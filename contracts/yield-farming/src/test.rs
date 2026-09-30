// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, YieldFarmingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, YieldFarmingContract);
    let client = YieldFarmingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn add_default_strategy(env: &Env, client: &YieldFarmingContractClient, admin: &Address) -> u32 {
    client.add_strategy(admin, &String::from_str(env, "LP Pool A"), &1000) // 10% APY
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_is_initialized_true_after_init() {
    let (_env, _admin, client) = setup();
    assert!(client.is_initialized());
}

// ── add_strategy ──────────────────────────────────────────────────────────────

#[test]
fn test_add_strategy_returns_sequential_ids() {
    let (env, admin, client) = setup();
    let id1 = client.add_strategy(&admin, &String::from_str(&env, "Pool A"), &500);
    let id2 = client.add_strategy(&admin, &String::from_str(&env, "Pool B"), &800);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_add_strategy_stores_data() {
    let (env, admin, client) = setup();
    let id = client.add_strategy(&admin, &String::from_str(&env, "Vault X"), &1500);
    let s = client.get_strategy(&id);
    assert_eq!(s.apy_bps, 1500);
    assert!(s.is_active);
    assert_eq!(s.total_deposited, 0);
}

#[test]
fn test_add_strategy_empty_name_fails() {
    let (env, admin, client) = setup();
    let result = client.try_add_strategy(&admin, &String::from_str(&env, ""), &500);
    assert_eq!(result, Err(Ok(Error::EmptyName)));
}

#[test]
fn test_add_strategy_invalid_apy_fails() {
    let (env, admin, client) = setup();
    let result = client.try_add_strategy(&admin, &String::from_str(&env, "Bad"), &10_001);
    assert_eq!(result, Err(Ok(Error::InvalidApy)));
}

#[test]
fn test_add_strategy_non_admin_fails() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_add_strategy(&stranger, &String::from_str(&env, "Pool"), &500);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── update_strategy_apy ───────────────────────────────────────────────────────

#[test]
fn test_update_apy_changes_value() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    client.update_strategy_apy(&admin, &id, &2000);
    assert_eq!(client.get_strategy(&id).apy_bps, 2000);
}

#[test]
fn test_update_apy_invalid_fails() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let result = client.try_update_strategy_apy(&admin, &id, &99_999);
    assert_eq!(result, Err(Ok(Error::InvalidApy)));
}

// ── set_strategy_active ───────────────────────────────────────────────────────

#[test]
fn test_pause_strategy() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    client.set_strategy_active(&admin, &id, &false);
    assert!(!client.get_strategy(&id).is_active);
}

#[test]
fn test_deposit_into_paused_strategy_fails() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    client.set_strategy_active(&admin, &id, &false);
    let user = Address::generate(&env);
    let result = client.try_deposit(&user, &id, &1_000_000);
    assert_eq!(result, Err(Ok(Error::StrategyPaused)));
}

// ── deposit ───────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_updates_position_and_tvl() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &id, &5_000_000);

    let pos = client.get_position(&user, &id);
    assert_eq!(pos.deposited, 5_000_000);
    assert_eq!(pos.compounded_balance, 5_000_000);

    let strategy = client.get_strategy(&id);
    assert_eq!(strategy.total_deposited, 5_000_000);
}

#[test]
fn test_deposit_zero_fails() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    let result = client.try_deposit(&user, &id, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_multiple_deposits_accumulate() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &id, &1_000_000);
    client.deposit(&user, &id, &2_000_000);

    let pos = client.get_position(&user, &id);
    // Balance should be at least 3_000_000 (may be slightly more due to compounding)
    assert!(pos.compounded_balance >= 3_000_000);
}

// ── withdraw ──────────────────────────────────────────────────────────────────

#[test]
fn test_withdraw_reduces_balance() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &id, &10_000_000);
    client.withdraw(&user, &id, &4_000_000);

    let pos = client.get_position(&user, &id);
    assert!(pos.compounded_balance >= 6_000_000);
}

#[test]
fn test_withdraw_full_removes_position() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &id, &1_000_000);
    // Withdraw the exact deposited amount (no time elapsed so no rewards)
    client.withdraw(&user, &id, &1_000_000);

    let result = client.try_get_position(&user, &id);
    assert_eq!(result, Err(Ok(Error::NoPosition)));
}

#[test]
fn test_withdraw_exceeds_balance_fails() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &id, &1_000_000);
    let result = client.try_withdraw(&user, &id, &9_999_999);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_withdraw_zero_fails() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &id, &1_000_000);
    let result = client.try_withdraw(&user, &id, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

// ── compound ──────────────────────────────────────────────────────────────────

#[test]
fn test_compound_increases_balance_over_time() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &id, &10_000_000);

    // Advance time by ~1 year
    env.ledger().with_mut(|l| l.timestamp += 31_536_000);

    let new_balance = client.compound(&user, &id);
    // 10% APY on 10_000_000 ≈ 1_000_000 reward → balance ≈ 11_000_000
    assert!(new_balance > 10_000_000);
}

#[test]
fn test_compound_no_time_elapsed_no_change() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &id, &5_000_000);
    let balance = client.compound(&user, &id);
    assert_eq!(balance, 5_000_000);
}

#[test]
fn test_compound_no_position_fails() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    let result = client.try_compound(&user, &id);
    assert_eq!(result, Err(Ok(Error::NoPosition)));
}

// ── list_strategies ───────────────────────────────────────────────────────────

#[test]
fn test_list_strategies_returns_all_ids() {
    let (env, admin, client) = setup();
    client.add_strategy(&admin, &String::from_str(&env, "A"), &100);
    client.add_strategy(&admin, &String::from_str(&env, "B"), &200);
    client.add_strategy(&admin, &String::from_str(&env, "C"), &300);

    let ids = client.list_strategies();
    assert_eq!(ids.len(), 3);
}

// ── portfolio: multiple strategies ───────────────────────────────────────────

#[test]
fn test_user_can_deposit_into_multiple_strategies() {
    let (env, admin, client) = setup();
    let id1 = client.add_strategy(&admin, &String::from_str(&env, "Pool A"), &500);
    let id2 = client.add_strategy(&admin, &String::from_str(&env, "Pool B"), &800);
    let user = Address::generate(&env);

    client.deposit(&user, &id1, &1_000_000);
    client.deposit(&user, &id2, &2_000_000);

    assert_eq!(client.get_position(&user, &id1).deposited, 1_000_000);
    assert_eq!(client.get_position(&user, &id2).deposited, 2_000_000);
}

#[test]
fn test_two_users_independent_positions() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.deposit(&alice, &id, &3_000_000);
    client.deposit(&bob, &id, &7_000_000);

    assert_eq!(client.get_position(&alice, &id).deposited, 3_000_000);
    assert_eq!(client.get_position(&bob, &id).deposited, 7_000_000);
    assert_eq!(client.get_strategy(&id).total_deposited, 10_000_000);
}

// -- Production optimizer ----------------------------------------------------

#[test]
fn test_legacy_strategy_has_backwards_compatible_pool_defaults() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);

    let config = client.get_pool_config(&id);
    assert_eq!(config.annual_rewards, 0);
    assert_eq!(config.capacity, 0);
    assert_eq!(config.max_allocation_bps, 10_000);
    assert_eq!(client.dynamic_apy(&id, &1_000_000), 1_000);
}

#[test]
fn test_configure_pool_validates_production_limits() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);

    assert_eq!(
        client.try_configure_pool(&admin, &id, &0, &-1, &0, &0, &10_000),
        Err(Ok(Error::InvalidPoolConfig))
    );
    assert_eq!(
        client.try_configure_pool(&admin, &id, &0, &0, &10_001, &0, &10_000),
        Err(Ok(Error::InvalidBasisPoints))
    );
    assert_eq!(
        client.try_configure_pool(&admin, &id, &0, &0, &0, &101, &10_000),
        Err(Ok(Error::InvalidRiskScore))
    );
}

#[test]
fn test_dynamic_apy_tracks_tvl_dilution_and_fees() {
    let (env, admin, client) = setup();
    let id = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &id, &1_000_000);
    client.configure_pool(&admin, &id, &100_000, &3_000_000, &1_000, &10, &10_000);

    assert_eq!(client.dynamic_apy(&id, &0), 900);
    assert_eq!(client.dynamic_apy(&id, &1_000_000), 450);
    assert_eq!(
        client.try_dynamic_apy(&id, &3_000_000),
        Err(Ok(Error::InsufficientCapacity))
    );
}

#[test]
fn test_optimizer_returns_exact_diversified_allocation() {
    let (env, admin, client) = setup();
    let low = client.add_strategy(&admin, &String::from_str(&env, "Low"), &500);
    let medium = client.add_strategy(&admin, &String::from_str(&env, "Medium"), &1_000);
    let high = client.add_strategy(&admin, &String::from_str(&env, "High"), &1_500);
    client.configure_pool(&admin, &low, &0, &0, &0, &5, &5_000);
    client.configure_pool(&admin, &medium, &0, &0, &0, &10, &5_000);
    client.configure_pool(&admin, &high, &0, &0, &0, &20, &5_000);

    let allocations = client.optimize_allocation(&1_000_000, &20);
    assert_eq!(allocations.len(), 3);
    assert_eq!(
        allocations.iter().map(|a| a.amount).sum::<i128>(),
        1_000_000
    );
    assert_eq!(
        allocations.iter().map(|a| a.weight_bps).sum::<u32>(),
        10_000
    );
    assert!(allocations.iter().all(|a| a.amount <= 500_000));
}

#[test]
fn test_optimizer_enforces_risk_and_capacity() {
    let (env, admin, client) = setup();
    let safe = client.add_strategy(&admin, &String::from_str(&env, "Safe"), &600);
    let risky = client.add_strategy(&admin, &String::from_str(&env, "Risky"), &2_000);
    client.configure_pool(&admin, &safe, &0, &600_000, &0, &10, &10_000);
    client.configure_pool(&admin, &risky, &0, &0, &0, &90, &10_000);

    assert_eq!(
        client.try_optimize_allocation(&1_000_000, &20),
        Err(Ok(Error::InsufficientCapacity))
    );
    let allocations = client.optimize_allocation(&500_000, &20);
    assert_eq!(allocations.len(), 1);
    assert_eq!(allocations.get(0).unwrap().strategy_id, safe);
}

#[test]
fn test_compound_all_reinvests_every_pool_and_updates_tvl() {
    let (env, admin, client) = setup();
    let first = client.add_strategy(&admin, &String::from_str(&env, "First"), &1_000);
    let second = client.add_strategy(&admin, &String::from_str(&env, "Second"), &2_000);
    let user = Address::generate(&env);
    client.deposit(&user, &first, &1_000_000);
    client.deposit(&user, &second, &2_000_000);
    env.ledger()
        .with_mut(|ledger| ledger.timestamp += 31_536_000);

    assert_eq!(client.compound_all(&user), 500_000);
    assert_eq!(
        client.get_position(&user, &first).compounded_balance,
        1_100_000
    );
    assert_eq!(
        client.get_position(&user, &second).compounded_balance,
        2_400_000
    );
    assert_eq!(client.get_strategy(&first).total_deposited, 1_100_000);
    assert_eq!(client.get_strategy(&second).total_deposited, 2_400_000);
}

#[test]
fn test_rebalance_moves_full_portfolio_across_multiple_pools() {
    let (env, admin, client) = setup();
    let low = client.add_strategy(&admin, &String::from_str(&env, "Low"), &300);
    let mid = client.add_strategy(&admin, &String::from_str(&env, "Mid"), &900);
    let high = client.add_strategy(&admin, &String::from_str(&env, "High"), &1_500);
    client.configure_pool(&admin, &low, &0, &0, &0, &5, &5_000);
    client.configure_pool(&admin, &mid, &0, &0, &0, &10, &5_000);
    client.configure_pool(&admin, &high, &0, &0, &0, &15, &5_000);
    let user = Address::generate(&env);
    client.deposit(&user, &low, &1_000_000);

    let result = client.rebalance(&user, &20);
    assert_eq!(result.total_balance, 1_000_000);
    assert!(result.new_weighted_apy_bps > result.previous_weighted_apy_bps);
    assert_eq!(
        result.allocations.iter().map(|a| a.amount).sum::<i128>(),
        1_000_000
    );
    assert!(client.try_get_position(&user, &low).is_ok());
    assert!(client.try_get_position(&user, &mid).is_ok());
    assert!(client.try_get_position(&user, &high).is_ok());
}

#[test]
fn test_rebalance_rejects_when_portfolio_cannot_improve() {
    let (env, admin, client) = setup();
    let only = add_default_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &only, &1_000_000);

    assert_eq!(
        client.try_rebalance(&user, &100),
        Err(Ok(Error::NoOptimizableStrategy))
    );
}
