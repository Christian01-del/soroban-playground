# Dutch Auction Smart Contract Specification

Technical design document for a Dutch Auction contract on Stellar Soroban with dynamic linear price decay from a starting price $P_{\text{start}}$ to a floor price $P_{\text{floor}}$.

---

## 1. Linear Price Decay Math

For an auction running from start timestamp $T_{\text{start}}$ to end timestamp $T_{\text{end}}$:

$$ P(t) = \begin{cases}
P_{\text{start}} & \text{if } t \le T_{\text{start}} \\
P_{\text{floor}} & \text{if } t \ge T_{\text{end}} \\
P_{\text{start}} - \lfloor \frac{(P_{\text{start}} - P_{\text{floor}}) \times (t - T_{\text{start}})}{T_{\text{end}} - T_{\text{start}}} \rfloor & \text{if } T_{\text{start}} < t < T_{\text{end}}
\end{cases}$$

---

## 2. Bid Execution & Settlement

1. **`buy(buyer, amount)`**: Accepts payment if $\text{payment} \ge P(t) \times \text{amount}$.
2. Excess payment is refunded immediately to buyer.
3. Auction terminates when total asset inventory reaches zero.

---

## References

- Implementation: [`contracts/dutch_auction/src/lib.rs`](../contracts/dutch_auction/src/lib.rs)
- Issue reference: Fixes #1041
$$
