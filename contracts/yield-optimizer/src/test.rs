// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Env, String,
};

use crate::types::{Allocation, Error};
use crate::{YieldOptimizer, YieldOptimizerClient};

fn setup() -> (Env, Address, YieldOptimizerClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, YieldOptimizer);
    let client = YieldOptimizerClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

use soroban_sdk::Address;

fn add_strategy(env: &Env, client: &YieldOptimizerClient, admin: &Address, apy: u32) -> u32 {
    client
        .add_strategy(admin, &String::from_str(env, "Strategy"), &apy)
        .unwrap()
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_init_ok() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, YieldOptimizer);
    let client = YieldOptimizerClient::new(&env, &id);
    let admin = Address::generate(&env);
    assert_eq!(client.initialize(&admin), Ok(()));
}

#[test]
fn test_init_twice_fails() {
    let (_, admin, client) = setup();
    assert_eq!(
        client.initialize(&admin),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (_, admin, client) = setup();
    assert!(!client.is_paused());
    client.pause(&admin).unwrap();
    assert!(client.is_paused());
    client.unpause(&admin).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_deposit() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 1000);
    client.pause(&admin).unwrap();
    let user = Address::generate(&env);
    assert_eq!(
        client.deposit(&user, &sid, &1_000_000),
        Err(Ok(Error::ContractPaused))
    );
}

// ── Strategy management ───────────────────────────────────────────────────────

#[test]
fn test_add_strategy_ok() {
    let (env, admin, client) = setup();
    let id = add_strategy(&env, &client, &admin, 500);
    assert_eq!(id, 1);
    let s = client.get_strategy(&id).unwrap();
    assert_eq!(s.apy_bps, 500);
    assert!(s.is_active);
}

#[test]
fn test_add_strategy_invalid_apy() {
    let (env, admin, client) = setup();
    assert_eq!(
        client.add_strategy(&admin, &String::from_str(&env, "S"), &50_001),
        Err(Ok(Error::InvalidApy))
    );
}

#[test]
fn test_update_apy() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 500);
    client.update_apy(&admin, &sid, &2000).unwrap();
    assert_eq!(client.get_strategy(&sid).unwrap().apy_bps, 2000);
}

#[test]
fn test_set_strategy_inactive() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 500);
    client.set_strategy_active(&admin, &sid, &false).unwrap();
    let user = Address::generate(&env);
    assert_eq!(
        client.deposit(&user, &sid, &1_000),
        Err(Ok(Error::StrategyPaused))
    );
}

// ── Deposit / Withdraw ────────────────────────────────────────────────────────

#[test]
fn test_deposit_withdraw() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 1000);
    let user = Address::generate(&env);
    client.deposit(&user, &sid, &1_000_000).unwrap();
    let pos = client.get_position(&user, &sid).unwrap();
    assert_eq!(pos.deposited, 1_000_000);
    client.withdraw(&user, &sid, &500_000).unwrap();
    let pos2 = client.get_position(&user, &sid).unwrap();
    assert_eq!(pos2.compounded_balance, 500_000);
}

#[test]
fn test_withdraw_excess_fails() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 1000);
    let user = Address::generate(&env);
    client.deposit(&user, &sid, &1_000).unwrap();
    assert_eq!(
        client.withdraw(&user, &sid, &2_000),
        Err(Ok(Error::InsufficientBalance))
    );
}

// ── Auto-compound ─────────────────────────────────────────────────────────────

#[test]
fn test_compound_accrues_rewards() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 10_000); // 100% APY
    let user = Address::generate(&env);
    client.deposit(&user, &sid, &1_000_000).unwrap();
    // Advance ledger by 1 year
    env.ledger().with_mut(|l| l.timestamp += 31_536_000);
    let bal = client.compound(&user, &sid).unwrap();
    assert!(bal > 1_000_000, "balance should have grown");
}

#[test]
fn test_compound_profitably_accounts_for_fees_and_costs() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 10_000); // 100% APY
    client
        .configure_advanced_strategy(
            &admin,
            &sid,
            &String::from_str(&env, "Blend"),
            &1000,
            &1_000,
            &50,
            &10,
        )
        .unwrap();

    let user = Address::generate(&env);
    client.deposit(&user, &sid, &1_000_000).unwrap();
    env.ledger().with_mut(|l| l.timestamp += 31_536_000);

    let result = client.compound_profitably(&user, &sid).unwrap();
    assert_eq!(result.gross_reward, 1_000_000);
    assert_eq!(result.fee_amount, 100_000);
    assert_eq!(result.harvest_cost, 1_000);
    assert_eq!(result.net_reward, 899_000);
    assert_eq!(result.compounded_balance, 1_899_000);
}

#[test]
fn test_compound_profitably_rejects_unprofitable_harvest() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 1000);
    client
        .configure_advanced_strategy(
            &admin,
            &sid,
            &String::from_str(&env, "Small"),
            &0,
            &120_000,
            &0,
            &5,
        )
        .unwrap();

    let user = Address::generate(&env);
    client.deposit(&user, &sid, &1_000_000).unwrap();
    env.ledger().with_mut(|l| l.timestamp += 31_536_000);

    let before = client.get_position(&user, &sid).unwrap().compounded_balance;
    assert_eq!(
        client.compound_profitably(&user, &sid),
        Err(Ok(Error::UnprofitableCompound))
    );
    assert_eq!(
        client.get_position(&user, &sid).unwrap().compounded_balance,
        before
    );
}

// ── Allocate ──────────────────────────────────────────────────────────────────

#[test]
fn test_allocate_ok() {
    let (env, admin, client) = setup();
    let s1 = add_strategy(&env, &client, &admin, 500);
    let s2 = add_strategy(&env, &client, &admin, 1000);
    let allocs = vec![
        &env,
        Allocation {
            strategy_id: s1,
            weight_bps: 6000,
        },
        Allocation {
            strategy_id: s2,
            weight_bps: 4000,
        },
    ];
    let amounts = client.allocate(&allocs, &1_000_000).unwrap();
    assert_eq!(amounts.get(0).unwrap(), 600_000);
    assert_eq!(amounts.get(1).unwrap(), 400_000);
}

#[test]
fn test_allocate_invalid_weights() {
    let (env, admin, client) = setup();
    let s1 = add_strategy(&env, &client, &admin, 500);
    let allocs = vec![
        &env,
        Allocation {
            strategy_id: s1,
            weight_bps: 5000,
        },
    ];
    assert_eq!(
        client.allocate(&allocs, &1_000_000),
        Err(Ok(Error::InvalidWeights))
    );
}

// ── Best strategy ─────────────────────────────────────────────────────────────

#[test]
fn test_best_strategy() {
    let (env, admin, client) = setup();
    let s1 = add_strategy(&env, &client, &admin, 500);
    let s2 = add_strategy(&env, &client, &admin, 2000);
    assert_eq!(client.best_strategy().unwrap(), s2);
    // Deactivate s2 — best should fall back to s1
    client.set_strategy_active(&admin, &s2, &false).unwrap();
    assert_eq!(client.best_strategy().unwrap(), s1);
}

#[test]
fn test_best_advanced_strategy_uses_net_yield_and_risk() {
    let (env, admin, client) = setup();
    let conservative = add_strategy(&env, &client, &admin, 1500);
    let expensive = add_strategy(&env, &client, &admin, 2000);
    client
        .configure_advanced_strategy(
            &admin,
            &conservative,
            &String::from_str(&env, "Conservative"),
            &0,
            &100,
            &0,
            &5,
        )
        .unwrap();
    client
        .configure_advanced_strategy(
            &admin,
            &expensive,
            &String::from_str(&env, "Expensive"),
            &3000,
            &100,
            &0,
            &80,
        )
        .unwrap();

    assert_eq!(client.best_strategy().unwrap(), expensive);
    assert_eq!(client.best_advanced_strategy(&50).unwrap(), conservative);
    assert_eq!(
        client.best_advanced_strategy(&4),
        Err(Ok(Error::NoOptimizableStrategy))
    );
}

#[test]
fn test_optimize_allocation_sums_weights_to_bps() {
    let (env, admin, client) = setup();
    let s1 = add_strategy(&env, &client, &admin, 1000);
    let s2 = add_strategy(&env, &client, &admin, 2000);
    client
        .configure_advanced_strategy(&admin, &s1, &String::from_str(&env, "A"), &0, &0, &0, &0)
        .unwrap();
    client
        .configure_advanced_strategy(&admin, &s2, &String::from_str(&env, "B"), &0, &0, &0, &0)
        .unwrap();

    let allocations = client.optimize_allocation(&1_000_000, &100).unwrap();
    assert_eq!(allocations.len(), 2);
    assert_eq!(
        allocations.get(0).unwrap().weight_bps + allocations.get(1).unwrap().weight_bps,
        10_000
    );
    assert_eq!(allocations.get(1).unwrap().strategy_id, s2);
    assert!(allocations.get(1).unwrap().weight_bps > allocations.get(0).unwrap().weight_bps);
}

#[test]
fn test_rebalance_to_best_moves_position() {
    let (env, admin, client) = setup();
    let low = add_strategy(&env, &client, &admin, 500);
    let high = add_strategy(&env, &client, &admin, 2000);
    client
        .configure_advanced_strategy(&admin, &low, &String::from_str(&env, "Low"), &0, &0, &0, &0)
        .unwrap();
    client
        .configure_advanced_strategy(
            &admin,
            &high,
            &String::from_str(&env, "High"),
            &0,
            &0,
            &0,
            &0,
        )
        .unwrap();

    let user = Address::generate(&env);
    client.deposit(&user, &low, &1_000_000).unwrap();
    env.ledger().with_mut(|l| l.timestamp += 31_536_000);

    let result = client.rebalance_to_best(&user, &low, &100).unwrap();
    assert_eq!(result.from_strategy_id, low);
    assert_eq!(result.to_strategy_id, high);
    assert!(result.moved_amount > 1_000_000);
    assert!(client.get_position(&user, &low).is_err());
    assert_eq!(
        client
            .get_position(&user, &high)
            .unwrap()
            .compounded_balance,
        result.moved_amount
    );
}

// ── Backtest ──────────────────────────────────────────────────────────────────

#[test]
fn test_backtest_one_year() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 1000); // 10% APY
    let result = client.backtest(&sid, &1_000_000, &31_536_000).unwrap();
    assert_eq!(result.initial_amount, 1_000_000);
    assert!(result.final_amount > 1_000_000);
    assert_eq!(result.gain, result.final_amount - 1_000_000);
}

#[test]
fn test_backtest_zero_duration_fails() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 1000);
    assert_eq!(
        client.backtest(&sid, &1_000_000, &0),
        Err(Ok(Error::InvalidDuration))
    );
}

#[test]
fn test_list_strategies() {
    let (env, admin, client) = setup();
    add_strategy(&env, &client, &admin, 500);
    add_strategy(&env, &client, &admin, 1000);
    let list = client.list_strategies();
    assert_eq!(list.len(), 2);
}

// ── Additional Edge & Validation Tests ────────────────────────────────────────

#[test]
fn test_add_strategy_empty_name_fails() {
    let (env, admin, client) = setup();
    assert_eq!(
        client.add_strategy(&admin, &String::from_str(&env, ""), &500),
        Err(Ok(Error::EmptyName))
    );
}

#[test]
fn test_configure_advanced_strategy_invalid_fee() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 500);
    assert_eq!(
        client.configure_advanced_strategy(
            &admin,
            &sid,
            &String::from_str(&env, "Protocol"),
            &10_001, // Fee > 10,000 bps
            &0,
            &0,
            &10,
        ),
        Err(Ok(Error::InvalidFee))
    );
}

#[test]
fn test_configure_advanced_strategy_invalid_risk() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 500);
    assert_eq!(
        client.configure_advanced_strategy(
            &admin,
            &sid,
            &String::from_str(&env, "Protocol"),
            &500,
            &0,
            &0,
            &101, // Risk > 100
        ),
        Err(Ok(Error::InvalidRiskScore))
    );
}

#[test]
fn test_deposit_zero_amount_fails() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 500);
    let user = Address::generate(&env);
    assert_eq!(client.deposit(&user, &sid, &0), Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_withdraw_zero_amount_fails() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 500);
    let user = Address::generate(&env);
    client.deposit(&user, &sid, &1_000).unwrap();
    assert_eq!(client.withdraw(&user, &sid, &0), Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_withdraw_full_clears_position() {
    let (env, admin, client) = setup();
    let sid = add_strategy(&env, &client, &admin, 500);
    let user = Address::generate(&env);
    client.deposit(&user, &sid, &1_000_000).unwrap();
    let withdrawn = client.withdraw(&user, &sid, &1_000_000).unwrap();
    assert_eq!(withdrawn, 1_000_000);
    assert_eq!(
        client.get_position(&user, &sid),
        Err(Ok(Error::PositionNotFound))
    );
}

#[test]
fn test_non_existent_strategy_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    assert_eq!(client.get_strategy(&999), Err(Ok(Error::StrategyNotFound)));
    assert_eq!(
        client.deposit(&user, &999, &1_000),
        Err(Ok(Error::StrategyNotFound))
    );
}

#[test]
fn test_best_strategy_no_strategies() {
    let (_env, _admin, client) = setup();
    assert_eq!(
        client.best_strategy(),
        Err(Ok(Error::NoOptimizableStrategy))
    );
}

#[cfg(test)]
mod tests {
    use crate::{YieldOptimizerVault, YieldOptimizerVaultClient};
    use soroban_sdk::{testutils::Address as _, token, Address, Env};

    #[test]
    fn test_vault_deposit_withdraw_harvest() {
        let env = Env::default();
        env.mock_all_signatures();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        // Setup mock underlying token contract
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        // Register vault contract
        let vault_id = env.register_contract(None, YieldOptimizerVault);
        let vault_client = YieldOptimizerVaultClient::new(&env, &vault_id);

        // Initialize vault with 5% performance fee (500 BPS)
        vault_client.initialize(&admin, &token_id, &500);

        // Mint initial tokens to user
        token_admin_client.mint(&user, &1_000);

        // 1. User deposits 1,000 tokens into vault
        let shares = vault_client.deposit(&user, &1_000);
        assert_eq!(shares, 1_000);
        assert_eq!(vault_client.balance_of_shares(&user), 1_000);
        assert_eq!(token_client.balance(&vault_id), 1_000);

        // 2. Simulate yield harvest (e.g. 200 tokens yield generated)
        token_admin_client.mint(&vault_id, &200);
        vault_client.harvest(&200);

        // Admin should receive 5% fee (10 tokens), leaving 1,190 in vault
        assert_eq!(token_client.balance(&admin), 10);
        assert_eq!(vault_client.total_assets(), 1_190);

        // 3. User withdraws all shares and receives principal + net yield
        let returned_assets = vault_client.withdraw(&user, &1_000);
        assert_eq!(returned_assets, 1_190);
        assert_eq!(token_client.balance(&user), 1_190);
        assert_eq!(vault_client.balance_of_shares(&user), 0);
    }
}
