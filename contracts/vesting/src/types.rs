use soroban_sdk::{contracterror, contracttype, Address};

/// Errors returned by the vesting engine.
///
/// Discriminants `1..=10` are part of the published contract ABI and must not be
/// renumbered; new variants continue from `11`.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    /// Contract instance storage has not been initialised yet.
    NotInitialized = 1,
    /// `initialize` was called on an already initialised instance.
    AlreadyInitialized = 2,
    /// The caller is not the contract admin.
    Unauthorized = 3,
    /// Schedule parameters are inconsistent (non-positive amount, zero duration,
    /// cliff past the end, or a timestamp that overflows `u64`).
    InvalidSchedule = 4,
    /// A schedule already exists for this beneficiary.
    ScheduleExists = 5,
    /// No schedule exists for this beneficiary.
    NoVestingSchedule = 6,
    /// The cliff has not been reached yet, so nothing is claimable.
    CliffNotReached = 7,
    /// The beneficiary has no vested-but-unclaimed tokens at this point in time.
    NoTokensToClaim = 8,
    /// The milestone was already unlocked and cannot be unlocked again.
    MilestoneAlreadyUnlocked = 9,
    /// No milestone is registered under `(beneficiary, milestone_id)`.
    MilestoneNotFound = 10,
    /// A milestone already exists under that id and may not be redefined.
    MilestoneExists = 11,
    /// `percent_bps` is outside the `1..=10_000` range.
    InvalidMilestone = 12,
    /// Adding this milestone would push the cumulative allocation above 100%.
    MilestoneAllocationExceeded = 13,
    /// The cliff has already been crossed, so the schedule can no longer be
    /// revoked: the cliff is the point of no return for the beneficiary.
    CliffReached = 14,
    /// The requested allocation exceeds [`crate::math::MAX_ESCROW_AMOUNT`].
    AmountTooLarge = 15,
    /// A vesting parameter produced an out-of-range intermediate value.
    ArithmeticError = 16,
    /// The schedule has already been revoked by the admin.
    ScheduleRevoked = 17,
    /// Tokens are already escrowed and committed, so the schedule is immutable.
    ScheduleActive = 18,
    /// The contract escrow does not cover the outstanding beneficiary liability.
    EscrowShortfall = 19,
}

/// A single beneficiary's vesting position.
///
/// `total_amount` is the escrowed allocation, `released_amount` the cumulative
/// amount already transferred out. The engine guarantees
/// `0 <= released_amount <= total_amount` at all times, and that the sum of every
/// claim over the lifetime of the schedule is exactly `total_amount` (no stranded
/// rounding dust).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    /// Total escrowed allocation. Always `> 0`.
    pub total_amount: i128,
    /// Cumulative amount already paid out. Always in `0..=total_amount`.
    pub released_amount: i128,
    /// Ledger timestamp at which vesting begins.
    pub start_time: u64,
    /// `start_time + cliff_duration`; nothing is vested before this timestamp.
    pub cliff_time: u64,
    /// `start_time + duration`; the full allocation is vested from here on.
    pub end_time: u64,
    /// One past the highest registered milestone id, so revocation can purge
    /// every milestone entry without an unbounded key scan.
    pub milestone_count: u32,
    /// Set once the admin has revoked the schedule (only possible before the
    /// cliff). Revoked schedules keep `total_amount` for auditability but can
    /// never vest or pay out again.
    pub revoked: bool,
}

impl VestingSchedule {
    /// Build a schedule from its creation parameters, validating the invariants
    /// that the engine depends on.
    ///
    /// The caller is expected to have already checked that the beneficiary has
    /// no live schedule; this constructor only enforces the *internal*
    /// consistency of the timestamps and amounts.
    pub fn try_new(
        total_amount: i128,
        start_time: u64,
        cliff_duration: u64,
        duration: u64,
    ) -> Result<Self, VestingError> {
        crate::math::validate_schedule(total_amount, start_time, cliff_duration, duration)?;

        // Both additions are guaranteed not to overflow by `validate_schedule`.
        let cliff_time = start_time
            .checked_add(cliff_duration)
            .ok_or(VestingError::InvalidSchedule)?;
        let end_time = start_time
            .checked_add(duration)
            .ok_or(VestingError::InvalidSchedule)?;

        Ok(Self {
            total_amount,
            released_amount: 0,
            start_time,
            cliff_time,
            end_time,
            milestone_count: 0,
            revoked: false,
        })
    }

    /// Total timestamp span of the linear curve. Guaranteed `> 0`.
    pub fn duration(&self) -> u64 {
        self.end_time - self.start_time
    }

    /// Amount still held in escrow on behalf of this beneficiary, i.e.
    /// `total_amount - released_amount`.
    pub fn outstanding(&self) -> i128 {
        self.total_amount - self.released_amount
    }
}

/// An optional discrete unlock attached to a schedule.
///
/// Milestones *accelerate* the linear curve: they add their unlocked percentage
/// to the vested amount but can never push the total payout above
/// `total_amount`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    /// Allocation in basis points, `1000 == 10%`. Always in `1..=10_000`.
    pub percent_bps: u32,
    /// Flipped by the admin once the milestone condition is satisfied.
    pub unlocked: bool,
}

/// Storage keys. Instance entries hold global config, persistent entries hold
/// per-beneficiary state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Instance: contract admin.
    Admin,
    /// Instance: underlying SEP-41 token escrowed by this contract.
    Token,
    /// Persistent: vesting schedule for a beneficiary.
    Vesting(Address),
    /// Persistent: milestone for `(beneficiary, milestone_id)`.
    Milestone(Address, u32),
}
