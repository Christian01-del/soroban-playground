// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Tokenized Real Estate (RWA)
//!
//! A Soroban smart contract providing:
//! - Property listing: admin tokenizes properties into fractional shares.
//! - Investment: **whitelisted** investors buy shares at a fixed price per share.
//! - Rental distribution: admin deposits rental income; investors claim pro-rata.
//! - Share transfers: investors can transfer shares to **whitelisted** recipients.
//! - KYC/AML compliance whitelist: admin approves or revokes investor addresses
//!   before any asset-transfer operation is permitted.
//!
//! ## Security invariants
//!
//! 1. `buy_shares` requires the buyer to have `KycStatus::Approved`.
//! 2. `transfer_shares` requires **both** sender and recipient to have
//!    `KycStatus::Approved`.
//! 3. Only the admin may approve or revoke KYC status.
//! 4. All admin functions verify the caller matches the stored admin address via
//!    `require_auth()` in addition to the address equality check.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_kyc_status, get_ownership, get_property, get_property_count, has_ownership,
    is_initialized, remove_ownership, set_admin, set_kyc_status, set_ownership, set_property,
    set_property_count,
};
use crate::types::{Error, KycStatus, Ownership, Property};

#[contract]
pub struct RealEstateContract;

#[contractimpl]
impl RealEstateContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_property_count(&env, 0);
        Ok(())
    }

    // ── KYC / AML whitelist management (admin only) ───────────────────────────

    /// Approve an investor address, granting them permission to buy and receive
    /// shares.  Must be called by the admin before any asset-transfer operation
    /// can succeed for the given address.
    pub fn approve_investor(env: Env, admin: Address, investor: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_kyc_status(&env, &investor, KycStatus::Approved);
        env.events()
            .publish((symbol_short!("kyc_ok"), investor.clone()), ());
        Ok(())
    }

    /// Revoke an investor address, blocking them from buying shares or
    /// receiving transfers going forward.  Existing share balances are
    /// preserved so the investor can still claim rental income; however they
    /// cannot acquire additional shares until re-approved.
    pub fn revoke_investor(env: Env, admin: Address, investor: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_kyc_status(&env, &investor, KycStatus::Revoked);
        env.events()
            .publish((symbol_short!("kyc_rev"), investor.clone()), ());
        Ok(())
    }

    /// Return the current `KycStatus` for an address.
    pub fn kyc_status(env: Env, investor: Address) -> KycStatus {
        get_kyc_status(&env, &investor)
    }

    // ── Property management (admin) ───────────────────────────────────────────

    /// List a new property for fractional investment. Returns the property ID.
    pub fn list_property(
        env: Env,
        admin: Address,
        name: String,
        total_shares: u64,
        price_per_share: i128,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if total_shares == 0 {
            return Err(Error::ZeroTotalShares);
        }
        if price_per_share <= 0 {
            return Err(Error::ZeroPrice);
        }

        let id = get_property_count(&env) + 1;
        let property = Property {
            name,
            total_shares,
            shares_sold: 0,
            price_per_share,
            pending_rental: 0,
            total_rental_deposited: 0,
            is_listed: true,
        };
        set_property(&env, id, &property);
        set_property_count(&env, id);

        env.events()
            .publish((symbol_short!("prop_add"), id), total_shares);

        Ok(id)
    }

    /// Delist a property (no new investments accepted).
    pub fn delist_property(env: Env, admin: Address, property_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut property = get_property(&env, property_id)?;
        property.is_listed = false;
        set_property(&env, property_id, &property);
        Ok(())
    }

    /// Deposit rental income for a property. Distributed pro-rata to shareholders.
    pub fn deposit_rental(
        env: Env,
        admin: Address,
        property_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::ZeroRental);
        }
        let mut property = get_property(&env, property_id)?;
        property.pending_rental += amount;
        property.total_rental_deposited += amount;
        set_property(&env, property_id, &property);

        env.events()
            .publish((symbol_short!("rental"), property_id), amount);

        Ok(())
    }

    // ── Investor actions ──────────────────────────────────────────────────────

    /// Buy `shares` in a listed property.
    ///
    /// # KYC/AML enforcement
    /// The caller (`investor`) **must** have `KycStatus::Approved`.  Any other
    /// status (Pending or Revoked) causes `Error::NotWhitelisted` or
    /// `Error::Blacklisted` respectively.
    ///
    /// Returns total cost in stroops.
    pub fn buy_shares(
        env: Env,
        investor: Address,
        property_id: u32,
        shares: u64,
    ) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        investor.require_auth();

        // ── KYC/AML gate ────────────────────────────────────────────────────
        Self::assert_whitelisted(&env, &investor)?;

        if shares == 0 {
            return Err(Error::ZeroShares);
        }

        let mut property = get_property(&env, property_id)?;
        if !property.is_listed {
            return Err(Error::NotForSale);
        }
        if property.shares_sold + shares > property.total_shares {
            return Err(Error::ExceedsTotalSupply);
        }

        let cost = (shares as i128).saturating_mul(property.price_per_share);

        // Update or create ownership record.
        // Snapshot rental_claimed at current total so new investor doesn't
        // retroactively claim rental deposited before their purchase.
        let mut ownership = if has_ownership(&env, property_id, &investor) {
            get_ownership(&env, property_id, &investor)?
        } else {
            Ownership {
                shares: 0,
                rental_claimed: property.total_rental_deposited,
            }
        };

        ownership.shares += shares;
        property.shares_sold += shares;

        set_ownership(&env, property_id, &investor, &ownership);
        set_property(&env, property_id, &property);

        env.events()
            .publish((symbol_short!("buy"), property_id), (investor, shares));

        Ok(cost)
    }

    /// Transfer `shares` from caller to `recipient`.
    ///
    /// # KYC/AML enforcement
    /// **Both** `from` and `to` must have `KycStatus::Approved`.  This prevents
    /// whitelisted investors from routing assets to non-compliant recipients.
    pub fn transfer_shares(
        env: Env,
        from: Address,
        to: Address,
        property_id: u32,
        shares: u64,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        from.require_auth();

        // ── KYC/AML gate – both sender and recipient ─────────────────────────
        Self::assert_whitelisted(&env, &from)?;
        Self::assert_whitelisted(&env, &to)?;

        if shares == 0 {
            return Err(Error::ZeroShares);
        }

        let property = get_property(&env, property_id)?;

        let mut from_ownership = get_ownership(&env, property_id, &from)?;
        if shares > from_ownership.shares {
            return Err(Error::InsufficientShares);
        }

        // Settle any unclaimed rental for sender before transfer
        let claimable = Self::compute_claimable(&from_ownership, &property);
        from_ownership.rental_claimed += claimable;
        from_ownership.shares -= shares;

        let mut to_ownership = if has_ownership(&env, property_id, &to) {
            get_ownership(&env, property_id, &to)?
        } else {
            Ownership {
                shares: 0,
                rental_claimed: property.total_rental_deposited,
            }
        };
        to_ownership.shares += shares;

        if from_ownership.shares == 0 {
            remove_ownership(&env, property_id, &from);
        } else {
            set_ownership(&env, property_id, &from, &from_ownership);
        }
        set_ownership(&env, property_id, &to, &to_ownership);

        env.events()
            .publish((symbol_short!("transfer"), property_id), (from, to, shares));

        Ok(())
    }

    /// Claim pro-rata rental income for an investor. Returns amount claimed.
    pub fn claim_rental(env: Env, investor: Address, property_id: u32) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        investor.require_auth();

        let property = get_property(&env, property_id)?;
        let mut ownership = get_ownership(&env, property_id, &investor)?;

        let claimable = Self::compute_claimable(&ownership, &property);
        if claimable == 0 {
            return Err(Error::NothingToClaim);
        }

        ownership.rental_claimed += claimable;
        set_ownership(&env, property_id, &investor, &ownership);

        env.events()
            .publish((symbol_short!("claim"), property_id), (investor, claimable));

        Ok(claimable)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_property(env: Env, property_id: u32) -> Result<Property, Error> {
        get_property(&env, property_id)
    }

    pub fn get_ownership(
        env: Env,
        investor: Address,
        property_id: u32,
    ) -> Result<Ownership, Error> {
        get_ownership(&env, property_id, &investor)
    }

    /// Return the claimable rental for an investor without mutating state.
    pub fn claimable_rental(env: Env, investor: Address, property_id: u32) -> Result<i128, Error> {
        let property = get_property(&env, property_id)?;
        let ownership = get_ownership(&env, property_id, &investor)?;
        Ok(Self::compute_claimable(&ownership, &property))
    }

    pub fn property_count(env: Env) -> u32 {
        get_property_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Pro-rata claimable = (shares / total_shares) * (total_deposited - rental_claimed_snapshot)
    fn compute_claimable(ownership: &Ownership, property: &Property) -> i128 {
        if property.shares_sold == 0 || ownership.shares == 0 {
            return 0;
        }
        let new_rental = property
            .total_rental_deposited
            .saturating_sub(ownership.rental_claimed);
        if new_rental <= 0 {
            return 0;
        }
        // claimable = new_rental * shares / total_shares
        new_rental.saturating_mul(ownership.shares as i128) / (property.total_shares as i128)
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    /// Enforce that an address has an `Approved` KYC status.
    ///
    /// - `KycStatus::Pending`  → `Error::NotWhitelisted`
    /// - `KycStatus::Revoked`  → `Error::Blacklisted`
    /// - `KycStatus::Approved` → passes
    fn assert_whitelisted(env: &Env, addr: &Address) -> Result<(), Error> {
        match get_kyc_status(env, addr) {
            KycStatus::Approved => Ok(()),
            KycStatus::Revoked => Err(Error::Blacklisted),
            KycStatus::Pending => Err(Error::NotWhitelisted),
        }
    }
}
