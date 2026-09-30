# NFT Royalty Standard & Secondary Market Enforcement Specification

Specification for a SEP-aligned Non-Fungible Token royalty enforcement protocol for secondary market sales on Stellar Soroban.

---

## 1. Royalty Split Mechanics

Upon secondary sale transfer at price $P_{\text{sale}}$ with creator royalty rate $\text{royalty\_bps}$:

$$\text{Royalty Amount} = \lfloor \frac{P_{\text{sale}} \times \text{royalty\_bps}}{10,000} \rfloor$$
$$\text{Seller Proceeds} = P_{\text{sale}} - \text{Royalty Amount}$$

- **Max Royalty Cap:** 2,500 BPS (25%).

---

## 2. On-Chain Enforcement Guard

- `transfer_with_royalty(from, to, token_id, sale_price)`: Atomic transfer that enforces simultaneous payment of seller proceeds and creator royalty.

---

## References

- Implementation: [`contracts/nft_royalty/src/lib.rs`](../contracts/nft_royalty/src/lib.rs)
- Issue reference: Fixes #1038
