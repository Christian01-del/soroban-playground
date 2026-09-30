// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Env, String,
};

const STRIKE: i128 = 100_000_000;
const PREMIUM: i128 = 5_000_000;
const AMOUNT: i128 = 1_000_000_000;

fn setup() -> (
    Env,
    OptionsProtocolClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OptionsProtocol);
    let client = OptionsProtocolClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let writer = Address::generate(&env);
    let holder = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin, writer, holder)
}

fn future(env: &Env) -> u64 {
    env.ledger().timestamp() + 86_400
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, ..) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, ..) = setup();
    assert!(client.try_initialize(&admin).is_err());
}

#[test]
fn test_write_call_option() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    assert_eq!(id, 1);
    assert_eq!(client.option_count(), 1);
}

#[test]
fn test_write_put_option() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Put,
    );
    assert_eq!(client.get_option(&id).kind, OptionKind::Put);
}

#[test]
fn test_write_zero_strike_fails() {
    let (env, client, _admin, writer, holder) = setup();
    assert!(client
        .try_write_option(
            &writer,
            &holder,
            &String::from_str(&env, "XLM"),
            &0i128,
            &PREMIUM,
            &AMOUNT,
            &future(&env),
            &OptionKind::Call
        )
        .is_err());
}

#[test]
fn test_write_zero_amount_fails() {
    let (env, client, _admin, writer, holder) = setup();
    assert!(client
        .try_write_option(
            &writer,
            &holder,
            &String::from_str(&env, "XLM"),
            &STRIKE,
            &PREMIUM,
            &0i128,
            &future(&env),
            &OptionKind::Call
        )
        .is_err());
}

#[test]
fn test_write_past_expiry_fails() {
    let (env, client, _admin, writer, holder) = setup();
    assert!(client
        .try_write_option(
            &writer,
            &holder,
            &String::from_str(&env, "XLM"),
            &STRIKE,
            &PREMIUM,
            &AMOUNT,
            &0u64,
            &OptionKind::Call
        )
        .is_err());
}

#[test]
fn test_write_writer_equals_holder_fails() {
    let (env, client, _admin, writer, _holder) = setup();
    assert!(client
        .try_write_option(
            &writer,
            &writer,
            &String::from_str(&env, "XLM"),
            &STRIKE,
            &PREMIUM,
            &AMOUNT,
            &future(&env),
            &OptionKind::Call
        )
        .is_err());
}

#[test]
fn test_exercise_success() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    let settlement = client.exercise(&holder, &id);
    assert_eq!(settlement, STRIKE);
    assert_eq!(client.get_option(&id).status, OptionStatus::Exercised);
}

#[test]
fn test_exercise_by_non_holder_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    assert!(client.try_exercise(&writer, &id).is_err());
}

#[test]
fn test_exercise_twice_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    client.exercise(&holder, &id);
    assert!(client.try_exercise(&holder, &id).is_err());
}

#[test]
fn test_exercise_expired_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = env.ledger().timestamp() + 1;
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &expiry,
        &OptionKind::Call,
    );
    env.ledger().with_mut(|l| l.timestamp = expiry + 1);
    assert!(client.try_exercise(&holder, &id).is_err());
}

#[test]
fn test_cancel_by_writer() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    client.cancel_option(&writer, &id);
    assert_eq!(client.get_option(&id).status, OptionStatus::Cancelled);
}

#[test]
fn test_cancel_by_non_writer_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    assert!(client.try_cancel_option(&holder, &id).is_err());
}

#[test]
fn test_cancel_twice_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    client.cancel_option(&writer, &id);
    assert!(client.try_cancel_option(&writer, &id).is_err());
}

#[test]
fn test_expire_after_expiry() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = env.ledger().timestamp() + 1;
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &expiry,
        &OptionKind::Call,
    );
    env.ledger().with_mut(|l| l.timestamp = expiry + 1);
    client.expire_option(&id);
    assert_eq!(client.get_option(&id).status, OptionStatus::Expired);
}

#[test]
fn test_expire_before_expiry_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    assert!(client.try_expire_option(&id).is_err());
}

#[test]
fn test_pause_blocks_write() {
    let (env, client, admin, writer, holder) = setup();
    client.set_paused(&admin, &true);
    assert!(client
        .try_write_option(
            &writer,
            &holder,
            &String::from_str(&env, "XLM"),
            &STRIKE,
            &PREMIUM,
            &AMOUNT,
            &future(&env),
            &OptionKind::Call
        )
        .is_err());
}

#[test]
fn test_unpause_allows_write() {
    let (env, client, admin, writer, holder) = setup();
    client.set_paused(&admin, &true);
    client.set_paused(&admin, &false);
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    assert_eq!(id, 1);
}

#[test]
fn test_non_admin_cannot_pause() {
    let (_env, client, _admin, writer, _holder) = setup();
    assert!(client.try_set_paused(&writer, &true).is_err());
}

#[test]
fn test_get_option_not_found() {
    let (_env, client, ..) = setup();
    assert!(client.try_get_option(&999u32).is_err());
}

#[test]
fn test_option_fields_stored_correctly() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = future(&env);
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "USDC"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &expiry,
        &OptionKind::Put,
    );
    let opt = client.get_option(&id);
    assert_eq!(opt.writer, writer);
    assert_eq!(opt.holder, holder);
    assert_eq!(opt.strike_price, STRIKE);
    assert_eq!(opt.premium, PREMIUM);
    assert_eq!(opt.amount, AMOUNT);
    assert_eq!(opt.expiry, expiry);
    assert_eq!(opt.kind, OptionKind::Put);
    assert_eq!(opt.status, OptionStatus::Active);
}

#[test]
fn test_write_negative_premium_fails() {
    let (env, client, _admin, writer, holder) = setup();
    assert!(client
        .try_write_option(
            &writer,
            &holder,
            &String::from_str(&env, "XLM"),
            &STRIKE,
            &-1i128,
            &AMOUNT,
            &future(&env),
            &OptionKind::Call
        )
        .is_err());
}

#[test]
fn test_pause_blocks_exercise() {
    let (env, client, admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    client.set_paused(&admin, &true);
    assert!(client.try_exercise(&holder, &id).is_err());
}

#[test]
fn test_exercise_cancelled_option_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    client.cancel_option(&writer, &id);
    assert!(client.try_exercise(&holder, &id).is_err());
}

#[test]
fn test_expire_already_exercised_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = env.ledger().timestamp() + 1;
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &expiry,
        &OptionKind::Call,
    );
    client.exercise(&holder, &id);
    env.ledger().with_mut(|l| l.timestamp = expiry + 1);
    assert!(client.try_expire_option(&id).is_err());
}

#[test]
fn test_expire_already_cancelled_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = env.ledger().timestamp() + 1;
    let id = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &expiry,
        &OptionKind::Call,
    );
    client.cancel_option(&writer, &id);
    env.ledger().with_mut(|l| l.timestamp = expiry + 1);
    assert!(client.try_expire_option(&id).is_err());
}

#[test]
fn test_multiple_options_sequential_ids() {
    let (env, client, _admin, writer, holder) = setup();
    let id1 = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "XLM"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Call,
    );
    let id2 = client.write_option(
        &writer,
        &holder,
        &String::from_str(&env, "USDC"),
        &STRIKE,
        &PREMIUM,
        &AMOUNT,
        &future(&env),
        &OptionKind::Put,
    );
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.option_count(), 2);
}

#[test]
fn test_is_paused_getter() {
    let (_env, client, admin, ..) = setup();
    assert!(!client.is_paused());
    client.set_paused(&admin, &true);
    assert!(client.is_paused());
}

fn assert_approx(actual: i128, expected: i128, tolerance: i128) {
    let difference = if actual >= expected {
        actual - expected
    } else {
        expected - actual
    };
    assert!(
        difference <= tolerance,
        "actual {actual}, expected {expected}, tolerance {tolerance}"
    );
}

#[test]
fn test_black_scholes_call_reference_values() {
    let (_env, client, ..) = setup();
    let result = client.calculate_greeks(&GreeksInput {
        spot_price: 1_000_000_000,
        strike_price: 1_000_000_000,
        volatility: 2_000_000,
        risk_free_rate: 500_000,
        time_to_expiry: 31_557_600,
        kind: OptionKind::Call,
    });

    // Reference values: price 10.4506, delta .6368, gamma .01876,
    // vega 37.524, theta -6.414, rho 53.232 (annualized).
    assert_approx(result.price, 104_506_000, 100_000);
    assert_approx(result.delta, 6_368_000, 5_000);
    assert_approx(result.gamma, 187_600, 2_000);
    assert_approx(result.vega, 375_240_000, 300_000);
    assert_approx(result.theta, -64_140_000, 300_000);
    assert_approx(result.rho, 532_320_000, 500_000);
}

#[test]
fn test_black_scholes_put_call_parity_and_delta() {
    let (_env, client, ..) = setup();
    let call = client.calculate_greeks(&GreeksInput {
        spot_price: 1_000_000_000,
        strike_price: 1_000_000_000,
        volatility: 2_000_000,
        risk_free_rate: 500_000,
        time_to_expiry: 31_557_600,
        kind: OptionKind::Call,
    });
    let put = client.calculate_greeks(&GreeksInput {
        spot_price: 1_000_000_000,
        strike_price: 1_000_000_000,
        volatility: 2_000_000,
        risk_free_rate: 500_000,
        time_to_expiry: 31_557_600,
        kind: OptionKind::Put,
    });

    assert_approx(put.price, 55_735_000, 100_000);
    assert_eq!(call.delta - put.delta, 10_000_000);
    assert_eq!(call.gamma, put.gamma);
    assert_eq!(call.vega, put.vega);
    assert!(put.rho < 0);
}

#[test]
fn test_black_scholes_rejects_invalid_inputs() {
    let (_env, client, ..) = setup();
    let input = GreeksInput {
        spot_price: 1_000_000_000,
        strike_price: 1_000_000_000,
        volatility: 0,
        risk_free_rate: 500_000,
        time_to_expiry: 31_557_600,
        kind: OptionKind::Call,
    };
    assert_eq!(
        client.try_calculate_greeks(&input),
        Err(Ok(Error::InvalidVolatility))
    );
}

struct MarginSetup {
    env: Env,
    client: OptionsProtocolClient<'static>,
    admin: Address,
    oracle: Address,
    writer: Address,
    holder: Address,
    token_address: Address,
    token: TokenClient<'static>,
    token_admin: StellarAssetClient<'static>,
}

fn setup_margin() -> MarginSetup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let writer = Address::generate(&env);
    let holder = Address::generate(&env);
    let asset_admin = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(asset_admin);
    let token_address = asset.address();
    let token = TokenClient::new(&env, &token_address);
    let token_admin = StellarAssetClient::new(&env, &token_address);
    let contract_id = env.register_contract(None, OptionsProtocol);
    let client = OptionsProtocolClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.configure_margin_pool(&admin, &token_address, &oracle, &1_000, &600);
    token_admin.mint(&writer, &2_000_000_000);
    token_admin.mint(&holder, &1_000_000_000);
    client.update_price(&oracle, &String::from_str(&env, "XLM"), &1_000_000_000);
    MarginSetup {
        env,
        client,
        admin,
        oracle,
        writer,
        holder,
        token_address,
        token,
        token_admin,
    }
}

fn write_margin_call(setup: &MarginSetup, deposit: i128) -> u32 {
    setup.client.deposit_margin(&setup.writer, &deposit);
    setup.client.write_collateralized_option(
        &setup.writer,
        &setup.holder,
        &String::from_str(&setup.env, "XLM"),
        &1_000_000_000,
        &50_000_000,
        &10_000_000,
        &(setup.env.ledger().timestamp() + 3_600),
        &OptionKind::Call,
        &1_000_000_000,
    )
}

#[test]
fn test_margin_deposit_and_available_withdrawal() {
    let setup = setup_margin();
    setup.client.deposit_margin(&setup.writer, &500_000_000);
    assert_eq!(
        setup.client.get_margin_account(&setup.writer).balance,
        500_000_000
    );
    setup.client.withdraw_margin(&setup.writer, &200_000_000);
    assert_eq!(
        setup.client.get_margin_account(&setup.writer).balance,
        300_000_000
    );
    assert_eq!(setup.token.balance(&setup.writer), 1_700_000_000);
}

#[test]
fn test_collateralized_write_locks_margin_and_blocks_legacy_exercise() {
    let setup = setup_margin();
    let id = write_margin_call(&setup, 600_000_000);
    let account = setup.client.get_margin_account(&setup.writer);
    assert_eq!(account.balance, 600_000_000);
    assert_eq!(account.locked, 100_000_000);
    assert_eq!(
        setup.client.get_margin_position(&id).max_payout,
        1_000_000_000
    );
    assert_eq!(setup.token.balance(&setup.holder), 950_000_000);
    assert_eq!(setup.token.balance(&setup.writer), 1_450_000_000);
    assert_eq!(
        setup.client.try_exercise(&setup.holder, &id),
        Err(Ok(Error::EuropeanOnly))
    );
    assert_eq!(
        setup
            .client
            .try_withdraw_margin(&setup.writer, &550_000_000),
        Err(Ok(Error::InsufficientMargin))
    );
}

#[test]
fn test_margin_call_trigger_and_cure() {
    let setup = setup_margin();
    let id = write_margin_call(&setup, 600_000_000);
    setup.client.update_price(
        &setup.oracle,
        &String::from_str(&setup.env, "XLM"),
        &1_500_000_000,
    );
    assert!(!setup.client.check_margin(&id));
    assert_eq!(
        setup.client.get_option(&id).status,
        OptionStatus::MarginCalled
    );

    setup.token_admin.mint(&setup.writer, &100_000_000);
    setup.client.deposit_margin(&setup.writer, &100_000_000);
    setup.client.cure_margin_call(&setup.writer, &id);
    assert_eq!(setup.client.get_option(&id).status, OptionStatus::Active);
    assert_eq!(setup.client.get_margin_position(&id).locked, 650_000_000);
}

#[test]
fn test_cash_settlement_transfers_intrinsic_value_and_releases_margin() {
    let setup = setup_margin();
    let id = write_margin_call(&setup, 1_000_000_000);
    let expiry = setup.client.get_option(&id).expiry;
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = expiry);
    setup.client.update_price(
        &setup.oracle,
        &String::from_str(&setup.env, "XLM"),
        &1_500_000_000,
    );
    setup.client.check_margin(&id);

    let holder_balance = setup.token.balance(&setup.holder);
    let payout = setup.client.settle_option(&id);
    assert_eq!(payout, 500_000_000);
    assert_eq!(setup.token.balance(&setup.holder), holder_balance + payout);
    assert_eq!(setup.client.get_option(&id).status, OptionStatus::Exercised);
    let account = setup.client.get_margin_account(&setup.writer);
    assert_eq!(account.balance, 500_000_000);
    assert_eq!(account.locked, 0);
    assert_eq!(
        setup.client.try_get_margin_position(&id),
        Err(Ok(Error::PositionNotCollateralized))
    );
}

#[test]
fn test_out_of_money_settlement_and_cancel_release_all_margin() {
    let setup = setup_margin();
    let first = write_margin_call(&setup, 600_000_000);
    assert_eq!(
        setup.client.try_cancel_option(&setup.writer, &first),
        Err(Ok(Error::EuropeanOnly))
    );
    setup
        .client
        .cancel_collateralized_option(&setup.writer, &setup.holder, &first);
    assert_eq!(setup.client.get_margin_account(&setup.writer).locked, 0);

    let second = setup.client.write_collateralized_option(
        &setup.writer,
        &setup.holder,
        &String::from_str(&setup.env, "XLM"),
        &1_000_000_000,
        &50_000_000,
        &10_000_000,
        &(setup.env.ledger().timestamp() + 3_600),
        &OptionKind::Put,
        &1_000_000_000,
    );
    let expiry = setup.client.get_option(&second).expiry;
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = expiry);
    setup.client.update_price(
        &setup.oracle,
        &String::from_str(&setup.env, "XLM"),
        &1_100_000_000,
    );
    assert_eq!(setup.client.settle_option(&second), 0);
    assert_eq!(
        setup.client.get_option(&second).status,
        OptionStatus::Expired
    );
    assert_eq!(setup.client.get_margin_account(&setup.writer).locked, 0);
}

#[test]
fn test_stale_and_unauthorized_oracle_prices_are_rejected() {
    let setup = setup_margin();
    let impostor = Address::generate(&setup.env);
    assert_eq!(
        setup.client.try_update_price(
            &impostor,
            &String::from_str(&setup.env, "XLM"),
            &1_100_000_000,
        ),
        Err(Ok(Error::Unauthorized))
    );
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += 601);
    setup.client.deposit_margin(&setup.writer, &600_000_000);
    assert_eq!(
        setup.client.try_write_collateralized_option(
            &setup.writer,
            &setup.holder,
            &String::from_str(&setup.env, "XLM"),
            &1_000_000_000,
            &50_000_000,
            &10_000_000,
            &(setup.env.ledger().timestamp() + 3_600),
            &OptionKind::Call,
            &1_000_000_000,
        ),
        Err(Ok(Error::StalePrice))
    );
}

#[test]
fn test_margin_pool_can_only_be_configured_once() {
    let setup = setup_margin();
    assert_eq!(
        setup.client.try_configure_margin_pool(
            &setup.admin,
            &setup.token_address,
            &setup.oracle,
            &1_000,
            &600,
        ),
        Err(Ok(Error::PoolAlreadyConfigured))
    );
}
