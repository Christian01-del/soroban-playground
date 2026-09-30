#![no_std]

mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::types::{DataKey, Error, InstanceKey, ReputationRecord, MAX_SCORE, MIN_SCORE};

/// Reputation System Contract
///
/// Tracks per-address reputation scores with admin-controlled adjustments
/// and a peer endorsement mechanism.
///
/// Design goals (refactored for maintainability):
///   - All storage access is centralised in private helpers (no raw storage
///     calls in public functions).
///   - Score arithmetic is extracted to a single saturating helper so the
///     clamping logic lives in exactly one place.
///   - Public functions are thin orchestrators: validate → mutate state →
///     emit event.
///   - Error variants are exhaustive; every guard is paired with a clear code.
#[contract]
pub struct ReputationSystemContract;

#[contractimpl]
impl ReputationSystemContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract. Must be called once before anything else.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if Self::storage_is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&InstanceKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&InstanceKey::Initialized, &true);
        env.events()
            .publish((symbol_short!("init"),), admin.clone());
        Ok(())
    }

    /// Transfer admin rights (admin only).
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&InstanceKey::Admin, &new_admin);
        env.events().publish((symbol_short!("adm_tx"),), new_admin);
        Ok(())
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /// Register a new subject. Anyone may register their own address;
    /// admin may register any address.
    pub fn register(env: Env, subject: Address) -> Result<(), Error> {
        Self::assert_initialized(&env)?;

        if Self::storage_has_record(&env, &subject) {
            return Err(Error::AlreadyRegistered);
        }

        let now = env.ledger().timestamp();
        let record = ReputationRecord {
            subject: subject.clone(),
            score: 0,
            positive_events: 0,
            negative_events: 0,
            endorsements: 0,
            registered_at: now,
            last_updated: now,
        };
        Self::storage_set_record(&env, &record);
        env.events().publish((symbol_short!("register"),), subject);
        Ok(())
    }

    // ── Score management (admin only) ─────────────────────────────────────────

    /// Increase a subject's score by `delta` (must be > 0, ≤ MAX_SCORE).
    pub fn award(env: Env, subject: Address, delta: i64) -> Result<i64, Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        Self::validate_delta(delta)?;

        let mut record = Self::storage_get_record(&env, &subject)?;
        record.score = Self::saturating_add(record.score, delta);
        record.positive_events = record.positive_events.saturating_add(1);
        record.last_updated = env.ledger().timestamp();

        Self::storage_set_record(&env, &record);
        env.events()
            .publish((symbol_short!("award"),), (subject, record.score));
        Ok(record.score)
    }

    /// Decrease a subject's score by `delta` (must be > 0, ≤ MAX_SCORE).
    pub fn slash(env: Env, subject: Address, delta: i64) -> Result<i64, Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        Self::validate_delta(delta)?;

        let mut record = Self::storage_get_record(&env, &subject)?;
        record.score = Self::saturating_sub(record.score, delta);
        record.negative_events = record.negative_events.saturating_add(1);
        record.last_updated = env.ledger().timestamp();

        Self::storage_set_record(&env, &record);
        env.events()
            .publish((symbol_short!("slash"),), (subject, record.score));
        Ok(record.score)
    }

    /// Set a subject's score to an exact value (admin only, for migration / overrides).
    /// Value is clamped to [MIN_SCORE, MAX_SCORE].
    pub fn set_score(env: Env, subject: Address, score: i64) -> Result<i64, Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();

        let mut record = Self::storage_get_record(&env, &subject)?;
        record.score = score.clamp(MIN_SCORE, MAX_SCORE);
        record.last_updated = env.ledger().timestamp();

        Self::storage_set_record(&env, &record);
        env.events()
            .publish((symbol_short!("set_sc"),), (subject, record.score));
        Ok(record.score)
    }

    // ── Peer endorsements ─────────────────────────────────────────────────────

    /// Endorse a subject (adds +1 to endorsement counter and a small score bump).
    /// Each (endorser, subject) pair may only endorse once.
    pub fn endorse(env: Env, endorser: Address, subject: Address) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        endorser.require_auth();

        if endorser == subject {
            return Err(Error::SelfEndorsement);
        }
        if !Self::storage_has_record(&env, &subject) {
            return Err(Error::SubjectNotRegistered);
        }

        let endorse_key = DataKey::Endorsed(endorser.clone(), subject.clone());
        if env.storage().persistent().has(&endorse_key) {
            return Err(Error::AlreadyEndorsed);
        }
        env.storage().persistent().set(&endorse_key, &true);

        let mut record = Self::storage_get_record(&env, &subject)?;
        record.endorsements = record.endorsements.saturating_add(1);
        // Endorsement contributes a fixed +10 to score (capped)
        record.score = Self::saturating_add(record.score, 10);
        record.last_updated = env.ledger().timestamp();

        Self::storage_set_record(&env, &record);
        env.events()
            .publish((symbol_short!("endorse"),), (endorser, subject));
        Ok(())
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_record(env: Env, subject: Address) -> Result<ReputationRecord, Error> {
        Self::storage_get_record(&env, &subject)
    }

    pub fn get_score(env: Env, subject: Address) -> Result<i64, Error> {
        Ok(Self::storage_get_record(&env, &subject)?.score)
    }

    pub fn is_registered(env: Env, subject: Address) -> bool {
        Self::storage_has_record(&env, &subject)
    }

    pub fn has_endorsed(env: Env, endorser: Address, subject: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Endorsed(endorser, subject))
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&InstanceKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    pub fn is_initialized(env: Env) -> bool {
        Self::storage_is_initialized(&env)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /// Assert the contract is initialised. Returns `NotInitialized` if not.
    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !Self::storage_is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    /// Load the admin address; errors if not initialised.
    fn require_admin(env: &Env) -> Result<Address, Error> {
        Self::assert_initialized(env)?;
        env.storage()
            .instance()
            .get(&InstanceKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Validate that `delta` is non-zero and within MAX_SCORE.
    fn validate_delta(delta: i64) -> Result<(), Error> {
        if delta == 0 {
            return Err(Error::ZeroDelta);
        }
        if delta < 0 || delta > MAX_SCORE {
            return Err(Error::DeltaTooLarge);
        }
        Ok(())
    }

    /// Saturating add clamped to [MIN_SCORE, MAX_SCORE].
    #[inline]
    fn saturating_add(score: i64, delta: i64) -> i64 {
        score.saturating_add(delta).clamp(MIN_SCORE, MAX_SCORE)
    }

    /// Saturating subtract clamped to [MIN_SCORE, MAX_SCORE].
    #[inline]
    fn saturating_sub(score: i64, delta: i64) -> i64 {
        score.saturating_sub(delta).clamp(MIN_SCORE, MAX_SCORE)
    }

    // ── Storage accessors (single point of truth) ─────────────────────────────

    fn storage_is_initialized(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&InstanceKey::Initialized)
            .unwrap_or(false)
    }

    fn storage_has_record(env: &Env, subject: &Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Record(subject.clone()))
    }

    fn storage_get_record(env: &Env, subject: &Address) -> Result<ReputationRecord, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Record(subject.clone()))
            .ok_or(Error::SubjectNotFound)
    }

    fn storage_set_record(env: &Env, record: &ReputationRecord) {
        env.storage()
            .persistent()
            .set(&DataKey::Record(record.subject.clone()), record);
    }
}
