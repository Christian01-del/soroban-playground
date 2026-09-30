#![cfg(test)]

use super::{
    types::{
        DataSourceType, Error, PolicyStatus, SatelliteWeatherData, TriggerDirection,
        WeatherDataStatus,
    },
    ParametricInsurance, ParametricInsuranceClient,
};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

const PREMIUM: i128 = 10_000_000;
const COVERAGE: i128 = 1_000_000_000;
const TERM: u64 = 2_592_000; // 30 days
const THRESHOLD: i128 = 50_0000000; // 50.0 scaled ×10^7

fn setup() -> (
    Env,
    ParametricInsuranceClient<'static>,
    Address,
    Address,
    u32,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ParametricInsurance);
    let client = ParametricInsuranceClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle, &true);
    let product_id = client.create_product(
        &admin,
        &String::from_str(&env, "Drought Cover"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &THRESHOLD,
        &TriggerDirection::AtOrBelow,
        &TERM,
    );
    (env, client, admin, oracle, product_id)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, ..) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, ..) = setup();
    let result = client.try_initialize(&admin);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

// ── Product management ────────────────────────────────────────────────────────

#[test]
fn test_create_product_increments_count() {
    let (env, client, admin, oracle, _) = setup();
    let id2 = client.create_product(
        &admin,
        &String::from_str(&env, "Flood Cover"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "WATER_LEVEL_CM"),
        &100_0000000i128,
        &TriggerDirection::AtOrAbove,
        &TERM,
    );
    assert_eq!(id2, 2);
    assert_eq!(client.product_count(), 2);
}

#[test]
fn test_create_product_empty_name_fails() {
    let (env, client, admin, oracle, _) = setup();
    let result = client.try_create_product(
        &admin,
        &String::from_str(&env, ""),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "X"),
        &THRESHOLD,
        &TriggerDirection::AtOrBelow,
        &TERM,
    );
    assert!(matches!(result, Err(Ok(Error::EmptyName))));
}

#[test]
fn test_create_product_non_admin_fails() {
    let (env, client, _admin, oracle, _) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_create_product(
        &stranger,
        &String::from_str(&env, "X"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "X"),
        &THRESHOLD,
        &TriggerDirection::AtOrBelow,
        &TERM,
    );
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

// ── Policy purchase ───────────────────────────────────────────────────────────

#[test]
fn test_buy_policy_creates_active_policy() {
    let (env, client, _admin, _oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    assert_eq!(policy_id, 1);
    let policy = client.get_policy(&policy_id);
    assert_eq!(policy.holder, holder);
    assert_eq!(policy.status, PolicyStatus::Active);
    assert_eq!(policy.coverage_amount, COVERAGE);
}

#[test]
fn test_buy_policy_inactive_product_fails() {
    let (env, client, admin, _oracle, product_id) = setup();
    client.deactivate_product(&admin, &product_id);
    let holder = Address::generate(&env);
    let result = client.try_buy_policy(&holder, &product_id);
    assert!(matches!(result, Err(Ok(Error::ProductInactive))));
}

// ── Oracle submissions ────────────────────────────────────────────────────────

#[test]
fn test_submit_reading_unknown_oracle_fails() {
    let (env, client, ..) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_submit_reading(
        &stranger,
        &String::from_str(&env, "RAINFALL_MM"),
        &30_0000000i128,
    );
    assert!(matches!(result, Err(Ok(Error::UnknownOracle))));
}

#[test]
fn test_submit_reading_stored_correctly() {
    let (env, client, _admin, oracle, _) = setup();
    client.submit_reading(
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &30_0000000i128,
    );
    let reading = client
        .get_reading(&oracle, &String::from_str(&env, "RAINFALL_MM"))
        .unwrap();
    assert_eq!(reading.value, 30_0000000);
}

// ── Claim processing ──────────────────────────────────────────────────────────

#[test]
fn test_process_claim_trigger_met_pays_out() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);

    // Rainfall = 20mm, threshold = 50mm, direction = AtOrBelow → triggered
    client.submit_reading(
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &20_0000000i128,
    );

    let payout = client.process_claim(&policy_id);
    assert_eq!(payout, COVERAGE);

    let policy = client.get_policy(&policy_id);
    assert_eq!(policy.status, PolicyStatus::Claimed);
    assert_eq!(policy.payout_amount, Some(COVERAGE));
    assert_eq!(policy.trigger_value, Some(20_0000000i128));
}

#[test]
fn test_process_claim_trigger_not_met_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);

    // Rainfall = 80mm, threshold = 50mm, direction = AtOrBelow → not triggered
    client.submit_reading(
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &80_0000000i128,
    );

    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::TriggerNotMet))));
}

#[test]
fn test_process_claim_no_oracle_data_fails() {
    let (env, client, _admin, _oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::OracleDataStale))));
}

#[test]
fn test_process_claim_stale_oracle_data_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);

    client.submit_reading(
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &20_0000000i128,
    );

    // Advance past the 24h staleness window
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::OracleDataStale))));
}

#[test]
fn test_process_claim_double_claim_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    client.submit_reading(
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &10_0000000i128,
    );
    client.process_claim(&policy_id);
    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::PolicyAlreadyClaimed))));
}

#[test]
fn test_process_claim_expired_policy_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    client.submit_reading(
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &10_0000000i128,
    );

    // Advance past policy term
    env.ledger().with_mut(|l| l.timestamp += TERM + 1);

    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::PolicyExpired))));
}

#[test]
fn test_at_or_above_trigger_fires_correctly() {
    let (env, client, admin, oracle, _) = setup();
    let flood_product = client.create_product(
        &admin,
        &String::from_str(&env, "Flood Cover"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "WATER_LEVEL_CM"),
        &100_0000000i128,
        &TriggerDirection::AtOrAbove,
        &TERM,
    );
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &flood_product);

    // Water level = 150cm, threshold = 100cm, AtOrAbove → triggered
    client.submit_reading(
        &oracle,
        &String::from_str(&env, "WATER_LEVEL_CM"),
        &150_0000000i128,
    );
    let payout = client.process_claim(&policy_id);
    assert_eq!(payout, COVERAGE);
}

#[test]
fn test_expire_policy_after_term() {
    let (env, client, _admin, _oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    env.ledger().with_mut(|l| l.timestamp += TERM + 1);
    client.expire_policy(&policy_id);
    let policy = client.get_policy(&policy_id);
    assert_eq!(policy.status, PolicyStatus::Expired);
}

#[contract]
struct MockSatelliteOracle;

#[contractimpl]
impl MockSatelliteOracle {
    pub fn set_weather(env: Env, record: SatelliteWeatherData) {
        env.storage().persistent().set(&record.id, &record);
    }

    pub fn get_weather_data(env: Env, data_id: u32) -> SatelliteWeatherData {
        env.storage().persistent().get(&data_id).unwrap()
    }
}

struct CropSetup {
    env: Env,
    client: ParametricInsuranceClient<'static>,
    admin: Address,
    holder: Address,
    token_address: Address,
    oracle_address: Address,
    token: TokenClient<'static>,
    oracle: MockSatelliteOracleClient<'static>,
    product_id: u32,
}

fn setup_crop(reserve_amount: i128) -> CropSetup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let admin = Address::generate(&env);
    let holder = Address::generate(&env);
    let funder = Address::generate(&env);

    let asset = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token_address = asset.address();
    let token = TokenClient::new(&env, &token_address);
    let token_admin = StellarAssetClient::new(&env, &token_address);
    token_admin.mint(&holder, &100);
    token_admin.mint(&funder, &2_000);

    let insurance_id = env.register_contract(None, ParametricInsurance);
    let client = ParametricInsuranceClient::new(&env, &insurance_id);
    client.initialize(&admin);
    client.configure_reserve(&admin, &token_address);
    if reserve_amount > 0 {
        client.fund_reserve(&funder, &reserve_amount);
    }

    let oracle_id = env.register_contract(None, MockSatelliteOracle);
    let oracle = MockSatelliteOracleClient::new(&env, &oracle_id);
    let product_id = client.create_crop_product(
        &admin,
        &String::from_str(&env, "Satellite Drought Cover"),
        &10,
        &1_000,
        &oracle_id,
        &String::from_str(&env, "KE-Nakuru-001"),
        &500,
        &TriggerDirection::AtOrBelow,
        &86_400,
        &3_600,
    );
    CropSetup {
        env,
        client,
        admin,
        holder,
        token_address,
        oracle_address: oracle_id,
        token,
        oracle,
        product_id,
    }
}

fn weather(setup: &CropSetup, id: u32, precipitation: u32) -> SatelliteWeatherData {
    SatelliteWeatherData {
        id,
        location: String::from_str(&setup.env, "KE-Nakuru-001"),
        latitude: -3_0364,
        longitude: 363_068,
        temperature: 2_500,
        humidity: 4_000,
        pressure: 10_132,
        wind_speed: 120,
        wind_direction: 180,
        precipitation,
        timestamp: setup.env.ledger().timestamp(),
        status: WeatherDataStatus::Verified,
        submitter: Address::generate(&setup.env),
        confirmations: 2,
        source_type: DataSourceType::Satellite,
    }
}

#[test]
fn test_crop_product_and_funded_policy_reserve_full_liability() {
    let setup = setup_crop(1_000);
    let terms = setup.client.get_crop_terms(&setup.product_id);
    assert_eq!(terms.region, String::from_str(&setup.env, "KE-Nakuru-001"));

    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    assert!(setup.client.is_policy_funded(&policy_id));
    assert_eq!(setup.client.get_total_reserved(), 1_000);
    assert_eq!(setup.token.balance(&setup.holder), 90);
    assert_eq!(setup.token.balance(&setup.client.address), 1_010);
}

#[test]
fn test_verified_satellite_drought_triggers_automatic_token_payout() {
    let setup = setup_crop(1_000);
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    setup.oracle.set_weather(&weather(&setup, 7, 200));

    let payout = setup.client.process_satellite_claim(&policy_id, &7);
    assert_eq!(payout, 1_000);
    assert_eq!(setup.token.balance(&setup.holder), 1_090);
    assert_eq!(setup.token.balance(&setup.client.address), 10);
    assert_eq!(setup.client.get_total_reserved(), 0);
    assert!(!setup.client.is_policy_funded(&policy_id));
    let policy = setup.client.get_policy(&policy_id);
    assert_eq!(policy.status, PolicyStatus::Claimed);
    assert_eq!(policy.trigger_value, Some(200));
}

#[test]
fn test_non_triggering_rainfall_preserves_policy_and_reserve() {
    let setup = setup_crop(1_000);
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    setup.oracle.set_weather(&weather(&setup, 8, 800));
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &8),
        Err(Ok(Error::TriggerNotMet))
    );
    assert_eq!(
        setup.client.get_policy(&policy_id).status,
        PolicyStatus::Active
    );
    assert_eq!(setup.client.get_total_reserved(), 1_000);
}

#[test]
fn test_unverified_or_non_satellite_observation_is_rejected() {
    let setup = setup_crop(1_000);
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    let mut pending = weather(&setup, 9, 200);
    pending.status = WeatherDataStatus::Pending;
    setup.oracle.set_weather(&pending);
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &9),
        Err(Ok(Error::InvalidOracleData))
    );

    let mut station = weather(&setup, 10, 200);
    station.source_type = DataSourceType::GroundStation;
    setup.oracle.set_weather(&station);
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &10),
        Err(Ok(Error::InvalidOracleData))
    );
}

#[test]
fn test_wrong_region_and_stale_observation_are_rejected() {
    let setup = setup_crop(1_000);
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    let mut wrong_region = weather(&setup, 11, 200);
    wrong_region.location = String::from_str(&setup.env, "KE-Kisumu-001");
    setup.oracle.set_weather(&wrong_region);
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &11),
        Err(Ok(Error::WrongRegion))
    );

    let mut stale = weather(&setup, 12, 200);
    stale.timestamp = setup.env.ledger().timestamp();
    setup.oracle.set_weather(&stale);
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += 3_601);
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &12),
        Err(Ok(Error::InvalidObservation))
    );
}

#[test]
fn test_pre_policy_and_future_observations_are_rejected() {
    let setup = setup_crop(1_000);
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    let mut old = weather(&setup, 13, 200);
    old.timestamp -= 1;
    setup.oracle.set_weather(&old);
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &13),
        Err(Ok(Error::InvalidObservation))
    );

    let mut future = weather(&setup, 14, 200);
    future.timestamp += 1;
    setup.oracle.set_weather(&future);
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &14),
        Err(Ok(Error::InvalidObservation))
    );
}

#[test]
fn test_insufficient_reserve_rolls_back_premium_and_policy() {
    let setup = setup_crop(500);
    assert_eq!(
        setup
            .client
            .try_buy_crop_policy(&setup.holder, &setup.product_id),
        Err(Ok(Error::InsufficientReserve))
    );
    assert_eq!(setup.token.balance(&setup.holder), 100);
    assert_eq!(setup.client.policy_count(), 0);
    assert_eq!(setup.client.get_total_reserved(), 0);
}

#[test]
fn test_admin_cannot_withdraw_reserved_claim_funds() {
    let setup = setup_crop(1_000);
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    assert_eq!(
        setup.client.try_withdraw_excess_reserve(&setup.admin, &11),
        Err(Ok(Error::InsufficientReserve))
    );
    setup.client.withdraw_excess_reserve(&setup.admin, &10);
    assert_eq!(setup.client.get_total_reserved(), 1_000);
    assert_eq!(
        setup.client.get_policy(&policy_id).status,
        PolicyStatus::Active
    );
}

#[test]
fn test_expiring_crop_policy_releases_reserved_liability() {
    let setup = setup_crop(1_000);
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += 86_401);
    setup.client.expire_policy(&policy_id);
    assert_eq!(setup.client.get_total_reserved(), 0);
    assert!(!setup.client.is_policy_funded(&policy_id));
}

#[test]
fn test_crop_policy_rejects_legacy_reading_claim_path_and_double_claim() {
    let setup = setup_crop(1_000);
    assert_eq!(
        setup
            .client
            .try_buy_policy(&setup.holder, &setup.product_id),
        Err(Ok(Error::SatelliteDataRequired))
    );
    let policy_id = setup
        .client
        .buy_crop_policy(&setup.holder, &setup.product_id);
    assert_eq!(
        setup.client.try_process_claim(&policy_id),
        Err(Ok(Error::SatelliteDataRequired))
    );
    setup.oracle.set_weather(&weather(&setup, 15, 200));
    setup.client.process_satellite_claim(&policy_id, &15);
    assert_eq!(
        setup.client.try_process_satellite_claim(&policy_id, &15),
        Err(Ok(Error::PolicyAlreadyClaimed))
    );
}

#[test]
fn test_crop_configuration_validation_and_single_reserve_asset() {
    let setup = setup_crop(1_000);
    assert_eq!(
        setup
            .client
            .try_configure_reserve(&setup.admin, &setup.token_address),
        Err(Ok(Error::ReserveAlreadyConfigured))
    );
    assert_eq!(
        setup.client.try_create_crop_product(
            &setup.admin,
            &String::from_str(&setup.env, "Invalid"),
            &10,
            &1_000,
            &setup.oracle_address,
            &String::from_str(&setup.env, "KE-Nakuru-001"),
            &500,
            &TriggerDirection::AtOrBelow,
            &86_400,
            &(7 * 86_400 + 1),
        ),
        Err(Ok(Error::InvalidConfig))
    );
}
