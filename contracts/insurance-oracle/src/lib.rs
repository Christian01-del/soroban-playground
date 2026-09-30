#![no_std]

mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
    Symbol, Vec,
};

const ADMIN: Symbol = symbol_short!("ADMIN");
const VERIFICATION_THRESHOLD: Symbol = symbol_short!("THRESHOLD");
const CIRCUIT_BREAKER: Symbol = symbol_short!("BREAKER");
const MAX_SOURCES: u32 = 20;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    InvalidInput = 2,
    NotFound = 3,
    CapExceeded = 4,
    CircuitOpen = 5,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RiskData {
    pub source: Address,
    pub risk_type: String,
    pub value: i128,
    pub confidence: u32,
    pub timestamp: u64,
    pub metadata: String,
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&ADMIN)
        .ok_or(Error::Unauthorized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has::<Symbol>(&ADMIN) {
        return Err(Error::NotFound);
    }
    Ok(())
}

fn get_sources(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&symbol_short!("SOURCES"))
        .unwrap_or_else(|| Vec::new(env))
}

#[contract]
pub struct InsuranceOracle;

#[contractimpl]
impl InsuranceOracle {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has::<Symbol>(&ADMIN) {
            return Err(Error::CapExceeded);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.storage().instance().set(&VERIFICATION_THRESHOLD, &3u32);
        env.storage()
            .persistent()
            .set(&symbol_short!("SOURCES"), &Vec::<Address>::new(&env));
        env.storage().instance().set(&CIRCUIT_BREAKER, &false);
        Ok(())
    }

    // ── Risk Data Management ────────────────────────────────────────────────────

    pub fn submit_risk_data(env: Env, data: RiskData) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sources = get_sources(&env);

        if !sources.contains(data.source.clone()) {
            return Err(Error::Unauthorized);
        }

        if data.confidence > 100 {
            return Err(Error::InvalidInput);
        }

        let breaker: bool = env
            .storage()
            .instance()
            .get(&CIRCUIT_BREAKER)
            .unwrap_or(false);
        if breaker {
            return Err(Error::CircuitOpen);
        }

        if data.risk_type.len() > 64 {
            return Err(Error::InvalidInput);
        }

        if data.metadata.len() > 256 {
            return Err(Error::InvalidInput);
        }

        let key: Symbol = symbol_short!("RD");
        let mut all_data: Vec<RiskData> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        all_data.push_back(data.clone());
        env.storage().persistent().set(&key, &all_data);

        env.events()
            .publish((symbol_short!("RiskSub"),), data.value);

        Ok(())
    }

    pub fn get_risk_data(env: Env, _risk_type: String) -> Result<Vec<RiskData>, Error> {
        ensure_initialized(&env)?;
        let key: Symbol = symbol_short!("RD");
        Ok(env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env)))
    }

    pub fn get_historical_claims(
        env: Env,
        _risk_type: String,
        from: u64,
        to: u64,
    ) -> Result<Vec<RiskData>, Error> {
        ensure_initialized(&env)?;
        let key: Symbol = symbol_short!("RD");
        let all_data: Vec<RiskData> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        let mut result: Vec<RiskData> = Vec::new(&env);
        for data in all_data.iter() {
            if data.timestamp >= from && data.timestamp <= to {
                result.push_back(data);
            }
        }
        Ok(result)
    }

    // ── Source Management ─────────────────────────────────────────────────────

    pub fn add_data_source(env: Env, admin: Address, source: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }

        let mut sources = get_sources(&env);
        if sources.contains(source.clone()) {
            return Ok(());
        }
        if sources.len() >= MAX_SOURCES {
            return Err(Error::CapExceeded);
        }

        sources.push_back(source);
        env.storage()
            .persistent()
            .set(&symbol_short!("SOURCES"), &sources);
        Ok(())
    }

    pub fn remove_data_source(env: Env, admin: Address, source: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }

        let sources = get_sources(&env);
        let mut new_sources: Vec<Address> = Vec::new(&env);
        for s in sources.iter() {
            if s != source {
                new_sources.push_back(s);
            }
        }
        env.storage()
            .persistent()
            .set(&symbol_short!("SOURCES"), &new_sources);
        Ok(())
    }

    // ── Threshold Configuration ─────────────────────────────────────────────

    pub fn set_verification_threshold(
        env: Env,
        admin: Address,
        threshold: u32,
    ) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }

        if threshold == 0 {
            return Err(Error::InvalidInput);
        }

        env.storage()
            .instance()
            .set(&VERIFICATION_THRESHOLD, &threshold);
        Ok(())
    }

    // ── Circuit Breaker ─────────────────────────────────────────────────────────

    pub fn activate_circuit_breaker(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }

        env.storage().instance().set(&CIRCUIT_BREAKER, &true);
        env.events().publish((symbol_short!("CbAct"),), 0u32);
        Ok(())
    }

    pub fn deactivate_circuit_breaker(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }

        env.storage().instance().set(&CIRCUIT_BREAKER, &false);
        env.events().publish((symbol_short!("CbDeact"),), 0u32);
        Ok(())
    }

    // ── Read-only ───────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_threshold_fn(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&VERIFICATION_THRESHOLD)
            .unwrap_or(3))
    }

    pub fn get_sources_fn(env: Env) -> Result<Vec<Address>, Error> {
        ensure_initialized(&env)?;
        Ok(get_sources(&env))
    }
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum OracleError {
    NotAuthorized = 1,
    AlreadyInitialized = 2,
    ReporterNotFound = 3,
    NoValidPriceFeeds = 4,
    StalePriceFeed = 5,
    InsufficientReporters = 6,
    InvalidPrice = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    StalenessThreshold,
    Reporter(Address),
    ReportersList,
    PriceReport(Address),
}

#[contract]
pub struct InsuranceOracleAggregator;

#[contractimpl]
impl InsuranceOracleAggregator {
    /// Initializes oracle aggregator with admin and max price staleness window (seconds).
    pub fn aggregator_initialize(
        env: Env,
        admin: Address,
        staleness_threshold_secs: u64,
    ) -> Result<(), OracleError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(OracleError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &staleness_threshold_secs);
        env.storage()
            .instance()
            .set(&DataKey::ReportersList, &Vec::<Address>::new(&env));

        Ok(())
    }

    /// Admin function to grant or revoke oracle reporter privileges.
    pub fn set_reporter_status(
        env: Env,
        reporter: Address,
        authorized: bool,
    ) -> Result<(), OracleError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(OracleError::NotAuthorized)?;
        admin.require_auth();

        let mut reporters: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ReportersList)
            .unwrap_or_else(|| Vec::new(&env));

        if authorized {
            if !env
                .storage()
                .persistent()
                .has(&DataKey::Reporter(reporter.clone()))
            {
                env.storage()
                    .persistent()
                    .set(&DataKey::Reporter(reporter.clone()), &true);
                reporters.push_back(reporter);
            }
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::Reporter(reporter.clone()));

            let mut updated_reporters = Vec::new(&env);
            for r in reporters.iter() {
                if r != reporter {
                    updated_reporters.push_back(r);
                }
            }
            reporters = updated_reporters;
        }

        env.storage()
            .instance()
            .set(&DataKey::ReportersList, &reporters);
        Ok(())
    }

    /// Submits a price feed update from an authorized reporter.
    pub fn submit_price(env: Env, reporter: Address, price: i128) -> Result<(), OracleError> {
        reporter.require_auth();

        let is_reporter: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Reporter(reporter.clone()))
            .unwrap_or(false);

        if !is_reporter {
            return Err(OracleError::NotAuthorized);
        }

        if price <= 0 {
            return Err(OracleError::InvalidPrice);
        }

        let report = PriceData {
            price,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::PriceReport(reporter), &report);

        Ok(())
    }

    /// Computes and returns the median price across non-stale authorized reporters.
    pub fn get_median_price(env: Env) -> Result<i128, OracleError> {
        let reporters: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ReportersList)
            .ok_or(OracleError::InsufficientReporters)?;

        let staleness_threshold: u64 = env
            .storage()
            .instance()
            .get(&DataKey::StalenessThreshold)
            .unwrap_or(300); // Default 5 mins

        let current_time = env.ledger().timestamp();
        let mut valid_prices: Vec<i128> = Vec::new(&env);

        for reporter in reporters.iter() {
            if let Some(report) = env
                .storage()
                .persistent()
                .get::<_, PriceData>(&DataKey::PriceReport(reporter))
            {
                if current_time.saturating_sub(report.timestamp) <= staleness_threshold {
                    valid_prices.push_back(report.price);
                }
            }
        }

        let len = valid_prices.len();
        if len == 0 {
            return Err(OracleError::NoValidPriceFeeds);
        }

        // Insertion sort to compute median safely in WASM environment
        let mut prices_arr = valid_prices;
        for i in 1..len {
            let key = prices_arr.get(i).unwrap();
            let mut j = i;
            while j > 0 && prices_arr.get(j - 1).unwrap() > key {
                prices_arr.set(j, prices_arr.get(j - 1).unwrap());
                j -= 1;
            }
            prices_arr.set(j, key);
        }

        // Compute median
        if len % 2 == 1 {
            Ok(prices_arr.get(len / 2).unwrap())
        } else {
            let mid1 = prices_arr.get((len / 2) - 1).unwrap();
            let mid2 = prices_arr.get(len / 2).unwrap();
            Ok((mid1 + mid2) / 2)
        }
    }
}
