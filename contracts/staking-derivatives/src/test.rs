// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Env,
};

fn setup() -> (Env, Address, StakingDerivativesClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, StakingDerivatives);
    let client = StakingDerivativesClient::new(&env, &id);
    let admin = Address::generate(&env);
    // 5% APY, 7-day unbonding period
    client.initialize(&admin, &500, &604_800);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (_env, _admin, client) = setup();
    let rate = client.get_exchange_rate();
    assert_eq!(rate, 1_000_000); // RATE_PRECISION, 1:1 at genesis
}

#[test]
fn test_double_init_fails() {
    let (_env, admin, client) = setup();
    let result = client.try_initialize(&admin, &500, &604_800);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_stake_mints_lst() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    let lst = client.stake(&staker, &1_000_000);
    // At 1:1 rate, 1_000_000 underlying → 1_000_000 lstTokens
    assert_eq!(lst, 1_000_000);
    let info = client.get_user_info(&staker);
    assert_eq!(info.lst_balance, 1_000_000);
}

#[test]
fn test_exchange_rate_increases_over_time() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    client.stake(&staker, &1_000_000);

    let rate_before = client.get_exchange_rate();

    // Advance time by 1 year
    env.ledger().with_mut(|l| l.timestamp += 31_557_600);
    client.accrue();

    let rate_after = client.get_exchange_rate();
    assert!(
        rate_after > rate_before,
        "rate_after={rate_after} should be > rate_before={rate_before}"
    );
    // 5% APY: rate should be approximately 1_050_000 after 1 year
    assert!(rate_after >= 1_040_000 && rate_after <= 1_060_000);
}

#[test]
fn test_preview_stake_matches_stake() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    // Advance time a bit to get non-trivial rate
    env.ledger().with_mut(|l| l.timestamp += 10_000_000);
    client.accrue();
    let preview = client.preview_stake(&500_000);
    let actual = client.stake(&staker, &500_000);
    assert_eq!(preview, actual);
}

#[test]
fn test_unstake_creates_unbond_entry() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    let lst = client.stake(&staker, &1_000_000);
    let (underlying, release_ts) = client.unstake(&staker, &lst);
    assert_eq!(underlying, 1_000_000);
    assert!(release_ts > env.ledger().timestamp());

    let entry = client.get_unbond_entry(&staker, &0);
    assert_eq!(entry.amount, 1_000_000);
    assert!(!entry.claimed);
}

#[test]
fn test_claim_before_ready_fails() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    let lst = client.stake(&staker, &1_000_000);
    client.unstake(&staker, &lst);
    let result = client.try_claim_unbonded(&staker, &0);
    assert_eq!(result, Err(Ok(Error::UnbondNotReady)));
}

#[test]
fn test_claim_after_unbonding_period() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    let lst = client.stake(&staker, &1_000_000);
    let (underlying, _) = client.unstake(&staker, &lst);

    // Advance past unbonding period (7 days = 604800s)
    env.ledger().with_mut(|l| l.timestamp += 604_801);
    let claimed = client.claim_unbonded(&staker, &0);
    assert_eq!(claimed, underlying);

    // Can't claim twice
    let result = client.try_claim_unbonded(&staker, &0);
    assert_eq!(result, Err(Ok(Error::AlreadyClaimed)));
}

#[test]
fn test_unstake_insufficient_balance_fails() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    client.stake(&staker, &1_000_000);
    let result = client.try_unstake(&staker, &9_999_999);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_validator_reward_increases_rate() {
    let (env, admin, client) = setup();
    let staker = Address::generate(&env);
    client.stake(&staker, &1_000_000);
    let validator = Address::generate(&env);
    client.delegate_to_validator(&admin, &validator, &1_000_000);

    let rate_before = client.get_exchange_rate();
    // Inject 50_000 rewards (5% of 1M)
    client.report_validator_rewards(&admin, &validator, &50_000);
    let rate_after = client.get_exchange_rate();
    assert!(rate_after > rate_before);
}

#[test]
fn test_pause_blocks_stake() {
    let (env, admin, client) = setup();
    client.set_paused(&admin, &true);
    let staker = Address::generate(&env);
    let result = client.try_stake(&staker, &1_000_000);
    assert_eq!(result, Err(Ok(Error::Paused)));
}

#[test]
fn test_unpause_allows_stake() {
    let (env, admin, client) = setup();
    client.set_paused(&admin, &true);
    client.set_paused(&admin, &false);
    let staker = Address::generate(&env);
    let lst = client.stake(&staker, &1_000_000);
    assert!(lst > 0);
}

#[test]
fn test_multiple_unbond_entries() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    client.stake(&staker, &3_000_000);

    // Create multiple unbond entries
    client.unstake(&staker, &1_000_000);
    client.unstake(&staker, &500_000);

    let info = client.get_user_info(&staker);
    assert_eq!(info.pending_unbond_count, 2);

    let metrics = client.get_metrics();
    // Both entries should be tracked in total_unbonding
    assert!(metrics.total_unbonding > 0);
}

#[test]
fn test_protocol_metrics() {
    let (env, _admin, client) = setup();
    let staker = Address::generate(&env);
    client.stake(&staker, &2_000_000);

    let metrics = client.get_metrics();
    assert_eq!(metrics.total_staked, 2_000_000);
    assert_eq!(metrics.total_lst, 2_000_000);
    assert_eq!(metrics.exchange_rate, 1_000_000);
}
