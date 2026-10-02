// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Decentralized Price Oracle
//!
//! Accepts price feeds from multiple whitelisted reporters and exposes a
//! **staleness-filtered medianized price**.
//!
//! ## Key security properties
//! - **Staleness threshold**: any price older than `max_age` seconds is treated
//!   as missing. `get_price` returns an error if no fresh price is available.
//! - **Multi-source medianizer**: requires at least `min_sources` fresh reports
//!   before producing a result, preventing a single compromised reporter from
//!   manipulating the feed.
//! - **Reporter allowlist**: only admin-approved addresses may submit prices.
//! - **Admin-only updates**: all configuration changes require admin auth.
//! - **Emergency pause**: admin can halt price consumption during an incident.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Map, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN_KEY: &str = "admin";
const INITIALIZED_KEY: &str = "init";
const PAUSED_KEY: &str = "paused";
const MAX_AGE_KEY: &str = "max_age";
const MIN_SOURCES_KEY: &str = "min_src";
const REPORTER_COUNT_KEY: &str = "rep_cnt";

/// Default staleness threshold: 30 seconds.
const DEFAULT_MAX_AGE: u64 = 30;
/// Default minimum sources required to produce a price.
const DEFAULT_MIN_SOURCES: u32 = 1;
/// Maximum reporters allowed.
const MAX_REPORTERS: u32 = 50;
/// Default circuit breaker threshold: 15% (1500 basis points).
const DEFAULT_CB_THRESHOLD_BPS: u32 = 1500;
/// Default circuit breaker window: 5 minutes (300 seconds).
const DEFAULT_CB_WINDOW: u64 = 300;

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Contract has not been initialized yet.
    NotInitialized = 2,
    /// Caller is not authorized to perform this action.
    Unauthorized = 3,
    /// Contract is paused.
    ContractPaused = 4,
    /// Reporter is already registered.
    ReporterAlreadyRegistered = 5,
    /// Reporter is not registered.
    ReporterNotFound = 6,
    /// Reporter cap has been reached.
    CapExceeded = 7,
    /// Submitted price is invalid (≤ 0).
    InvalidPrice = 8,
    /// No fresh price is available (all prices are stale or no reports exist).
    NoPriceFeed = 9,
    /// Fewer valid sources than `min_sources` are available.
    InsufficientSources = 10,
    /// Invalid configuration parameter.
    InvalidParameter = 11,
    /// Circuit breaker is frozen due to price anomaly / rapid deviation.
    CircuitBreakerFrozen = 12,
}

/// A single price report from one reporter.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceReport {
    /// Reported price (scaled by the agreed decimals, e.g. × 10^7).
    pub price: i128,
    /// Ledger timestamp at which the price was submitted.
    pub timestamp: u64,
}

/// The aggregated output returned by `get_price`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregatedPrice {
    /// Median price across all valid (fresh) sources.
    pub price: i128,
    /// Number of sources included in the aggregation.
    pub num_sources: u32,
    /// Ledger timestamp of the oldest price included.
    pub oldest_timestamp: u64,
    /// Ledger timestamp at which this result was computed.
    pub computed_at: u64,
}

// ── Storage helpers ───────────────────────────────────────────────────────────

fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&symbol_short!("init"))
        .unwrap_or(false)
}

fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&symbol_short!("init"), &true);
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&symbol_short!("admin"))
        .ok_or(Error::NotInitialized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&symbol_short!("admin"), admin);
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&symbol_short!("paused"))
        .unwrap_or(false)
}

fn set_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&symbol_short!("paused"), &paused);
}

fn get_max_age(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&symbol_short!("max_age"))
        .unwrap_or(DEFAULT_MAX_AGE)
}

fn set_max_age(env: &Env, max_age: u64) {
    env.storage()
        .instance()
        .set(&symbol_short!("max_age"), &max_age);
}

fn get_min_sources(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&symbol_short!("min_src"))
        .unwrap_or(DEFAULT_MIN_SOURCES)
}

fn set_min_sources(env: &Env, min: u32) {
    env.storage()
        .instance()
        .set(&symbol_short!("min_src"), &min);
}

fn get_reporter_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&symbol_short!("rep_cnt"))
        .unwrap_or(0)
}

fn set_reporter_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&symbol_short!("rep_cnt"), &count);
}

/// Returns `true` if `reporter` is on the allowlist.
fn is_reporter(env: &Env, reporter: &Address) -> bool {
    let reporters: Map<Address, bool> = env
        .storage()
        .instance()
        .get(&symbol_short!("reporters"))
        .unwrap_or_else(|| Map::new(env));
    reporters.get(reporter.clone()).unwrap_or(false)
}

fn add_reporter_to_map(env: &Env, reporter: &Address) {
    let mut reporters: Map<Address, bool> = env
        .storage()
        .instance()
        .get(&symbol_short!("reporters"))
        .unwrap_or_else(|| Map::new(env));
    reporters.set(reporter.clone(), true);
    env.storage()
        .instance()
        .set(&symbol_short!("reporters"), &reporters);
}

fn remove_reporter_from_map(env: &Env, reporter: &Address) {
    let mut reporters: Map<Address, bool> = env
        .storage()
        .instance()
        .get(&symbol_short!("reporters"))
        .unwrap_or_else(|| Map::new(env));
    reporters.remove(reporter.clone());
    env.storage()
        .instance()
        .set(&symbol_short!("reporters"), &reporters);
}

/// Storage key for a reporter's latest price report.
fn reporter_price_key(reporter: &Address) -> (soroban_sdk::Symbol, Address) {
    (symbol_short!("rp"), reporter.clone())
}

fn save_report(env: &Env, reporter: &Address, report: &PriceReport) {
    env.storage()
        .persistent()
        .set(&reporter_price_key(reporter), report);
}

fn load_report(env: &Env, reporter: &Address) -> Option<PriceReport> {
    env.storage()
        .persistent()
        .get(&reporter_price_key(reporter))
}

fn get_circuit_breaker_frozen(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&symbol_short!("cb_frozen"))
        .unwrap_or(false)
}

fn set_circuit_breaker_frozen(env: &Env, frozen: bool) {
    env.storage()
        .instance()
        .set(&symbol_short!("cb_frozen"), &frozen);
}

fn get_last_median_record(env: &Env) -> Option<(i128, u64)> {
    env.storage()
        .instance()
        .get::<_, (i128, u64)>(&symbol_short!("last_med"))
}

fn set_last_median_record(env: &Env, price: i128, timestamp: u64) {
    env.storage()
        .instance()
        .set(&symbol_short!("last_med"), &(price, timestamp));
}

fn get_cb_threshold_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&symbol_short!("cb_thr"))
        .unwrap_or(DEFAULT_CB_THRESHOLD_BPS)
}

fn set_cb_threshold_bps(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&symbol_short!("cb_thr"), &bps);
}

fn get_cb_window(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&symbol_short!("cb_win"))
        .unwrap_or(DEFAULT_CB_WINDOW)
}

fn set_cb_window(env: &Env, window: u64) {
    env.storage()
        .instance()
        .set(&symbol_short!("cb_win"), &window);
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct Oracle;

#[contractimpl]
impl Oracle {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialize the oracle. May only be called once.
    ///
    /// * `admin`       – address that controls configuration.
    /// * `max_age`     – staleness threshold in seconds (default 3 600).
    /// * `min_sources` – minimum fresh reports required to produce a price
    ///                   (default 1; set ≥ 2 for flash-crash resistance).
    pub fn initialize(
        env: Env,
        admin: Address,
        max_age: Option<u64>,
        min_sources: Option<u32>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_max_age(&env, max_age.unwrap_or(DEFAULT_MAX_AGE));
        let min = min_sources.unwrap_or(DEFAULT_MIN_SOURCES);
        if min == 0 {
            return Err(Error::InvalidParameter);
        }
        set_min_sources(&env, min);
        set_initialized(&env);
        env.events()
            .publish((symbol_short!("init"),), (admin,));
        Ok(())
    }

    // ── Admin: pause / unpause ────────────────────────────────────────────────

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

    // ── Admin: reporter management ────────────────────────────────────────────

    /// Whitelist a reporter so they may submit prices.
    pub fn add_reporter(env: Env, admin: Address, reporter: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if is_reporter(&env, &reporter) {
            return Err(Error::ReporterAlreadyRegistered);
        }
        let count = get_reporter_count(&env);
        if count >= MAX_REPORTERS {
            return Err(Error::CapExceeded);
        }
        add_reporter_to_map(&env, &reporter);
        set_reporter_count(&env, count + 1);
        env.events()
            .publish((symbol_short!("rep_add"),), reporter);
        Ok(())
    }

    /// Remove a reporter from the allowlist. Their last-submitted price is also
    /// cleared so it is no longer included in future aggregations.
    pub fn remove_reporter(env: Env, admin: Address, reporter: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if !is_reporter(&env, &reporter) {
            return Err(Error::ReporterNotFound);
        }
        remove_reporter_from_map(&env, &reporter);
        // Clear stale price data for deregistered reporter.
        env.storage()
            .persistent()
            .remove(&reporter_price_key(&reporter));
        let count = get_reporter_count(&env);
        if count > 0 {
            set_reporter_count(&env, count - 1);
        }
        env.events()
            .publish((symbol_short!("rep_rm"),), reporter);
        Ok(())
    }

    // ── Admin: configuration ──────────────────────────────────────────────────

    /// Update the staleness threshold. Must be > 0.
    pub fn set_max_age(env: Env, admin: Address, max_age: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if max_age == 0 {
            return Err(Error::InvalidParameter);
        }
        set_max_age(&env, max_age);
        Ok(())
    }

    /// Update the minimum number of fresh sources required.
    pub fn set_min_sources(env: Env, admin: Address, min_sources: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if min_sources == 0 {
            return Err(Error::InvalidParameter);
        }
        set_min_sources(&env, min_sources);
        Ok(())
    }

    /// Set circuit breaker configuration (threshold in basis points, and time window in seconds).
    pub fn set_circuit_breaker_config(
        env: Env,
        admin: Address,
        threshold_bps: u32,
        window: u64,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_cb_threshold_bps(&env, threshold_bps);
        set_cb_window(&env, window);
        Ok(())
    }

    /// Reset / unfreeze the circuit breaker.
    pub fn unfreeze_circuit_breaker(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_circuit_breaker_frozen(&env, false);
        env.events()
            .publish((symbol_short!("cb_unfrz"),), admin);
        Ok(())
    }

    // ── Price submission ──────────────────────────────────────────────────────

    /// Submit (or update) a price. Only whitelisted reporters may call this.
    ///
    /// # Errors
    /// - [`Error::ContractPaused`] – oracle is paused.
    /// - [`Error::Unauthorized`]   – `reporter` is not on the allowlist.
    /// - [`Error::InvalidPrice`]   – `price` ≤ 0.
    pub fn submit_price(env: Env, reporter: Address, price: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        reporter.require_auth();
        if !is_reporter(&env, &reporter) {
            return Err(Error::Unauthorized);
        }
        if price <= 0 {
            return Err(Error::InvalidPrice);
        }
        let report = PriceReport {
            price,
            timestamp: env.ledger().timestamp(),
        };
        save_report(&env, &reporter, &report);
        env.events()
            .publish((symbol_short!("price"),), (reporter, price));
        Ok(())
    }

    // ── Price aggregation ─────────────────────────────────────────────────────

    /// Return the medianized price over all fresh (non-stale) reports.
    ///
    /// A report is **stale** if `now - report.timestamp > max_age`.
    ///
    /// # Errors
    /// - [`Error::ContractPaused`]       – oracle is paused.
    /// - [`Error::NoPriceFeed`]          – no reporters are registered or all
    ///                                     prices are stale.
    /// - [`Error::InsufficientSources`]  – fewer valid prices than `min_sources`.
    pub fn get_price(env: Env) -> Result<AggregatedPrice, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;

        let now = env.ledger().timestamp();
        let max_age = get_max_age(&env);
        let min_sources = get_min_sources(&env);

        // Collect reporters from the map
        let reporters: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&symbol_short!("reporters"))
            .unwrap_or_else(|| Map::new(&env));

        let mut prices: Vec<i128> = Vec::new(&env);
        let mut oldest_ts: u64 = u64::MAX;

        for reporter in reporters.keys() {
            if let Some(report) = load_report(&env, &reporter) {
                let age = now.saturating_sub(report.timestamp);
                if age <= max_age {
                    prices.push_back(report.price);
                    if report.timestamp < oldest_ts {
                        oldest_ts = report.timestamp;
                    }
                }
            }
        }

        if prices.is_empty() {
            return Err(Error::NoPriceFeed);
        }
        if prices.len() < min_sources {
            return Err(Error::InsufficientSources);
        }

        if get_circuit_breaker_frozen(&env) {
            return Err(Error::CircuitBreakerFrozen);
        }

        let num_sources = prices.len();
        // Use compute_median_price_internal with quickselect and outlier rejection
        let price = compute_median_price_internal(&env, &mut prices);

        // Circuit breaker check: if prices deviate > threshold_bps in window
        let cb_threshold = get_cb_threshold_bps(&env);
        let cb_window = get_cb_window(&env);
        if let Some((last_price, last_time)) = get_last_median_record(&env) {
            if now.saturating_sub(last_time) <= cb_window {
                let diff = if price > last_price {
                    price - last_price
                } else {
                    last_price - price
                };
                // diff / last_price > threshold_bps / 10000 => diff * 10000 > last_price * threshold_bps
                if last_price > 0 && diff * 10000 > last_price * (cb_threshold as i128) {
                    set_circuit_breaker_frozen(&env, true);
                    env.events().publish(
                        (symbol_short!("cb_freeze"),),
                        (last_price, price, now),
                    );
                    return Err(Error::CircuitBreakerFrozen);
                }
            }
        }
        set_last_median_record(&env, price, now);

        Ok(AggregatedPrice {
            price,
            num_sources,
            oldest_timestamp: if oldest_ts == u64::MAX { now } else { oldest_ts },
            computed_at: now,
        })
    }

    /// Return a single reporter's last price report (regardless of staleness).
    pub fn get_reporter_price(env: Env, reporter: Address) -> Result<PriceReport, Error> {
        ensure_initialized(&env)?;
        if !is_reporter(&env, &reporter) {
            return Err(Error::ReporterNotFound);
        }
        load_report(&env, &reporter).ok_or(Error::NoPriceFeed)
    }

    // ── Read-only config ──────────────────────────────────────────────────────

    pub fn get_max_age(env: Env) -> u64 {
        get_max_age(&env)
    }

    pub fn get_min_sources(env: Env) -> u32 {
        get_min_sources(&env)
    }

    pub fn get_reporter_count(env: Env) -> u32 {
        get_reporter_count(&env)
    }

    pub fn is_reporter(env: Env, reporter: Address) -> bool {
        is_reporter(&env, &reporter)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    pub fn is_circuit_breaker_frozen(env: Env) -> bool {
        get_circuit_breaker_frozen(&env)
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

/// In-place insertion sort on a `Vec<i128>` (no_std safe, small N).
fn sort_prices(prices: &mut Vec<i128>) {
    let n = prices.len();
    let mut i: u32 = 1;
    while i < n {
        let key = prices.get(i).unwrap();
        let mut j = i;
        while j > 0 && prices.get(j - 1).unwrap() > key {
            let prev = prices.get(j - 1).unwrap();
            prices.set(j, prev);
            j -= 1;
        }
        prices.set(j, key);
        i += 1;
    }
}

/// Quickselect algorithm to find the k-th smallest element in 0-indexed vector (in-place partitioning).
fn quickselect(prices: &mut Vec<i128>, mut k: u32) -> i128 {
    let mut low: u32 = 0;
    let mut high: u32 = prices.len() - 1;

    while low < high {
        let pivot_idx = low + (high - low) / 2;
        let pivot_val = prices.get(pivot_idx).unwrap();

        // Move pivot to end
        prices.set(pivot_idx, prices.get(high).unwrap());
        prices.set(high, pivot_val);

        let mut store_idx = low;
        let mut i = low;
        while i < high {
            if prices.get(i).unwrap() < pivot_val {
                let tmp = prices.get(store_idx).unwrap();
                prices.set(store_idx, prices.get(i).unwrap());
                prices.set(i, tmp);
                store_idx += 1;
            }
            i += 1;
        }

        let tmp = prices.get(high).unwrap();
        prices.set(high, prices.get(store_idx).unwrap());
        prices.set(store_idx, tmp);

        if store_idx == k {
            return prices.get(k).unwrap();
        } else if store_idx < k {
            low = store_idx + 1;
        } else {
            high = if store_idx > 0 { store_idx - 1 } else { 0 };
        }
    }
    prices.get(k).unwrap()
}

/// Compute the median of a non-empty price list using quickselect and outlier rejection.
fn compute_median_price_internal(env: &Env, prices: &mut Vec<i128>) -> i128 {
    let n = prices.len();
    if n == 0 {
        return 0;
    }

    // Quickselect to find the median
    let median_val = quickselect(prices, n / 2);

    // Statistical outlier rejection (> 2 standard deviations or MAD / IQR approximation / deviation check)
    // For robust multi-oracle aggregation with 7+ oracles, filter out reports deviating > 2 standard deviations or >20% from median, or similar outlier filter.
    // Let's implement robust filtering: compute mean and standard deviation (or median absolute deviation), or filter out any price differing from median by more than 2 std devs.
    if n >= 3 {
        // Calculate mean and variance
        let mut sum: i128 = 0;
        let mut i: u32 = 0;
        while i < n {
            sum += prices.get(i).unwrap();
            i += 1;
        }
        let mean = sum / (n as i128);

        let mut var_sum: i128 = 0;
        i = 0;
        while i < n {
            let diff = prices.get(i).unwrap() - mean;
            var_sum += diff * diff;
            i += 1;
        }
        let variance = var_sum / (n as i128);
        // Integer square root for standard deviation
        let std_dev = isqrt(variance);

        if std_dev > 0 {
            let mut filtered: Vec<i128> = Vec::new(env);
            i = 0;
            while i < n {
                let p = prices.get(i).unwrap();
                let abs_diff = if p > mean { p - mean } else { mean - p };
                // Keep within 2 standard deviations
                if abs_diff <= 2 * std_dev {
                    filtered.push_back(p);
                }
                i += 1;
            }
            if !filtered.is_empty() {
                // Re-compute median of filtered prices using quickselect/sort
                let fn_n = filtered.len();
                let mid_val = quickselect(&mut filtered, fn_n / 2);
                return mid_val;
            }
        }
    }

    median_val
}

/// Integer square root function (Newton's method).
fn isqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Compute the median of a non-empty price list (sorts in place).
fn median(prices: &mut Vec<i128>) -> i128 {
    sort_prices(prices);
    let n = prices.len();
    if n % 2 == 1 {
        prices.get(n / 2).unwrap()
    } else {
        let lo = prices.get(n / 2 - 1).unwrap();
        let hi = prices.get(n / 2).unwrap();
        (lo + hi) / 2
    }
}
