// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AlreadyInState = 4,
    ContractPaused = 5,
    InsufficientSignatures = 6,
    ProposalNotFound = 7,
    ProposalAlreadyExecuted = 8,
    ProposalExpired = 9,
    GuardianAlreadyAdded = 10,
    GuardianNotFound = 11,
    TimeLockNotExpired = 12,
    InvalidThreshold = 13,
    AlreadyExists = 14,
    AlreadySigned = 15,
}

// ── Structs ───────────────────────────────────────────────────────────────────

/// A proposal for pausing or unpausing the contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseProposal {
    pub id: u32,
    pub proposer: Address,
    pub action: PauseAction,
    pub reason: soroban_sdk::String,
    pub created_at: u64,
    pub expires_at: u64,
    pub executed: bool,
    pub signers: soroban_sdk::Vec<Address>,
}

/// The type of pause action.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PauseAction {
    Pause,
    Unpause,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    Paused,
    Threshold,
    GuardianCount,
    PauseReason,
    PauseTimestamp,
    ProposalCount,
}

#[contracttype]
pub enum DataKey {
    Guardian(Address),
    Proposal(u32),
}
