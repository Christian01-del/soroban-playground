# Perpetual Futures Funding Engine

Soroban vAMM engine that derives the mark price from virtual quote/base
reserves and compares it with an oracle-controlled index price every eight
hours.

## Funding

The per-period rate is the mark/index premium in basis points:

`(mark_price - index_price) * 10_000 / index_price`

Rates are capped to ±100 bps per interval. A positive rate means longs pay
shorts; a negative rate means shorts pay longs. Settlement is permissionless
and stores a cumulative funding index for position-accounting contracts.
Delayed settlement processes at most 21 periods per call, allowing safe,
repeatable catch-up without an unbounded transaction.

## API

- `initialize` sets the admin, oracle, reserves, and initial index price.
- `update_vamm_reserves` derives and records the mark price.
- `update_index_price` records the authenticated oracle price.
- `preview_funding_rate` returns the current capped premium.
- `settle_funding` accrues elapsed eight-hour periods.
- `get_market` and `get_funding` expose current state.

Prices use seven-decimal fixed-point precision (`10_000_000 = 1.0`). Contract
instance storage renews its TTL on every state access.

```sh
cargo test -p soroban-perpetuals
```
