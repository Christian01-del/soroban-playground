// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{BuyoutBid, DataKey, Error, InstanceKey, NftVault};

macro_rules! instance_get {
    ($fn:ident, $key:ident, $t:ty, $default:expr) => {
        pub fn $fn(env: &Env) -> $t {
            env.storage().instance().get(&InstanceKey::$key).unwrap_or($default)
        }
    };
}
macro_rules! instance_set {
    ($fn:ident, $key:ident, $t:ty) => {
        pub fn $fn(env: &Env, v: $t) {
            env.storage().instance().set(&InstanceKey::$key, &v);
        }
    };
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}
pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

instance_get!(get_vault_count, VaultCount, u32, 0);
instance_set!(set_vault_count, VaultCount, u32);
instance_get!(is_paused, Paused, bool, false);
instance_set!(set_paused, Paused, bool);
instance_get!(get_total_fractions_global, TotalFractions, i128, 0);
instance_set!(set_total_fractions_global, TotalFractions, i128);

// ── Vault storage ─────────────────────────────────────────────────────────────

pub fn get_vault(env: &Env, id: u32) -> Option<NftVault> {
    env.storage().persistent().get(&DataKey::Vault(id))
}

pub fn set_vault(env: &Env, vault: &NftVault) {
    env.storage().persistent().set(&DataKey::Vault(vault.id), vault);
}

// ── Fraction (ERC-20-style) balances ─────────────────────────────────────────

pub fn get_fraction_balance(env: &Env, vault_id: u32, holder: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::FractionBalance(vault_id, holder.clone()))
        .unwrap_or(0)
}

pub fn set_fraction_balance(env: &Env, vault_id: u32, holder: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::FractionBalance(vault_id, holder.clone()), &amount);
}

// ── ERC-20 allowances ─────────────────────────────────────────────────────────

pub fn get_allowance(env: &Env, vault_id: u32, owner: &Address, spender: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Allowance(
            vault_id,
            owner.clone(),
            spender.clone(),
        ))
        .unwrap_or(0)
}

pub fn set_allowance(
    env: &Env,
    vault_id: u32,
    owner: &Address,
    spender: &Address,
    amount: i128,
) {
    env.storage().persistent().set(
        &DataKey::Allowance(vault_id, owner.clone(), spender.clone()),
        &amount,
    );
}

// ── Buyout bids ───────────────────────────────────────────────────────────────

pub fn get_buyout_bid(env: &Env, vault_id: u32) -> Option<BuyoutBid> {
    env.storage()
        .persistent()
        .get(&DataKey::BuyoutBid(vault_id))
}

pub fn set_buyout_bid(env: &Env, bid: &BuyoutBid) {
    env.storage()
        .persistent()
        .set(&DataKey::BuyoutBid(bid.vault_id), bid);
}
