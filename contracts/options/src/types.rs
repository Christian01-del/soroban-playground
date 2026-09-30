// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    OptionCount,
    /// Total margin collateral in the pool
    TotalMargin,
    Paused,
}

#[contracttype]
pub enum DataKey {
    /// Option details by id
    Option(u32),
    /// Margin deposit per writer
    Margin(Address),
    /// Position: (option_id, holder) → position details
    Position(u32, Address),
}

/// Option type: Call or Put.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OptionType {
    Call = 0,
    Put = 1,
}

/// Option status.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OptionStatus {
    Active = 0,
    Exercised = 1,
    Expired = 2,
    Cancelled = 3,
}

/// A European cash-settled option contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OptionContract {
    pub id: u32,
    pub writer: Address,
    pub option_type: OptionType,
    /// Strike price (underlying units, scaled by PRICE_PRECISION).
    pub strike_price: i128,
    /// Spot price at time of writing (for Greeks baseline).
    pub spot_price_at_write: i128,
    /// Premium paid by buyer (in collateral units).
    pub premium: i128,
    /// Number of contracts (each contract covers 1 unit of underlying).
    pub size: i128,
    /// Expiry timestamp (Unix seconds).
    pub expiry: u64,
    /// Current holder/buyer of the option.
    pub holder: Option<Address>,
    pub status: OptionStatus,
    /// Settlement price at expiry (set on exercise/expiry).
    pub settlement_price: i128,
}

/// Black-Scholes Greeks snapshot.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Greeks {
    /// Delta: rate of change of option price w.r.t. underlying (scaled by GREEK_PRECISION).
    pub delta: i128,
    /// Gamma: rate of change of delta (scaled by GREEK_PRECISION).
    pub gamma: i128,
    /// Theta: time decay per day (scaled by GREEK_PRECISION, negative for long positions).
    pub theta: i128,
    /// Vega: sensitivity to 1% volatility change (scaled by GREEK_PRECISION).
    pub vega: i128,
    /// Intrinsic value (max(S-K, 0) for Call, max(K-S, 0) for Put).
    pub intrinsic_value: i128,
    /// Time value = option_price - intrinsic_value.
    pub time_value: i128,
}

/// Margin requirement details.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MarginRequirement {
    /// Minimum required margin for this option position.
    pub required: i128,
    /// Current deposited margin.
    pub deposited: i128,
    /// Whether the position is under-margined (margin call triggered).
    pub margin_call: bool,
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
    Paused = 5,
    Overflow = 6,
    OptionNotFound = 7,
    OptionExpired = 8,
    OptionNotExpired = 9,
    OptionAlreadySettled = 10,
    InsufficientMargin = 11,
    NotOptionHolder = 12,
    InvalidStrike = 13,
    InvalidExpiry = 14,
    InvalidVolatility = 15,
    MarginCallActive = 16,
}
