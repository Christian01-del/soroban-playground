# Parametric Insurance and Satellite Crop Cover

This Soroban contract provides generic parametric insurance and a production
crop-insurance extension backed by authenticated satellite precipitation from
`contracts/weather-data-oracle`. Existing generic products, policies, direct
oracle readings, and accounting-only payouts remain backward compatible.

## Crop insurance flow

1. The admin calls `configure_reserve` once with the settlement token and funds
   it through `fund_reserve`.
2. `create_crop_product` binds a product to a weather-oracle contract, insured
   region, rainfall threshold/direction, policy term, and observation-age limit.
   Rainfall uses the weather oracle's deterministic unit: millimetres × 10.
3. `buy_crop_policy` transfers the premium and reserves the full coverage amount
   before issuing the policy. Purchases fail atomically when reserves are short.
4. Weather sources submit and confirm records in `weather-data-oracle`.
5. Anyone may call `process_satellite_claim(policy_id, weather_data_id)`. The
   insurance contract fetches the record directly from the configured oracle
   contract and validates provenance, verification status, region, policy
   period, observation age, and trigger threshold.
6. A valid drought or excess-rainfall trigger finalizes the policy, releases its
   liability, and transfers settlement tokens to the farmer in one transaction.

## Oracle requirements

The cross-contract interface matches the repository weather oracle's complete
`WeatherData` encoding. A claim accepts only records that:

- are `Verified` or `Finalized`;
- originated from `DataSourceType::Satellite`;
- have at least one confirmation;
- match the product's exact region identifier;
- were observed after purchase, no later than claim/expiry, and are not stale.

Pending, disputed, ground-station/API, wrong-region, future, pre-policy, and
stale observations are rejected without changing policy or reserve state.

## Solvency and safety

- Every funded crop policy reserves 100% of its coverage.
- Admin withdrawals are limited to the live token balance minus active
  liabilities; collected premiums become withdrawable only when truly excess.
- Claim failure rolls back all state and token changes under Soroban transaction
  semantics.
- Successful claims and expired policies release their liability exactly once.
- Crop policies cannot use the legacy direct-reading claim path, preventing a
  configured satellite contract from being bypassed.
- Reserve-token configuration is immutable after setup.

Run the focused suite from the repository root:

```sh
cargo test -p soroban-parametric-insurance
```
