#![no_std]

//! Token-escrowed recursive royalty waterfalls with batched pull payments.

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Vec,
};

const BPS: i128 = 10_000;
pub const MAX_NODES: u32 = 64;
pub const MAX_DEPTH: u32 = 8;
pub const MAX_BATCH: u32 = 20;
const INSTANCE_TTL_THRESHOLD: u32 = 30 * 17_280;
const INSTANCE_TTL_BUMP: u32 = 120 * 17_280;
const DATA_TTL_THRESHOLD: u32 = 30 * 17_280;
const DATA_TTL_BUMP: u32 = 365 * 17_280;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Paused,
    AgreementCount,
    Agreement(u64),
    Pending(u64, Address),
}

/// One node in an ordered royalty tree.
///
/// Node zero is the root and must have no parent and a `share_bps` of 10,000.
/// Every other node references an earlier parent. Its share is a percentage of
/// that parent's incoming amount, not a percentage of the global deposit.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoyaltyNode {
    pub account: Address,
    pub parent: Option<u32>,
    pub share_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Agreement {
    pub id: u64,
    pub owner: Address,
    pub token: Address,
    pub reference: String,
    pub nodes: Vec<RoyaltyNode>,
    pub active: bool,
    pub total_received: i128,
    pub total_claimed: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    InvalidReference = 5,
    InvalidTree = 6,
    TooManyNodes = 7,
    TreeTooDeep = 8,
    DuplicateAccount = 9,
    InvalidShare = 10,
    AgreementNotFound = 11,
    AgreementInactive = 12,
    InvalidAmount = 13,
    ArithmeticError = 14,
    NothingToClaim = 15,
    EmptyBatch = 16,
    BatchTooLarge = 17,
}

#[contract]
pub struct Royalty;

#[contractimpl]
impl Royalty {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::AgreementCount, &0u64);
        bump_instance(&env);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        admin(&env)?.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        bump_instance(&env);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    /// Creates an immutable royalty tree. Parents must precede their children.
    pub fn create_agreement(
        env: Env,
        owner: Address,
        token: Address,
        reference: String,
        nodes: Vec<RoyaltyNode>,
    ) -> Result<u64, Error> {
        initialized(&env)?;
        not_paused(&env)?;
        owner.require_auth();
        if reference.is_empty() || reference.len() > 128 {
            return Err(Error::InvalidReference);
        }
        validate_tree(&env, &nodes)?;

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AgreementCount)
            .unwrap();
        let agreement = Agreement {
            id,
            owner,
            token,
            reference,
            nodes,
            active: true,
            total_received: 0,
            total_claimed: 0,
        };
        put_agreement(&env, &agreement);
        env.storage()
            .instance()
            .set(&DataKey::AgreementCount, &(id + 1));
        bump_instance(&env);
        env.events()
            .publish((symbol_short!("created"), id), agreement.owner);
        Ok(id)
    }

    /// Stops future deposits without affecting already accrued claims.
    pub fn close_agreement(env: Env, agreement_id: u64) -> Result<(), Error> {
        initialized(&env)?;
        let mut agreement = agreement(&env, agreement_id)?;
        agreement.owner.require_auth();
        agreement.active = false;
        put_agreement(&env, &agreement);
        env.events()
            .publish((symbol_short!("closed"), agreement_id), ());
        Ok(())
    }

    /// Escrows revenue and recursively allocates it to pending balances.
    pub fn deposit(env: Env, payer: Address, agreement_id: u64, amount: i128) -> Result<(), Error> {
        initialized(&env)?;
        not_paused(&env)?;
        payer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut agreement = agreement(&env, agreement_id)?;
        if !agreement.active {
            return Err(Error::AgreementInactive);
        }

        // Compute every credit before the external token call. If any checked
        // operation fails, no funds have moved and no state has changed.
        let credits = allocate(&env, amount, &agreement.nodes)?;
        let mut new_pending = Vec::new(&env);
        for i in 0..agreement.nodes.len() {
            let account = agreement.nodes.get(i).unwrap().account;
            let old = pending(&env, agreement_id, &account);
            new_pending.push_back(
                old.checked_add(credits.get(i).unwrap())
                    .ok_or(Error::ArithmeticError)?,
            );
        }
        agreement.total_received = agreement
            .total_received
            .checked_add(amount)
            .ok_or(Error::ArithmeticError)?;

        token::Client::new(&env, &agreement.token).transfer(
            &payer,
            &env.current_contract_address(),
            &amount,
        );
        for i in 0..agreement.nodes.len() {
            let account = agreement.nodes.get(i).unwrap().account;
            put_pending(&env, agreement_id, &account, new_pending.get(i).unwrap());
        }
        put_agreement(&env, &agreement);
        env.events()
            .publish((symbol_short!("deposit"), agreement_id), (payer, amount));
        Ok(())
    }

    pub fn claim(env: Env, agreement_id: u64, recipient: Address) -> Result<i128, Error> {
        initialized(&env)?;
        recipient.require_auth();
        claim_one(&env, agreement_id, &recipient)
    }

    /// Claims for several recipients in one invocation.
    ///
    /// The authenticated operator may be a payout automation service. Funds
    /// can only go to their recorded recipients, so the operator cannot divert
    /// them. Zero-balance recipients are skipped to make retries idempotent.
    pub fn claim_batch(
        env: Env,
        operator: Address,
        agreement_id: u64,
        recipients: Vec<Address>,
    ) -> Result<i128, Error> {
        initialized(&env)?;
        operator.require_auth();
        if recipients.is_empty() {
            return Err(Error::EmptyBatch);
        }
        if recipients.len() > MAX_BATCH {
            return Err(Error::BatchTooLarge);
        }
        for i in 0..recipients.len() {
            for j in (i + 1)..recipients.len() {
                if recipients.get(i).unwrap() == recipients.get(j).unwrap() {
                    return Err(Error::DuplicateAccount);
                }
            }
        }

        let mut total = 0i128;
        for recipient in recipients.iter() {
            let amount = pending(&env, agreement_id, &recipient);
            if amount > 0 {
                total = total.checked_add(amount).ok_or(Error::ArithmeticError)?;
                claim_one(&env, agreement_id, &recipient)?;
            }
        }
        if total == 0 {
            return Err(Error::NothingToClaim);
        }
        env.events()
            .publish((symbol_short!("batch"), agreement_id), (operator, total));
        Ok(total)
    }

    /// Previews per-node credits and guarantees their sum equals `amount`.
    pub fn preview(env: Env, agreement_id: u64, amount: i128) -> Result<Vec<i128>, Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let agreement = agreement(&env, agreement_id)?;
        allocate(&env, amount, &agreement.nodes)
    }

    pub fn get_agreement(env: Env, agreement_id: u64) -> Result<Agreement, Error> {
        agreement(&env, agreement_id)
    }

    pub fn pending_balance(env: Env, agreement_id: u64, recipient: Address) -> i128 {
        pending(&env, agreement_id, &recipient)
    }
}

fn validate_tree(env: &Env, nodes: &Vec<RoyaltyNode>) -> Result<(), Error> {
    if nodes.is_empty() {
        return Err(Error::InvalidTree);
    }
    if nodes.len() > MAX_NODES {
        return Err(Error::TooManyNodes);
    }
    let root = nodes.get(0).unwrap();
    if root.parent.is_some() || root.share_bps != BPS as u32 {
        return Err(Error::InvalidTree);
    }

    let mut depths = Vec::from_array(env, [0u32; MAX_NODES as usize]).slice(0..nodes.len());
    let mut child_totals = Vec::from_array(env, [0u32; MAX_NODES as usize]).slice(0..nodes.len());
    for i in 0..nodes.len() {
        let node = nodes.get(i).unwrap();
        if node.share_bps == 0 || node.share_bps > BPS as u32 {
            return Err(Error::InvalidShare);
        }
        for j in 0..i {
            if node.account == nodes.get(j).unwrap().account {
                return Err(Error::DuplicateAccount);
            }
        }
        if i > 0 {
            let parent = node.parent.ok_or(Error::InvalidTree)?;
            if parent >= i {
                return Err(Error::InvalidTree);
            }
            let depth = depths.get(parent).unwrap() + 1;
            if depth > MAX_DEPTH {
                return Err(Error::TreeTooDeep);
            }
            depths.set(i, depth);
            let total = child_totals
                .get(parent)
                .unwrap()
                .checked_add(node.share_bps)
                .ok_or(Error::ArithmeticError)?;
            if total > BPS as u32 {
                return Err(Error::InvalidShare);
            }
            child_totals.set(parent, total);
        }
    }
    Ok(())
}

fn allocate(env: &Env, amount: i128, nodes: &Vec<RoyaltyNode>) -> Result<Vec<i128>, Error> {
    let mut incoming = Vec::from_array(env, [0i128; MAX_NODES as usize]).slice(0..nodes.len());
    let mut credits = Vec::from_array(env, [0i128; MAX_NODES as usize]).slice(0..nodes.len());
    incoming.set(0, amount);

    for parent_index in 0..nodes.len() {
        let parent_amount = incoming.get(parent_index).unwrap();
        let mut distributed = 0i128;
        // Ordered parent indexes make this bounded traversal cycle-free.
        for child_index in (parent_index + 1)..nodes.len() {
            let child = nodes.get(child_index).unwrap();
            if child.parent == Some(parent_index) {
                let share = checked_mul_div(parent_amount, child.share_bps as i128, BPS)?;
                incoming.set(child_index, share);
                distributed = distributed
                    .checked_add(share)
                    .ok_or(Error::ArithmeticError)?;
            }
        }
        credits.set(
            parent_index,
            parent_amount
                .checked_sub(distributed)
                .ok_or(Error::ArithmeticError)?,
        );
    }
    Ok(credits)
}

fn claim_one(env: &Env, agreement_id: u64, recipient: &Address) -> Result<i128, Error> {
    let mut agreement = agreement(env, agreement_id)?;
    let amount = pending(env, agreement_id, recipient);
    if amount <= 0 {
        return Err(Error::NothingToClaim);
    }
    agreement.total_claimed = agreement
        .total_claimed
        .checked_add(amount)
        .ok_or(Error::ArithmeticError)?;
    put_pending(env, agreement_id, recipient, 0);
    put_agreement(env, &agreement);
    token::Client::new(env, &agreement.token).transfer(
        &env.current_contract_address(),
        recipient,
        &amount,
    );
    env.events().publish(
        (symbol_short!("claim"), agreement_id),
        (recipient.clone(), amount),
    );
    Ok(amount)
}

fn checked_mul_div(a: i128, b: i128, divisor: i128) -> Result<i128, Error> {
    a.checked_mul(b)
        .and_then(|value| value.checked_div(divisor))
        .ok_or(Error::ArithmeticError)
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

fn agreement(env: &Env, id: u64) -> Result<Agreement, Error> {
    initialized(env)?;
    let key = DataKey::Agreement(id);
    let value = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::AgreementNotFound)?;
    bump_key(env, &key);
    Ok(value)
}

fn put_agreement(env: &Env, agreement: &Agreement) {
    let key = DataKey::Agreement(agreement.id);
    env.storage().persistent().set(&key, agreement);
    bump_key(env, &key);
}

fn pending(env: &Env, id: u64, account: &Address) -> i128 {
    let key = DataKey::Pending(id, account.clone());
    let value = env.storage().persistent().get(&key).unwrap_or(0);
    if value > 0 {
        bump_key(env, &key);
    }
    value
}

fn put_pending(env: &Env, id: u64, account: &Address, amount: i128) {
    let key = DataKey::Pending(id, account.clone());
    env.storage().persistent().set(&key, &amount);
    bump_key(env, &key);
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
