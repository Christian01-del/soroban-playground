//! Typed storage accessors.
//!
//! Every persistent read is paired with a TTL bump so a live schedule cannot be
//! archived out from under a beneficiary between claims.

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Milestone, VestingError, VestingSchedule};

/// Instance storage TTL bump bounds (~1 day threshold, extended to ~30 days).
pub const INSTANCE_BUMP_THRESHOLD: u32 = 17_280;
pub const INSTANCE_EXTEND_TO: u32 = 518_400;

/// Persistent storage TTL bump bounds (~1 day threshold, extended to ~30 days).
pub const PERSISTENT_BUMP_THRESHOLD: u32 = 17_280;
pub const PERSISTENT_EXTEND_TO: u32 = 518_400;

/// Bump the instance TTL after a state-touching invocation.
pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_EXTEND_TO);
}

/// Bump a persistent entry's TTL after reading or writing it.
pub fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_EXTEND_TO);
}

// ── Instance config ─────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn admin(env: &Env) -> Result<Address, VestingError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(VestingError::NotInitialized)
}

/// Read the admin and require its authorisation. Used by every admin-only
/// entrypoint so authorisation is never forgotten.
pub fn require_admin(env: &Env) -> Result<Address, VestingError> {
    let admin = admin(env)?;
    admin.require_auth();
    Ok(admin)
}

pub fn read_token(env: &Env) -> Result<Address, VestingError> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(VestingError::NotInitialized)
}

// ── Schedules ───────────────────────────────────────────────────────────────

pub fn schedule_key(beneficiary: &Address) -> DataKey {
    DataKey::Vesting(beneficiary.clone())
}

pub fn milestone_key(beneficiary: &Address, milestone_id: u32) -> DataKey {
    DataKey::Milestone(beneficiary.clone(), milestone_id)
}

pub fn load_schedule(env: &Env, beneficiary: &Address) -> Result<VestingSchedule, VestingError> {
    let key = schedule_key(beneficiary);
    let schedule: VestingSchedule = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(VestingError::NoVestingSchedule)?;
    bump_persistent(env, &key);
    Ok(schedule)
}

pub fn try_load_schedule(env: &Env, beneficiary: &Address) -> Option<VestingSchedule> {
    let key = schedule_key(beneficiary);
    let schedule: Option<VestingSchedule> = env.storage().persistent().get(&key);
    if schedule.is_some() {
        bump_persistent(env, &key);
    }
    schedule
}

pub fn has_schedule(env: &Env, beneficiary: &Address) -> bool {
    env.storage().persistent().has(&schedule_key(beneficiary))
}

pub fn save_schedule(env: &Env, beneficiary: &Address, schedule: &VestingSchedule) {
    let key = schedule_key(beneficiary);
    env.storage().persistent().set(&key, schedule);
    bump_persistent(env, &key);
}

// ── Milestones ──────────────────────────────────────────────────────────────

pub fn load_milestone(
    env: &Env,
    beneficiary: &Address,
    milestone_id: u32,
) -> Result<Milestone, VestingError> {
    let key = milestone_key(beneficiary, milestone_id);
    let milestone: Option<Milestone> = env.storage().persistent().get(&key);
    if milestone.is_none() {
        return Err(VestingError::MilestoneNotFound);
    }
    bump_persistent(env, &key);
    milestone.ok_or(VestingError::MilestoneNotFound)
}

pub fn try_load_milestone(
    env: &Env,
    beneficiary: &Address,
    milestone_id: u32,
) -> Option<Milestone> {
    let key = milestone_key(beneficiary, milestone_id);
    let milestone: Option<Milestone> = env.storage().persistent().get(&key);
    if milestone.is_some() {
        bump_persistent(env, &key);
    }
    milestone
}

pub fn save_milestone(env: &Env, beneficiary: &Address, milestone_id: u32, m: &Milestone) {
    let key = milestone_key(beneficiary, milestone_id);
    env.storage().persistent().set(&key, m);
    bump_persistent(env, &key);
}

pub fn remove_milestone(env: &Env, beneficiary: &Address, milestone_id: u32) {
    env.storage()
        .persistent()
        .remove(&milestone_key(beneficiary, milestone_id));
}

/// Cumulative basis points of every **unlocked** milestone of a schedule.
///
/// This is the quantity the engine multiplies by — cumulative, not per-milestone
/// — so milestone rounding dust cannot accumulate (see [`crate::math`]).
pub fn unlocked_bps(
    env: &Env,
    beneficiary: &Address,
    milestone_count: u32,
) -> Result<u32, VestingError> {
    let total = sum_bps(env, beneficiary, milestone_count, true)?;
    if total > crate::math::BPS_DENOMINATOR {
        return Err(VestingError::MilestoneAllocationExceeded);
    }
    Ok(total)
}

/// Cumulative basis points of every **registered** milestone, locked or not.
///
/// Bounding the *total* allocation at 100% has to consider milestones that have
/// not been unlocked yet, otherwise a schedule could accumulate several
/// allocations that each look safe in isolation but jointly exceed the escrow.
pub fn allocated_bps(
    env: &Env,
    beneficiary: &Address,
    milestone_count: u32,
) -> Result<u32, VestingError> {
    sum_bps(env, beneficiary, milestone_count, false)
}

fn sum_bps(
    env: &Env,
    beneficiary: &Address,
    milestone_count: u32,
    only_unlocked: bool,
) -> Result<u32, VestingError> {
    let mut total: u32 = 0;
    for id in 0..milestone_count {
        if let Some(m) = try_load_milestone(env, beneficiary, id) {
            if !only_unlocked || m.unlocked {
                total = total
                    .checked_add(m.percent_bps)
                    .ok_or(VestingError::ArithmeticError)?;
            }
        }
    }
    Ok(total)
}
