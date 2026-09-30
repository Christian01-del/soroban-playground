// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    /// Total staked tokens in the protocol
    TotalStaked,
    /// Total lstTokens (liquid staking derivative) in circulation
    TotalLst,
    /// Current exchange rate: lstTokens → underlying (scaled by RATE_PRECISION)
    ExchangeRate,
    /// Last timestamp when rewards were accrued
    LastAccrualTs,
    /// Annual reward rate in basis points (e.g. 500 = 5% APY)
    RewardRateBps,
    /// Unbonding period in seconds
    UnbondingPeriod,
    /// Paused flag
    Paused,
    /// Total rewards accrued lifetime
    TotalRewards,
    /// Total pending unbonding amount
    TotalUnbonding,
}

#[contracttype]
pub enum DataKey {
    /// Staker's lstToken balance
    LstBalance(Address),
    /// Staker's unbonding queue entries count
    UnbondCount(Address),
    /// Individual unbond entry: (staker, index) → UnbondEntry
    UnbondEntry(Address, u32),
    /// Validator stakes: validator → staked_amount
    ValidatorStake(Address),
}

/// Represents a pending unbonding entry in the queue.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UnbondEntry {
    /// Amount of underlying token to be returned.
    pub amount: i128,
    /// Timestamp when this unbonding completes (can_claim_after).
    pub release_ts: u64,
    /// Whether this entry has been claimed.
    pub claimed: bool,
}

/// Snapshot returned by get_user_info().
#[contracttype]
#[derive(Clone, Debug)]
pub struct UserInfo {
    pub lst_balance: i128,
    pub underlying_value: i128,
    pub pending_unbond_count: u32,
}

/// Protocol-level metrics.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolMetrics {
    pub total_staked: i128,
    pub total_lst: i128,
    pub exchange_rate: i128,
    pub total_rewards: i128,
    pub total_unbonding: i128,
    pub last_accrual_ts: u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ZeroAmount = 4,
    InsufficientBalance = 5,
    Paused = 6,
    Overflow = 7,
    UnbondNotReady = 8,
    InvalidEntry = 9,
    AlreadyClaimed = 10,
    InvalidRate = 11,
    InvalidPeriod = 12,
}
