#![cfg(test)]

use super::*;
use soroban_sdk::Env;

fn setup() -> (Env, PriceFeedAdapterClient<'static>) {
    let env = Env::default();
    let contract_id = env.register_contract(None, PriceFeedAdapter);
    let client = PriceFeedAdapterClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn test_get_price_supported_symbols() {
    let (env, client) = setup();
    for sym in ["XLM", "USDC", "BTC"] {
        let symbol = Bytes::from_slice(&env, sym.as_bytes());
        assert_eq!(client.get_price(&symbol), 1_000_000);
    }
}

#[test]
fn test_get_price_empty_symbol_fails() {
    let (env, client) = setup();
    let symbol = Bytes::new(&env);
    let result = client.try_get_price(&symbol);
    assert_eq!(result, Err(Ok(PriceFeedError::EmptySymbol)));
}

#[test]
fn test_get_price_unsupported_symbol_fails() {
    let (env, client) = setup();
    let symbol = Bytes::from_slice(&env, b"DOGE");
    let result = client.try_get_price(&symbol);
    assert_eq!(result, Err(Ok(PriceFeedError::UnsupportedSymbol)));
}

#[test]
fn test_is_supported_matches_get_price() {
    let (env, client) = setup();
    let supported = Bytes::from_slice(&env, b"XLM");
    let unsupported = Bytes::from_slice(&env, b"DOGE");

    assert!(client.is_supported(&supported));
    assert!(!client.is_supported(&unsupported));
}
