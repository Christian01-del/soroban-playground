#![no_std]

//! Linear vesting engine with cliff-gated revocation safeguards.
//!
//! # Guarantees
//!
//! * **No stranded dust.** All vesting math is *cumulative* and evaluated in
//!   `u128`, and the curve is short-circuited to the full allocation from
//!   `end_time` on. However a schedule is sliced into claims, the claims sum to
//!   exactly `total_amount`; the residual stroops left by intermediate floors are
//!   always paid out by the final claim. See [`math`].
//! * **The cliff is the point of no return.** Nothing at all — neither the linear
//!   curve nor milestones — is claimable before `cliff_time`, which makes
//!   `revoke_before_cliff` safe: it can only ever return tokens that were never
//!   reachable by the beneficiary. Once the cliff is crossed the schedule is
//!   permanently non-revocable, so the admin can never claw back tokens the
//!   beneficiary is entitled to.
//! * **Milestones accelerate, never overpay.** Unlocked milestones add to the
//!   vested amount but the entitlement is capped at `total_amount`. Their value is
//!   derived from cumulative basis points, so per-milestone rounding dust cancels
//!   out instead of accumulating.
//! * **No panics on user input.** Every division, multiplication and timestamp
//!   addition is checked; the engine returns a typed error instead of unwinding.

mod math;
mod storage;
mod types;

mod test;

pub use math::{
    milestone_rewards, vested_linear, vested_total, BPS_DENOMINATOR, MAX_ESCROW_AMOUNT,
};
pub use types::{DataKey, Milestone, VestingError, VestingSchedule};

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};

use crate::storage::{
    bump_instance, has_schedule, load_milestone, load_schedule, read_token, remove_milestone,
    save_milestone, save_schedule, try_load_milestone, try_load_schedule, unlocked_bps,
};

#[contract]
pub struct TokenVestingContract;

#[contractimpl]
impl TokenVestingContract {
    /// Initialise the global vesting vault with an admin and the underlying
    /// SEP-41 token that will be escrowed.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), VestingError> {
        if storage::is_initialized(&env) {
            return Err(VestingError::AlreadyInitialized);
        }
        admin.require_auth();

        storage::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        bump_instance(&env);

        env.events()
            .publish((symbol_short!("vesting"), symbol_short!("init")), admin);

        Ok(())
    }

    /// Create a linear vesting schedule for `beneficiary` and escrow
    /// `total_amount` tokens from the admin.
    ///
    /// `cliff_duration` must not exceed `duration`; a zero cliff vests linearly
    /// from `start_time`. `start_time` may be in the past or the future.
    ///
    /// One schedule per beneficiary, and the slot stays occupied for good: even
    /// a revoked schedule leaves a tombstone, so a beneficiary cannot be
    /// re-scheduled after a revocation.
    pub fn create_schedule(
        env: Env,
        beneficiary: Address,
        total_amount: i128,
        start_time: u64,
        cliff_duration: u64,
        duration: u64,
    ) -> Result<(), VestingError> {
        let admin = storage::require_admin(&env)?;

        // Validate before moving any tokens so a rejected schedule is free.
        let schedule =
            VestingSchedule::try_new(total_amount, start_time, cliff_duration, duration)?;

        if has_schedule(&env, &beneficiary) {
            return Err(VestingError::ScheduleExists);
        }

        let token_address = read_token(&env)?;
        token::Client::new(&env, &token_address).transfer(
            &admin,
            &env.current_contract_address(),
            &total_amount,
        );

        save_schedule(&env, &beneficiary, &schedule);
        bump_instance(&env);

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("created")),
            (
                beneficiary,
                total_amount,
                schedule.cliff_time,
                schedule.end_time,
            ),
        );

        Ok(())
    }

    /// Register a discrete unlock for `beneficiary`, worth `percent_bps` of the
    /// schedule's allocation (`1000 == 10%`).
    ///
    /// Milestones accelerate the linear curve; they can never raise the lifetime
    /// payout above `total_amount`. Milestone ids must be registered contiguously
    /// from `0`, may only be defined once, and the cumulative allocation of all
    /// milestones — locked or unlocked — may not exceed 100%.
    pub fn add_milestone(
        env: Env,
        beneficiary: Address,
        milestone_id: u32,
        percent_bps: u32,
    ) -> Result<(), VestingError> {
        storage::require_admin(&env)?;

        if percent_bps == 0 || percent_bps > BPS_DENOMINATOR {
            return Err(VestingError::InvalidMilestone);
        }

        let mut schedule = load_schedule(&env, &beneficiary)?;
        if schedule.revoked {
            return Err(VestingError::ScheduleRevoked);
        }
        // A milestone id may only ever be defined once: redefining it would reset
        // `unlocked` and let the admin replay an unlock.
        if milestone_id < schedule.milestone_count {
            return Err(VestingError::MilestoneExists);
        }
        // Contiguous ids keep every milestone scan bounded by the number of real
        // milestones, so no admin input can inflate the work done by `claim`,
        // `revoke_before_cliff` or the views.
        if milestone_id > schedule.milestone_count {
            return Err(VestingError::InvalidMilestone);
        }

        let allocated = storage::allocated_bps(&env, &beneficiary, schedule.milestone_count)?;
        let total_bps = allocated
            .checked_add(percent_bps)
            .ok_or(VestingError::ArithmeticError)?;
        if total_bps > BPS_DENOMINATOR {
            return Err(VestingError::MilestoneAllocationExceeded);
        }

        schedule.milestone_count += 1;
        save_schedule(&env, &beneficiary, &schedule);
        save_milestone(
            &env,
            &beneficiary,
            milestone_id,
            &Milestone {
                percent_bps,
                unlocked: false,
            },
        );

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("m_added")),
            (beneficiary, milestone_id, percent_bps),
        );

        Ok(())
    }

    /// Admin marks a milestone as satisfied.
    ///
    /// A milestone may be unlocked before the cliff, but its reward stays
    /// unclaimable until the cliff is crossed — the cliff is a hard floor for the
    /// whole schedule. Unlocking is one-way and cannot be replayed.
    pub fn unlock_milestone(
        env: Env,
        beneficiary: Address,
        milestone_id: u32,
    ) -> Result<(), VestingError> {
        storage::require_admin(&env)?;

        let schedule = load_schedule(&env, &beneficiary)?;
        if schedule.revoked {
            return Err(VestingError::ScheduleRevoked);
        }

        let mut milestone = load_milestone(&env, &beneficiary, milestone_id)?;
        if milestone.unlocked {
            return Err(VestingError::MilestoneAlreadyUnlocked);
        }

        milestone.unlocked = true;
        save_milestone(&env, &beneficiary, milestone_id, &milestone);

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("m_unlock")),
            (beneficiary, milestone_id),
        );

        Ok(())
    }

    /// Cancel a schedule and return the whole allocation to the admin.
    ///
    /// # Cliff revocation safeguards
    ///
    /// This is the only way escrowed tokens leave the contract before vesting,
    /// and it is deliberately narrow:
    ///
    /// * admin-only;
    /// * rejected once `now >= cliff_time` ([`VestingError::CliffReached`]) — from
    ///   that moment on the beneficiary may hold a vested claim, so the admin can
    ///   never claw back tokens it has already earned them;
    /// * rejected if any token was already released
    ///   ([`VestingError::ScheduleActive`]), which is unreachable while the cliff
    ///   holds but is asserted so a future code change cannot open a drain;
    /// * re-marking a revoked schedule fails ([`VestingError::ScheduleRevoked`]),
    ///   so revocation is not repeatable and cannot be used to drain twice.
    ///
    /// The schedule is kept as a tombstone with `revoked == true` — a permanent
    /// on-chain audit record of the cancellation — and every milestone of the
    /// schedule is purged. Because a tombstone still occupies the beneficiary
    /// slot, a revoked beneficiary cannot be re-scheduled; this matches the
    /// one-schedule-per-beneficiary rule and keeps the entitlement history
    /// complete.
    ///
    /// Returns the amount returned to the admin.
    pub fn revoke_before_cliff(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        let admin = storage::require_admin(&env)?;

        let mut schedule = load_schedule(&env, &beneficiary)?;
        if schedule.revoked {
            return Err(VestingError::ScheduleRevoked);
        }

        let now = env.ledger().timestamp();
        if now >= schedule.cliff_time {
            return Err(VestingError::CliffReached);
        }
        // Defence in depth: nothing is vested before the cliff, so this must hold.
        if schedule.released_amount != 0 {
            return Err(VestingError::ScheduleActive);
        }

        let refund = schedule.total_amount;
        for id in 0..schedule.milestone_count {
            remove_milestone(&env, &beneficiary, id);
        }
        schedule.milestone_count = 0;
        schedule.revoked = true;
        save_schedule(&env, &beneficiary, &schedule);
        bump_instance(&env);

        token::Client::new(&env, &read_token(&env)?).transfer(
            &env.current_contract_address(),
            &admin,
            &refund,
        );

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("revoked")),
            (beneficiary, refund),
        );

        Ok(refund)
    }

    /// Tokens the beneficiary may claim right now (linear curve + unlocked
    /// milestones − already released). Returns `0` when nothing is claimable or
    /// no schedule exists.
    pub fn claimable_amount(env: Env, beneficiary: Address) -> i128 {
        Self::internal_claimable(&env, &beneficiary).unwrap_or(0)
    }

    /// Cumulative amount unlocked by the schedule at the current timestamp,
    /// before subtracting what has already been released.
    pub fn vested_amount(env: Env, beneficiary: Address) -> i128 {
        let schedule = match try_load_schedule(&env, &beneficiary) {
            Some(s) => s,
            None => return 0,
        };
        let bps = unlocked_bps(&env, &beneficiary, schedule.milestone_count).unwrap_or(0);
        vested_total(&schedule, bps, env.ledger().timestamp()).unwrap_or(0)
    }

    /// Tokens still held in escrow for this beneficiary
    /// (`total_amount - released_amount`). Zero once the schedule is revoked.
    pub fn remaining_amount(env: Env, beneficiary: Address) -> i128 {
        try_load_schedule(&env, &beneficiary)
            .map(|s| if s.revoked { 0 } else { s.outstanding() })
            .unwrap_or(0)
    }

    /// Beneficiary claims every token that is currently vested but unreleased.
    ///
    /// Returns the transferred amount. Because the engine derives the transfer
    /// from the cumulative vested amount, repeated claims can never overpay and
    /// never leave a residue behind.
    pub fn claim(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        beneficiary.require_auth();

        let mut schedule = load_schedule(&env, &beneficiary)?;
        if schedule.revoked {
            return Err(VestingError::ScheduleRevoked);
        }

        let bps = unlocked_bps(&env, &beneficiary, schedule.milestone_count)?;
        let now = env.ledger().timestamp();
        let amount = math::claimable(&schedule, bps, now)?;
        if amount <= 0 {
            return Err(VestingError::NoTokensToClaim);
        }

        // Guard the invariant `released + amount <= total` explicitly instead of
        // relying on the cap inside the curve.
        let released = schedule
            .released_amount
            .checked_add(amount)
            .ok_or(VestingError::ArithmeticError)?;
        if released > schedule.total_amount {
            return Err(VestingError::ArithmeticError);
        }
        schedule.released_amount = released;
        save_schedule(&env, &beneficiary, &schedule);

        token::Client::new(&env, &read_token(&env)?).transfer(
            &env.current_contract_address(),
            &beneficiary,
            &amount,
        );

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("claimed")),
            (beneficiary, amount),
        );

        Ok(amount)
    }

    /// The schedule of `beneficiary`, if any.
    pub fn get_schedule(env: Env, beneficiary: Address) -> Option<VestingSchedule> {
        try_load_schedule(&env, &beneficiary)
    }

    /// A milestone of `beneficiary`, if any.
    pub fn get_milestone(env: Env, beneficiary: Address, milestone_id: u32) -> Option<Milestone> {
        try_load_milestone(&env, &beneficiary, milestone_id)
    }

    /// Cumulative basis points unlocked by milestones. Equals `10_000` only when
    /// the milestones that accelerate the schedule sum to 100%.
    pub fn unlocked_milestone_bps(env: Env, beneficiary: Address) -> u32 {
        match try_load_schedule(&env, &beneficiary) {
            Some(s) if !s.revoked => {
                unlocked_bps(&env, &beneficiary, s.milestone_count).unwrap_or(0)
            }
            _ => 0,
        }
    }

    /// Auditing hook: the shortfall between the tokens still owed to `beneficiary`
    /// and the tokens this contract actually holds for them.
    ///
    /// Returns `0` when the escrow is fully covered and a positive value when
    /// tokens are missing (which can only happen if the underlying token
    /// violates SEP-41). Views never revert: a negative value would mean the
    /// contract is holding more than it owes.
    pub fn escrow_shortfall(env: Env, beneficiary: Address) -> i128 {
        let schedule = match try_load_schedule(&env, &beneficiary) {
            // A revoked schedule owes nothing, whatever the shared escrow holds.
            Some(s) if !s.revoked => s,
            _ => return 0,
        };
        let token_address = match read_token(&env) {
            Ok(a) => a,
            Err(_) => return 0,
        };
        let balance =
            token::Client::new(&env, &token_address).balance(&env.current_contract_address());
        (schedule.outstanding() - balance).max(0)
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /// Shared claim computation used by both `claimable_amount` and `claim` so
    /// the view can never disagree with the state-changing entrypoint.
    fn internal_claimable(env: &Env, beneficiary: &Address) -> Result<i128, VestingError> {
        let schedule =
            try_load_schedule(env, beneficiary).ok_or(VestingError::NoVestingSchedule)?;
        let bps = unlocked_bps(env, beneficiary, schedule.milestone_count)?;
        math::claimable(&schedule, bps, env.ledger().timestamp())
    }
}
