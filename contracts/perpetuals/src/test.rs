use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

struct Setup {
    env: Env,
    client: PerpetualsClient<'static>,
    admin: Address,
    oracle: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let id = env.register_contract(None, Perpetuals);
    let client = PerpetualsClient::new(&env, &id);
    client.initialize(&admin, &oracle, &1_000, &1_000, &PRICE_SCALE);
    Setup {
        env,
        client,
        admin,
        oracle,
    }
}

#[test]
fn derives_mark_price_from_vamm_reserves() {
    let s = setup();
    assert_eq!(
        s.client.update_vamm_reserves(&s.admin, &1_000, &1_100),
        11_000_000
    );
    let market = s.client.get_market();
    assert_eq!(market.mark_price, 11_000_000);
    assert_eq!(market.index_price, PRICE_SCALE);
}

#[test]
fn funding_settles_only_on_eight_hour_boundary() {
    let s = setup();
    s.client.update_vamm_reserves(&s.admin, &1_000, &1_005);
    assert_eq!(s.client.preview_funding_rate(), 50);
    assert_eq!(
        s.client.try_settle_funding(),
        Err(Ok(Error::FundingTooEarly))
    );

    s.env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += FUNDING_INTERVAL);
    let result = s.client.settle_funding();
    assert_eq!(result.rate_bps, 50);
    assert_eq!(result.intervals_settled, 1);
    assert_eq!(result.cumulative_funding_bps, 50);
}

#[test]
fn funding_is_signed_and_capped() {
    let s = setup();
    s.client.update_vamm_reserves(&s.admin, &1_000, &2_000);
    assert_eq!(s.client.preview_funding_rate(), MAX_FUNDING_RATE_BPS);

    s.client.update_index_price(&s.oracle, &20_000_000);
    s.client.update_vamm_reserves(&s.admin, &1_000, &1_000);
    assert_eq!(s.client.preview_funding_rate(), -MAX_FUNDING_RATE_BPS);
}

#[test]
fn catch_up_is_bounded_and_preserves_interval_alignment() {
    let s = setup();
    s.client.update_vamm_reserves(&s.admin, &1_000, &1_001);
    s.env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += FUNDING_INTERVAL * 25);

    let first = s.client.settle_funding();
    assert_eq!(first.intervals_settled, MAX_INTERVALS_PER_CALL);
    let second = s.client.settle_funding();
    assert_eq!(second.intervals_settled, 4);
    let state = s.client.get_funding();
    assert_eq!(state.cumulative_funding_bps, 250);
    assert_eq!(
        s.client.try_settle_funding(),
        Err(Ok(Error::FundingTooEarly))
    );
}

#[test]
fn validates_roles_prices_and_reserves() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client.try_update_vamm_reserves(&stranger, &1_000, &1_000),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        s.client.try_update_index_price(&s.oracle, &0),
        Err(Ok(Error::InvalidPrice))
    );
    assert_eq!(
        s.client.try_update_vamm_reserves(&s.admin, &0, &1_000),
        Err(Ok(Error::InvalidReserve))
    );
}
