# Dynamic Fee AMM

This Soroban constant-product AMM retains its original fixed-fee API and adds
an opt-in volatility- and utilization-adjusted fee curve. Existing deployments
continue using `FeeBps` unchanged until the pool admin calls
`configure_dynamic_fees`.

## Fee curve

Every quote computes:

```text
utilization = amount_in / (reserve_in + amount_in)
fee = clamp(
  base_fee
  + decayed_volatility * volatility_multiplier
  + utilization * utilization_multiplier,
  min_fee,
  max_fee
)
```

Values are integer basis points (`10_000 == 100%`) with checked arithmetic.
Recent volatility is an exponentially weighted moving average of absolute
canonical pool-price returns. Historical volatility decays linearly to zero
over `volatility_window`, preventing stale market stress from keeping fees high.
All bounds, weights, decay, and the maximum accepted price impact are explicitly
configured and validated on-chain.

`quote_dynamic_swap` returns `amount_out`, effective fee, price impact, decayed
volatility, and utilization. The legacy `get_amount_out` uses the same quote
engine, so previews remain consistent with execution.

## Execution protection

- `swap` preserves the existing signature and `min_out` behavior.
- `swap_with_limits` additionally binds a quote to `max_fee_bps` and a ledger
  timestamp deadline.
- When dynamic fees are enabled, swaps exceeding `max_price_impact_bps` are
  rejected before state changes.
- Actual effective fees, rather than the base fee, are recorded in pool metrics.
- Fee and volatility updates emit Soroban events for monitoring and indexers.

The model is direction-independent: volatility always observes token B per token
A, including swaps whose input is token B. It uses no floating point and performs
all reserve, quote, accumulator, and metric arithmetic with overflow checks.

## Administration

Only the stored pool admin may configure or disable dynamic fees. Disabling the
curve restores the original base fee while retaining observations for monitoring.
Invalid initialization fees, identical pool tokens, invalid curve ranges, and
unsafe weights are rejected.

Run the focused tests from the repository root:

```sh
cargo test -p soroban-amm-pool
```
