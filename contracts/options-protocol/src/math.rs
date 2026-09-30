// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Deterministic fixed-point Black-Scholes math.

use crate::types::{Error, Greeks, GreeksInput, OptionKind};

pub const SCALE: i128 = 10_000_000;
const SECONDS_PER_YEAR: i128 = 31_557_600;
const LN_2: i128 = 6_931_472;
const INV_SQRT_2_PI: i128 = 3_989_423;
const MAX_EXP_INPUT: i128 = 200_000_000;

fn checked_add(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_add(b).ok_or(Error::MathOverflow)
}

fn checked_sub(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_sub(b).ok_or(Error::MathOverflow)
}

pub fn mul(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_mul(b)
        .and_then(|value| value.checked_div(SCALE))
        .ok_or(Error::MathOverflow)
}

pub fn div(a: i128, b: i128) -> Result<i128, Error> {
    if b == 0 {
        return Err(Error::MathOverflow);
    }
    a.checked_mul(SCALE)
        .and_then(|value| value.checked_div(b))
        .ok_or(Error::MathOverflow)
}

fn integer_sqrt(value: i128) -> Result<i128, Error> {
    if value < 0 {
        return Err(Error::MathOverflow);
    }
    if value < 2 {
        return Ok(value);
    }
    let mut x = value;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + value / x) / 2;
    }
    Ok(x)
}

fn sqrt(value: i128) -> Result<i128, Error> {
    let scaled = value.checked_mul(SCALE).ok_or(Error::MathOverflow)?;
    integer_sqrt(scaled)
}

/// Natural logarithm using range reduction and an atanh series.
fn ln(mut value: i128) -> Result<i128, Error> {
    if value <= 0 {
        return Err(Error::MathOverflow);
    }
    let mut exponent = 0i128;
    while value >= 2 * SCALE {
        value /= 2;
        exponent += 1;
    }
    while value < SCALE {
        value = value.checked_mul(2).ok_or(Error::MathOverflow)?;
        exponent -= 1;
    }

    let z = div(value - SCALE, value + SCALE)?;
    let z2 = mul(z, z)?;
    let mut term = z;
    let mut sum = term;
    for denominator in [3i128, 5, 7, 9, 11, 13] {
        term = mul(term, z2)?;
        sum = checked_add(sum, term / denominator)?;
    }
    checked_add(
        sum.checked_mul(2).ok_or(Error::MathOverflow)?,
        exponent * LN_2,
    )
}

/// Exponential with ln(2) range reduction and a Taylor series.
fn exp(value: i128) -> Result<i128, Error> {
    if !(-MAX_EXP_INPUT..=MAX_EXP_INPUT).contains(&value) {
        return Err(Error::MathOverflow);
    }
    let exponent = value / LN_2;
    let reduced = value - exponent * LN_2;
    let mut sum = SCALE;
    let mut term = SCALE;
    for n in 1i128..=20 {
        term = mul(term, reduced)? / n;
        sum = checked_add(sum, term)?;
    }
    if exponent >= 0 {
        sum.checked_mul(1i128 << exponent as u32)
            .ok_or(Error::MathOverflow)
    } else {
        Ok(sum / (1i128 << (-exponent) as u32))
    }
}

fn normal_pdf(value: i128) -> Result<i128, Error> {
    let squared = mul(value, value)?;
    mul(INV_SQRT_2_PI, exp(-squared / 2)?)
}

/// Standard normal CDF (Abramowitz-Stegun 7.1.26 approximation).
fn normal_cdf(value: i128) -> Result<i128, Error> {
    let x = value.abs();
    let t = div(SCALE, checked_add(SCALE, mul(2_316_419, x)?)?)?;
    let polynomial = mul(
        t,
        checked_add(
            3_193_815,
            mul(
                t,
                checked_add(
                    -3_565_638,
                    mul(
                        t,
                        checked_add(
                            17_814_779,
                            mul(t, checked_add(-18_212_560, mul(t, 13_302_744)?)?)?,
                        )?,
                    )?,
                )?,
            )?,
        )?,
    )?;
    let positive = checked_sub(SCALE, mul(normal_pdf(x)?, polynomial)?)?;
    if value >= 0 {
        Ok(positive)
    } else {
        checked_sub(SCALE, positive)
    }
}

pub fn black_scholes(input: &GreeksInput) -> Result<Greeks, Error> {
    if input.spot_price <= 0 || input.strike_price <= 0 {
        return Err(Error::InvalidPrice);
    }
    if input.volatility <= 0 || input.volatility > 5 * SCALE {
        return Err(Error::InvalidVolatility);
    }
    if input
        .risk_free_rate
        .checked_abs()
        .ok_or(Error::InvalidRate)?
        > 2 * SCALE
    {
        return Err(Error::InvalidRate);
    }
    if input.time_to_expiry == 0 || input.time_to_expiry > 10 * 31_557_600 {
        return Err(Error::InvalidTimeToExpiry);
    }

    let time = (input.time_to_expiry as i128)
        .checked_mul(SCALE)
        .and_then(|value| value.checked_div(SECONDS_PER_YEAR))
        .ok_or(Error::MathOverflow)?;
    let sqrt_time = sqrt(time)?;
    let sigma_sqrt_time = mul(input.volatility, sqrt_time)?;
    let sigma_squared = mul(input.volatility, input.volatility)?;
    let drift = checked_add(input.risk_free_rate, sigma_squared / 2)?;
    let numerator = checked_add(
        ln(div(input.spot_price, input.strike_price)?)?,
        mul(drift, time)?,
    )?;
    let d1 = div(numerator, sigma_sqrt_time)?;
    let d2 = checked_sub(d1, sigma_sqrt_time)?;
    let discount = exp(-mul(input.risk_free_rate, time)?)?;
    let discounted_strike = mul(input.strike_price, discount)?;
    let pdf = normal_pdf(d1)?;

    let (price, delta, theta_rate_leg, rho) = match input.kind {
        OptionKind::Call => {
            let nd1 = normal_cdf(d1)?;
            let nd2 = normal_cdf(d2)?;
            (
                checked_sub(mul(input.spot_price, nd1)?, mul(discounted_strike, nd2)?)?,
                nd1,
                -mul(mul(input.risk_free_rate, discounted_strike)?, nd2)?,
                mul(mul(discounted_strike, time)?, nd2)?,
            )
        }
        OptionKind::Put => {
            let nmd1 = normal_cdf(-d1)?;
            let nmd2 = normal_cdf(-d2)?;
            (
                checked_sub(mul(discounted_strike, nmd2)?, mul(input.spot_price, nmd1)?)?,
                checked_sub(normal_cdf(d1)?, SCALE)?,
                mul(mul(input.risk_free_rate, discounted_strike)?, nmd2)?,
                -mul(mul(discounted_strike, time)?, nmd2)?,
            )
        }
    };

    let diffusion_theta = -div(
        mul(mul(input.spot_price, pdf)?, input.volatility)?,
        2 * sqrt_time,
    )?;
    let gamma_denominator = mul(mul(input.spot_price, input.volatility)?, sqrt_time)?;

    Ok(Greeks {
        price: if price < 0 { 0 } else { price },
        delta,
        gamma: div(pdf, gamma_denominator)?,
        vega: mul(mul(input.spot_price, pdf)?, sqrt_time)?,
        theta: checked_add(diffusion_theta, theta_rate_leg)?,
        rho,
    })
}
