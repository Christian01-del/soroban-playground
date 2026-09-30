use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

struct Fixture {
    env: Env,
    client: RoyaltyClient<'static>,
    token: Address,
    asset: StellarAssetClient<'static>,
    balances: TokenClient<'static>,
    root: Address,
    producer: Address,
    engineer: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token = token_contract.address();
    let asset = StellarAssetClient::new(&env, &token);
    let balances = TokenClient::new(&env, &token);
    let contract = env.register_contract(None, Royalty);
    let client = RoyaltyClient::new(&env, &contract);
    client.initialize(&admin);
    Fixture {
        root: Address::generate(&env),
        producer: Address::generate(&env),
        engineer: Address::generate(&env),
        env,
        client,
        token,
        asset,
        balances,
    }
}

fn tree(f: &Fixture) -> Vec<RoyaltyNode> {
    soroban_sdk::vec![
        &f.env,
        RoyaltyNode {
            account: f.root.clone(),
            parent: None,
            share_bps: 10_000,
        },
        RoyaltyNode {
            account: f.producer.clone(),
            parent: Some(0),
            share_bps: 6_000,
        },
        RoyaltyNode {
            account: f.engineer.clone(),
            parent: Some(1),
            share_bps: 2_500,
        },
    ]
}

fn agreement(f: &Fixture) -> u64 {
    f.client.create_agreement(
        &f.root,
        &f.token,
        &String::from_str(&f.env, "recording:catalog-42"),
        &tree(f),
    )
}

#[test]
fn recursive_preview_conserves_every_unit() {
    let f = setup();
    let id = agreement(&f);
    let shares = f.client.preview(&id, &10_000);

    assert_eq!(shares, soroban_sdk::vec![&f.env, 4_000, 4_500, 1_500]);
    assert_eq!(shares.iter().sum::<i128>(), 10_000);
}

#[test]
fn local_rounding_remainder_stays_with_parent() {
    let f = setup();
    let id = agreement(&f);
    let shares = f.client.preview(&id, &7);

    // root -> producer floor(7 * .6) = 4; producer -> engineer = 1.
    assert_eq!(shares, soroban_sdk::vec![&f.env, 3, 3, 1]);
    assert_eq!(shares.iter().sum::<i128>(), 7);
}

#[test]
fn deposit_is_escrowed_and_accumulates_pending_balances() {
    let f = setup();
    let id = agreement(&f);
    let payer = Address::generate(&f.env);
    f.asset.mint(&payer, &20_000);

    f.client.deposit(&payer, &id, &10_000);
    f.client.deposit(&payer, &id, &10_000);

    assert_eq!(f.balances.balance(&payer), 0);
    assert_eq!(f.client.pending_balance(&id, &f.root), 8_000);
    assert_eq!(f.client.pending_balance(&id, &f.producer), 9_000);
    assert_eq!(f.client.pending_balance(&id, &f.engineer), 3_000);
    assert_eq!(f.client.get_agreement(&id).total_received, 20_000);
}

#[test]
fn individual_claim_is_single_use() {
    let f = setup();
    let id = agreement(&f);
    let payer = Address::generate(&f.env);
    f.asset.mint(&payer, &10_000);
    f.client.deposit(&payer, &id, &10_000);

    assert_eq!(f.client.claim(&id, &f.engineer), 1_500);
    assert_eq!(f.balances.balance(&f.engineer), 1_500);
    assert_eq!(
        f.client.try_claim(&id, &f.engineer),
        Err(Ok(Error::NothingToClaim))
    );
    assert_eq!(f.client.get_agreement(&id).total_claimed, 1_500);
}

#[test]
fn batch_claim_pays_multiple_recipients() {
    let f = setup();
    let id = agreement(&f);
    let payer = Address::generate(&f.env);
    let operator = Address::generate(&f.env);
    f.asset.mint(&payer, &10_000);
    f.client.deposit(&payer, &id, &10_000);

    let recipients = soroban_sdk::vec![&f.env, f.root.clone(), f.producer.clone()];
    assert_eq!(f.client.claim_batch(&operator, &id, &recipients), 8_500);
    assert_eq!(f.balances.balance(&f.root), 4_000);
    assert_eq!(f.balances.balance(&f.producer), 4_500);
    assert_eq!(f.client.get_agreement(&id).total_claimed, 8_500);
}

#[test]
fn rejects_cycles_duplicates_and_overallocated_parent() {
    let f = setup();
    let bad_parent = soroban_sdk::vec![
        &f.env,
        RoyaltyNode {
            account: f.root.clone(),
            parent: None,
            share_bps: 10_000,
        },
        RoyaltyNode {
            account: f.producer.clone(),
            parent: Some(1),
            share_bps: 5_000,
        },
    ];
    assert_eq!(
        f.client.try_create_agreement(
            &f.root,
            &f.token,
            &String::from_str(&f.env, "cycle"),
            &bad_parent,
        ),
        Err(Ok(Error::InvalidTree))
    );

    let duplicate = soroban_sdk::vec![
        &f.env,
        RoyaltyNode {
            account: f.root.clone(),
            parent: None,
            share_bps: 10_000,
        },
        RoyaltyNode {
            account: f.root.clone(),
            parent: Some(0),
            share_bps: 5_000,
        },
    ];
    assert_eq!(
        f.client.try_create_agreement(
            &f.root,
            &f.token,
            &String::from_str(&f.env, "duplicate"),
            &duplicate,
        ),
        Err(Ok(Error::DuplicateAccount))
    );

    let overallocated = soroban_sdk::vec![
        &f.env,
        RoyaltyNode {
            account: f.root.clone(),
            parent: None,
            share_bps: 10_000,
        },
        RoyaltyNode {
            account: f.producer.clone(),
            parent: Some(0),
            share_bps: 6_000,
        },
        RoyaltyNode {
            account: f.engineer.clone(),
            parent: Some(0),
            share_bps: 5_000,
        },
    ];
    assert_eq!(
        f.client.try_create_agreement(
            &f.root,
            &f.token,
            &String::from_str(&f.env, "overallocated"),
            &overallocated,
        ),
        Err(Ok(Error::InvalidShare))
    );
}

#[test]
fn batch_validation_precedes_any_transfer() {
    let f = setup();
    let id = agreement(&f);
    let payer = Address::generate(&f.env);
    let operator = Address::generate(&f.env);
    f.asset.mint(&payer, &10_000);
    f.client.deposit(&payer, &id, &10_000);
    let duplicate = soroban_sdk::vec![&f.env, f.root.clone(), f.root.clone()];

    assert_eq!(
        f.client.try_claim_batch(&operator, &id, &duplicate),
        Err(Ok(Error::DuplicateAccount))
    );
    assert_eq!(f.balances.balance(&f.root), 0);
    assert_eq!(f.client.pending_balance(&id, &f.root), 4_000);
}

#[test]
fn pause_and_close_do_not_block_existing_claims() {
    let f = setup();
    let id = agreement(&f);
    let payer = Address::generate(&f.env);
    f.asset.mint(&payer, &20_000);
    f.client.deposit(&payer, &id, &10_000);
    f.client.close_agreement(&id);
    assert_eq!(
        f.client.try_deposit(&payer, &id, &10_000),
        Err(Ok(Error::AgreementInactive))
    );
    f.client.set_paused(&true);

    assert_eq!(f.client.claim(&id, &f.root), 4_000);
    assert_eq!(f.balances.balance(&f.root), 4_000);
}
