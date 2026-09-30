// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Product lifecycle ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProductStatus {
    Registered = 0,
    InTransit = 1,
    AtWarehouse = 2,
    QualityCheck = 3,
    Approved = 4,
    Rejected = 5,
    Delivered = 6,
    Recalled = 7,
    TemperatureViolation = 8,
}

// ── Quality check result ──────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum QualityResult {
    Pass = 0,
    Fail = 1,
    Pending = 2,
}

// ── Cold chain enums ──────────────────────────────────────────────────────────

/// Status of an SLA agreement.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SlaStatus {
    Active,
    Violated,
    Completed,
    Expired,
}

/// Status of a temperature log.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TemperatureLogStatus {
    Normal,
    Warning,
    Violation,
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Product {
    pub id: u32,
    pub owner: Address,
    pub name: String,
    /// SHA-256 hash of product metadata (origin, batch, etc.)
    pub metadata_hash: u64,
    pub status: ProductStatus,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Checkpoint {
    pub product_id: u32,
    pub index: u32,
    pub handler: Address,
    pub location_hash: u64,
    pub notes_hash: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct QualityReport {
    pub product_id: u32,
    pub inspector: Address,
    pub result: QualityResult,
    /// Hash of the detailed inspection report.
    pub report_hash: u64,
    pub timestamp: u64,
}

/// Temperature log entry for cold-chain monitoring.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TemperatureLog {
    pub product_id: u32,
    pub timestamp: u64,
    pub temperature_celsius: i32,
    pub humidity_percent: u32,
    pub status: TemperatureLogStatus,
    pub recorded_by: Address,
    pub proof_hash: u64,
}

/// SLA (Service Level Agreement) for cold-chain requirements.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ColdChainSla {
    pub id: u32,
    pub product_id: u32,
    pub min_temp_celsius: i32,
    pub max_temp_celsius: i32,
    pub max_violation_minutes: u32,
    pub penalty_per_violation: i128,
    pub deposit_amount: i128,
    pub status: SlaStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub violation_count: u32,
    pub total_penalties: i128,
}

/// Penalty record for SLA violations.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PenaltyRecord {
    pub id: u32,
    pub sla_id: u32,
    pub product_id: u32,
    pub violation_timestamp: u64,
    pub duration_minutes: u32,
    pub penalty_amount: i128,
    pub recorded_by: Address,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProductCount,
    SlaCount,
    PenaltyCount,
}

#[contracttype]
pub enum DataKey {
    Product(u32),
    /// Number of checkpoints for a product.
    CheckpointCount(u32),
    Checkpoint(u32, u32),
    QualityReport(u32),
    /// Authorised inspector addresses.
    Inspector(Address),
    /// Authorised handler addresses.
    Handler(Address),
    /// Cold chain SLA for a product.
    ColdChainSla(u32),
    /// Temperature log for a product at a timestamp.
    TemperatureLog(u32, u64),
    /// Penalty record.
    Penalty(u32),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ProductNotFound = 4,
    InvalidStatus = 5,
    EmptyName = 6,
    NotInspector = 7,
    NotHandler = 8,
    AlreadyRecalled = 9,
    QualityReportNotFound = 10,
    SlaNotFound = 11,
    SlaAlreadyActive = 12,
    SlaExpired = 13,
    SlaNotActive = 14,
    InvalidTemperatureRange = 15,
    PenaltyNotFound = 16,
    InsufficientDeposit = 17,
}
