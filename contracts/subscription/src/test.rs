#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
};

const PRICE: i128 = 1_000;
const INTERVAL: u64 = 60;

struct Fixture {
    env: Env,
    contract_id: Address,
    client: SubscriptionBillingClient<'static>,
    merchant: Address,
    subscriber: Address,
    token: TokenClient<'static>,
    plan_id: u64,
}

impl Fixture {
    fn approve(&self, amount: i128) {
        self.token
            .approve(&self.subscriber, &self.contract_id, &amount, &10_000);
    }

    fn authorization(&self, max_cycles: u32) -> Authorization {
        Authorization {
            starts_at: self.env.ledger().timestamp(),
            ends_at: self.env.ledger().timestamp() + 1_000,
            max_cycles,
        }
    }

    fn subscribe(&self, max_cycles: u32) -> u64 {
        self.client
            .subscribe(
                &self.subscriber,
                &self.plan_id,
                &self.authorization(max_cycles),
            )
            .unwrap()
    }
}

fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
        ledger.sequence_number = 100;
    });
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(issuer).address();
    let token = TokenClient::new(&env, &token_id);
    let token_admin = StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&subscriber, &20_000);

    let contract_id = env.register_contract(None, SubscriptionBilling);
    let client = SubscriptionBillingClient::new(&env, &contract_id);
    client.initialize(&admin).unwrap();
    let plan_id = client
        .create_plan(
            &merchant,
            &String::from_str(&env, "Pro"),
            &token_id,
            &PRICE,
            &INTERVAL,
        )
        .unwrap();

    Fixture {
        env,
        contract_id,
        client,
        merchant,
        subscriber,
        token,
        plan_id,
    }
}

#[test]
fn subscription_requires_preapproved_allowance() {
    let f = fixture();
    assert!(matches!(
        f.client
            .try_subscribe(&f.subscriber, &f.plan_id, &f.authorization(2)),
        Err(Ok(Error::InsufficientAllowance))
    ));
    f.approve(PRICE * 2);
    let id = f.subscribe(2);
    let subscription = f.client.get_subscription(&id).unwrap();
    assert_eq!(subscription.max_cycles, 2);
    assert_eq!(subscription.cycles_charged, 0);
    assert_eq!(f.token.balance(&f.merchant), 0);
}

#[test]
fn keeper_charge_uses_transfer_from_and_pays_merchant_directly() {
    let f = fixture();
    f.approve(PRICE * 3);
    let id = f.subscribe(3);
    assert_eq!(f.client.charge(&id).unwrap(), PRICE);
    assert_eq!(f.token.balance(&f.merchant), PRICE);
    assert_eq!(f.token.balance(&f.contract_id), 0);
    assert_eq!(f.token.allowance(&f.subscriber, &f.contract_id), PRICE * 2);
    let subscription = f.client.get_subscription(&id).unwrap();
    assert_eq!(subscription.cycles_charged, 1);
    assert_eq!(subscription.total_charged, PRICE);
    assert_eq!(subscription.next_charge_at, 1_060);
}

#[test]
fn charges_are_time_spaced_and_cycle_bounded() {
    let f = fixture();
    f.approve(PRICE * 5);
    let id = f.subscribe(2);
    f.client.charge(&id).unwrap();
    assert!(matches!(f.client.try_charge(&id), Err(Ok(Error::NotDue))));

    // A long keeper outage still permits only one charge at this timestamp.
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 1_500);
    f.client.charge(&id).unwrap();
    assert!(matches!(f.client.try_charge(&id), Err(Ok(Error::NotDue))));
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 1_560);
    assert!(matches!(
        f.client.try_charge(&id),
        Err(Ok(Error::CycleLimitReached))
    ));
    assert_eq!(f.token.balance(&f.merchant), PRICE * 2);
}

#[test]
fn subscriber_cancel_is_final_and_blocks_future_pulls() {
    let f = fixture();
    f.approve(PRICE * 5);
    let id = f.subscribe(5);
    f.client.cancel(&f.subscriber, &id).unwrap();
    f.env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += INTERVAL);
    assert!(matches!(
        f.client.try_charge(&id),
        Err(Ok(Error::SubscriptionCancelled))
    ));
    assert!(matches!(
        f.client.try_update_authorization(&id, &2_000, &10),
        Err(Ok(Error::SubscriptionCancelled))
    ));
    assert_eq!(f.token.balance(&f.merchant), 0);
}

#[test]
fn authorization_expiry_blocks_pull_even_with_token_allowance() {
    let f = fixture();
    f.approve(PRICE * 10);
    let authorization = Authorization {
        starts_at: 1_000,
        ends_at: 1_010,
        max_cycles: 10,
    };
    let id = f
        .client
        .subscribe(&f.subscriber, &f.plan_id, &authorization)
        .unwrap();
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 1_011);
    assert!(matches!(
        f.client.try_charge(&id),
        Err(Ok(Error::AuthorizationExpired))
    ));
    assert_eq!(f.token.allowance(&f.subscriber, &f.contract_id), PRICE * 10);
}

#[test]
fn emergency_pause_blocks_charges_but_never_blocks_cancellation() {
    let f = fixture();
    f.approve(PRICE * 3);
    let id = f.subscribe(3);
    f.client.set_paused(&true).unwrap();
    assert!(f.client.is_paused());
    assert!(matches!(f.client.try_charge(&id), Err(Ok(Error::Paused))));
    f.client.cancel(&f.subscriber, &id).unwrap();
    assert_eq!(
        f.client.get_subscription(&id).unwrap().status,
        SubscriptionStatus::Cancelled
    );
}

#[test]
fn merchant_can_deactivate_plan_and_cancel_but_stranger_cannot() {
    let f = fixture();
    f.approve(PRICE * 3);
    let id = f.subscribe(3);
    let stranger = Address::generate(&f.env);
    assert!(matches!(
        f.client.try_cancel(&stranger, &id),
        Err(Ok(Error::Unauthorized))
    ));
    f.client.cancel(&f.merchant, &id).unwrap();
    f.client.set_plan_active(&f.plan_id, &false).unwrap();
    assert!(!f.client.get_plan(&f.plan_id).unwrap().active);
}

#[test]
fn superseded_subscription_cannot_charge_or_remove_current_index() {
    let f = fixture();
    f.approve(PRICE * 4);
    let old_id = f.subscribe(1);
    f.client.charge(&old_id).unwrap();
    let new_id = f.subscribe(2);

    assert!(matches!(
        f.client.try_charge(&old_id),
        Err(Ok(Error::AlreadySubscribed))
    ));
    f.client.cancel(&f.subscriber, &old_id).unwrap();
    assert_eq!(
        f.client.get_subscription_id(&f.subscriber, &f.plan_id),
        Some(new_id)
    );
    f.client.charge(&new_id).unwrap();
    assert_eq!(f.token.balance(&f.merchant), PRICE * 2);
}

#[test]
fn future_authorization_cannot_be_charged_early() {
    let f = fixture();
    f.approve(PRICE);
    let authorization = Authorization {
        starts_at: 1_100,
        ends_at: 1_200,
        max_cycles: 1,
    };
    let id = f
        .client
        .subscribe(&f.subscriber, &f.plan_id, &authorization)
        .unwrap();
    assert!(matches!(
        f.client.try_charge(&id),
        Err(Ok(Error::AuthorizationNotStarted))
    ));
}

#[test]
fn invalid_plan_and_authorization_bounds_are_rejected() {
    let f = fixture();
    let token_address = f.client.get_plan(&f.plan_id).unwrap().token;
    let result = f.client.try_create_plan(
        &f.merchant,
        &String::from_str(&f.env, "Bad"),
        &token_address,
        &0,
        &INTERVAL,
    );
    assert!(matches!(result, Err(Ok(Error::InvalidConfig))));
    f.approve(PRICE);
    let invalid = Authorization {
        starts_at: 1_100,
        ends_at: 1_099,
        max_cycles: 1,
    };
    assert!(matches!(
        f.client.try_subscribe(&f.subscriber, &f.plan_id, &invalid),
        Err(Ok(Error::InvalidConfig))
    ));
}
