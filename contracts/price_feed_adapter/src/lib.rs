//! Price Feed Adapter contract with robust error handling (#996).
//!
//! Was a "dummy" stub before this change: it targeted `soroban-sdk = "0.10.0"`
//! (every sibling contract in this repo uses `21.0.6`), had no `#[contract]`
//! attribute on the contract struct (required for `#[contractimpl]` to
//! generate a valid contract), and its error type wrapped
//! `soroban_sdk::Error` in a plain Rust enum that isn't a valid Soroban
//! contract error type at all (`#[contracterror]`-derived `u32`-repr enums
//! are the only kind the host ABI accepts as a function's `Result<T, E>`
//! error). None of that compiled.
#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, Bytes, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PriceFeedError {
    /// `symbol` was empty.
    EmptySymbol = 1,
    /// `symbol` isn't one this adapter has a price for.
    UnsupportedSymbol = 2,
}

/// Symbols this dummy adapter can price. A real adapter would look these up
/// from configured feed sources instead of a fixed list.
const SUPPORTED_SYMBOLS: [&[u8]; 3] = [b"XLM", b"USDC", b"BTC"];

#[contract]
pub struct PriceFeedAdapter;

#[contractimpl]
impl PriceFeedAdapter {
    /// Returns a price for `symbol`, scaled to 6 decimals.
    ///
    /// # Errors
    /// - [`PriceFeedError::EmptySymbol`] if `symbol` is empty.
    /// - [`PriceFeedError::UnsupportedSymbol`] if `symbol` isn't recognised.
    pub fn get_price(env: Env, symbol: Bytes) -> Result<i128, PriceFeedError> {
        if symbol.is_empty() {
            return Err(PriceFeedError::EmptySymbol);
        }
        if !Self::is_supported(env.clone(), symbol.clone()) {
            return Err(PriceFeedError::UnsupportedSymbol);
        }

        // Dummy fixed price for illustration purposes (6 decimals).
        Ok(1_000_000)
    }

    /// Whether `symbol` is one this adapter can price.
    pub fn is_supported(env: Env, symbol: Bytes) -> bool {
        SUPPORTED_SYMBOLS
            .iter()
            .any(|s| symbol == Bytes::from_slice(&env, s))
    }
}

#[cfg(test)]
mod test;
