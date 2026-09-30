// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String};

use crate::types::{
    CropTerms, DataKey, Error, InstanceKey, OracleReading, Policy, Product, ReserveConfig,
};

// ── Admin ─────────────────────────────────────────────────────────────────────

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

// ── Counters ──────────────────────────────────────────────────────────────────

pub fn get_product_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::ProductCount)
        .unwrap_or(0)
}

pub fn set_product_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::ProductCount, &count);
}

pub fn get_policy_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::PolicyCount)
        .unwrap_or(0)
}

pub fn set_policy_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::PolicyCount, &count);
}

// ── Products ──────────────────────────────────────────────────────────────────

pub fn get_product(env: &Env, product_id: u32) -> Result<Product, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Product(product_id))
        .ok_or(Error::ProductNotFound)
}

pub fn set_product(env: &Env, product_id: u32, product: &Product) {
    env.storage()
        .persistent()
        .set(&DataKey::Product(product_id), product);
}

// ── Policies ──────────────────────────────────────────────────────────────────

pub fn get_policy(env: &Env, policy_id: u32) -> Result<Policy, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(policy_id))
        .ok_or(Error::PolicyNotFound)
}

pub fn set_policy(env: &Env, policy_id: u32, policy: &Policy) {
    env.storage()
        .persistent()
        .set(&DataKey::Policy(policy_id), policy);
}

// ── Oracle ────────────────────────────────────────────────────────────────────

pub fn is_oracle(env: &Env, oracle: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Oracle(oracle.clone()))
        .unwrap_or(false)
}

pub fn set_oracle(env: &Env, oracle: &Address, active: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Oracle(oracle.clone()), &active);
}

pub fn get_oracle_reading(
    env: &Env,
    oracle: &Address,
    parameter_key: &String,
) -> Option<OracleReading> {
    env.storage().persistent().get(&DataKey::OracleReading(
        oracle.clone(),
        parameter_key.clone(),
    ))
}

pub fn set_oracle_reading(
    env: &Env,
    oracle: &Address,
    parameter_key: &String,
    reading: &OracleReading,
) {
    env.storage().persistent().set(
        &DataKey::OracleReading(oracle.clone(), parameter_key.clone()),
        reading,
    );
}

// ── Crop insurance and reserves ───────────────────────────────────────────────

pub fn set_crop_terms(env: &Env, product_id: u32, terms: &CropTerms) {
    env.storage()
        .persistent()
        .set(&DataKey::CropTerms(product_id), terms);
}

pub fn get_crop_terms(env: &Env, product_id: u32) -> Result<CropTerms, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::CropTerms(product_id))
        .ok_or(Error::SatelliteDataRequired)
}

pub fn has_crop_terms(env: &Env, product_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::CropTerms(product_id))
}

pub fn set_reserve_config(env: &Env, config: &ReserveConfig) {
    env.storage()
        .instance()
        .set(&InstanceKey::ReserveConfig, config);
}

pub fn get_reserve_config(env: &Env) -> Result<ReserveConfig, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::ReserveConfig)
        .ok_or(Error::ReserveNotConfigured)
}

pub fn has_reserve_config(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::ReserveConfig)
}

pub fn get_total_reserved(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalReserved)
        .unwrap_or(0)
}

pub fn set_total_reserved(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::TotalReserved, &amount);
}

pub fn set_policy_funded(env: &Env, policy_id: u32, funded: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::FundedPolicy(policy_id), &funded);
}

pub fn is_policy_funded(env: &Env, policy_id: u32) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::FundedPolicy(policy_id))
        .unwrap_or(false)
}
