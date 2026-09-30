use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    MarketNotFound = 3,
    MarketAlreadyResolved = 4,
    MarketNotResolved = 5,
    MarketExpired = 6,
    MarketNotExpired = 7,
    InvalidOutcome = 8,
    InsufficientStake = 9,
    NothingToWithdraw = 10,
    Unauthorized = 11,
    InvalidMarketType = 12,
    ZeroStake = 13,
    PositionNotFound = 14,
    InvalidOutcomeCount = 15,
    InvalidAmount = 16,
    ArithmeticOverflow = 17,
    ConditionalMarketRequired = 18,
    InsufficientShares = 19,
    InsufficientLiquidity = 20,
    SlippageExceeded = 21,
    ResolutionTooEarly = 22,
    ResolutionNotProposed = 23,
    DisputeWindowActive = 24,
    DisputeWindowClosed = 25,
    ResolutionAlreadyDisputed = 26,
    ResolutionNotDisputed = 27,
    InvalidDisputeWindow = 28,
    DisputeBondTooSmall = 29,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MarketType {
    Binary, // YES/NO outcome
    Scalar, // Numeric range outcome
    Categorical,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MarketStatus {
    Open,
    Resolved,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Market {
    pub id: u32,
    pub creator: Address,
    pub question: String,
    pub market_type: MarketType,
    pub status: MarketStatus,
    pub resolution_deadline: u64, // ledger timestamp
    pub oracle: Address,
    pub winning_outcome: Option<u32>, // 0=NO/low, 1=YES/high for binary; numeric for scalar
    pub total_yes_stake: i128,
    pub total_no_stake: i128,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub market_id: u32,
    pub trader: Address,
    pub outcome: u32, // 1=YES, 0=NO
    pub stake: i128,
}

/// Configuration and automated-market-maker state for a collateralized market.
/// Kept separately from `Market` so the legacy public market shape stays stable.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ConditionalMarket {
    pub market_id: u32,
    pub outcomes: Vec<String>,
    pub collateral_token: Address,
    pub dispute_resolver: Address,
    pub dispute_window: u64,
    pub minimum_dispute_bond: i128,
    /// Outcome-token reserves owned by the fixed-product market maker.
    pub pool_balances: Vec<i128>,
    pub total_liquidity_shares: i128,
    /// Collateral held by the contract against complete outcome-token sets.
    pub collateral_locked: i128,
}

/// Pending oracle result. A result is final only after its challenge window or
/// after the designated dispute resolver rules on it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolutionProposal {
    pub outcome: u32,
    pub proposed_at: u64,
    pub dispute_deadline: u64,
    pub disputer: Option<Address>,
    pub dispute_bond: i128,
}
