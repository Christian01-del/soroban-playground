# Algorithmic Stablecoin and Peg Stability Module

This contract retains the original algorithmic stablecoin, transfer, rebase,
pause, and administrative APIs and adds an opt-in collateral-backed PSM.

## PSM

The PSM supports two configured Stellar asset contracts (typically USDC and
USDT). `psm_mint` transfers collateral into the contract and issues stablecoins
at 1:1 less the mint fee. `psm_burn` destroys stablecoins and returns the chosen
collateral at 1:1 less the burn fee.

Fees are charged in basis points, rounded up to prevent fee avoidance through
many small swaps, and capped at 500 bps. Both swap directions accept a minimum
output for slippage protection. The contract separately tracks each collateral
reserve and the stablecoin supply issued through the PSM.

## Administration

- `configure_psm` sets USDC/USDT addresses once, avoiding stranded reserves.
- `set_psm_fees` adjusts mint and burn fees within the 5% cap.
- Existing pause/unpause controls also apply to PSM swaps.
- `get_psm_config`, `get_psm_supply`, and `get_collateral_reserve` expose backing.

All token amounts use the collateral asset's native precision. Deployments
should configure assets with matching decimals.

```sh
cargo test -p stablecoin
```
