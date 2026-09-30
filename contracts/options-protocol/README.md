# Options Protocol

This Soroban contract supports legacy call/put records plus token-backed,
cash-settled European options. It includes a deterministic Black-Scholes price
and Greeks calculator suitable for Wasm, authenticated price observations, and
a pooled writer margin account.

## Fixed-point convention

All prices, token amounts, rates, volatility, and calculator results use seven
decimal places (`10_000_000 == 1.0`). `time_to_expiry` is expressed in seconds.
Theta is annualized; vega and rho represent a full `1.0` change in volatility
or rate. The calculator validates its domain and uses checked integer math.

## Margin lifecycle

1. Call `initialize`, then have the admin call `configure_margin_pool` once.
2. The configured oracle signs `update_price` observations. Risk and settlement
   reject observations older than `max_price_age`.
3. Writers use `deposit_margin`, then `write_collateralized_option`. The
   contract reserves intrinsic value plus the configured maintenance percentage,
   bounded by the explicitly disclosed `max_payout`; the holder authorizes and
   transfers the premium directly to the writer when the position is created.
4. A keeper calls `check_margin` after price updates. Available pooled funds are
   reserved automatically; otherwise the option enters `MarginCalled`. A writer
   can deposit funds and invoke `cure_margin_call`.
5. At or after expiry, anyone calls `settle_option`. The latest authenticated
   spot price determines intrinsic value, capped by `max_payout`, and settlement
   tokens move directly to the holder. Unused collateral is released.

Soroban contracts do not run background jobs, so “automatic” margin calls use
the standard keeper model: price updates and permissionless checks trigger the
on-chain transition deterministically.

## Compatibility and safety

The original `write_option`, `exercise`, cancellation, and expiry entry points
are retained. Collateralized options reject legacy exercise/expiry/cancellation
paths and must use expiry-only `settle_option`; early cancellation requires both
counterparties through `cancel_collateralized_option`. The settlement token
cannot be changed after pool configuration, withdrawals cannot consume reserved
funds, oracle updates are authenticated, and material transitions emit events.

Run the focused suite from the repository root:

```sh
cargo test -p options-protocol
```
