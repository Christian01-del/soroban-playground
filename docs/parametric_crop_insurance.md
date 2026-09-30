# Parametric Crop Insurance Smart Contract Specification

Technical specification for automated parametric agricultural insurance payouts triggered by oracle rainfall/temperature feeds on Stellar Soroban.

---

## 1. Parametric Payout Formula

Insurance policy triggers automatic claims if oracle rainfall $R_{\text{actual}}$ falls below drought threshold $R_{\text{min}}$ during coverage window $[T_{\text{start}}, T_{\text{end}}]$:

$$ \text{Payout}(R_{\text{actual}}) = \begin{cases}
\text{Max Coverage Amount} & \text{if } R_{\text{actual}} \le R_{\text{severe}} \\
\lfloor \frac{\text{Max Coverage} \times (R_{\text{min}} - R_{\text{actual}})}{R_{\text{min}} - R_{\text{severe}}} \rfloor & \text{if } R_{\text{severe}} < R_{\text{actual}} < R_{\text{min}} \\
0 & \text{if } R_{\text{actual}} \ge R_{\text{min}}
\end{cases}$$

---

## 2. Oracle Attestation & Verification

- Weather oracle submits signed payload with temperature, precipitation (mm), and grid location.
- Multi-signature verification requires 2 out of 3 independent weather data providers.

---

## References

- Implementation: [`contracts/crop_insurance/src/lib.rs`](../contracts/crop_insurance/src/lib.rs)
- Issue reference: Fixes #1040
$$
