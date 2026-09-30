// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

/// Whether the option gives the right to buy or sell.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OptionKind {
    Call = 0,
    Put = 1,
}

/// Lifecycle state of an option contract.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OptionStatus {
    /// Written and available for exercise.
    Active = 0,
    /// Exercised by the holder.
    Exercised = 1,
    /// Expired without exercise.
    Expired = 2,
    /// Cancelled by the writer before expiry.
    Cancelled = 3,
    /// The writer must add collateral before the position can be restored.
    MarginCalled = 4,
}

/// Inputs to the deterministic Black-Scholes calculator.
///
/// Prices, volatility, and the continuously compounded rate use seven decimal
/// fixed-point precision. For example, 20% volatility is `2_000_000`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GreeksInput {
    pub spot_price: i128,
    pub strike_price: i128,
    pub volatility: i128,
    pub risk_free_rate: i128,
    pub time_to_expiry: u64,
    pub kind: OptionKind,
}

/// Black-Scholes price and Greeks, all represented with seven decimals.
/// Theta is annualized and vega/rho measure a full `1.0` input change.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Greeks {
    pub price: i128,
    pub delta: i128,
    pub gamma: i128,
    pub vega: i128,
    pub theta: i128,
    pub rho: i128,
}

/// Immutable token and risk controls for the margin pool.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarginConfig {
    pub settlement_token: Address,
    pub oracle: Address,
    pub maintenance_margin_bps: u32,
    pub max_price_age: u64,
}

/// A writer's token balance and the portion reserved by open positions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarginAccount {
    pub balance: i128,
    pub locked: i128,
}

/// Collateral attached to an expiry-only, cash-settled option.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarginPosition {
    pub locked: i128,
    pub max_payout: i128,
}

/// An oracle observation used by risk checks and settlement.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub updated_at: u64,
}

/// A single on-chain option contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OptionContract {
    /// Auto-incremented ID.
    pub id: u32,
    /// Address that wrote (sold) the option.
    pub writer: Address,
    /// Address that holds (bought) the option.
    pub holder: Address,
    /// Underlying asset symbol (e.g. "XLM").
    pub underlying: soroban_sdk::String,
    /// Strike price in stroops.
    pub strike_price: i128,
    /// Premium paid by holder to writer (in stroops).
    pub premium: i128,
    /// Notional amount of underlying (in stroops).
    pub amount: i128,
    /// Ledger timestamp after which the option expires.
    pub expiry: u64,
    /// Call or Put.
    pub kind: OptionKind,
    /// Current status.
    pub status: OptionStatus,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    OptionCount,
    Paused,
    MarginConfig,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Option(u32),
    MarginAccount(Address),
    MarginPosition(u32),
    Price(String),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    OptionNotFound = 4,
    OptionNotActive = 5,
    OptionExpired = 6,
    OptionNotExpired = 7,
    InvalidStrike = 8,
    InvalidPremium = 9,
    InvalidAmount = 10,
    InvalidExpiry = 11,
    ContractPaused = 12,
    WriterCannotBeHolder = 13,
    PoolAlreadyConfigured = 14,
    PoolNotConfigured = 15,
    InvalidMarginConfig = 16,
    InvalidPrice = 17,
    StalePrice = 18,
    InsufficientMargin = 19,
    PositionNotCollateralized = 20,
    EuropeanOnly = 21,
    InvalidMaxPayout = 22,
    InvalidVolatility = 23,
    InvalidRate = 24,
    InvalidTimeToExpiry = 25,
    MathOverflow = 26,
    MarginCallNotActive = 27,
}
