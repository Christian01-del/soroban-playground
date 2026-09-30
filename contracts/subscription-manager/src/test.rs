#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

use crate::types::{Error, SubStatus};
use crate::{SubscriptionManagerContract, SubscriptionManagerContractClient};

// ── Helpers ──────────────────────────────────────────────────────────────────

const INTERVAL: u64 = 2_592_000; // 30 days in seconds
const PRICE: i128 = 1_000_000_000; // 1 000 XLM in stroops

fn setup() -> (
    Env,
    Address,
    Address,
    SubscriptionManagerContractClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, SubscriptionManagerContract);
    let client = SubscriptionManagerContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, admin, contract_id, client)
}

fn create_token(
    env: &Env,
    admin: &Address,
) -> (Address, TokenClient<'static>, StellarAssetClient<'static>) {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let token_address = token_id.address();
    let token_client = TokenClient::new(env, &token_address);
    let asset_client = StellarAssetClient::new(env, &token_address);
    (token_address, token_client, asset_client)
}

// ── Initialisation tests ──────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, _, client) = setup();
    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_double_init_fails() {
    let (env, admin, _, client) = setup();
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Plan tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_create_plan() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Pro Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let plan = client.get_plan(&plan_id);
    assert_eq!(plan.price, PRICE);
    assert_eq!(plan.interval, INTERVAL);
    assert!(plan.active);
}

#[test]
fn test_create_plan_zero_price_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let result = client.try_create_plan(&String::from_str(&env, "Bad"), &0, &INTERVAL, &token);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_create_plan_zero_interval_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let result = client.try_create_plan(&String::from_str(&env, "Bad"), &PRICE, &0, &token);
    assert_eq!(result, Err(Ok(Error::InvalidInterval)));
}

#[test]
fn test_deactivate_and_reactivate_plan() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let plan_id = client.create_plan(&String::from_str(&env, "Basic"), &PRICE, &INTERVAL, &token);

    client.deactivate_plan(&plan_id);
    assert!(!client.get_plan(&plan_id).active);

    client.activate_plan(&plan_id);
    assert!(client.get_plan(&plan_id).active);
}

// ── Subscription tests ────────────────────────────────────────────────────────

#[test]
fn test_subscribe_charges_first_cycle() {
    let (env, admin, contract_id, client) = setup();
    let (token, token_client, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);

    // First payment deducted
    assert_eq!(token_client.balance(&subscriber), PRICE * 9);
    // Contract holds the payment
    assert_eq!(token_client.balance(&contract_id), PRICE);

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.cycles_paid, 1);
    assert_eq!(sub.status, SubStatus::Active);
}

#[test]
fn test_subscribe_inactive_plan_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Inactive"),
        &PRICE,
        &INTERVAL,
        &token,
    );
    client.deactivate_plan(&plan_id);

    let subscriber = Address::generate(&env);
    let result = client.try_subscribe(&subscriber, &plan_id);
    assert_eq!(result, Err(Ok(Error::PlanInactive)));
}

#[test]
fn test_duplicate_subscribe_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    client.subscribe(&subscriber, &plan_id);
    let result = client.try_subscribe(&subscriber, &plan_id);
    assert_eq!(result, Err(Ok(Error::AlreadySubscribed)));
}

// ── Cancel tests ─────────────────────────────────────────────────────────────

#[test]
fn test_cancel_by_subscriber() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);
    client.cancel(&subscriber, &sub_id);

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.status, SubStatus::Cancelled);
}

#[test]
fn test_cancel_by_admin() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);
    client.cancel(&admin, &sub_id);

    assert_eq!(
        client.get_subscription(&sub_id).status,
        SubStatus::Cancelled
    );
}

#[test]
fn test_cancel_twice_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);
    client.cancel(&subscriber, &sub_id);
    let result = client.try_cancel(&subscriber, &sub_id);
    assert_eq!(result, Err(Ok(Error::SubscriptionCancelled)));
}

#[test]
fn test_cancel_by_stranger_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);

    let stranger = Address::generate(&env);
    let result = client.try_cancel(&stranger, &sub_id);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Charge tests ──────────────────────────────────────────────────────────────

#[test]
fn test_charge_not_due_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);

    // Charge immediately without advancing time → should fail
    let result = client.try_charge(&sub_id);
    assert_eq!(result, Err(Ok(Error::SubscriptionNotDue)));
}

#[test]
fn test_charge_after_interval() {
    let (env, admin, contract_id, client) = setup();
    let (token, token_client, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);

    // Advance ledger time past the interval
    env.ledger().with_mut(|info| {
        info.timestamp += INTERVAL + 1;
    });

    assert!(client.is_charge_due(&sub_id));

    client.charge(&sub_id);

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.cycles_paid, 2);
    // Subscriber paid 2 cycles
    assert_eq!(token_client.balance(&subscriber), PRICE * 8);
    assert_eq!(token_client.balance(&contract_id), PRICE * 2);
}

#[test]
fn test_charge_cancelled_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);
    client.cancel(&subscriber, &sub_id);

    env.ledger().with_mut(|info| {
        info.timestamp += INTERVAL + 1;
    });

    let result = client.try_charge(&sub_id);
    assert_eq!(result, Err(Ok(Error::SubscriptionCancelled)));
}

// ── Withdraw tests ────────────────────────────────────────────────────────────

#[test]
fn test_withdraw_ok() {
    let (env, admin, contract_id, client) = setup();
    let (token, token_client, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));
    client.subscribe(&subscriber, &plan_id);

    let admin_balance_before = token_client.balance(&admin);
    client.withdraw(&token, &PRICE);

    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(token_client.balance(&admin), admin_balance_before + PRICE);
}

#[test]
fn test_resubscribe_after_cancel() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);
    client.cancel(&subscriber, &sub_id);

    // Should be able to subscribe again after cancellation
    let new_sub_id = client.subscribe(&subscriber, &plan_id);
    assert_ne!(sub_id, new_sub_id);
    assert_eq!(
        client.get_subscription(&new_sub_id).status,
        SubStatus::Active
    );
}

#[test]
fn test_transfer_admin() {
    let (env, admin, _, client) = setup();
    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

// ── Enhanced error handling tests ─────────────────────────────────────────────

#[test]
fn test_create_plan_empty_name_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let result = client.try_create_plan(&String::from_str(&env, ""), &PRICE, &INTERVAL, &token);
    assert_eq!(result, Err(Ok(Error::EmptyPlanName)));
}

#[test]
fn test_create_plan_negative_price_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let result =
        client.try_create_plan(&String::from_str(&env, "Bad"), &(-1i128), &INTERVAL, &token);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_create_plan_price_too_large_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let result = client.try_create_plan(
        &String::from_str(&env, "Huge"),
        &(i128::MAX / 2 + 1),
        &INTERVAL,
        &token,
    );
    assert_eq!(result, Err(Ok(Error::PriceTooLarge)));
}

#[test]
fn test_create_plan_interval_too_large_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    // 315_360_001 seconds > 10 years
    let result = client.try_create_plan(
        &String::from_str(&env, "Eternity"),
        &PRICE,
        &315_360_001u64,
        &token,
    );
    assert_eq!(result, Err(Ok(Error::IntervalTooLarge)));
}

#[test]
fn test_withdraw_exceeds_balance_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));
    client.subscribe(&subscriber, &plan_id);

    // Try to withdraw more than PRICE (the only cycle collected)
    let result = client.try_withdraw(&token, &(PRICE * 2));
    assert_eq!(result, Err(Ok(Error::InsufficientContractBalance)));
}

#[test]
fn test_withdraw_zero_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, _) = create_token(&env, &admin);

    let result = client.try_withdraw(&token, &0i128);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_get_plan_not_found() {
    let (_, _, _, client) = setup();
    let result = client.try_get_plan(&999u64);
    assert!(result.is_err());
}

#[test]
fn test_get_subscription_not_found() {
    let (_, _, _, client) = setup();
    let result = client.try_get_subscription(&999u64);
    assert!(result.is_err());
}

#[test]
fn test_charge_cancelled_subscription_fails() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Monthly"),
        &PRICE,
        &INTERVAL,
        &token,
    );

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 10));

    let sub_id = client.subscribe(&subscriber, &plan_id);
    client.cancel(&subscriber, &sub_id);

    let result = client.try_charge(&sub_id);
    assert_eq!(result, Err(Ok(Error::SubscriptionCancelled)));
}

#[test]
fn test_subscribe_to_nonexistent_plan_fails() {
    let (env, _, _, client) = setup();

    let subscriber = Address::generate(&env);
    let result = client.try_subscribe(&subscriber, &999u64);
    assert_eq!(result, Err(Ok(Error::PlanNotFound)));
}

#[test]
fn test_deactivate_plan_blocks_new_subscriptions() {
    let (env, admin, _, client) = setup();
    let (token, _, asset_client) = create_token(&env, &admin);

    let plan_id = client.create_plan(
        &String::from_str(&env, "Premium"),
        &PRICE,
        &INTERVAL,
        &token,
    );
    client.deactivate_plan(&plan_id);

    let subscriber = Address::generate(&env);
    asset_client.mint(&subscriber, &(PRICE * 5));

    let result = client.try_subscribe(&subscriber, &plan_id);
    assert_eq!(result, Err(Ok(Error::PlanInactive)));
}
