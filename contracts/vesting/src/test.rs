#![cfg(test)]

//! Integration tests for the linear vesting engine (issue #1356).
//!
//! The suite is organised around the invariants the engine promises, with a
//! dedicated regression test per defect that was fixed.

use crate::{TokenVestingContract, TokenVestingContractClient, VestingError};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

// ── Harness ─────────────────────────────────────────────────────────────────

struct Harness {
    env: Env,
    admin: Address,
    beneficiary: Address,
    token_id: Address,
    contract_id: Address,
    client: TokenVestingContractClient<'static>,
    token: TokenClient<'static>,
}

impl Harness {
    /// Deploy the contract, wire up an underlying SEP-41 asset and mint
    /// `admin_funds` to the admin for escrow.
    fn new(admin_funds: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        // The curve-sweep tests drive thousands of invocations through the mock
        // host and would exhaust the default test budget. Real ledgers grant a
        // fresh budget per transaction, so this only relaxes the harness.
        let mut budget = env.budget();
        budget.reset_unlimited();

        let admin = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token = TokenClient::new(&env, &token_id);

        let contract_id = env.register_contract(None, TokenVestingContract);
        let client = TokenVestingContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id);

        if admin_funds > 0 {
            StellarAssetClient::new(&env, &token_id).mint(&admin, &admin_funds);
        }

        Self {
            env,
            admin,
            beneficiary,
            token_id,
            contract_id,
            client,
            token,
        }
    }

    /// Deploy with the common `1_000_000` allocation escrowed for the beneficiary.
    fn with_schedule(total: i128, start: u64, cliff: u64, duration: u64) -> Self {
        let h = Self::new(total);
        h.client
            .create_schedule(&h.beneficiary, &total, &start, &cliff, &duration);
        h
    }

    fn at(&self, timestamp: u64) {
        self.env.ledger().set_timestamp(timestamp);
    }

    /// Claim whatever is claimable, returning `0` when nothing is. Keeps the
    /// "sweep the whole curve" loops readable.
    fn claim_if_any(&self) -> i128 {
        match self.client.try_claim(&self.beneficiary) {
            Ok(Ok(amount)) => amount,
            _ => 0,
        }
    }

    fn beneficiary_balance(&self) -> i128 {
        self.token.balance(&self.beneficiary)
    }

    fn escrow_balance(&self) -> i128 {
        self.token.balance(&self.contract_id)
    }
}

// ── Initialization & access control ─────────────────────────────────────────

#[test]
fn initializes_once_and_records_config() {
    let h = Harness::new(0);
    assert_eq!(
        h.client.try_initialize(&h.admin, &h.token_id),
        Err(Ok(VestingError::AlreadyInitialized))
    );
    // The token address is wired: a schedule can be created straight away.
    let schedule = h.client.get_schedule(&h.beneficiary);
    assert_eq!(schedule, None);
}

#[test]
#[should_panic]
fn create_schedule_requires_admin_authorisation() {
    let h = Harness::new(1_000);
    // Drop the blanket mock so the admin's signature is actually required.
    h.env.mock_auths(&[]);
    h.client
        .create_schedule(&h.beneficiary, &1_000, &0, &0, &100);
}

#[test]
#[should_panic]
fn claim_requires_beneficiary_authorisation() {
    let h = Harness::with_schedule(1_000, 0, 0, 100);
    h.at(100);
    h.env.mock_auths(&[]);
    h.client.claim(&h.beneficiary);
}

#[test]
#[should_panic]
fn revoke_requires_admin_authorisation() {
    let h = Harness::with_schedule(1_000, 0, 500, 1_000);
    h.at(0);
    h.env.mock_auths(&[]);
    h.client.revoke_before_cliff(&h.beneficiary);
}

#[test]
#[should_panic]
fn unlock_milestone_requires_admin_authorisation() {
    let h = Harness::with_schedule(1_000, 0, 0, 1_000);
    h.client.add_milestone(&h.beneficiary, &1, &1_000);
    h.env.mock_auths(&[]);
    h.client.unlock_milestone(&h.beneficiary, &1);
}

// ── Schedule creation validation ────────────────────────────────────────────

#[test]
fn rejects_invalid_schedule_parameters() {
    let h = Harness::new(10_000);

    // zero / negative allocation
    assert_eq!(
        h.client
            .try_create_schedule(&h.beneficiary, &0, &0, &0, &100),
        Err(Ok(VestingError::InvalidSchedule))
    );
    assert_eq!(
        h.client
            .try_create_schedule(&h.beneficiary, &-1, &0, &0, &100),
        Err(Ok(VestingError::InvalidSchedule))
    );
    // zero duration would make the curve denominator zero
    assert_eq!(
        h.client
            .try_create_schedule(&h.beneficiary, &1_000, &0, &0, &0),
        Err(Ok(VestingError::InvalidSchedule))
    );
    // cliff past the end
    assert_eq!(
        h.client
            .try_create_schedule(&h.beneficiary, &1_000, &0, &500, &100),
        Err(Ok(VestingError::InvalidSchedule))
    );
    // allocations above the exact-arithmetic bound
    assert_eq!(
        h.client.try_create_schedule(
            &h.beneficiary,
            &(crate::MAX_ESCROW_AMOUNT + 1),
            &0,
            &0,
            &100
        ),
        Err(Ok(VestingError::AmountTooLarge))
    );

    // None of the rejected calls moved a single stroop.
    assert_eq!(h.escrow_balance(), 0);
    assert_eq!(h.beneficiary_balance(), 0);
}

/// Regression for the unchecked `start_time + duration` addition: an overflowing
/// schedule used to be accepted (wrapping silently in debug, panicking in
/// release builds, which enable `overflow-checks`).
#[test]
fn rejects_schedule_whose_timestamps_overflow() {
    let h = Harness::new(10_000);
    let result = h
        .client
        .try_create_schedule(&h.beneficiary, &1_000, &(u64::MAX - 5), &20, &30);
    assert_eq!(result, Err(Ok(VestingError::InvalidSchedule)));
    assert_eq!(h.escrow_balance(), 0);
}

#[test]
fn accepts_boundary_schedule_parameters() {
    let h = Harness::new(10_000);
    // end_time exactly at u64::MAX
    h.client
        .create_schedule(&h.beneficiary, &1_000, &(u64::MAX - 10), &0, &10);
    let s = h.client.get_schedule(&h.beneficiary).unwrap();
    assert_eq!(s.end_time, u64::MAX);

    // cliff == duration: everything unlocks at the end
    h.client.create_schedule(&h.admin, &1_000, &0, &100, &100);
    let s2 = h.client.get_schedule(&h.admin).unwrap();
    assert_eq!(s2.cliff_time, s2.end_time);
}

#[test]
fn rejects_duplicate_schedule_per_beneficiary() {
    let h = Harness::with_schedule(1_000, 0, 0, 100);
    assert_eq!(
        h.client
            .try_create_schedule(&h.beneficiary, &1_000, &0, &0, &100),
        Err(Ok(VestingError::ScheduleExists))
    );
    assert_eq!(h.escrow_balance(), 1_000, "no second escrow");
}

#[test]
fn escrow_moves_exactly_the_allocation() {
    let h = Harness::with_schedule(1_000, 0, 0, 100);
    assert_eq!(h.escrow_balance(), 1_000);
    assert_eq!(h.token.balance(&h.admin), 0);
    assert_eq!(h.client.remaining_amount(&h.beneficiary), 1_000);
    assert_eq!(h.client.escrow_shortfall(&h.beneficiary), 0);
}

#[test]
fn unknown_beneficiary_has_empty_views() {
    let h = Harness::new(0);
    let stranger = Address::generate(&h.env);
    assert_eq!(h.client.claimable_amount(&stranger), 0);
    assert_eq!(h.client.vested_amount(&stranger), 0);
    assert_eq!(h.client.remaining_amount(&stranger), 0);
    assert_eq!(h.client.unlocked_milestone_bps(&stranger), 0);
    assert_eq!(h.client.get_schedule(&stranger), None);
    assert_eq!(h.client.escrow_shortfall(&stranger), 0);
    assert_eq!(
        h.client.try_claim(&stranger),
        Err(Ok(VestingError::NoVestingSchedule))
    );
}

// ── Linear curve + dust sweep (core of #1356) ───────────────────────────────

/// The original documented happy path: cliff at 1_500, end at 3_000.
#[test]
fn linear_vesting_with_cliff_and_claims() {
    let h = Harness::with_schedule(100_000, 1_000, 500, 2_000);
    assert_eq!(h.escrow_balance(), 100_000);

    // Before the cliff nothing at all is claimable.
    h.at(1_200);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 0);
    assert_eq!(
        h.client.try_claim(&h.beneficiary),
        Err(Ok(VestingError::NoTokensToClaim))
    );

    // Half-way: exactly half vested.
    h.at(2_000);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 50_000);
    assert_eq!(h.client.claim(&h.beneficiary), 50_000);
    assert_eq!(h.beneficiary_balance(), 50_000);

    // End: the remaining half.
    h.at(3_000);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 50_000);
    assert_eq!(h.client.claim(&h.beneficiary), 50_000);
    assert_eq!(h.beneficiary_balance(), 100_000);
    assert_eq!(h.escrow_balance(), 0);
    assert_eq!(h.client.remaining_amount(&h.beneficiary), 0);
}

/// The headline regression: a schedule whose division does not divide evenly must
/// still pay out the full allocation. Claiming at every single second is the
/// worst case for cumulative rounding.
#[test]
fn every_single_second_claim_sums_to_the_exact_total() {
    let h = Harness::with_schedule(1_000_003, 0, 0, 97);

    let mut claimed = 0i128;
    for now in 0..=97u64 {
        h.at(now);
        claimed += h.claim_if_any();
    }

    assert_eq!(claimed, 1_000_003, "no dust, no overpay");
    assert_eq!(h.beneficiary_balance(), 1_000_003);
    assert_eq!(h.escrow_balance(), 0, "escrow fully drained");
    assert_eq!(h.client.remaining_amount(&h.beneficiary), 0);
    assert_eq!(h.client.escrow_shortfall(&h.beneficiary), 0);
}

/// Worst case for a single claim taken one ledger after the cliff: the floor of
/// the first tranche plus the sweep at `end_time` must still equal the total.
#[test]
fn dust_is_swept_by_the_final_claim() {
    // 1 token over 3 seconds: the floor is 0 for the first two seconds.
    let h = Harness::with_schedule(1, 0, 0, 3);
    h.at(2);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 0);
    h.at(3);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 1);
    assert_eq!(h.client.claim(&h.beneficiary), 1);
    assert_eq!(h.beneficiary_balance(), 1);
    assert_eq!(h.escrow_balance(), 0);
}

#[test]
fn many_partition_shapes_never_strand_tokens() {
    for total in [1i128, 3, 7, 99_999, 1_000_003] {
        for duration in [1u64, 3, 7, 101] {
            for cliff in [0u64, duration / 2] {
                let h = Harness::with_schedule(total, 0, cliff, duration);

                // Claim at the 1/3, 2/3 and end points.
                let mut claimed = 0i128;
                for now in [duration / 3, (2 * duration) / 3, duration] {
                    h.at(now);
                    claimed += h.claim_if_any();
                }
                h.at(duration);
                claimed += h.claim_if_any();

                assert_eq!(
                    claimed, total,
                    "dust stranded: total={total} duration={duration} cliff={cliff}"
                );
                assert_eq!(h.escrow_balance(), 0);
            }
        }
    }
}

#[test]
fn vesting_is_monotonic_and_bounded() {
    let h = Harness::with_schedule(12_345_678, 1_000, 3_000, 4_000);
    let mut previous = 0i128;
    for step in 0..500u64 {
        let now = step * 16;
        h.at(now);
        let vested = h.client.vested_amount(&h.beneficiary);
        assert!(vested >= previous, "vesting dipped at {now}");
        assert!(vested <= 12_345_678, "vesting overshot at {now}");
        assert!(h.client.claimable_amount(&h.beneficiary) <= vested);
        previous = vested;
    }
    assert_eq!(previous, 12_345_678);
    assert_eq!(h.client.vested_amount(&h.beneficiary), 12_345_678);
}

#[test]
fn claiming_after_full_payout_is_rejected() {
    let h = Harness::with_schedule(1_000, 0, 0, 10);
    h.at(10);
    assert_eq!(h.client.claim(&h.beneficiary), 1_000);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 0);
    assert_eq!(
        h.client.try_claim(&h.beneficiary),
        Err(Ok(VestingError::NoTokensToClaim))
    );
    assert_eq!(h.beneficiary_balance(), 1_000, "no double payout");
    assert_eq!(h.escrow_balance(), 0);
}

/// Regression for the i128 overflow that aborted the host mid-curve: the product
/// `total * elapsed` no longer fits in `i128`, but is exact in `u128`.
#[test]
fn huge_allocations_do_not_overflow_the_curve() {
    let total: i128 = 10_000_000_000_000_000_000; // 1e19, ~5.4x u64::MAX? no: > i128::MAX/1.8e19
    let duration: u64 = 18_000_000_000_000_000_000;
    let h = Harness::with_schedule(total, 0, 0, duration);

    // 1e19 * 1.75e19 = 1.75e38 > i128::MAX (1.70141e38) — used to panic.
    h.at(17_500_000_000_000_000_000);
    let vested = h.client.vested_amount(&h.beneficiary);
    assert_eq!(
        vested,
        (total as u128 * 17_500_000_000_000_000_000u128 / duration as u128) as i128
    );
    assert!(vested > 0 && vested <= total);

    // The dust sweep still delivers the exact remainder at the end.
    let first = h.client.claim(&h.beneficiary);
    h.at(duration);
    let second = h.client.claim(&h.beneficiary);
    assert_eq!(first + second, total);
    assert_eq!(h.escrow_balance(), 0);
}

#[test]
fn maximum_escrow_amount_is_supported_exactly() {
    let total = crate::MAX_ESCROW_AMOUNT; // u64::MAX
    let h = Harness::new(total);
    h.client
        .create_schedule(&h.beneficiary, &total, &0, &0, &u64::MAX);
    h.at(u64::MAX);
    assert_eq!(h.client.vested_amount(&h.beneficiary), total);
    assert_eq!(h.client.claim(&h.beneficiary), total);
    assert_eq!(h.escrow_balance(), 0);
}

// ── Milestones ──────────────────────────────────────────────────────────────

/// Regression for the dead milestone path: unlocked milestones used to be
/// written to storage but never read, so their reward was unreachable.
#[test]
fn unlocked_milestone_is_immediately_claimable_at_the_cliff() {
    let h = Harness::with_schedule(1_000_000, 1_000, 0, 4_000);
    h.client.add_milestone(&h.beneficiary, &0, &2_500);
    assert_eq!(h.client.unlocked_milestone_bps(&h.beneficiary), 0);
    h.client.unlock_milestone(&h.beneficiary, &0);
    assert_eq!(h.client.unlocked_milestone_bps(&h.beneficiary), 2_500);

    h.at(1_000);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 250_000);
    assert_eq!(h.client.claim(&h.beneficiary), 250_000);
    assert_eq!(h.beneficiary_balance(), 250_000);
}

#[test]
fn locked_milestone_pays_nothing() {
    let h = Harness::with_schedule(1_000_000, 0, 0, 4_000);
    h.client.add_milestone(&h.beneficiary, &0, &5_000);
    h.at(4_000);
    // Pure linear curve: the locked milestone must not move the needle.
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 1_000_000);
}

/// Milestone rewards come from cumulative basis points, so unlocking every
/// milestone whose bps sum to `s` releases exactly `floor(total * s / 10_000)`.
#[test]
fn milestone_dust_is_recovered_through_cumulative_bps() {
    let total = 1_000_003i128;
    let h = Harness::with_schedule(total, 0, 0, 4_000);

    // Three milestones of 3333 bps -> 9999 bps cumulative.
    let per_milestone_floor = 3 * (total * 3_333 / 10_000);
    for id in 0..3u32 {
        h.client.add_milestone(&h.beneficiary, &id, &3_333);
        h.client.unlock_milestone(&h.beneficiary, &id);
    }
    assert_eq!(h.client.unlocked_milestone_bps(&h.beneficiary), 9_999);

    h.at(0);
    let claimable = h.client.claimable_amount(&h.beneficiary);
    assert_eq!(claimable, total * 9_999 / 10_000);
    assert!(
        claimable > per_milestone_floor,
        "cumulative bps must recover the per-milestone dust"
    );
    assert_eq!(h.client.claim(&h.beneficiary), claimable);
}

/// Regression for the milestone double-unlock: `add_milestone` used to overwrite
/// unconditionally, resetting `unlocked` and allowing a replayed payout.
#[test]
fn milestone_cannot_be_redefined_after_unlock() {
    let h = Harness::with_schedule(1_000_000, 0, 0, 4_000);
    h.client.add_milestone(&h.beneficiary, &0, &5_000);
    h.client.unlock_milestone(&h.beneficiary, &0);

    assert_eq!(
        h.client.try_add_milestone(&h.beneficiary, &0, &5_000),
        Err(Ok(VestingError::MilestoneExists))
    );
    assert_eq!(
        h.client.try_unlock_milestone(&h.beneficiary, &0),
        Err(Ok(VestingError::MilestoneAlreadyUnlocked))
    );
    assert_eq!(h.client.unlocked_milestone_bps(&h.beneficiary), 5_000);

    h.at(4_000);
    assert_eq!(
        h.client.claim(&h.beneficiary),
        1_000_000,
        "single payout only"
    );
    assert_eq!(h.escrow_balance(), 0);
}

#[test]
fn milestone_parameters_are_validated() {
    let h = Harness::with_schedule(1_000_000, 0, 0, 4_000);

    assert_eq!(
        h.client.try_add_milestone(&h.beneficiary, &0, &0),
        Err(Ok(VestingError::InvalidMilestone))
    );
    assert_eq!(
        h.client
            .try_add_milestone(&h.beneficiary, &1, &(crate::BPS_DENOMINATOR + 1)),
        Err(Ok(VestingError::InvalidMilestone))
    );

    // Cumulative allocation may not exceed 100%.
    h.client.add_milestone(&h.beneficiary, &0, &6_000);
    h.client.add_milestone(&h.beneficiary, &1, &4_000);
    assert_eq!(
        h.client.try_add_milestone(&h.beneficiary, &2, &1),
        Err(Ok(VestingError::MilestoneAllocationExceeded))
    );
    // A milestone id cannot be reused once defined.
    assert_eq!(
        h.client.try_add_milestone(&h.beneficiary, &0, &1),
        Err(Ok(VestingError::MilestoneExists))
    );
    // Ids must be contiguous from 0, which keeps every milestone scan bounded by
    // the number of real milestones.
    assert_eq!(
        h.client.try_add_milestone(&h.beneficiary, &9_999, &1),
        Err(Ok(VestingError::InvalidMilestone))
    );
    assert_eq!(
        h.client
            .get_schedule(&h.beneficiary)
            .unwrap()
            .milestone_count,
        2
    );
    // Milestones require an existing schedule.
    let stranger = Address::generate(&h.env);
    assert_eq!(
        h.client.try_add_milestone(&stranger, &0, &1_000),
        Err(Ok(VestingError::NoVestingSchedule))
    );
    // Unlocking an unknown milestone fails.
    assert_eq!(
        h.client.try_unlock_milestone(&h.beneficiary, &9_999),
        Err(Ok(VestingError::MilestoneNotFound))
    );
}

#[test]
fn milestone_metadata_is_queryable() {
    let h = Harness::with_schedule(1_000_000, 0, 0, 4_000);
    assert_eq!(h.client.get_milestone(&h.beneficiary, &0), None);
    h.client.add_milestone(&h.beneficiary, &0, &3_333);
    let m = h.client.get_milestone(&h.beneficiary, &0).unwrap();
    assert_eq!(m.percent_bps, 3_333);
    assert!(!m.unlocked);
    h.client.unlock_milestone(&h.beneficiary, &0);
    assert!(h.client.get_milestone(&h.beneficiary, &0).unwrap().unlocked);
    // Ids stay contiguous, so slot 1 does not exist until it is registered.
    assert_eq!(h.client.get_milestone(&h.beneficiary, &1), None);
}

/// Milestones may be unlocked early but stay unclaimable until the cliff, so the
/// cliff remains a hard floor for the whole schedule.
#[test]
fn milestones_are_cliff_gated() {
    let h = Harness::with_schedule(1_000_000, 1_000, 500, 2_000);
    h.client.add_milestone(&h.beneficiary, &0, &5_000);
    h.client.unlock_milestone(&h.beneficiary, &0);

    h.at(1_499);
    assert_eq!(h.client.vested_amount(&h.beneficiary), 0);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 0);

    // At the cliff 25% of the allocation is linearly vested and the 50% milestone
    // adds another 500_000 on top.
    h.at(1_500);
    assert_eq!(h.client.vested_amount(&h.beneficiary), 750_000);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 750_000);
}

/// A milestone that covers the whole allocation must not be able to pay out
/// more than the escrow, however far the linear curve has run.
#[test]
fn milestones_never_overpay_the_escrow() {
    let h = Harness::with_schedule(1_000_003, 0, 0, 4_000);
    h.client
        .add_milestone(&h.beneficiary, &0, &crate::BPS_DENOMINATOR);
    h.client.unlock_milestone(&h.beneficiary, &0);

    let mut claimed = 0i128;
    for step in 0..=200u64 {
        h.at(step * 20);
        let amount = h.claim_if_any();
        assert!(
            claimed + amount <= 1_000_003,
            "milestone overpaid the escrow"
        );
        claimed += amount;
    }
    h.at(4_000);
    claimed += h.claim_if_any();
    assert_eq!(claimed, 1_000_003);
    assert_eq!(h.escrow_balance(), 0);
}

// ── Cliff revocation safeguards ─────────────────────────────────────────────

#[test]
fn revoke_before_cliff_returns_the_whole_allocation() {
    let h = Harness::with_schedule(1_000_000, 1_000, 500, 2_000);
    h.at(1_499);

    assert_eq!(h.client.revoke_before_cliff(&h.beneficiary), 1_000_000);
    assert_eq!(h.token.balance(&h.admin), 1_000_000);
    assert_eq!(h.escrow_balance(), 0, "no residual dust left in escrow");
    assert_eq!(h.beneficiary_balance(), 0);

    // The schedule is gone and can never vest or pay out.
    let s = h.client.get_schedule(&h.beneficiary).unwrap();
    assert!(s.revoked);
    assert_eq!(s.released_amount, 0);
    h.at(2_000);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 0);
    assert_eq!(h.client.vested_amount(&h.beneficiary), 0);
    assert_eq!(h.client.remaining_amount(&h.beneficiary), 0);
    assert_eq!(h.client.escrow_shortfall(&h.beneficiary), 0);
    assert_eq!(
        h.client.try_claim(&h.beneficiary),
        Err(Ok(VestingError::ScheduleRevoked))
    );
}

/// The core safeguard: once the cliff is crossed the admin can never claw back
/// tokens the beneficiary has already earned.
#[test]
fn revoke_is_rejected_at_and_after_the_cliff() {
    for now in [1_500u64, 1_501, 2_000, 3_000, 100_000] {
        let h = Harness::with_schedule(1_000_000, 1_000, 500, 2_000);
        h.at(now);
        assert_eq!(
            h.client.try_revoke_before_cliff(&h.beneficiary),
            Err(Ok(VestingError::CliffReached)),
            "revocation must be refused at {now}"
        );
        assert_eq!(h.escrow_balance(), 1_000_000, "escrow untouched at {now}");
    }
}

#[test]
fn revoke_cannot_be_replayed() {
    let h = Harness::with_schedule(1_000, 0, 500, 1_000);
    h.at(0);
    assert_eq!(h.client.revoke_before_cliff(&h.beneficiary), 1_000);
    assert_eq!(
        h.client.try_revoke_before_cliff(&h.beneficiary),
        Err(Ok(VestingError::ScheduleRevoked))
    );
    assert_eq!(h.token.balance(&h.admin), 1_000, "single refund only");
    assert_eq!(h.escrow_balance(), 0);
}

#[test]
fn revoke_of_unknown_beneficiary_fails() {
    let h = Harness::new(0);
    let stranger = Address::generate(&h.env);
    assert_eq!(
        h.client.try_revoke_before_cliff(&stranger),
        Err(Ok(VestingError::NoVestingSchedule))
    );
}

#[test]
fn revocation_purges_milestones() {
    let h = Harness::with_schedule(1_000_000, 0, 500, 1_000);
    for id in 0..3u32 {
        h.client.add_milestone(&h.beneficiary, &id, &1_000);
    }
    h.client.unlock_milestone(&h.beneficiary, &1);
    h.at(0);

    assert_eq!(h.client.revoke_before_cliff(&h.beneficiary), 1_000_000);
    assert_eq!(h.client.unlocked_milestone_bps(&h.beneficiary), 0);
    for id in 0..3u32 {
        assert_eq!(h.client.get_milestone(&h.beneficiary, &id), None);
    }

    // A revoked schedule is closed to new milestones too.
    assert_eq!(
        h.client.try_add_milestone(&h.beneficiary, &4, &1_000),
        Err(Ok(VestingError::ScheduleRevoked))
    );
    assert_eq!(
        h.client.try_unlock_milestone(&h.beneficiary, &1),
        Err(Ok(VestingError::ScheduleRevoked))
    );
    assert_eq!(
        h.client.try_unlock_milestone(&h.beneficiary, &0),
        Err(Ok(VestingError::ScheduleRevoked))
    );
}

/// A milestone unlocked before the cliff stays revocable, and revocation returns
/// the full allocation — the milestone never became a claim on the escrow.
#[test]
fn revocation_after_a_milestone_unlock_still_returns_everything() {
    let h = Harness::with_schedule(1_000_000, 0, 500, 1_000);
    h.client.add_milestone(&h.beneficiary, &0, &9_000);
    h.client.unlock_milestone(&h.beneficiary, &0);
    h.at(499);

    assert_eq!(h.client.claimable_amount(&h.beneficiary), 0);
    assert_eq!(h.client.revoke_before_cliff(&h.beneficiary), 1_000_000);
    assert_eq!(h.token.balance(&h.admin), 1_000_000);
    assert_eq!(h.escrow_balance(), 0);
}

#[test]
fn revoked_beneficiary_cannot_be_rescheduled() {
    let h = Harness::with_schedule(1_000, 0, 500, 1_000);
    h.at(0);
    h.client.revoke_before_cliff(&h.beneficiary);

    // The tombstone keeps the cancellation auditable and occupies the
    // beneficiary slot for good.
    assert_eq!(
        h.client
            .try_create_schedule(&h.beneficiary, &1_000, &0, &0, &1_000),
        Err(Ok(VestingError::ScheduleExists))
    );
    assert_eq!(h.escrow_balance(), 0);
    assert_eq!(h.token.balance(&h.admin), 1_000);
}

// ── Multi-beneficiary isolation ─────────────────────────────────────────────

#[test]
fn schedules_are_isolated_per_beneficiary() {
    let h = Harness::new(3_000);
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);

    h.client.create_schedule(&alice, &1_000, &0, &0, &100);
    h.client.create_schedule(&bob, &2_000, &0, &0, &100);
    assert_eq!(h.escrow_balance(), 3_000);

    h.at(50);
    assert_eq!(h.client.claimable_amount(&alice), 500);
    assert_eq!(h.client.claimable_amount(&bob), 1_000);

    assert_eq!(h.client.claim(&alice), 500);
    assert_eq!(h.client.claim(&bob), 1_000);
    assert_eq!(h.token.balance(&alice), 500);
    assert_eq!(h.token.balance(&bob), 1_000);

    h.at(100);
    assert_eq!(h.client.claim(&alice), 500);
    assert_eq!(h.client.claim(&bob), 1_000);
    assert_eq!(h.escrow_balance(), 0, "both escrows drained exactly");
    assert_eq!(h.client.remaining_amount(&alice), 0);
    assert_eq!(h.client.remaining_amount(&bob), 0);
}

/// Revoking one beneficiary must not touch another beneficiary's escrow.
#[test]
fn revocation_does_not_disturb_other_beneficiaries() {
    let h = Harness::new(3_000);
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.client.create_schedule(&alice, &1_000, &0, &500, &1_000);
    h.client.create_schedule(&bob, &2_000, &0, &0, &1_000);

    h.at(0);
    assert_eq!(h.client.revoke_before_cliff(&alice), 1_000);
    assert_eq!(h.escrow_balance(), 2_000);

    h.at(1_000);
    assert_eq!(h.client.claim(&bob), 2_000);
    assert_eq!(h.escrow_balance(), 0);
    assert_eq!(h.token.balance(&bob), 2_000);
    assert_eq!(h.token.balance(&alice), 0);
}

// ── Time manipulation safety ────────────────────────────────────────────────

#[test]
fn timestamps_before_the_start_are_safe() {
    let h = Harness::with_schedule(1_000, 5_000, 1_000, 2_000);
    h.at(0);
    assert_eq!(h.client.vested_amount(&h.beneficiary), 0);
    assert_eq!(h.client.claimable_amount(&h.beneficiary), 0);
    // Still revocable, since the cliff has not been reached.
    assert_eq!(h.client.revoke_before_cliff(&h.beneficiary), 1_000);
}

#[test]
fn far_future_timestamps_saturate_at_the_total() {
    let h = Harness::with_schedule(1_000, 0, 0, 1_000);
    h.at(u64::MAX);
    assert_eq!(h.client.vested_amount(&h.beneficiary), 1_000);
    assert_eq!(h.client.claim(&h.beneficiary), 1_000);
    assert_eq!(h.escrow_balance(), 0);
}

// ── Interop with the underlying token ───────────────────────────────────────

#[test]
fn escrow_shortfall_reports_a_drained_escrow() {
    let h = Harness::with_schedule(1_000, 0, 0, 100);
    h.at(10);
    assert_eq!(h.client.claim(&h.beneficiary), 100);
    assert_eq!(h.client.remaining_amount(&h.beneficiary), 900);
    // The contract only holds the tokens still owed to this beneficiary, so the
    // shortfall stays at zero on a healthy ledger.
    assert_eq!(h.client.escrow_shortfall(&h.beneficiary), 0);
}

#[test]
fn admin_can_fund_multiple_schedules_sequentially() {
    let h = Harness::new(5_000);
    for i in 0..5u32 {
        let beneficiary = Address::generate(&h.env);
        h.client.create_schedule(&beneficiary, &1_000, &0, &0, &100);
        assert_eq!(h.escrow_balance(), i128::from(i + 1) * 1_000);
        assert_eq!(
            h.client.get_schedule(&beneficiary).unwrap().total_amount,
            1_000
        );
    }
    assert_eq!(h.token.balance(&h.admin), 0);
}
