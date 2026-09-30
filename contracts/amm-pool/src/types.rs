// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    TotalLp,
    /// Cumulative price accumulator for TWAP: price_a_cumulative
    PriceACum,
    /// Cumulative price accumulator for TWAP: price_b_cumulative
    PriceBCum,
    /// Ledger timestamp of last swap (for TWAP)
    LastTimestamp,
    /// Swap fee in basis points (default 30 = 0.30%)
    FeeBps,
    /// NFT collection address (for NFT AMM pools)
    NftCollection,
    /// Total volume traded in the pool
    TotalVolume,
    /// Total fees collected
    TotalFees,
    /// Opt-in bounds and weighting for volatility-adjusted fees.
    DynamicFeeConfig,
    /// Exponentially weighted recent pool-price volatility.
    VolatilityState,
}

#[contracttype]
pub enum DataKey {
    /// LP balance for an address.
    Lp(Address),
    /// NFT floor price tracking
    NftFloorPrice,
    /// Collection statistics
    CollectionStats,
}

/// NFT Collection Analytics
#[contracttype]
#[derive(Clone, Debug)]
pub struct CollectionStats {
    pub floor_price: i128,
    pub ceiling_price: i128,
    pub total_volume: i128,
    pub trade_count: u32,
    pub unique_holders: u32,
    pub last_update: u64,
}

/// Risk controls for the opt-in dynamic fee model.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DynamicFeeConfig {
    /// Lower bound for the effective swap fee.
    pub min_fee_bps: i128,
    /// Upper bound for the effective swap fee.
    pub max_fee_bps: i128,
    /// Portion of recent volatility added to the fee (10_000 = 1x).
    pub volatility_multiplier_bps: i128,
    /// Portion of per-swap reserve utilization added to the fee.
    pub utilization_multiplier_bps: i128,
    /// Weight assigned to the latest absolute price return.
    pub ema_alpha_bps: i128,
    /// Seconds after which inactive historical volatility fully decays.
    pub volatility_window: u64,
    /// Maximum fee-inclusive execution price impact accepted by the pool.
    pub max_price_impact_bps: i128,
}

/// Current volatility observation, expressed in basis points.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VolatilityState {
    pub ema_volatility_bps: i128,
    pub last_price: i128,
    pub last_timestamp: u64,
}

/// Deterministic swap preview including each dynamic fee input.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapQuote {
    pub amount_out: i128,
    pub fee_bps: i128,
    pub price_impact_bps: i128,
    pub volatility_bps: i128,
    pub utilization_bps: i128,
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
    InsufficientLiquidity = 5,
    SlippageExceeded = 6,
    InsufficientLpBalance = 7,
    InvalidToken = 8,
    Overflow = 9,
    ZeroOutput = 10,
    InvalidFee = 11,
    InvalidDynamicFeeConfig = 12,
    PriceImpactExceeded = 13,
    FeeLimitExceeded = 14,
    DeadlineExpired = 15,
}
