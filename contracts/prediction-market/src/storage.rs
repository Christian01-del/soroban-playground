use soroban_sdk::{contracttype, Address, Env, Symbol};

use crate::types::{ConditionalMarket, Error, Market, Position, ResolutionProposal};

const PERSISTENT_TTL_THRESHOLD: u32 = 518_400;
const PERSISTENT_TTL_BUMP: u32 = 535_680;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Market(u32),
    Position(u32, Address),
    ConditionalMarket(u32),
    OutcomeBalance(u32, Address, u32),
    LiquidityBalance(u32, Address),
    Resolution(u32),
}

const ADMIN_KEY: &str = "admin";
const MARKET_COUNT_KEY: &str = "mkt_count";

pub fn is_initialized(env: &Env) -> bool {
    let initialized = env.storage().instance().has(&Symbol::new(env, ADMIN_KEY));
    if initialized {
        bump_instance(env);
    }
    initialized
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, ADMIN_KEY), admin);
    bump_instance(env);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    let admin = env
        .storage()
        .instance()
        .get(&Symbol::new(env, ADMIN_KEY))
        .ok_or(Error::NotInitialized)?;
    bump_instance(env);
    Ok(admin)
}

pub fn get_market_count(env: &Env) -> u32 {
    let count = env
        .storage()
        .instance()
        .get(&Symbol::new(env, MARKET_COUNT_KEY))
        .unwrap_or(0u32);
    if is_initialized(env) {
        bump_instance(env);
    }
    count
}

pub fn increment_market_count(env: &Env) -> u32 {
    let count = get_market_count(env) + 1;
    env.storage()
        .instance()
        .set(&Symbol::new(env, MARKET_COUNT_KEY), &count);
    bump_instance(env);
    count
}

pub fn set_market(env: &Env, market: &Market) {
    let key = DataKey::Market(market.id);
    env.storage().persistent().set(&key, market);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

pub fn get_market(env: &Env, id: u32) -> Result<Market, Error> {
    let key = DataKey::Market(id);
    let market = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::MarketNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    Ok(market)
}

pub fn set_position(env: &Env, position: &Position) {
    let key = DataKey::Position(position.market_id, position.trader.clone());
    env.storage().persistent().set(&key, position);
    bump(env, &key);
}

pub fn get_position(env: &Env, market_id: u32, trader: &Address) -> Option<Position> {
    let key = DataKey::Position(market_id, trader.clone());
    let position = env.storage().persistent().get(&key);
    if position.is_some() {
        bump(env, &key);
    }
    position
}

pub fn set_conditional_market(env: &Env, market: &ConditionalMarket) {
    let key = DataKey::ConditionalMarket(market.market_id);
    env.storage().persistent().set(&key, market);
    bump(env, &key);
}

pub fn get_conditional_market(env: &Env, market_id: u32) -> Result<ConditionalMarket, Error> {
    let key = DataKey::ConditionalMarket(market_id);
    let market = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::ConditionalMarketRequired)?;
    bump(env, &key);
    Ok(market)
}

pub fn has_conditional_market(env: &Env, market_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ConditionalMarket(market_id))
}

pub fn get_outcome_balance(env: &Env, market_id: u32, owner: &Address, outcome: u32) -> i128 {
    let key = DataKey::OutcomeBalance(market_id, owner.clone(), outcome);
    let balance = env.storage().persistent().get(&key).unwrap_or(0);
    if balance > 0 {
        bump(env, &key);
    }
    balance
}

pub fn set_outcome_balance(
    env: &Env,
    market_id: u32,
    owner: &Address,
    outcome: u32,
    balance: i128,
) {
    let key = DataKey::OutcomeBalance(market_id, owner.clone(), outcome);
    env.storage().persistent().set(&key, &balance);
    bump(env, &key);
}

pub fn get_liquidity_balance(env: &Env, market_id: u32, owner: &Address) -> i128 {
    let key = DataKey::LiquidityBalance(market_id, owner.clone());
    let balance = env.storage().persistent().get(&key).unwrap_or(0);
    if balance > 0 {
        bump(env, &key);
    }
    balance
}

pub fn set_liquidity_balance(env: &Env, market_id: u32, owner: &Address, balance: i128) {
    let key = DataKey::LiquidityBalance(market_id, owner.clone());
    env.storage().persistent().set(&key, &balance);
    bump(env, &key);
}

pub fn get_resolution(env: &Env, market_id: u32) -> Option<ResolutionProposal> {
    let key = DataKey::Resolution(market_id);
    let proposal = env.storage().persistent().get(&key);
    if proposal.is_some() {
        bump(env, &key);
    }
    proposal
}

pub fn set_resolution(env: &Env, market_id: u32, proposal: &ResolutionProposal) {
    let key = DataKey::Resolution(market_id);
    env.storage().persistent().set(&key, proposal);
    bump(env, &key);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}
