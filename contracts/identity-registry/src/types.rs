use soroban_sdk::{contracterror, contracttype, Address, String};

/// Status of an on-chain identity.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum IdentityStatus {
    /// Registered but not yet verified by the admin.
    Pending = 0,
    /// Verified by the admin; trusted identity.
    Verified = 1,
    /// Revoked; no further transitions allowed.
    Revoked = 2,
}

/// An on-chain identity record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Identity {
    /// Owner address.
    pub owner: Address,
    /// Human-readable display name (1–64 chars).
    pub display_name: String,
    /// Off-chain metadata URI (1–256 chars).
    pub metadata_uri: String,
    /// Lifecycle status.
    pub status: IdentityStatus,
    /// Ledger timestamp when the identity was first registered.
    pub registered_at: u64,
    /// Ledger timestamp of the most recent update.
    pub updated_at: u64,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    Initialized,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Identity(Address),
}

/// All errors the contract can return.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    IdentityNotFound = 4,
    AlreadyRegistered = 5,
    IdentityRevoked = 6,
    AlreadyRevoked = 7,
    InvalidStatus = 8,
    EmptyDisplayName = 9,
    DisplayNameTooLong = 10,
    EmptyMetadataUri = 11,
    MetadataUriTooLong = 12,
}
