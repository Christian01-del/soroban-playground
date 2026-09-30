#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use crate::types::{Error, IdentityStatus};
use crate::{IdentityRegistryContract, IdentityRegistryContractClient};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, IdentityRegistryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, IdentityRegistryContract);
    let client = IdentityRegistryContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, admin, client)
}

fn n(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, client) = setup();
    let _ = env;
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
    let owner = Address::generate(&env);

    client.register(
        &owner,
        &n(&env, "Alice"),
        &n(&env, "https://example.com/alice"),
    );

    assert!(client.has_identity(&owner));
    let identity = client.get_identity(&owner);
    assert_eq!(identity.status, IdentityStatus::Pending);
    assert_eq!(identity.owner, owner);
}

#[test]
fn test_register_empty_name_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    let result = client.try_register(&owner, &n(&env, ""), &n(&env, "https://example.com"));
    assert_eq!(result, Err(Ok(Error::EmptyDisplayName)));
}

#[test]
fn test_register_name_too_long_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);
    // 65 characters
    let long = n(
        &env,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );

    let result = client.try_register(&owner, &long, &n(&env, "https://example.com"));
    assert_eq!(result, Err(Ok(Error::DisplayNameTooLong)));
}

#[test]
fn test_register_empty_uri_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    let result = client.try_register(&owner, &n(&env, "Bob"), &n(&env, ""));
    assert_eq!(result, Err(Ok(Error::EmptyMetadataUri)));
}

#[test]
fn test_register_duplicate_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    client.register(
        &owner,
        &n(&env, "Alice"),
        &n(&env, "https://example.com/alice"),
    );

    let result = client.try_register(
        &owner,
        &n(&env, "Alice"),
        &n(&env, "https://example.com/alice"),
    );
    assert_eq!(result, Err(Ok(Error::AlreadyRegistered)));
}

#[test]
fn test_has_identity_false_for_unregistered() {
    let (env, _, client) = setup();
    let stranger = Address::generate(&env);
    assert!(!client.has_identity(&stranger));
}

// ── Verification ──────────────────────────────────────────────────────────────

#[test]
fn test_verify_ok() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Carol"), &n(&env, "https://carol.io"));
    client.verify(&owner);

    let identity = client.get_identity(&owner);
    assert_eq!(identity.status, IdentityStatus::Verified);
    assert!(client.is_verified(&owner));
}

#[test]
fn test_verify_nonexistent_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    let result = client.try_verify(&owner);
    assert_eq!(result, Err(Ok(Error::IdentityNotFound)));
}

#[test]
fn test_verify_already_verified_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Dave"), &n(&env, "https://dave.io"));
    client.verify(&owner);

    let result = client.try_verify(&owner);
    assert_eq!(result, Err(Ok(Error::InvalidStatus)));
}

#[test]
fn test_is_verified_returns_false_for_pending() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Eve"), &n(&env, "https://eve.io"));
    assert!(!client.is_verified(&owner));
}

// ── Revocation ────────────────────────────────────────────────────────────────

#[test]
fn test_revoke_by_admin_ok() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Frank"), &n(&env, "https://frank.io"));
    client.revoke(&admin, &owner);

    let identity = client.get_identity(&owner);
    assert_eq!(identity.status, IdentityStatus::Revoked);
}

#[test]
fn test_revoke_by_owner_ok() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Grace"), &n(&env, "https://grace.io"));
    client.revoke(&owner, &owner);

    assert_eq!(client.get_identity(&owner).status, IdentityStatus::Revoked);
}

#[test]
fn test_revoke_by_stranger_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);

    client.register(&owner, &n(&env, "Henry"), &n(&env, "https://henry.io"));

    let result = client.try_revoke(&stranger, &owner);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_revoke_twice_fails() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Ivy"), &n(&env, "https://ivy.io"));
    client.revoke(&admin, &owner);

    let result = client.try_revoke(&admin, &owner);
    assert_eq!(result, Err(Ok(Error::AlreadyRevoked)));
}

#[test]
fn test_revoke_nonexistent_fails() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);

    let result = client.try_revoke(&admin, &owner);
    assert_eq!(result, Err(Ok(Error::IdentityNotFound)));
}

// ── Metadata update ───────────────────────────────────────────────────────────

#[test]
fn test_update_metadata_ok() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Jack"), &n(&env, "https://jack.io/v1"));

    env.ledger().with_mut(|info| {
        info.timestamp += 100;
    });

    client.update_metadata(
        &owner,
        &n(&env, "Jack Updated"),
        &n(&env, "https://jack.io/v2"),
    );

    let identity = client.get_identity(&owner);
    assert_eq!(identity.display_name, n(&env, "Jack Updated"));
    assert_eq!(identity.metadata_uri, n(&env, "https://jack.io/v2"));
    assert!(identity.updated_at > identity.registered_at);
}

#[test]
fn test_update_metadata_empty_name_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Karl"), &n(&env, "https://karl.io"));

    let result = client.try_update_metadata(&owner, &n(&env, ""), &n(&env, "https://karl.io"));
    assert_eq!(result, Err(Ok(Error::EmptyDisplayName)));
}

#[test]
fn test_update_metadata_on_revoked_fails() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);

    client.register(&owner, &n(&env, "Lisa"), &n(&env, "https://lisa.io"));
    client.revoke(&admin, &owner);

    let result =
        client.try_update_metadata(&owner, &n(&env, "Lisa New"), &n(&env, "https://lisa.io"));
    assert_eq!(result, Err(Ok(Error::IdentityRevoked)));
}

#[test]
fn test_update_metadata_nonexistent_fails() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    let result =
        client.try_update_metadata(&owner, &n(&env, "Nobody"), &n(&env, "https://nobody.io"));
    assert_eq!(result, Err(Ok(Error::IdentityNotFound)));
}

// ── Admin transfer ────────────────────────────────────────────────────────────

#[test]
fn test_transfer_admin_ok() {
    let (env, _admin, client) = setup();
    let new_admin = Address::generate(&env);

    client.transfer_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

// ── Full lifecycle ────────────────────────────────────────────────────────────

#[test]
fn test_full_lifecycle() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);

    // 1. Register
    client.register(
        &owner,
        &n(&env, "Mallory"),
        &n(&env, "https://mallory.io/id"),
    );
    assert_eq!(client.get_identity(&owner).status, IdentityStatus::Pending);

    // 2. Verify
    client.verify(&owner);
    assert!(client.is_verified(&owner));

    // 3. Update metadata while verified
    env.ledger().with_mut(|info| {
        info.timestamp += 500;
    });
    client.update_metadata(
        &owner,
        &n(&env, "Mallory V2"),
        &n(&env, "https://mallory.io/id/v2"),
    );

    // 4. Revoke by owner
    client.revoke(&owner, &owner);
    assert_eq!(client.get_identity(&owner).status, IdentityStatus::Revoked);
    assert!(!client.is_verified(&owner));
}

#[test]
fn test_get_identity_not_found() {
    let (env, _, client) = setup();
    let owner = Address::generate(&env);

    let result = client.try_get_identity(&owner);
    assert!(result.is_err());
}
