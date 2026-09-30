// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract already initialized.
    AlreadyInitialized = 1,
    /// Contract not yet initialized.
    NotInitialized = 2,
    /// Caller is not the admin.
    Unauthorized = 3,
    /// Deposit amount must be greater than zero.
    ZeroAmount = 4,
    /// Strategy ID does not exist.
    StrategyNotFound = 5,
    /// User has no position in this strategy.
    NoPosition = 6,
    /// Withdrawal amount exceeds deposited balance.
    InsufficientBalance = 7,
    /// Strategy is currently paused.
    StrategyPaused = 8,
    /// APY value out of acceptable range (max 10000 bps = 100%).
    InvalidApy = 9,
    /// Strategy name must not be empty.
    EmptyName = 10,
    /// Pool capacity and reward amounts cannot be negative.
    InvalidPoolConfig = 11,
    /// Fees and allocation limits must be valid basis-point values.
    InvalidBasisPoints = 12,
    /// Risk scores must be between 0 and 100.
    InvalidRiskScore = 13,
    /// No active pool satisfies the supplied optimizer constraints.
    NoOptimizableStrategy = 14,
    /// Active pools cannot accept the full amount being optimized.
    InsufficientCapacity = 15,
    /// A calculation exceeded the supported i128 range.
    ArithmeticOverflow = 16,
}

/// Represents a single yield strategy (e.g. a liquidity pool or lending vault).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Strategy {
    /// Human-readable name.
    pub name: String,
    /// Annual percentage yield in basis points (1 bps = 0.01%).
    pub apy_bps: u32,
    /// Total value locked across all depositors (in stroops / smallest unit).
    pub total_deposited: i128,
    /// Whether the strategy is accepting new deposits.
    pub is_active: bool,
    /// Accumulated rewards available for compounding (in stroops).
    pub pending_rewards: i128,
    /// Ledger timestamp of the last compound operation.
    pub last_compound_ts: u64,
}

/// Tracks an individual user's position in a strategy.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Position {
    /// Amount the user originally deposited.
    pub deposited: i128,
    /// Compounded balance (deposited + reinvested rewards).
    pub compounded_balance: i128,
    /// Ledger timestamp of the user's last deposit or compound.
    pub last_update_ts: u64,
}

/// Optional optimizer metadata stored separately from [`Strategy`].
///
/// Keeping this in a distinct storage entry preserves the encoding of strategy
/// records created by earlier contract versions.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolConfig {
    /// Expected reward-token value emitted by the pool per year. When zero,
    /// the strategy's quoted APY is used as a backwards-compatible fallback.
    pub annual_rewards: i128,
    /// Maximum capital accepted by the pool. Zero means unlimited.
    pub capacity: i128,
    /// Performance fee charged against gross yield.
    pub fee_bps: u32,
    /// Relative risk from 0 (lowest) to 100 (highest).
    pub risk_score: u32,
    /// Maximum share of an optimized portfolio assigned to this pool.
    pub max_allocation_bps: u32,
}

/// One target produced by the multi-pool optimizer.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Allocation {
    pub strategy_id: u32,
    pub amount: i128,
    pub weight_bps: u32,
    /// Fee-adjusted APY at the pool's projected post-allocation TVL.
    pub projected_apy_bps: u32,
}

/// Summary of an atomic portfolio rebalance.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RebalanceResult {
    pub total_balance: i128,
    pub previous_weighted_apy_bps: u32,
    pub new_weighted_apy_bps: u32,
    pub allocations: Vec<Allocation>,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    StrategyCount,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    /// Strategy data by numeric ID.
    Strategy(u32),
    /// User position: (strategy_id, user_address).
    Position(u32, Address),
    /// Optional optimizer configuration by strategy ID.
    PoolConfig(u32),
}
