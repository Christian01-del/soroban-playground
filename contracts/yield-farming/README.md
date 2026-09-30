# Yield Farming Aggregator

A Soroban smart contract that aggregates yield strategies with auto-compounding, strategy optimization, and portfolio tracking.

## Features

- **Strategy management** — admin registers strategies with a name and APY (in basis points).
- **Deposits / Withdrawals** — users deposit into any active strategy; withdrawals trigger a compound first.
- **Auto-compounding** — rewards accrue pro-rata over time and are reinvested into the principal. Anyone (e.g. a keeper bot) can trigger `compound` on behalf of a user.
- **Strategy optimization** — admin can update APY or pause/resume strategies at any time.
- **Portfolio tracking** — per-user `Position` records deposited amount, compounded balance, and last-update timestamp across multiple strategies.
- **Dynamic APY** — optional annual reward emissions derive fee-adjusted APY from projected pool TVL while legacy pools continue using quoted APY.
- **Capacity-aware allocation** — active pools are weighted by fee-adjusted yield and risk, then constrained by pool capacity and per-pool portfolio limits.
- **Multi-pool rebalancing** — users can compound and atomically redistribute their complete portfolio into optimizer targets.

## Contract Interface

| Function                                  | Description                                       |
| ----------------------------------------- | ------------------------------------------------- |
| `initialize(admin)`                       | One-time setup                                    |
| `add_strategy(admin, name, apy_bps)`      | Register a new strategy                           |
| `update_strategy_apy(admin, id, apy_bps)` | Change a strategy's APY                           |
| `set_strategy_active(admin, id, active)`  | Pause / resume a strategy                         |
| `deposit(user, strategy_id, amount)`      | Deposit into a strategy                           |
| `withdraw(user, strategy_id, amount)`     | Withdraw from a strategy                          |
| `compound(user, strategy_id)`             | Trigger auto-compound for a user                  |
| `compound_all(user)`                      | Compound all of a user's pool positions           |
| `configure_pool(admin, id, ...)`          | Set emissions, capacity, fee, risk, and max weight|
| `dynamic_apy(id, additional_amount)`      | Preview APY at projected TVL                      |
| `optimize_allocation(amount, max_risk)`   | Calculate capacity-aware multi-pool targets       |
| `rebalance(user, max_risk)`               | Atomically optimize a user's complete portfolio   |
| `get_strategy(id)`                        | Read strategy details                             |
| `get_position(user, id)`                  | Read user position (with live compounded balance) |
| `list_strategies()`                       | List all strategy IDs                             |
| `strategy_count()`                        | Total number of strategies                        |

## Optimizer model

Optimizer settings are stored separately from legacy `Strategy` and `Position`
records, preserving their serialized representation. If `annual_rewards` is
zero, dynamic APY falls back to the strategy's quoted APY. Otherwise gross APY
is `annual_rewards * 10_000 / projected_tvl`, capped at 100%, and the configured
performance fee is deducted. Allocation scores apply the configured risk score,
while capacity and maximum portfolio weight are hard constraints. Returned
amounts always sum to the requested total or the call fails without state changes.

## Build & Test

```bash
cd contracts/yield-farming
cargo test
cargo build --target wasm32-unknown-unknown --release
```
