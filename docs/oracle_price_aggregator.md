# Decentralized Oracle Price Aggregator Specification

Technical design specification for a multi-feed oracle price aggregator with medianizer calculation, staleness threshold checks, and outlier rejection on Stellar Soroban.

---

## 1. Medianizer & Outlier Rejection Algorithm

For an ensemble of $N$ oracle price feeds $P = [p_1, p_2, \dots, p_N]$:

1. **Staleness Filter:** Filter out feeds where $\text{current\_timestamp} - \text{feed\_timestamp} > \text{STALENESS\_THRESHOLD\_SECS}$ (default: 300s).
2. **Median Calculation:** Sort remaining valid price observations:
   $$\text{Aggregated Price} = \text{Median}(P_{\text{valid}})$$

---

## 2. Staleness & Safety Controls

- **Min Active Feeds:** At least 3 valid non-stale oracle feeds required. Throws `Error::InsufficientOracleFeeds` if valid feeds < 3.
- **Max Price Deviation Guard:** Rejects price updates exceeding a 20% variance from previous block median.

---

## References

- Implementation: [`contracts/oracle_aggregator/src/lib.rs`](../contracts/oracle_aggregator/src/lib.rs)
- Issue reference: Fixes #1034
