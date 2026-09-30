# Loan Syndication Contract

This Soroban contract coordinates a fixed-term loan funded by multiple lenders
across senior and junior risk tranches. It escrows a SEP-41-compatible token,
tracks lender positions independently, and settles repayments through a
deterministic senior-first waterfall.

## Risk model

Each loan divides its principal target into:

- **Senior tranche** — lower fixed yield, first priority on repayments and
  recoveries.
- **Junior tranche** — higher fixed yield, paid only after the senior amount due
  is fully allocated. Junior principal and yield therefore absorb defaults
  before senior claims are impaired.

For a 1,000-unit loan with 700 senior at 10% and 300 junior at 20%, the amounts
due are 770 and 360. If only 800 is recovered, the senior tranche receives 770
and the junior tranche receives 30. If only 500 is recovered, senior receives
500 and junior receives zero.

Yields are whole-term fixed yields rather than annualized rates. All division
rounds down to token base units, so proportional multi-lender claims never
exceed the tranche allocation.

## Lifecycle

1. `create_loan` defines the asset, tranche targets, yields, funding deadline,
   maturity, and default grace period.
2. Lenders call `fund` with tranche `0` (senior) or `1` (junior). Funding cannot
   exceed either tranche's exact target.
3. Once both targets are filled, the borrower calls `drawdown`. The contract
   transfers the principal and moves the loan to `Active`.
4. Any authenticated payer may call `repay`. Overpayments are capped at the
   remaining amount due. Full repayment immediately enables claims.
5. After maturity plus grace, anyone may call `mark_default` to freeze a partial
   recovery and enable the loss waterfall.
6. Lenders call `claim` independently. Positions record claimed amounts, making
   settlement idempotent and order-independent.

A borrower or contract admin may call `cancel_loan` before drawdown. Anyone may
call `expire_loan` after the funding deadline. Lenders then recover their funded
principal through `claim_refund`.

## Operational safeguards

- Real token escrow and authenticated transfers.
- Checked integer arithmetic and overflow-resistant proportional calculations.
- Typed composite storage keys for loan/lender/tranche isolation.
- Persistent and instance TTL renewal.
- Reentrancy guard around every external token interaction.
- Admin pause for new loans, funding, and drawdown. Repayment, default marking,
  claims, and refunds remain available while paused so funds cannot be trapped.
- Funding caps, explicit lifecycle transitions, single-use claims, and bounded
  yield/grace parameters.

## Public interface

| Function | Purpose |
| --- | --- |
| `initialize` | Set the contract admin once |
| `pause` / `unpause` | Control new risk creation and drawdown |
| `create_loan` | Define a senior/junior loan syndicate |
| `fund` | Fund one tranche |
| `drawdown` | Transfer a fully funded principal to the borrower |
| `repay` | Service principal and fixed yield |
| `mark_default` | Finalize recovery after maturity and grace |
| `cancel_loan` / `expire_loan` | End an undrawn loan |
| `claim_refund` | Recover funding from a cancelled loan |
| `claim` | Withdraw a proportional waterfall settlement |
| `get_loan` / `get_position` | Read loan and lender state |
| `tranche_summary` | Read tranche funding, yield, due, and allocation |
| `calculate_claim` / `total_due` | Preview settlement values |

## Development

From the repository root:

```sh
cargo test -p soroban-loan-syndication
cargo clippy -p soroban-loan-syndication --tests -- -D warnings
cargo build -p soroban-loan-syndication --target wasm32-unknown-unknown --release
```
