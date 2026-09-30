// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    VaultCount,
    Paused,
    /// Total governance tokens in circulation across all vaults
    TotalFractions,
}

#[contracttype]
pub enum DataKey {
    /// Vault details by id
    Vault(u32),
    /// Fraction (ERC-20-style) balance per (vault_id, holder)
    FractionBalance(u32, Address),
    /// Allowance: (vault_id, owner, spender) → amount
    Allowance(u32, Address, Address),
    /// Active buyout bid for a vault
    BuyoutBid(u32),
}

/// Status of an NFT vault.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VaultStatus {
    /// NFT locked, fractions circulating normally.
    Active = 0,
    /// A buyout auction is in progress.
    BuyoutInProgress = 1,
    /// Buyout succeeded; NFT transferred to buyer.
    BoughtOut = 2,
    /// NFT redeemed by unanimous fractional owners.
    Redeemed = 3,
}

/// An NFT vault holding a locked NFT with fractional governance tokens.
#[contracttype]
#[derive(Clone, Debug)]
pub struct NftVault {
    pub id: u32,
    pub creator: Address,
    /// NFT collection contract address.
    pub nft_contract: Address,
    /// Token ID within the NFT collection.
    pub nft_token_id: u32,
    /// Human-readable name for the fractions (ERC-20 style).
    pub fraction_name: String,
    /// Total supply of fractions issued.
    pub total_fractions: i128,
    /// Reserve price below which buyouts cannot succeed (PRICE_PRECISION scaled).
    pub reserve_price: i128,
    pub status: VaultStatus,
    /// Timestamp vault was created.
    pub created_at: u64,
}

/// An active buyout bid/auction.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BuyoutBid {
    pub vault_id: u32,
    pub bidder: Address,
    /// Total bid amount (PRICE_PRECISION scaled).
    pub bid_amount: i128,
    /// Bid price per fraction (bid_amount / total_fractions).
    pub price_per_fraction: i128,
    /// Auction end timestamp.
    pub auction_end: u64,
    /// Whether the bid has been settled.
    pub settled: bool,
    /// Votes in favor of buyout (fraction count).
    pub votes_for: i128,
    /// Votes against buyout (fraction count).
    pub votes_against: i128,
}

/// Fraction holder's position in a vault.
#[contracttype]
#[derive(Clone, Debug)]
pub struct HolderPosition {
    pub vault_id: u32,
    pub holder: Address,
    pub fraction_balance: i128,
    /// Ownership percentage in basis points (balance * 10000 / total_fractions).
    pub ownership_bps: i128,
    /// Value of holdings at current reserve price.
    pub value_at_reserve: i128,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ZeroAmount = 4,
    Paused = 5,
    Overflow = 6,
    VaultNotFound = 7,
    VaultNotActive = 8,
    InsufficientBalance = 9,
    BuyoutBelowReserve = 10,
    BuyoutAuctionActive = 11,
    BuyoutAuctionNotActive = 12,
    BuyoutAuctionNotEnded = 13,
    BuyoutAlreadySettled = 14,
    InsufficientAllowance = 15,
    InvalidFractions = 16,
    InvalidReservePrice = 17,
}
