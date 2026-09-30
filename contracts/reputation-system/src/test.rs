#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::types::{Error, MAX_SCORE, MIN_SCORE};
use crate::{ReputationSystemContract, ReputationSystemContractClient};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, ReputationSystemContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, ReputationSystemContract);
    let client = ReputationSystemContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, admin, client)
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_, admin, client) = setup();
    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_double_init_fails() {
    let (_, admin, client) = setup();
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Registration ──────────────────────────────────────────────────────────────

#[test]
fn test_register_ok() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);

    assert!(client.is_registered(&subject));
    assert_eq!(client.get_score(&subject), 0);
}

#[test]
fn test_register_duplicate_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let result = client.try_register(&subject);
    assert_eq!(result, Err(Ok(Error::AlreadyRegistered)));
}

// ── Score management ──────────────────────────────────────────────────────────

#[test]
fn test_award_increases_score() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let new_score = client.award(&subject, &100);
    assert_eq!(new_score, 100);
    assert_eq!(client.get_score(&subject), 100);
}

#[test]
fn test_slash_decreases_score() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    client.award(&subject, &500);
    let new_score = client.slash(&subject, &200);
    assert_eq!(new_score, 300);
}

#[test]
fn test_award_clamped_at_max() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    client.set_score(&subject, &(MAX_SCORE - 1));
    let new_score = client.award(&subject, &MAX_SCORE);
    assert_eq!(new_score, MAX_SCORE);
}

#[test]
fn test_slash_clamped_at_min() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let new_score = client.slash(&subject, &MAX_SCORE);
    assert_eq!(new_score, MIN_SCORE);
}

#[test]
fn test_award_zero_delta_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let result = client.try_award(&subject, &0i64);
    assert_eq!(result, Err(Ok(Error::ZeroDelta)));
}

#[test]
fn test_slash_zero_delta_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let result = client.try_slash(&subject, &0i64);
    assert_eq!(result, Err(Ok(Error::ZeroDelta)));
}

#[test]
fn test_award_delta_too_large_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let result = client.try_award(&subject, &(MAX_SCORE + 1));
    assert_eq!(result, Err(Ok(Error::DeltaTooLarge)));
}

#[test]
fn test_award_negative_delta_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let result = client.try_award(&subject, &(-1i64));
    assert_eq!(result, Err(Ok(Error::DeltaTooLarge)));
}

#[test]
fn test_set_score_exact_value() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let new_score = client.set_score(&subject, &12345);
    assert_eq!(new_score, 12345);
}

#[test]
fn test_set_score_clamped_above_max() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let new_score = client.set_score(&subject, &(MAX_SCORE + 9999));
    assert_eq!(new_score, MAX_SCORE);
}

#[test]
fn test_set_score_clamped_below_min() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let new_score = client.set_score(&subject, &(MIN_SCORE - 9999));
    assert_eq!(new_score, MIN_SCORE);
}

#[test]
fn test_award_on_unregistered_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    let result = client.try_award(&subject, &100i64);
    assert_eq!(result, Err(Ok(Error::SubjectNotFound)));
}

// ── Endorsements ──────────────────────────────────────────────────────────────

#[test]
fn test_endorse_increases_count_and_score() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);
    let endorser = Address::generate(&env);

    client.register(&subject);
    let score_before = client.get_score(&subject);
    client.endorse(&endorser, &subject);

    let record = client.get_record(&subject);
    assert_eq!(record.endorsements, 1);
    assert_eq!(client.get_score(&subject), score_before + 10);
}

#[test]
fn test_endorse_self_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    let result = client.try_endorse(&subject, &subject);
    assert_eq!(result, Err(Ok(Error::SelfEndorsement)));
}

#[test]
fn test_endorse_unregistered_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);
    let endorser = Address::generate(&env);

    let result = client.try_endorse(&endorser, &subject);
    assert_eq!(result, Err(Ok(Error::SubjectNotRegistered)));
}

#[test]
fn test_endorse_duplicate_fails() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);
    let endorser = Address::generate(&env);

    client.register(&subject);
    client.endorse(&endorser, &subject);

    let result = client.try_endorse(&endorser, &subject);
    assert_eq!(result, Err(Ok(Error::AlreadyEndorsed)));
}

#[test]
fn test_has_endorsed_flag() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);
    let endorser = Address::generate(&env);

    client.register(&subject);
    assert!(!client.has_endorsed(&endorser, &subject));

    client.endorse(&endorser, &subject);
    assert!(client.has_endorsed(&endorser, &subject));
}

// ── Admin transfer ────────────────────────────────────────────────────────────

#[test]
fn test_transfer_admin_ok() {
    let (env, _, client) = setup();
    let new_admin = Address::generate(&env);

    client.transfer_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

// ── Event counts ──────────────────────────────────────────────────────────────

#[test]
fn test_event_counters() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);

    client.register(&subject);
    client.award(&subject, &100);
    client.award(&subject, &50);
    client.slash(&subject, &25);

    let record = client.get_record(&subject);
    assert_eq!(record.positive_events, 2);
    assert_eq!(record.negative_events, 1);
}

// ── Full lifecycle ────────────────────────────────────────────────────────────

#[test]
fn test_full_lifecycle() {
    let (env, _, client) = setup();
    let subject = Address::generate(&env);
    let e1 = Address::generate(&env);
    let e2 = Address::generate(&env);

    // Register
    client.register(&subject);
    assert_eq!(client.get_score(&subject), 0);

    // Award
    client.award(&subject, &200);
    assert_eq!(client.get_score(&subject), 200);

    // Two endorsements
    client.endorse(&e1, &subject);
    client.endorse(&e2, &subject);
    assert_eq!(client.get_score(&subject), 220);

    // Slash
    client.slash(&subject, &50);
    assert_eq!(client.get_score(&subject), 170);

    // Override
    client.set_score(&subject, &999);
    assert_eq!(client.get_score(&subject), 999);

    let record = client.get_record(&subject);
    assert_eq!(record.endorsements, 2);
    assert_eq!(record.positive_events, 1);
    assert_eq!(record.negative_events, 1);
}
