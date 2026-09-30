use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    EscrowNotFound = 4,
    InvalidState = 5,
    MilestoneNotFound = 6,
    InvalidAmount = 7,
    NoMilestones = 8,
    TooManyMilestones = 9,
    AlreadyDisputed = 10,
    InvalidRuling = 11,
    InvalidFeeBps = 12,
    AtomicSwapNotFound = 13,
    InvalidSwap = 14,
    SwapExpired = 15,
    SwapNotExpired = 16,
    InvalidHashlock = 17,
    InvalidPreimage = 18,
    TimelockOutOfRange = 19,
    SameAsset = 20,
    Overflow = 21,
}

/// Lifecycle of a bilateral hash time-locked atomic swap.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AtomicSwapStatus {
    /// Maker's offered asset is locked; awaiting the designated taker.
    AwaitingCounterparty,
    /// Both assets are locked and can be exchanged with the preimage.
    Funded,
    /// Both transfer legs completed atomically.
    Claimed,
    /// Locked assets returned after expiry.
    Refunded,
    /// Maker recovered the offered asset before counterparty funding.
    Cancelled,
}

/// A two-asset HTLC. Amounts use each token contract's native precision.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AtomicSwap {
    pub id: u64,
    pub maker: Address,
    pub taker: Address,
    pub offered_token: Address,
    pub offered_amount: i128,
    pub requested_token: Address,
    pub requested_amount: i128,
    pub hashlock: BytesN<32>,
    pub expires_at: u64,
    pub status: AtomicSwapStatus,
    /// Published after a successful claim so linked HTLCs can observe it.
    pub revealed_preimage: Option<Bytes>,
    pub created_at: u64,
    pub funded_at: Option<u64>,
    pub settled_at: Option<u64>,
}

/// Aggregate atomic-swap lifecycle counters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AtomicSwapStats {
    pub total: u64,
    pub active: u64,
    pub claimed: u64,
    pub refunded: u64,
    pub cancelled: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Pending,   // created, awaiting client deposit
    Active,    // funded, work may proceed
    Completed, // all milestones paid out
    Disputed,  // arbiter intervention required
    Cancelled, // voided before completion
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,     // not yet started
    InProgress,  // freelancer working
    UnderReview, // submitted, client reviewing
    Approved,    // client signed off, awaiting payment release
    Rejected,    // client rejected, back to InProgress
    Paid,        // payment released
}

/// Dispute resolution ruling passed to `resolve_dispute`.
/// Encoded as u32: 0 = FreelancerFavored, 1 = ClientFavored, 2 = Split.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Ruling {
    FreelancerFavored,
    ClientFavored,
    Split,
}

/// A single work milestone within an escrow contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u32,
    pub amount: i128,
    pub status: MilestoneStatus,
}

/// The escrow agreement between a client and a freelancer.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u32,
    pub client: Address,
    pub freelancer: Address,
    pub arbiter: Address,
    pub total_amount: i128,
    pub paid_amount: i128,
    pub milestone_count: u32,
    pub status: EscrowStatus,
    pub created_at: u64,
    /// Basis points (e.g. 200 = 2%) deducted from each payment as arbiter fee.
    pub arbiter_fee_bps: u32,
}

/// Global protocol analytics stored in contract instance storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Analytics {
    pub total_escrows: u32,
    pub active_escrows: u32,
    pub completed_escrows: u32,
    pub disputed_escrows: u32,
    pub cancelled_escrows: u32,
    pub total_value_locked: i128,
    pub total_paid_out: i128,
}

/// Storage key namespace.
#[contracttype]
pub enum DataKey {
    Admin,
    ArbiterFeeBps,
    Initialized,
    EscrowCount,
    Analytics,
    Escrow(u32),
    Milestone(u32, u32), // (escrow_id, milestone_id)
    AtomicSwapCount,
    AtomicSwapStats,
    AtomicSwap(u64),
}
