# Liquid Staking Derivatives

Soroban accounting engine for an underlying staking token and internal LSD
shares. Deposits mint shares at the current pool exchange rate. The configured
admin reports validator rewards by transferring the same amount of underlying
into the contract, so every exchange-rate increase is fully backed.

## Accounting

`exchange_rate = total_active_underlying * 10_000_000 / total_shares`

All conversions round down. A final full-share exit receives all remaining
active underlying to prevent stranded rounding dust. Requested withdrawals are
removed from active stake and tracked in `total_pending`, so later rewards do
not change an already queued withdrawal.

## Main operations

- `initialize(admin, underlying, unbonding_period)` configures the contract once.
- `deposit(user, amount)` transfers underlying and returns minted shares.
- `accrue_rewards(admin, amount)` funds validator rewards and returns the new rate.
- `request_unstake(user, shares)` burns shares and returns a global queue ID.
- `claim_unstake(user, request_id)` transfers underlying after maturity.
- `exchange_rate`, conversion helpers, `share_balance`, `get_request`, and
  `totals` expose the accounting state.

Amounts use the underlying token's native precision; the unbonding period uses
ledger timestamps in seconds. Persistent balances and queue entries, plus the
contract instance, extend their storage TTL whenever accessed.

Run tests from the repository root with:

```sh
cargo test -p soroban-staking-derivatives
```
