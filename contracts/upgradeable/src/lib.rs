// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Upgradeable Contract  (Issue #587)
//!
//! Enables admins to upgrade the WASM implementation of a contract while
//! preserving on-chain state and address.
//!
//! ## Lifecycle
//! 1. Admin calls `initialize` (once).
//! 2. Admin calls `propose_upgrade` with a new WASM hash; the hash is stored
//!    alongside the current ledger sequence.
//! 3. After `timelock_ledgers` ledgers have elapsed, admin calls
//!    `execute_upgrade` to apply the hash via `env.deployer().update_current_contract_wasm`.
//! 4. Alternatively, admin calls `upgrade_to`, an alias of `propose_upgrade`.
//! 5. Admin may `cancel_upgrade` to withdraw a pending proposal.
//! 6. Admin may `pause`/`unpause` for emergency halts.

#![no_std]

mod storage;
mod types;

// Gated so the test module is not compiled into the deployed WASM. It was
// declared unconditionally; only the `#![cfg(test)]` inside test.rs kept it
// from adding weight to release builds.
#[cfg(test)]
mod test;

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Address, BytesN, Env};

use crate::storage::{
    clear_pending_upgrade, get_admin, get_pending_upgrade, get_timelock, is_initialized, is_paused,
    set_admin, set_paused, set_pending_upgrade, set_timelock,
};

/// Errors returned by the upgradeable contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    TimelockNotElapsed = 4,
    NoPendingUpgrade = 5,
    ContractPaused = 6,
}

#[contract]
pub struct UpgradeableContract;

#[contractimpl]
impl UpgradeableContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract. Can only be called once.
    /// `timelock_ledgers`: minimum ledgers to wait before executing a proposed upgrade.
    pub fn initialize(
        env: Env,
        admin: Address,
        timelock_ledgers: Option<u32>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_timelock(&env, timelock_ledgers.unwrap_or(0));
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Pause / Unpause ───────────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), admin);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), admin);
        Ok(())
    }

    // ── Upgrade management ────────────────────────────────────────────────────

    /// Propose a WASM upgrade. Records the hash and current ledger.
    /// If `timelock_ledgers == 0`, the upgrade is applied immediately.
    pub fn propose_upgrade(env: Env, admin: Address, new_hash: BytesN<32>) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let timelock = get_timelock(&env);
        if timelock == 0 {
            env.deployer()
                .update_current_contract_wasm(new_hash.clone());
            env.events().publish((symbol_short!("upgraded"),), new_hash);
        } else {
            let current = env.ledger().sequence();
            set_pending_upgrade(&env, &new_hash, current);
            env.events()
                .publish((symbol_short!("proposed"),), (new_hash, current));
        }
        Ok(())
    }

    /// Execute a previously proposed upgrade after the timelock has elapsed.
    pub fn execute_upgrade(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let (hash, proposed_at) = get_pending_upgrade(&env).ok_or(Error::NoPendingUpgrade)?;
        let timelock = get_timelock(&env);
        let current = env.ledger().sequence();

        // saturating_add, not `+`: both operands are u32, and a large timelock
        // proposed at a high ledger sequence overflows. Release builds here set
        // overflow-checks = true, so that would panic — aborting the invocation
        // with no error code instead of reporting TimelockNotElapsed. Saturating
        // keeps the comparison correct, since an unreachable deadline should
        // simply never elapse.
        if current < proposed_at.saturating_add(timelock) {
            return Err(Error::TimelockNotElapsed);
        }

        clear_pending_upgrade(&env);
        env.deployer().update_current_contract_wasm(hash.clone());
        env.events().publish((symbol_short!("upgraded"),), hash);
        Ok(())
    }

    /// Alias for [`Self::propose_upgrade`].
    ///
    /// Applies `new_hash` immediately when the timelock is 0, and otherwise
    /// records it as pending — it does *not* bypass a configured timelock. The
    /// previous doc comment said "requires timelock == 0", which read as though
    /// the call would fail on a timelocked contract; it never did, it silently
    /// proposed instead. Behaviour is unchanged, the description now matches it.
    pub fn upgrade_to(env: Env, admin: Address, new_hash: BytesN<32>) -> Result<(), Error> {
        Self::propose_upgrade(env, admin, new_hash)
    }

    /// Withdraw a pending upgrade without executing it. Admin-only.
    ///
    /// Previously a proposal could only be replaced, never cancelled: once a
    /// hash was pending, the only way out was to propose a different one, and a
    /// contract could not be returned to a clean state. That matters when a
    /// proposal turns out to be wrong — leaving it pending means it stays
    /// executable the moment the timelock elapses.
    ///
    /// Permitted while paused: cancelling only removes a pending action, so
    /// blocking it during an emergency halt would be exactly backwards.
    pub fn cancel_upgrade(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let (hash, _) = get_pending_upgrade(&env).ok_or(Error::NoPendingUpgrade)?;
        clear_pending_upgrade(&env);
        env.events().publish((symbol_short!("cancelled"),), hash);
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_timelock(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_timelock(&env))
    }

    pub fn get_pending_upgrade(env: Env) -> Option<(BytesN<32>, u32)> {
        get_pending_upgrade(&env)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
