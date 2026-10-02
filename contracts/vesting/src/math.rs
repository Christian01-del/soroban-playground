//! Rounding-exact vesting math.
//!
//! # The dust problem
//!
//! A naive linear schedule computes the vested amount as
//! `floor(total * elapsed / duration)`. Flooring is unavoidable in integer
//! arithmetic, but it is only *harmless* when every consumer derives its value
//! from the same **cumulative** quantity. Two mistakes turn that harmless floor
//! into permanently unreachable tokens:
//!
//! 1. **Per-partition flooring.** If each claim is computed as its own
//!    `floor(total * elapsed_i / duration)` delta, the rounding error of every
//!    partition accumulates and the sum of all claims drifts away from
//!    `total`. Here the curve is always evaluated as a cumulative amount and the
//!    claim is the delta against `released_amount`, so
//!    `sum(claims) == total` exactly, no matter how the schedule is sliced.
//! 2. **Per-milestone flooring.** Flooring each milestone's
//!    `total * bps / 10_000` independently loses up to 1 stroop per milestone.
//!    [`milestone_rewards`] therefore works from the *cumulative* unlocked
//!    basis points, which makes the sum of all milestone payouts exactly
//!    `floor(total * total_bps / 10_000)`.
//!
//! # Precision and overflow
//!
//! All intermediate products are evaluated in `u128`. That is exact — not
//! approximate — as long as the escrowed allocation fits in `u64`, which is
//! what [`MAX_ESCROW_AMOUNT`] enforces at schedule creation:
//! `u64::MAX * u64::MAX = 2^128 - 2^65 + 1 < u128::MAX`. `u64::MAX`
//! stroops (1.8e19) is many orders of magnitude above any realistic token
//! supply, so the bound costs nothing in practice while removing the
//! `total * elapsed` `i128` overflow that used to abort the host mid-curve.

use crate::types::{VestingError, VestingSchedule};

/// Basis-point denominator: `10_000 == 100%`.
pub const BPS_DENOMINATOR: u32 = 10_000;

/// Largest allocation a single schedule may escrow: `u64::MAX` stroops.
///
/// Chosen so that `total_amount * elapsed_seconds` is always representable
/// exactly in `u128`, which makes every division below exact modulo the single
/// final floor.
pub const MAX_ESCROW_AMOUNT: i128 = u64::MAX as i128;

/// `floor(amount * mul / div)` evaluated in `u128`.
///
/// Returns [`VestingError::ArithmeticError`] for a zero divisor or a negative
/// amount. For every in-range input the quotient is `<= amount`, so it always
/// fits back into `i128` without loss.
pub fn mul_div_floor(amount: i128, mul: u64, div: u64) -> Result<i128, VestingError> {
    if div == 0 || amount < 0 {
        return Err(VestingError::ArithmeticError);
    }
    // `amount <= MAX_ESCROW_AMOUNT <= u64::MAX` is enforced at schedule creation
    // and `mul <= u64::MAX`, so this product cannot overflow `u128`.
    let product = amount as u128 * mul as u128;
    // `div >= 1` and `product <= amount * u64::MAX`, so the quotient is `<= amount`
    // when `mul <= div`; in the general case the caller keeps the result bounded
    // with `min(.., total_amount)`.
    let quotient = product / div as u128;
    i128::try_from(quotient).map_err(|_| VestingError::ArithmeticError)
}

/// Validate the creation parameters of a schedule.
///
/// Guarantees, for every schedule the engine will ever evaluate:
/// * `total_amount` is in `1..=MAX_ESCROW_AMOUNT`
/// * `duration > 0`, so the curve denominator can never be zero
/// * `cliff_duration <= duration`, so the cliff never lands after the end
/// * `start_time + cliff_duration` and `start_time + duration` do not overflow
///   `u64`, so no schedule can be created with wrapped timestamps
pub fn validate_schedule(
    total_amount: i128,
    start_time: u64,
    cliff_duration: u64,
    duration: u64,
) -> Result<(), VestingError> {
    if total_amount <= 0 {
        return Err(VestingError::InvalidSchedule);
    }
    if total_amount > MAX_ESCROW_AMOUNT {
        return Err(VestingError::AmountTooLarge);
    }
    if duration == 0 {
        return Err(VestingError::InvalidSchedule);
    }
    if cliff_duration > duration {
        return Err(VestingError::InvalidSchedule);
    }
    if start_time.checked_add(cliff_duration).is_none()
        || start_time.checked_add(duration).is_none()
    {
        return Err(VestingError::InvalidSchedule);
    }
    Ok(())
}

/// Cumulative amount unlocked by the linear curve at `now`.
///
/// Properties relied upon by the whole contract:
///
/// * `vested_linear(t) == 0` for `t < cliff_time`
/// * `vested_linear(t) == total_amount` for `t >= end_time` — **the dust sweep**.
///   This is what guarantees the last claim hands over the residual stroops that
///   intermediate floors left behind, so nothing is ever stranded.
/// * monotonically non-decreasing in `now`
/// * exact: no floating point, no `u128`-truncating intermediate casts
pub fn vested_linear(schedule: &VestingSchedule, now: u64) -> Result<i128, VestingError> {
    if schedule.revoked {
        return Ok(0);
    }
    if now < schedule.cliff_time {
        return Ok(0);
    }
    if now >= schedule.end_time {
        return Ok(schedule.total_amount);
    }

    // `now >= cliff_time >= start_time` and `end_time > start_time` hold by
    // construction, so neither subtraction can underflow.
    let elapsed = now - schedule.start_time;
    let duration = schedule.duration();
    let vested = mul_div_floor(schedule.total_amount, elapsed, duration)?;

    Ok(vested.min(schedule.total_amount))
}

/// Tokens unlocked by milestones at the given **cumulative** unlocked bps.
///
/// Working from cumulative bps rather than summing `floor(total * bps_i / 10_000)`
/// per milestone is what removes milestone rounding dust: the result is
/// `floor(total * total_bps / 10_000)`, so unlocking every milestone whose bps sum
/// to `s` releases exactly `floor(total * s / 10_000)`.
pub fn milestone_rewards(total_amount: i128, unlocked_bps: u32) -> Result<i128, VestingError> {
    mul_div_floor(total_amount, unlocked_bps as u64, BPS_DENOMINATOR as u64)
}

/// Total entitlement at `now`: linear curve plus unlocked milestones, capped by
/// the escrowed allocation.
///
/// The `min(total_amount, ..)` cap is the invariant that makes combining a
/// linear curve with milestones safe: milestones can only *accelerate* the
/// unlock, never overpay. Since `vested_linear(end_time) == total_amount`, the
/// lifetime sum of all claims is exactly `total_amount` in every case.
pub fn vested_total(
    schedule: &VestingSchedule,
    unlocked_bps: u32,
    now: u64,
) -> Result<i128, VestingError> {
    if schedule.revoked || now < schedule.cliff_time {
        return Ok(0);
    }

    let linear = vested_linear(schedule, now)?;
    let boosted = milestone_rewards(schedule.total_amount, unlocked_bps)?;
    let total = linear
        .checked_add(boosted)
        .ok_or(VestingError::ArithmeticError)?;

    Ok(total.min(schedule.total_amount))
}

/// Amount the beneficiary may claim right now, never negative.
pub fn claimable(
    schedule: &VestingSchedule,
    unlocked_bps: u32,
    now: u64,
) -> Result<i128, VestingError> {
    let vested = vested_total(schedule, unlocked_bps, now)?;
    Ok(vested.saturating_sub(schedule.released_amount))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schedule(total: i128, start: u64, cliff: u64, duration: u64) -> VestingSchedule {
        VestingSchedule::try_new(total, start, cliff, duration).expect("valid schedule")
    }

    // ── validate_schedule ───────────────────────────────────────────────────

    #[test]
    fn validate_rejects_bad_parameters() {
        assert_eq!(
            validate_schedule(0, 0, 0, 1),
            Err(VestingError::InvalidSchedule)
        );
        assert_eq!(
            validate_schedule(-1, 0, 0, 1),
            Err(VestingError::InvalidSchedule)
        );
        assert_eq!(
            validate_schedule(1_000, 0, 0, 0),
            Err(VestingError::InvalidSchedule)
        );
        // cliff past the end
        assert_eq!(
            validate_schedule(1_000, 0, 5, 4),
            Err(VestingError::InvalidSchedule)
        );
        // u64 overflow on either addition
        assert_eq!(
            validate_schedule(1_000, u64::MAX - 5, 20, 30),
            Err(VestingError::InvalidSchedule)
        );
        assert_eq!(
            validate_schedule(1_000, u64::MAX, 0, 1),
            Err(VestingError::InvalidSchedule)
        );
    }

    #[test]
    fn validate_accepts_boundary_parameters() {
        assert_eq!(validate_schedule(1, 0, 0, 1), Ok(()));
        assert_eq!(validate_schedule(1_000, 0, 4, 4), Ok(()));
        assert_eq!(validate_schedule(MAX_ESCROW_AMOUNT, 0, 0, u64::MAX), Ok(()));
        assert_eq!(
            validate_schedule(1_000, u64::MAX - 10, 0, 10),
            Ok(()),
            "end_time == u64::MAX must be constructible"
        );
    }

    #[test]
    fn rejects_allocations_above_escrow_bound() {
        assert_eq!(
            validate_schedule(MAX_ESCROW_AMOUNT + 1, 0, 0, 1),
            Err(VestingError::AmountTooLarge)
        );
    }

    // ── mul_div_floor ───────────────────────────────────────────────────────

    #[test]
    fn mul_div_floor_is_exact_for_huge_amounts() {
        // 1e19 * 1.75e19 = 1.75e38 overflows i128 (max 1.70141e38) but is exact in u128.
        let amount = 10_000_000_000_000_000_000i128;
        let mul = 17_500_000_000_000_000_000u64;
        let got = mul_div_floor(amount, mul, 18_000_000_000_000_000_000u64).unwrap();
        let expected = (amount as u128 * mul as u128 / 18_000_000_000_000_000_000u128) as i128;
        assert_eq!(got, expected);
    }

    #[test]
    fn mul_div_floor_is_monotonic_in_the_multiplier() {
        let amount = 123_456_789i128;
        let mut previous = 0;
        for step in 1..=1_000u64 {
            let got = mul_div_floor(amount, step * 1_000_000_000_000, u64::MAX).unwrap();
            assert!(got >= previous);
            previous = got;
        }
        // Equal numerator and denominator is the identity, exactly.
        assert_eq!(mul_div_floor(amount, u64::MAX, u64::MAX), Ok(amount));
        assert_eq!(mul_div_floor(amount, 1, 1), Ok(amount));
        // The multiplier may exceed the divisor: the result is then larger than
        // the amount, but still exact rather than truncated down to it.
        assert_eq!(mul_div_floor(amount, 7, 1), Ok(amount * 7));
    }

    #[test]
    fn mul_div_floor_rejects_unsafe_inputs() {
        assert_eq!(
            mul_div_floor(1_000, 1, 0),
            Err(VestingError::ArithmeticError)
        );
        assert_eq!(
            mul_div_floor(-1_000, 1, 1),
            Err(VestingError::ArithmeticError)
        );
    }

    // ── vested_linear ───────────────────────────────────────────────────────

    #[test]
    fn cliff_gates_all_vesting() {
        let s = schedule(1_000_000, 1_000, 500, 2_000);
        assert_eq!(vested_linear(&s, 0), Ok(0));
        assert_eq!(vested_linear(&s, 999), Ok(0));
        assert_eq!(vested_linear(&s, 1_499), Ok(0));
        // exactly at the cliff the accrued tranche is released
        assert_eq!(vested_linear(&s, 1_500), Ok(250_000));
    }

    #[test]
    fn curve_hits_the_full_allocation_at_the_end() {
        let s = schedule(1_000_000, 1_000, 500, 2_000);
        assert_eq!(vested_linear(&s, 2_999), Ok(999_500));
        assert_eq!(vested_linear(&s, 3_000), Ok(1_000_000));
        assert_eq!(vested_linear(&s, 3_001), Ok(1_000_000));
        assert_eq!(vested_linear(&s, u64::MAX), Ok(1_000_000));
    }

    #[test]
    fn curve_is_monotonic() {
        let s = schedule(1_000_003, 0, 7, 9_973);
        let mut previous = 0;
        for now in 0..12_000u64 {
            let vested = vested_linear(&s, now).unwrap();
            assert!(vested >= previous, "curve dipped at {now}");
            assert!(vested <= s.total_amount, "curve overshot at {now}");
            previous = vested;
        }
        assert_eq!(previous, 1_000_003);
    }

    #[test]
    fn revoked_schedule_never_vests() {
        let mut s = schedule(1_000, 0, 0, 100);
        s.revoked = true;
        assert_eq!(vested_linear(&s, 0), Ok(0));
        assert_eq!(vested_linear(&s, 50), Ok(0));
        assert_eq!(vested_linear(&s, 100), Ok(0));
        assert_eq!(claimable(&s, 0, u64::MAX), Ok(0));
    }

    #[test]
    fn single_token_allocation_never_loses_the_stroop() {
        let s = schedule(1, 0, 0, 3);
        assert_eq!(vested_linear(&s, 0), Ok(0));
        assert_eq!(vested_linear(&s, 1), Ok(0));
        assert_eq!(vested_linear(&s, 2), Ok(0));
        assert_eq!(vested_linear(&s, 3), Ok(1));
    }

    // ── milestone math ──────────────────────────────────────────────────────

    #[test]
    fn cumulative_bps_remove_per_milestone_dust() {
        let total = 1_000_003i128;
        // Three milestones of 3333 bps each: 9999 bps total.
        // Per-milestone flooring yields 3 * floor(33333.00999) = 3 * 33333 = 99999,
        // losing 2 stroops. Cumulative bps yields exactly floor(9999 * 1000003/10000).
        let sum_of_floors = 3 * (total * 3333 / 10_000);
        let cumulative = milestone_rewards(total, 9_999).unwrap();
        assert_eq!(cumulative, total * 9_999 / 10_000);
        assert!(
            cumulative > sum_of_floors,
            "cumulative bps must recover the lost dust: {cumulative} vs {sum_of_floors}"
        );
    }

    #[test]
    fn milestone_rewards_hit_the_full_allocation() {
        let total = 1_000_003i128;
        assert_eq!(milestone_rewards(total, BPS_DENOMINATOR), Ok(total));
        assert_eq!(milestone_rewards(total, 0), Ok(0));
    }

    // ── claimable ───────────────────────────────────────────────────────────

    #[test]
    fn milestones_accelerate_but_never_overpay() {
        let s = schedule(1_000_000, 1_000, 0, 4_000);
        // At the cliff a 25% milestone must already be claimable.
        assert_eq!(claimable(&s, 2_500, 1_000), Ok(250_000));
        // Past the end the cap keeps the payout at the escrowed amount.
        assert_eq!(claimable(&s, 2_500, 4_000), Ok(1_000_000));
        assert_eq!(claimable(&s, BPS_DENOMINATOR, u64::MAX), Ok(1_000_000));
    }

    #[test]
    fn milestones_are_cliff_gated() {
        // 50% of the 1_000_000 allocation is already vested at the cliff, and the
        // 5_000 bps milestone adds another 500_000 on top.
        let s = schedule(1_000_000, 1_000, 500, 2_000);
        assert_eq!(claimable(&s, 5_000, 1_499), Ok(0));
        assert_eq!(claimable(&s, 5_000, 1_500), Ok(750_000));
    }

    #[test]
    fn claimable_is_zero_once_fully_paid() {
        let mut s = schedule(1_000_000, 0, 0, 1_000);
        s.released_amount = 1_000_000;
        assert_eq!(claimable(&s, 0, 1_000), Ok(0));
        assert_eq!(claimable(&s, 0, u64::MAX), Ok(0));
    }

    /// The core property behind #1356: however a schedule is sliced, the claims
    /// sum to exactly the escrowed allocation — no dust is ever stranded.
    #[test]
    fn every_partition_of_the_curve_sums_to_the_total() {
        for total in [1i128, 2, 7, 99, 1_000_003, 12_345_678_901] {
            for duration in [1u64, 2, 3, 7, 100, 999] {
                let mut s = schedule(total, 0, 0, duration);
                let mut claimed = 0i128;
                for now in 0..=duration {
                    let amount = claimable(&s, 0, now).unwrap();
                    assert!(amount >= 0, "negative claim for total {total}");
                    s.released_amount += amount;
                    claimed += amount;
                }
                assert_eq!(claimed, total, "dust stranded for {total}/{duration}");
                assert_eq!(s.outstanding(), 0);
            }
        }
    }
}
