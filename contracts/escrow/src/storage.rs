use crate::types::{Analytics, AtomicSwap, AtomicSwapStats, DataKey, Error, Escrow, Milestone};

// Approximately 30 and 90 days at Stellar's expected five-second ledger time.
const TTL_RENEWAL_THRESHOLD: u32 = 518_400;
const TTL_RENEWAL_TARGET: u32 = 1_555_200;
use soroban_sdk::{Address, Env};

// ── Initialization ────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Arbiter fee ───────────────────────────────────────────────────────────────

pub fn get_arbiter_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ArbiterFeeBps)
        .unwrap_or(200) // default 2%
}

pub fn set_arbiter_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::ArbiterFeeBps, &bps);
}

// ── Escrow count ──────────────────────────────────────────────────────────────

pub fn get_escrow_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::EscrowCount)
        .unwrap_or(0)
}

pub fn increment_escrow_count(env: &Env) -> u32 {
    let next = get_escrow_count(env) + 1;
    env.storage().instance().set(&DataKey::EscrowCount, &next);
    next
}

// ── Escrow ────────────────────────────────────────────────────────────────────

pub fn get_escrow(env: &Env, id: u32) -> Result<Escrow, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Escrow(id))
        .ok_or(Error::EscrowNotFound)
}

pub fn set_escrow(env: &Env, escrow: &Escrow) {
    env.storage()
        .persistent()
        .set(&DataKey::Escrow(escrow.id), escrow);
}

// ── Milestone ─────────────────────────────────────────────────────────────────

pub fn get_milestone(env: &Env, escrow_id: u32, milestone_id: u32) -> Result<Milestone, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Milestone(escrow_id, milestone_id))
        .ok_or(Error::MilestoneNotFound)
}

pub fn set_milestone(env: &Env, escrow_id: u32, milestone: &Milestone) {
    env.storage()
        .persistent()
        .set(&DataKey::Milestone(escrow_id, milestone.id), milestone);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

pub fn get_analytics(env: &Env) -> Analytics {
    env.storage()
        .instance()
        .get(&DataKey::Analytics)
        .unwrap_or(Analytics {
            total_escrows: 0,
            active_escrows: 0,
            completed_escrows: 0,
            disputed_escrows: 0,
            cancelled_escrows: 0,
            total_value_locked: 0,
            total_paid_out: 0,
        })
}

pub fn set_analytics(env: &Env, analytics: &Analytics) {
    env.storage().instance().set(&DataKey::Analytics, analytics);
}

// ── Atomic swaps ──────────────────────────────────────────────────────────────

pub fn next_atomic_swap_id(env: &Env) -> Result<u64, Error> {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::AtomicSwapCount)
        .unwrap_or(0);
    let next = current.checked_add(1).ok_or(Error::Overflow)?;
    env.storage()
        .instance()
        .set(&DataKey::AtomicSwapCount, &next);
    Ok(next)
}

pub fn get_atomic_swap_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::AtomicSwapCount)
        .unwrap_or(0)
}

pub fn get_atomic_swap(env: &Env, id: u64) -> Result<AtomicSwap, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::AtomicSwap(id))
        .ok_or(Error::AtomicSwapNotFound)
}

pub fn set_atomic_swap(env: &Env, swap: &AtomicSwap) {
    let key = DataKey::AtomicSwap(swap.id);
    env.storage().persistent().set(&key, swap);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_RENEWAL_THRESHOLD, TTL_RENEWAL_TARGET);
}

pub fn get_atomic_swap_stats(env: &Env) -> AtomicSwapStats {
    env.storage()
        .instance()
        .get(&DataKey::AtomicSwapStats)
        .unwrap_or(AtomicSwapStats {
            total: 0,
            active: 0,
            claimed: 0,
            refunded: 0,
            cancelled: 0,
        })
}

pub fn set_atomic_swap_stats(env: &Env, stats: &AtomicSwapStats) {
    env.storage()
        .instance()
        .set(&DataKey::AtomicSwapStats, stats);
}
