#![no_std]

mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::types::{DataKey, Error, Identity, IdentityStatus, InstanceKey};

/// Identity Registry Contract
///
/// Allows users to register a self-sovereign identity, update their metadata,
/// and lets a designated admin verify or revoke identities.
///
/// Lifecycle:
///   1. Admin calls `initialize`
///   2. User calls `register` → identity stored with status `Pending`
///   3. Admin calls `verify` → status → `Verified`
///   4. Admin (or owner) calls `revoke` → status → `Revoked`
///   5. Owner can call `update_metadata` at any time while identity is active
#[contract]
pub struct IdentityRegistryContract;

#[contractimpl]
impl IdentityRegistryContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the registry with an admin address.
    /// Must be called exactly once before any other function.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&InstanceKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&InstanceKey::Initialized, &true);
        env.events()
            .publish((symbol_short!("init"),), admin.clone());
        Ok(())
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    /// Transfer admin rights to a new address (admin only).
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&InstanceKey::Admin, &new_admin);
        env.events().publish((symbol_short!("adm_tx"),), new_admin);
        Ok(())
    }

    // ── Identity management ───────────────────────────────────────────────────

    /// Register a new identity for `owner`.
    ///
    /// * `owner`       – address that controls this identity
    /// * `display_name`– human-readable name (must not be empty, max 64 chars)
    /// * `metadata_uri`– off-chain URI for full identity document (max 256 chars)
    pub fn register(
        env: Env,
        owner: Address,
        display_name: String,
        metadata_uri: String,
    ) -> Result<(), Error> {
        assert_initialized(&env)?;
        owner.require_auth();

        if display_name.len() == 0 {
            return Err(Error::EmptyDisplayName);
        }
        if display_name.len() > 64 {
            return Err(Error::DisplayNameTooLong);
        }
        if metadata_uri.len() == 0 {
            return Err(Error::EmptyMetadataUri);
        }
        if metadata_uri.len() > 256 {
            return Err(Error::MetadataUriTooLong);
        }
        if has_identity(&env, &owner) {
            return Err(Error::AlreadyRegistered);
        }

        let now = env.ledger().timestamp();
        let identity = Identity {
            owner: owner.clone(),
            display_name,
            metadata_uri,
            status: IdentityStatus::Pending,
            registered_at: now,
            updated_at: now,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Identity(owner.clone()), &identity);
        env.events().publish((symbol_short!("register"),), owner);
        Ok(())
    }

    /// Update the display name and/or metadata URI for an existing identity.
    /// Only the owner may call this. The identity must not be revoked.
    pub fn update_metadata(
        env: Env,
        owner: Address,
        display_name: String,
        metadata_uri: String,
    ) -> Result<(), Error> {
        assert_initialized(&env)?;
        owner.require_auth();

        if display_name.len() == 0 {
            return Err(Error::EmptyDisplayName);
        }
        if display_name.len() > 64 {
            return Err(Error::DisplayNameTooLong);
        }
        if metadata_uri.len() == 0 {
            return Err(Error::EmptyMetadataUri);
        }
        if metadata_uri.len() > 256 {
            return Err(Error::MetadataUriTooLong);
        }

        let mut identity = get_identity(&env, &owner)?;
        if identity.status == IdentityStatus::Revoked {
            return Err(Error::IdentityRevoked);
        }

        identity.display_name = display_name;
        identity.metadata_uri = metadata_uri;
        identity.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Identity(owner.clone()), &identity);
        env.events().publish((symbol_short!("updated"),), owner);
        Ok(())
    }

    /// Verify an identity (admin only).  Moves status from Pending → Verified.
    pub fn verify(env: Env, owner: Address) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut identity = get_identity(&env, &owner)?;
        if identity.status != IdentityStatus::Pending {
            return Err(Error::InvalidStatus);
        }

        identity.status = IdentityStatus::Verified;
        identity.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Identity(owner.clone()), &identity);
        env.events().publish((symbol_short!("verified"),), owner);
        Ok(())
    }

    /// Revoke an identity. Can be called by admin or the owner themselves.
    /// Once revoked the identity cannot transition to any other status.
    pub fn revoke(env: Env, caller: Address, owner: Address) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        caller.require_auth();

        if caller != admin && caller != owner {
            return Err(Error::Unauthorized);
        }

        let mut identity = get_identity(&env, &owner)?;
        if identity.status == IdentityStatus::Revoked {
            return Err(Error::AlreadyRevoked);
        }

        identity.status = IdentityStatus::Revoked;
        identity.updated_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Identity(owner.clone()), &identity);
        env.events().publish((symbol_short!("revoked"),), owner);
        Ok(())
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Fetch an identity record. Returns `IdentityNotFound` if not registered.
    pub fn get_identity(env: Env, owner: Address) -> Result<Identity, Error> {
        get_identity(&env, &owner)
    }

    /// Returns `true` if `owner` has a registered identity.
    pub fn has_identity(env: Env, owner: Address) -> bool {
        has_identity(&env, &owner)
    }

    /// Returns `true` if the identity is Verified.
    pub fn is_verified(env: Env, owner: Address) -> Result<bool, Error> {
        let identity = get_identity(&env, &owner)?;
        Ok(identity.status == IdentityStatus::Verified)
    }

    /// Returns `true` if the contract has been initialised.
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }
}

// ── Module-private helpers ────────────────────────────────────────────────────

fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&InstanceKey::Initialized)
        .unwrap_or(false)
}

fn assert_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        Err(Error::NotInitialized)
    } else {
        Ok(())
    }
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn has_identity(env: &Env, owner: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Identity(owner.clone()))
}

fn get_identity(env: &Env, owner: &Address) -> Result<Identity, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Identity(owner.clone()))
        .ok_or(Error::IdentityNotFound)
}
