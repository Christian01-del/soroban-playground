# Gas-Optimized Token Vesting Engine Specification

Technical design document for a gas-optimized token vesting schedule contract with cliff periods, linear unlock schedules, and milestone-based claim execution on Stellar Soroban.

- Implementation: [`contracts/vesting/src/lib.rs`](../contracts/vesting/src/lib.rs)
- Issue reference: Fixes #1356

---

## 1. Vesting Math & Linear Unlock Formula

For a given vesting schedule with total allocation $A$, start ledger $L_{\text{start}}$, cliff ledger $L_{\text{cliff}}$, and end ledger $L_{\text{end}}$:

$$ \text{Vested Amount}(L) = \begin{cases}
0 & \text{if } L < L_{\text{cliff}} \\
A & \text{if } L \ge L_{\text{end}} \\
\left\lfloor \frac{A \times (L - L_{\text{start}})}{L_{\text{end}} - L_{\text{start}}} \right\rfloor & \text{if } L_{\text{cliff}} \le L < L_{\text{end}}
\end{cases}$$

### 1.1 Exactness requirements

The floor above is only safe because of three properties, all enforced in
`contracts/vesting/src/math.rs`:

1. **The curve is cumulative.** `Vested Amount` is always derived from the total
   allocation and the elapsed time; a claim is the *delta* against
   `released_amount`. Partitioning the curve into claims therefore cannot
   accumulate rounding error:

   $$\sum_{i} \left( V(L_i) - V(L_{i-1}) \right) = V(L_n) = A$$

   The `$L \ge L_{\text{end}}$ branch is the **dust sweep**: it hands over the
   residual stroops that intermediate floors left behind, so the last claim
   always closes the schedule out exactly.

2. **Intermediate products are exact.** The numerator $A \times (L - L_{\text{start}})$
   is evaluated in `u128`. It fits exactly as long as $A \le 2^{64}$, which is what
   `MAX_ESCROW_AMOUNT = u64::MAX` enforces at schedule creation, since
   $(2^{64}-1)^2 < 2^{128}-1$. The previous `i128` evaluation overflowed and aborted
   the host for allocations above roughly $9.2 \times 10^{18}$.

3. **Timestamps cannot wrap.** `start_time + cliff_duration` and
   `start_time + duration` are `checked_add`ed, so no schedule can be created with
   wrapped timestamps (which previously passed validation in debug builds and
   panicked in release builds, where `overflow-checks` is enabled).

---

## 2. Milestone-Based Unlocks

In addition to linear time-based vesting, schedule creators can append discrete milestone vectors. A milestone is worth `percent_bps` basis points of the allocation (`1000 == 10%`), and milestone ids are registered contiguously from `0`.

$$\text{Claimable Amount}(L) = \min\left(A,\; \text{Vested Amount}(L) + \sum_{\text{completed } M_j} \text{Milestone\_Reward}_j\right) - \text{Total\_Claimed}$$

with

$$\text{Milestone\_Reward} = \left\lfloor \frac{A \times S}{10\,000} \right\rfloor \quad\text{where } S = \sum_{\text{completed } M_j} \text{percent\_bps}_j$$

Three rules make the combined accounting safe:

- **Cumulative basis points.** The reward is computed from the *running total* of
  unlocked bps, not as a sum of per-milestone floors, so unlocking every milestone
  releases exactly $\lfloor A \cdot S / 10\,000 \rfloor$ and the per-milestone
  rounding dust cancels instead of accumulating.
- **Capped at the escrow.** The $\min(A, \cdot)$ term means milestones can only
  *accelerate* the linear curve — they can never raise the lifetime payout above
  the escrowed allocation, and since $\text{Vested Amount}(L_{\text{end}}) = A$ the
  lifetime total is always exactly $A$.
- **Cliff-gated.** No milestone reward is claimable before $L_{\text{cliff}}$, even
  if the milestone was unlocked earlier. This keeps the cliff a hard floor for the
  whole schedule and is what makes pre-cliff revocation safe.

The cumulative *allocation* of all registered milestones, locked or unlocked, may
not exceed $10\,000$ bps, and a milestone id may only be defined once (redefining
it would reset `unlocked` and allow a replayed payout).

---

## 3. Cliff Revocation Safeguards

`revoke_before_cliff(beneficiary)` is the only way escrowed tokens leave the
contract before vesting. It is rejected — with a typed error, never a panic — when:

| Condition | Error |
| --- | --- |
| caller is not the admin | auth failure |
| `now >= cliff_time` | `CliffReached` |
| `released_amount != 0` | `ScheduleActive` |
| schedule already revoked | `ScheduleRevoked` |
| no schedule for the beneficiary | `NoVestingSchedule` |

Because nothing at all is claimable before the cliff, the refunded amount is
exactly `total_amount` and can only ever be tokens the beneficiary was never
entitled to. After the cliff the schedule is permanently non-revocable, so the
admin can never claw back a vested claim. Revocation leaves a tombstone with
`revoked == true`, purges every milestone, and keeps the beneficiary slot
occupied so a cancelled allocation cannot be silently re-created.

---

## 4. Storage & Gas Optimization Patterns

- **Packed Instance Layout:** Schedule metadata packed into a single `#[contracttype]` entry to minimize storage read bytes per schedule.
- **TTL Auto-Bump:** Every read or write of a schedule or milestone extends its persistent TTL by 30 days, and every state-touching entrypoint bumps the instance TTL.
- **Bounded milestone scans:** Milestone ids are contiguous from `0`, so the per-schedule scans in `claim`, `revoke_before_cliff` and the views are bounded by the number of real milestones rather than by attacker-supplied ids.

---

## References

- Implementation: [`contracts/vesting/src/lib.rs`](../contracts/vesting/src/lib.rs)
- Vesting math: [`contracts/vesting/src/math.rs`](../contracts/vesting/src/math.rs)
- Tests: [`contracts/vesting/src/test.rs`](../contracts/vesting/src/test.rs)
- Issue reference: Fixes #1356
