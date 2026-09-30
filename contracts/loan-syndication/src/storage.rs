use soroban_sdk::{contracttype, Address, Env};

use crate::types::{Error, Loan, Tranche, TranchePosition};

const TTL_THRESHOLD: u32 = 518_400;
const TTL_BUMP: u32 = 535_680;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    Paused,
    Locked,
    LoanCount,
    Loan(u32),
    Position(u32, Address, Tranche),
}

pub fn is_initialized(env: &Env) -> bool {
    let initialized = env.storage().instance().has(&DataKey::Initialized);
    if initialized {
        bump_instance(env);
    }
    initialized
}

pub fn set_initialized(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
    env.storage().instance().set(&DataKey::Initialized, &true);
    env.storage().instance().set(&DataKey::Paused, &false);
    bump_instance(env);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    let admin = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    bump_instance(env);
    Ok(admin)
}

pub fn is_paused(env: &Env) -> bool {
    let paused = env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false);
    if is_initialized(env) {
        bump_instance(env);
    }
    paused
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
    bump_instance(env);
}

pub fn enter(env: &Env) -> Result<(), Error> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Locked)
        .unwrap_or(false)
    {
        return Err(Error::ReentrantCall);
    }
    env.storage().instance().set(&DataKey::Locked, &true);
    bump_instance(env);
    Ok(())
}

pub fn exit(env: &Env) {
    env.storage().instance().set(&DataKey::Locked, &false);
    bump_instance(env);
}

pub fn next_loan_id(env: &Env) -> Result<u32, Error> {
    let current: u32 = env
        .storage()
        .instance()
        .get(&DataKey::LoanCount)
        .unwrap_or(0);
    let next = current.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
    env.storage().instance().set(&DataKey::LoanCount, &next);
    bump_instance(env);
    Ok(next)
}

pub fn get_loan_count(env: &Env) -> u32 {
    let count = env
        .storage()
        .instance()
        .get(&DataKey::LoanCount)
        .unwrap_or(0);
    if is_initialized(env) {
        bump_instance(env);
    }
    count
}

pub fn set_loan(env: &Env, loan: &Loan) {
    let key = DataKey::Loan(loan.id);
    env.storage().persistent().set(&key, loan);
    bump_persistent(env, &key);
}

pub fn get_loan(env: &Env, loan_id: u32) -> Result<Loan, Error> {
    let key = DataKey::Loan(loan_id);
    let loan = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::LoanNotFound)?;
    bump_persistent(env, &key);
    Ok(loan)
}

pub fn get_position(
    env: &Env,
    loan_id: u32,
    lender: &Address,
    tranche: Tranche,
) -> TranchePosition {
    let key = DataKey::Position(loan_id, lender.clone(), tranche);
    let position = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(TranchePosition {
            loan_id,
            lender: lender.clone(),
            tranche,
            principal: 0,
            claimed: 0,
        });
    if position.principal > 0 {
        bump_persistent(env, &key);
    }
    position
}

pub fn set_position(env: &Env, position: &TranchePosition) {
    let key = DataKey::Position(position.loan_id, position.lender.clone(), position.tranche);
    env.storage().persistent().set(&key, position);
    bump_persistent(env, &key);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_BUMP);
}
