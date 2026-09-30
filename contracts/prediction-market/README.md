# Prediction Market Contract

This Soroban contract supports two API generations:

- The original `create_market`, `place_bet`, `resolve_market`, and
  `calculate_payout` API remains available for existing integrations.
- New collateralized binary and categorical markets provide conditional outcome
  shares, automated liquidity pricing, and challengeable oracle settlement.

## Collateralized markets

Create a binary market with `create_binary_market`, or a market with 2-16 named
outcomes with `create_categorical_market`. Creation transfers
`initial_liquidity` units of the selected Soroban token into the contract. Every
unit of collateral mints one complete set (one share of every outcome), so the
contract remains fully collateralized.

Conditional shares are contract-native ledger balances identified by market,
owner, and outcome. They are not freely transferable. This prevents an external
token contract from minting unbacked claims while keeping settlement operations
constant-time.

### Pricing and liquidity

`buy_shares` deposits collateral, mints a complete set, and trades the unwanted
outcomes into a fixed-product pool. Call `quote_buy` first and pass an acceptable
`min_shares` to protect against slippage. `spot_price` returns the pool's implied
probability in basis points.

Liquidity providers deposit complete sets through `add_liquidity` and receive
proportional liquidity shares. `remove_liquidity` burns those shares and returns
a basket of outcome balances. Equal quantities of every outcome can be burned
with `redeem_complete_set` to recover collateral before an oracle result is
proposed.

All amount arithmetic is checked. Persistent market, balance, and resolution
records renew their Soroban TTL whenever they are used.

### Oracle settlement

1. After `resolution_deadline`, the designated oracle calls
   `propose_resolution`.
2. During `dispute_window`, one challenger may call `dispute_resolution` and
   escrow at least the market's `minimum_dispute_bond` in its collateral token.
   The minimum is one percent of initial liquidity (at least one base unit),
   preventing zero-cost settlement denial.
3. An undisputed proposal can be completed by anyone with
   `finalize_resolution` after the window.
4. If challenged, only `dispute_resolver` can call `resolve_dispute`. An
   overturned result returns the bond to the challenger; an upheld result awards
   it to the oracle.
5. Holders burn winning shares with `redeem_winnings` for one unit of collateral
   per share.

Trading stops at the resolution deadline, and a proposed result freezes
complete-set redemption. Liquidity can still be removed after trading closes so
providers can redeem the final winning portion of their pool basket.

## Development

From the repository root:

```sh
cargo test -p soroban-prediction-market
cargo build -p soroban-prediction-market --target wasm32-unknown-unknown --release
```

The test suite covers the legacy API, binary and three-outcome market creation,
fixed-product quotes, slippage atomicity, liquidity mint/burn behavior,
complete-set redemption, deadline enforcement, undisputed finalization, dispute
overturns, bond awards, and winning-share redemption.
