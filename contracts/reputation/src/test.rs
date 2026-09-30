use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String, Vec,
};

fn setup() -> (Env, ReputationContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(&env);
    let id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &id);
    client.initialize(&admin, &100, &1_000);
    (env, client, admin)
}

fn reporter(env: &Env, client: &ReputationContractClient) -> Address {
    let address = Address::generate(env);
    client.set_reporter(
        &address,
        &ReporterConfig {
            active: true,
            weight_bps: 5_000,
            max_points_per_event: 1_000,
            max_points_per_epoch: 2_000,
        },
    );
    address
}

fn subject(env: &Env, client: &ReputationContractClient) -> Address {
    let address = Address::generate(env);
    client.register(&address);
    address
}

fn event(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn initialization_and_registration_are_guarded() {
    let (env, client, admin) = setup();
    assert_eq!(
        client.try_initialize(&admin, &100, &1_000),
        Err(Ok(Error::AlreadyInitialized))
    );
    let who = subject(&env, &client);
    assert!(client.is_registered(&who));
    assert_eq!(client.try_register(&who), Err(Ok(Error::AlreadyRegistered)));
}

#[test]
fn activity_is_weighted_and_replay_protected() {
    let (env, client, _) = setup();
    let reporter = reporter(&env, &client);
    let who = subject(&env, &client);
    let id = event(&env, 1);
    assert_eq!(client.record_activity(&reporter, &who, &id, &200), 100);
    assert_eq!(
        client.try_record_activity(&reporter, &who, &id, &200),
        Err(Ok(Error::EventAlreadyProcessed))
    );
    assert_eq!(client.get_score(&who).activity_score, 100);
}

#[test]
fn negative_activity_never_underflows() {
    let (env, client, _) = setup();
    let reporter = reporter(&env, &client);
    let who = subject(&env, &client);
    assert_eq!(
        client.record_activity(&reporter, &who, &event(&env, 2), &-200),
        0
    );
}

#[test]
fn activity_decays_lazily_by_complete_epochs() {
    let (env, client, _) = setup();
    let reporter = reporter(&env, &client);
    let who = subject(&env, &client);
    client.record_activity(&reporter, &who, &event(&env, 3), &1_000);
    env.ledger().set_timestamp(1_200);
    assert_eq!(client.get_score(&who).activity_score, 405); // 500 * .9 * .9
}

#[test]
fn activity_has_per_epoch_rate_limit() {
    let (env, client, _) = setup();
    let reporter = reporter(&env, &client);
    let who = subject(&env, &client);
    client.record_activity(&reporter, &who, &event(&env, 4), &1_000);
    client.record_activity(&reporter, &who, &event(&env, 5), &1_000);
    assert_eq!(
        client.try_record_activity(&reporter, &who, &event(&env, 6), &1),
        Err(Ok(Error::RateLimitExceeded))
    );
}

#[test]
fn independent_credentials_raise_confidence() {
    let (env, client, _) = setup();
    let who = subject(&env, &client);
    for index in 0..3 {
        let issuer = Address::generate(&env);
        client.set_issuer(
            &issuer,
            &IssuerConfig {
                active: true,
                max_credential_weight: 1_000,
            },
        );
        client.issue_credential(&issuer, &who, &String::from_str(&env, "kyc"), &100, &2_000);
        let score = client.get_score(&who);
        assert_eq!(score.active_credentials, index + 1);
    }
    let score = client.get_score(&who);
    assert_eq!(score.credential_score, 300);
    assert_eq!(score.confidence_bps, 10_000);
    assert_eq!(score.final_score, 300);
}

#[test]
fn duplicate_revoked_and_expired_credentials_are_handled() {
    let (env, client, _) = setup();
    let who = subject(&env, &client);
    let issuer = Address::generate(&env);
    client.set_issuer(
        &issuer,
        &IssuerConfig {
            active: true,
            max_credential_weight: 500,
        },
    );
    let kind = String::from_str(&env, "personhood");
    client.issue_credential(&issuer, &who, &kind, &500, &1_100);
    assert_eq!(
        client.try_issue_credential(&issuer, &who, &kind, &500, &1_100),
        Err(Ok(Error::CredentialAlreadyActive))
    );
    client.revoke_credential(&issuer, &who);
    assert_eq!(client.get_score(&who).active_credentials, 0);
    client.issue_credential(&issuer, &who, &kind, &500, &1_100);
    env.ledger().set_timestamp(1_100);
    assert_eq!(client.get_score(&who).active_credentials, 0);
}

#[test]
fn untrusted_issuer_and_invalid_points_fail() {
    let (env, client, _) = setup();
    let who = subject(&env, &client);
    let issuer = Address::generate(&env);
    assert_eq!(
        client.try_issue_credential(&issuer, &who, &String::from_str(&env, "kyc"), &1, &2_000),
        Err(Ok(Error::IssuerNotFound))
    );
    let reporter = reporter(&env, &client);
    assert_eq!(
        client.try_record_activity(&reporter, &who, &event(&env, 8), &0),
        Err(Ok(Error::InvalidPoints))
    );
}

#[test]
fn pause_blocks_writes_but_allows_revocation_and_reads() {
    let (env, client, _) = setup();
    let who = subject(&env, &client);
    let issuer = Address::generate(&env);
    client.set_issuer(
        &issuer,
        &IssuerConfig {
            active: true,
            max_credential_weight: 100,
        },
    );
    client.issue_credential(&issuer, &who, &String::from_str(&env, "kyc"), &100, &2_000);
    client.set_paused(&true);
    assert_eq!(
        client.try_register(&Address::generate(&env)),
        Err(Ok(Error::Paused))
    );
    assert_eq!(client.get_score(&who).active_credentials, 1);
    client.revoke_credential(&issuer, &who);
    assert_eq!(client.get_score(&who).active_credentials, 0);
}

#[test]
fn batch_queries_are_bounded() {
    let (env, client, _) = setup();
    let who = subject(&env, &client);
    let mut one = Vec::new(&env);
    one.push_back(who);
    assert_eq!(client.get_scores(&one).len(), 1);
    let mut too_many = Vec::new(&env);
    for _ in 0..21 {
        too_many.push_back(Address::generate(&env));
    }
    assert_eq!(
        client.try_get_scores(&too_many),
        Err(Ok(Error::BatchLimitExceeded))
    );
}
