// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String};

use crate::types::{
    DataKey, Error, InstanceKey, MarginAccount, MarginConfig, MarginPosition, OptionContract,
    PriceData,
};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn get_option_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::OptionCount)
        .unwrap_or(0)
}

pub fn set_option_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::OptionCount, &count);
}

pub fn set_option(env: &Env, option: &OptionContract) {
    env.storage()
        .persistent()
        .set(&DataKey::Option(option.id), option);
}

pub fn get_option(env: &Env, id: u32) -> Result<OptionContract, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Option(id))
        .ok_or(Error::OptionNotFound)
}

pub fn has_margin_config(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::MarginConfig)
}

pub fn set_margin_config(env: &Env, config: &MarginConfig) {
    env.storage()
        .instance()
        .set(&InstanceKey::MarginConfig, config);
}

pub fn get_margin_config(env: &Env) -> Result<MarginConfig, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::MarginConfig)
        .ok_or(Error::PoolNotConfigured)
}

pub fn get_margin_account(env: &Env, writer: &Address) -> MarginAccount {
    env.storage()
        .persistent()
        .get(&DataKey::MarginAccount(writer.clone()))
        .unwrap_or(MarginAccount {
            balance: 0,
            locked: 0,
        })
}

pub fn set_margin_account(env: &Env, writer: &Address, account: &MarginAccount) {
    env.storage()
        .persistent()
        .set(&DataKey::MarginAccount(writer.clone()), account);
}

pub fn get_margin_position(env: &Env, id: u32) -> Result<MarginPosition, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::MarginPosition(id))
        .ok_or(Error::PositionNotCollateralized)
}

pub fn has_margin_position(env: &Env, id: u32) -> bool {
    env.storage().persistent().has(&DataKey::MarginPosition(id))
}

pub fn set_margin_position(env: &Env, id: u32, position: &MarginPosition) {
    env.storage()
        .persistent()
        .set(&DataKey::MarginPosition(id), position);
}

pub fn remove_margin_position(env: &Env, id: u32) {
    env.storage()
        .persistent()
        .remove(&DataKey::MarginPosition(id));
}

pub fn set_price(env: &Env, underlying: &String, price: &PriceData) {
    env.storage()
        .persistent()
        .set(&DataKey::Price(underlying.clone()), price);
}

pub fn get_price(env: &Env, underlying: &String) -> Result<PriceData, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Price(underlying.clone()))
        .ok_or(Error::InvalidPrice)
}
