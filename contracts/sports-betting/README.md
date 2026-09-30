# Sports Betting

A production-oriented Soroban pari-mutuel betting contract with token escrow and
multi-oracle consensual settlement.

## Lifecycle

1. Initialize with an administrator, fee recipient, and fee up to 10%.
2. The administrator registers up to 32 independent oracle addresses.
3. The administrator creates a 2–8 outcome market with betting and settlement deadlines.
4. Bettors stake the configured Stellar token. Odds are derived from live pool balances.
5. After betting closes, each active oracle may submit exactly one result.
6. The first result reaching the market's immutable threshold settles it.
7. Winners pull their proportional share; the fee recipient separately pulls the fee.

If consensus is not reached by the settlement deadline, anyone may cancel the
market and bettors can reclaim each stake. A consensus outcome with no winning
stake also cancels the market, preventing locked funds.

## Security properties

- Stakes are transferred into contract escrow before state is committed.
- Oracle votes are authenticated and duplicate votes are rejected.
- Thresholds are snapshotted per market and bounded by the registered oracle set.
- Checked arithmetic protects pool, fee, odds, and payout calculations.
- Claims use checks-effects-interactions and cannot be replayed.
- Pausing blocks new risk and oracle settlement but never blocks claims/refunds.
- Persistent and instance storage TTLs are renewed during normal use.

Rounding uses integer division. Any sub-unit payout dust remains in escrow; the
fee recipient can claim only the exact recorded fee and cannot sweep bettor funds.
