#![no_std]

//! Token-escrowed pari-mutuel sports pools with multi-oracle settlement.

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Vec,
};

const MAX_FEE_BPS: u32 = 1_000;
const BPS: i128 = 10_000;
const MAX_ORACLES: u32 = 32;
const INSTANCE_TTL_THRESHOLD: u32 = 30 * 17_280;
const INSTANCE_TTL_BUMP: u32 = 120 * 17_280;
const DATA_TTL_THRESHOLD: u32 = 30 * 17_280;
const DATA_TTL_BUMP: u32 = 365 * 17_280;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    FeeRecipient,
    FeeBps,
    Paused,
    MarketCount,
    Oracle(Address),
    OracleCount,
    Market(u64),
    Bet(u64, Address, u32),
    Vote(u64, Address),
    VoteCounts(u64),
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
    pub id: u64,
    pub event_id: String,
    pub token: Address,
    pub close_time: u64,
    pub settlement_deadline: u64,
    pub oracle_threshold: u32,
    pub status: MarketStatus,
    pub winning_outcome: Option<u32>,
    pub pools: Vec<i128>,
    pub total_pool: i128,
    pub fee_amount: i128,
    pub fee_claimed: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    InvalidFee = 5,
    InvalidThreshold = 6,
    OracleAlreadyExists = 7,
    OracleNotFound = 8,
    TooManyOracles = 9,
    InvalidSchedule = 10,
    InvalidEvent = 11,
    InvalidOutcome = 12,
    InvalidAmount = 13,
    MarketNotFound = 14,
    BettingClosed = 15,
    MarketNotClosed = 16,
    SettlementExpired = 17,
    AlreadyVoted = 18,
    MarketFinalized = 19,
    NotResolved = 20,
    NothingToClaim = 21,
    AlreadyClaimed = 22,
    ArithmeticError = 23,
    CancellationUnavailable = 24,
}

#[contract]
pub struct SportsBetting;

#[contractimpl]
impl SportsBetting {
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_recipient: Address,
        fee_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::MarketCount, &0u64);
        env.storage().instance().set(&DataKey::OracleCount, &0u32);
        bump_instance(&env);
        env.events()
            .publish((symbol_short!("init"),), (admin, fee_recipient, fee_bps));
        Ok(())
    }

    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        admin(&env)?.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        bump_instance(&env);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    pub fn add_oracle(env: Env, oracle: Address) -> Result<(), Error> {
        admin(&env)?.require_auth();
        let key = DataKey::Oracle(oracle.clone());
        if env.storage().persistent().get(&key).unwrap_or(false) {
            return Err(Error::OracleAlreadyExists);
        }
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::OracleCount)
            .unwrap_or(0);
        if count >= MAX_ORACLES {
            return Err(Error::TooManyOracles);
        }
        env.storage().persistent().set(&key, &true);
        bump_key(&env, &key);
        env.storage()
            .instance()
            .set(&DataKey::OracleCount, &(count + 1));
        bump_instance(&env);
        env.events().publish((symbol_short!("ora_add"),), oracle);
        Ok(())
    }

    pub fn remove_oracle(env: Env, oracle: Address) -> Result<(), Error> {
        admin(&env)?.require_auth();
        let key = DataKey::Oracle(oracle.clone());
        if !env.storage().persistent().get(&key).unwrap_or(false) {
            return Err(Error::OracleNotFound);
        }
        env.storage().persistent().set(&key, &false);
        bump_key(&env, &key);
        let count: u32 = env.storage().instance().get(&DataKey::OracleCount).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::OracleCount, &(count - 1));
        bump_instance(&env);
        env.events().publish((symbol_short!("ora_rem"),), oracle);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_market(
        env: Env,
        event_id: String,
        token: Address,
        outcome_count: u32,
        close_time: u64,
        settlement_deadline: u64,
        oracle_threshold: u32,
    ) -> Result<u64, Error> {
        admin(&env)?.require_auth();
        not_paused(&env)?;
        if event_id.is_empty() {
            return Err(Error::InvalidEvent);
        }
        if !(2..=8).contains(&outcome_count) {
            return Err(Error::InvalidOutcome);
        }
        if close_time <= env.ledger().timestamp() || settlement_deadline <= close_time {
            return Err(Error::InvalidSchedule);
        }
        let oracle_count: u32 = env.storage().instance().get(&DataKey::OracleCount).unwrap();
        if oracle_threshold == 0 || oracle_threshold > oracle_count {
            return Err(Error::InvalidThreshold);
        }

        let id: u64 = env.storage().instance().get(&DataKey::MarketCount).unwrap();
        let market = Market {
            id,
            event_id,
            token,
            close_time,
            settlement_deadline,
            oracle_threshold,
            status: MarketStatus::Open,
            winning_outcome: None,
            pools: Vec::from_array(&env, [0i128; 8]).slice(0..outcome_count),
            total_pool: 0,
            fee_amount: 0,
            fee_claimed: false,
        };
        put_market(&env, &market);
        env.storage()
            .instance()
            .set(&DataKey::MarketCount, &(id + 1));
        bump_instance(&env);
        env.events()
            .publish((symbol_short!("mk_create"), id), outcome_count);
        Ok(id)
    }

    pub fn place_bet(
        env: Env,
        bettor: Address,
        market_id: u64,
        outcome: u32,
        amount: i128,
    ) -> Result<(), Error> {
        initialized(&env)?;
        not_paused(&env)?;
        bettor.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut market = market(&env, market_id)?;
        if market.status != MarketStatus::Open {
            return Err(Error::MarketFinalized);
        }
        if env.ledger().timestamp() >= market.close_time {
            return Err(Error::BettingClosed);
        }
        if outcome >= market.pools.len() {
            return Err(Error::InvalidOutcome);
        }

        let new_pool = market
            .pools
            .get(outcome)
            .unwrap()
            .checked_add(amount)
            .ok_or(Error::ArithmeticError)?;
        market.total_pool = market
            .total_pool
            .checked_add(amount)
            .ok_or(Error::ArithmeticError)?;
        market.pools.set(outcome, new_pool);

        let bet_key = DataKey::Bet(market_id, bettor.clone(), outcome);
        let prior: i128 = env.storage().persistent().get(&bet_key).unwrap_or(0);
        let updated = prior.checked_add(amount).ok_or(Error::ArithmeticError)?;

        token::Client::new(&env, &market.token).transfer(
            &bettor,
            &env.current_contract_address(),
            &amount,
        );
        env.storage().persistent().set(&bet_key, &updated);
        bump_key(&env, &bet_key);
        put_market(&env, &market);
        env.events()
            .publish((symbol_short!("bet"), market_id, outcome), (bettor, amount));
        Ok(())
    }

    pub fn submit_result(
        env: Env,
        oracle: Address,
        market_id: u64,
        outcome: u32,
    ) -> Result<bool, Error> {
        initialized(&env)?;
        not_paused(&env)?;
        oracle.require_auth();
        if !is_oracle(&env, &oracle) {
            return Err(Error::Unauthorized);
        }
        let mut market = market(&env, market_id)?;
        if market.status != MarketStatus::Open {
            return Err(Error::MarketFinalized);
        }
        let now = env.ledger().timestamp();
        if now < market.close_time {
            return Err(Error::MarketNotClosed);
        }
        if now > market.settlement_deadline {
            return Err(Error::SettlementExpired);
        }
        if outcome >= market.pools.len() {
            return Err(Error::InvalidOutcome);
        }
        let vote_key = DataKey::Vote(market_id, oracle.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(Error::AlreadyVoted);
        }
        env.storage().persistent().set(&vote_key, &outcome);
        bump_key(&env, &vote_key);
        let count_key = DataKey::VoteCounts(market_id);
        let mut counts: Vec<u32> = env
            .storage()
            .persistent()
            .get(&count_key)
            .unwrap_or(Vec::from_array(&env, [0u32; 8]).slice(0..market.pools.len()));
        let votes = counts.get(outcome).unwrap() + 1;
        counts.set(outcome, votes);
        env.storage().persistent().set(&count_key, &counts);
        bump_key(&env, &count_key);

        let resolved = votes >= market.oracle_threshold;
        if resolved {
            if market.pools.get(outcome).unwrap() == 0 {
                market.status = MarketStatus::Cancelled;
            } else {
                market.status = MarketStatus::Resolved;
                market.winning_outcome = Some(outcome);
                let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap();
                market.fee_amount = checked_mul_div(market.total_pool, fee_bps as i128, BPS)?;
            }
            put_market(&env, &market);
            env.events().publish(
                (symbol_short!("settled"), market_id),
                (outcome, market.status),
            );
        } else {
            env.events()
                .publish((symbol_short!("vote"), market_id), (oracle, outcome, votes));
        }
        Ok(resolved)
    }

    pub fn cancel_expired(env: Env, market_id: u64) -> Result<(), Error> {
        initialized(&env)?;
        let mut market = market(&env, market_id)?;
        if market.status != MarketStatus::Open {
            return Err(Error::MarketFinalized);
        }
        if env.ledger().timestamp() <= market.settlement_deadline {
            return Err(Error::CancellationUnavailable);
        }
        market.status = MarketStatus::Cancelled;
        put_market(&env, &market);
        env.events()
            .publish((symbol_short!("cancel"), market_id), ());
        Ok(())
    }

    pub fn claim(env: Env, bettor: Address, market_id: u64, outcome: u32) -> Result<i128, Error> {
        initialized(&env)?;
        bettor.require_auth();
        let market = market(&env, market_id)?;
        if outcome >= market.pools.len() {
            return Err(Error::InvalidOutcome);
        }
        if market.status == MarketStatus::Open {
            return Err(Error::NotResolved);
        }
        let key = DataKey::Bet(market_id, bettor.clone(), outcome);
        let stake: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if stake == 0 {
            return Err(Error::NothingToClaim);
        }

        let payout = if market.status == MarketStatus::Cancelled {
            stake
        } else if market.winning_outcome == Some(outcome) {
            let distributable = market
                .total_pool
                .checked_sub(market.fee_amount)
                .ok_or(Error::ArithmeticError)?;
            checked_mul_div(stake, distributable, market.pools.get(outcome).unwrap())?
        } else {
            0
        };
        env.storage().persistent().set(&key, &0i128);
        bump_key(&env, &key);
        if payout > 0 {
            token::Client::new(&env, &market.token).transfer(
                &env.current_contract_address(),
                &bettor,
                &payout,
            );
        }
        env.events()
            .publish((symbol_short!("claim"), market_id), (bettor, payout));
        Ok(payout)
    }

    pub fn claim_fee(env: Env, market_id: u64) -> Result<i128, Error> {
        initialized(&env)?;
        let recipient: Address = env
            .storage()
            .instance()
            .get(&DataKey::FeeRecipient)
            .unwrap();
        recipient.require_auth();
        let mut market = market(&env, market_id)?;
        if market.status != MarketStatus::Resolved {
            return Err(Error::NotResolved);
        }
        if market.fee_claimed {
            return Err(Error::AlreadyClaimed);
        }
        market.fee_claimed = true;
        put_market(&env, &market);
        if market.fee_amount > 0 {
            token::Client::new(&env, &market.token).transfer(
                &env.current_contract_address(),
                &recipient,
                &market.fee_amount,
            );
        }
        Ok(market.fee_amount)
    }

    /// Returns the current pari-mutuel payout multiplier in basis points.
    pub fn odds(env: Env, market_id: u64, outcome: u32) -> Result<u32, Error> {
        let market = market(&env, market_id)?;
        if outcome >= market.pools.len() {
            return Err(Error::InvalidOutcome);
        }
        let pool = market.pools.get(outcome).unwrap();
        if pool == 0 {
            return Ok(0);
        }
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap();
        let net_bps = BPS - fee_bps as i128;
        let net_total = checked_mul_div(market.total_pool, net_bps, BPS)?;
        let odds = checked_mul_div(net_total, BPS, pool)?;
        u32::try_from(odds).map_err(|_| Error::ArithmeticError)
    }

    pub fn get_market(env: Env, market_id: u64) -> Result<Market, Error> {
        market(&env, market_id)
    }

    pub fn get_bet(env: Env, market_id: u64, bettor: Address, outcome: u32) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Bet(market_id, bettor, outcome))
            .unwrap_or(0)
    }
}

fn initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    bump_instance(env);
    Ok(())
}

fn admin(env: &Env) -> Result<Address, Error> {
    initialized(env)?;
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        return Err(Error::Paused);
    }
    Ok(())
}

fn is_oracle(env: &Env, oracle: &Address) -> bool {
    let key = DataKey::Oracle(oracle.clone());
    let active = env.storage().persistent().get(&key).unwrap_or(false);
    if active {
        bump_key(env, &key);
    }
    active
}

fn market(env: &Env, id: u64) -> Result<Market, Error> {
    initialized(env)?;
    let key = DataKey::Market(id);
    let value = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::MarketNotFound)?;
    bump_key(env, &key);
    Ok(value)
}

fn put_market(env: &Env, market: &Market) {
    let key = DataKey::Market(market.id);
    env.storage().persistent().set(&key, market);
    bump_key(env, &key);
}

fn checked_mul_div(a: i128, b: i128, divisor: i128) -> Result<i128, Error> {
    a.checked_mul(b)
        .and_then(|v| v.checked_div(divisor))
        .ok_or(Error::ArithmeticError)
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);
}

fn bump_key(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, DATA_TTL_THRESHOLD, DATA_TTL_BUMP);
}
