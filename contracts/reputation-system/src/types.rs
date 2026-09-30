use soroban_sdk::{contracterror, contracttype, Address};

// ── Score type alias ──────────────────────────────────────────────────────────
// i64 chosen for score: large enough range, fits natively in Soroban XDR.

/// Maximum absolute value a score can reach (prevents unbounded growth).
pub const MAX_SCORE: i64 = 1_000_000;

/// Minimum score floor (prevents negative infinity).
pub const MIN_SCORE: i64 = -100_000;

// ── On-chain types ────────────────────────────────────────────────────────────

/// A single user's reputation record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReputationRecord {
    /// Subject address.
    pub subject: Address,
    /// Cumulative reputation score, clamped to [MIN_SCORE, MAX_SCORE].
    pub score: i64,
    /// Total number of positive score adjustments ever applied.
    pub positive_events: u32,
    /// Total number of negative score adjustments (slashes) ever applied.
    pub negative_events: u32,
    /// Total endorsements received.
    pub endorsements: u32,
    /// Ledger timestamp of first registration.
    pub registered_at: u64,
    /// Ledger timestamp of most recent update.
    pub last_updated: u64,
}

/// Instance storage keys (single-value config).
#[contracttype]
pub enum InstanceKey {
    Admin,
    Initialized,
}

/// Persistent storage keys (per-subject data).
#[contracttype]
pub enum DataKey {
    /// Reputation record indexed by subject address.
    Record(Address),
    /// Endorsement index: (endorser, subject) → bool (prevents duplicate endorsements).
    Endorsed(Address, Address),
}

/// All errors the contract can return.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    SubjectNotFound = 4,
    AlreadyRegistered = 5,
    /// Adjustment delta must not be zero.
    ZeroDelta = 6,
    /// Delta magnitude exceeds MAX_SCORE (sanity cap per single call).
    DeltaTooLarge = 7,
    /// Endorser and subject must be different addresses.
    SelfEndorsement = 8,
    /// Endorser has already endorsed this subject.
    AlreadyEndorsed = 9,
    /// Subject not registered; auto-registration is disabled.
    SubjectNotRegistered = 10,
}
