# Gas-Optimized Token Vesting Engine Specification

Technical design document for a gas-optimized token vesting schedule contract with cliff periods, linear unlock schedules, and milestone-based claim execution on Stellar Soroban.

---

## 1. Vesting Math & Linear Unlock Formula

For a given vesting schedule with total allocation $A$, start ledger $L_{\text{start}}$, cliff ledger $L_{\text{cliff}}$, and end ledger $L_{\text{end}}$:

$$ \text{Vested Amount}(L) = \begin{cases}
0 & \text{if } L < L_{\text{cliff}} \\
A & \text{if } L \ge L_{\text{end}} \\
\lfloor \frac{A \times (L - L_{\text{start}})}{L_{\text{end}} - L_{\text{start}}} \rfloor & \text{if } L_{\text{cliff}} \le L < L_{\text{end}}
\end{cases}$$

---

## 2. Milestone-Based Unlocks

In addition to linear time-based vesting, schedule creators can append discrete milestone vectors:

$$\text{Claimable Amount}(L) = \text{Vested Amount}(L) + \sum_{\text{completed } M_j} \text{Milestone\_Reward}_j - \text{Total\_Claimed}$$

---

## 3. Storage & Gas Optimization Patterns

- **Packed Instance Layout:** Schedule metadata packed into single vector entries to minimize storage read bytes (~300 bytes per schedule).
- **TTL Auto-Bump:** Every claim extends schedule persistent storage TTL by 30 days.

---

## References

- Implementation: [`contracts/vesting_engine/src/lib.rs`](../contracts/vesting_engine/src/lib.rs)
- Issue reference: Fixes #1037
$$
