# Multi-Token Liquidity Vault Specification

Technical design specification for a multi-token automated yield rebalancing liquidity vault smart contract on Stellar Soroban.

---

## 1. Automated Rebalancing Algorithm

For a pool holding tokens $T_1, T_2, \dots, T_N$ with target weights $W_1, W_2, \dots, W_N$ where $\sum W_i = 1$:

$$\text{Rebalance Delta}_i = (\text{Total Vault Value} \times W_i) - \text{Current Value}(T_i)$$

- Rebalance triggers when $|\text{Rebalance Delta}_i| > \text{THRESHOLD\_BPS}$ (default 250 BPS).

---

## 2. Yield Strategy Integration

- Automated allocation across money market lending protocols on Stellar Mainnet.

---

## References

- Implementation: [`contracts/liquidity_vault/src/lib.rs`](../contracts/liquidity_vault/src/lib.rs)
- Issue reference: Fixes #1035
