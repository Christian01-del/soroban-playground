// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ProductNotFound = 4,
    PolicyNotFound = 5,
    ProductInactive = 6,
    PolicyExpired = 7,
    PolicyAlreadyClaimed = 8,
    TriggerNotMet = 9,
    ZeroPremium = 10,
    ZeroCoverage = 11,
    InvalidTrigger = 12,
    UnknownOracle = 13,
    OracleDataStale = 14,
    EmptyName = 15,
    PolicyNotActive = 16,
    ReserveNotConfigured = 17,
    ReserveAlreadyConfigured = 18,
    InsufficientReserve = 19,
    InvalidOracleData = 20,
    WrongRegion = 21,
    SatelliteDataRequired = 22,
    PolicyNotFunded = 23,
    InvalidObservation = 24,
    InvalidConfig = 25,
    Overflow = 26,
    /// Oracle reading lacks required verification.
    UnverifiedOracleData = 27,
    /// Oracle reading has insufficient confirmations.
    InsufficientConfirmations = 28,
    /// Oracle data source type not authorized for this product.
    UnauthorizedDataSource = 29,
    /// Oracle reading timestamp is invalid (future or too old).
    InvalidTimestamp = 30,
}

/// Verification status mirrored from `weather-data-oracle`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WeatherDataStatus {
    Pending,
    Verified,
    Disputed,
    Finalized,
}

/// Source provenance mirrored from `weather-data-oracle`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataSourceType {
    Satellite,
    GroundStation,
    WeatherAPI,
}

/// Cross-contract weather record returned by the repository weather oracle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SatelliteWeatherData {
    pub id: u32,
    pub location: String,
    pub latitude: i64,
    pub longitude: i64,
    pub temperature: i32,
    pub humidity: u32,
    pub pressure: u32,
    pub wind_speed: u32,
    pub wind_direction: u32,
    /// Precipitation in millimetres × 10.
    pub precipitation: u32,
    pub timestamp: u64,
    pub status: WeatherDataStatus,
    pub submitter: Address,
    pub confirmations: u32,
    pub source_type: DataSourceType,
}

/// Additional immutable constraints for a satellite-backed crop product.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CropTerms {
    pub region: String,
    /// Maximum age of an observation at claim time.
    pub max_observation_age: u64,
}

/// Settlement-token configuration for funded crop policies.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveConfig {
    pub settlement_token: Address,
}

/// Direction of the trigger comparison.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TriggerDirection {
    /// Payout if oracle_value >= threshold (e.g. temperature too high).
    AtOrAbove = 0,
    /// Payout if oracle_value <= threshold (e.g. rainfall too low).
    AtOrBelow = 1,
}

/// Lifecycle state of a policy.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PolicyStatus {
    Active = 0,
    Claimed = 1,
    Expired = 2,
}

/// Configuration for creating a new insurance product.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProductConfig {
    /// Human-readable name (e.g. "Drought Cover – Kenya").
    pub name: String,
    /// Premium paid by the policyholder (in stroops).
    pub premium: i128,
    /// Maximum payout amount (in stroops).
    pub coverage_amount: i128,
    /// Authorised oracle address for this product.
    pub oracle: Address,
    /// The parameter key the oracle reports (e.g. "RAINFALL_MM").
    pub parameter_key: String,
    /// Threshold value that must be breached to trigger payout (scaled ×10^7).
    pub trigger_threshold: i128,
    /// Whether the trigger fires above or below the threshold.
    pub trigger_direction: TriggerDirection,
    /// Policy duration in seconds.
    pub term_secs: u64,
    /// Authorized data source types for this product.
    pub authorized_sources: Vec<DataSourceType>,
    /// Minimum confirmations required for oracle readings.
    pub min_confirmations: u32,
    /// Optional location requirement for geo-specific products.
    pub required_location: Option<String>,
}

/// Configuration for creating a new crop insurance product.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CropProductConfig {
    /// Human-readable name (e.g. "Maize Yield – Kenya").
    pub name: String,
    /// Premium paid by the policyholder (in stroops).
    pub premium: i128,
    /// Maximum payout amount (in stroops).
    pub coverage_amount: i128,
    /// Authorised satellite oracle address for this product.
    pub satellite_oracle: Address,
    /// Rainfall threshold that must be breached to trigger payout (scaled ×10^7).
    pub rainfall_threshold: i128,
    /// Whether the trigger fires above or below the threshold.
    pub trigger_direction: TriggerDirection,
    /// Policy duration in seconds.
    pub term_secs: u64,
    /// Maximum age of satellite observations in seconds.
    pub max_observation_age: u64,
    /// Minimum confirmations required for oracle readings.
    pub min_confirmations: u32,
    /// Region identifier for this crop product.
    pub region: String,
}

/// A parametric insurance product template defined by the admin.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Product {
    /// Human-readable name (e.g. "Drought Cover – Kenya").
    pub name: String,
    /// Premium paid by the policyholder (in stroops).
    pub premium: i128,
    /// Maximum payout amount (in stroops).
    pub coverage_amount: i128,
    /// Authorised oracle address for this product.
    pub oracle: Address,
    /// The parameter key the oracle reports (e.g. "RAINFALL_MM").
    pub parameter_key: String,
    /// Threshold value that must be breached to trigger payout (scaled ×10^7).
    pub trigger_threshold: i128,
    /// Whether the trigger fires above or below the threshold.
    pub trigger_direction: TriggerDirection,
    /// Policy duration in seconds.
    pub term_secs: u64,
    /// Whether new policies can be purchased.
    pub is_active: bool,
    /// Authorized data source types for this product.
    pub authorized_sources: Vec<DataSourceType>,
    /// Minimum confirmations required for oracle readings.
    pub min_confirmations: u32,
    /// Optional location requirement for geo-specific products.
    pub required_location: Option<String>,
}

/// A purchased policy instance.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Policy {
    /// Product this policy covers.
    pub product_id: u32,
    /// Policyholder Stellar address.
    pub holder: Address,
    /// Premium paid.
    pub premium_paid: i128,
    /// Coverage cap at payout.
    pub coverage_amount: i128,
    /// Ledger timestamp when policy was purchased.
    pub purchased_at: u64,
    /// Ledger timestamp when policy expires.
    pub expires_at: u64,
    /// Current lifecycle state.
    pub status: PolicyStatus,
    /// Oracle-reported value at the time of claim (set on successful claim).
    pub trigger_value: Option<i128>,
    /// Actual amount paid out (set on successful claim).
    pub payout_amount: Option<i128>,
}

/// Oracle data record submitted by authorised oracles.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleReading {
    /// The parameter being reported (must match Product.parameter_key).
    pub parameter_key: String,
    /// Reported value (scaled ×10^7).
    pub value: i128,
    /// Ledger timestamp of the reading.
    pub timestamp: u64,
    /// Data source provenance (e.g., Satellite, GroundStation, WeatherAPI).
    pub source_type: DataSourceType,
    /// Verification status of the reading.
    pub status: WeatherDataStatus,
    /// Number of confirmations from independent oracles.
    pub confirmations: u32,
    /// Optional location identifier for geo-specific readings.
    pub location: Option<String>,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProductCount,
    PolicyCount,
    ReserveConfig,
    TotalReserved,
}

#[contracttype]
pub enum DataKey {
    Product(u32),
    Policy(u32),
    /// Latest oracle reading: (oracle_address, parameter_key) → OracleReading
    OracleReading(Address, String),
    /// Authorised oracle addresses.
    Oracle(Address),
    /// Crop-specific satellite constraints keyed by product.
    CropTerms(u32),
    /// Whether a policy has premium custody and reserved payout funds.
    FundedPolicy(u32),
}
