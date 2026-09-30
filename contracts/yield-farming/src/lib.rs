// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Yield Farming Strategy Optimizer with Multi-Pool Rebalancing
//!
//! ## Issue #1295 — Dynamic APY Calculations & Auto-Compounding for Liquidity Vault Tokens
//!
//! This contract implements a production-grade yield farming aggregator with:
//!
//! ### Auto-Compounding
//! - `compound(user, strategy_id)` — compound a single position (keeper-callable)
//! - `compound_all(user)` — compound all positions in one transaction
//! - `deposit(user, strategy_id, amount)` — automatically compounds before deposit
//! - `withdraw(user, strategy_id, amount)` — automatically compounds before withdrawal
//!
//! ### Dynamic APY Calculation
//! - `dynamic_apy(strategy_id, additional_amount)` — fee-adjusted, TVL-aware APY
//!   at any hypothetical deposit size.  Pools with `annual_rewards > 0` use
//!   emissions-based APY (`rewards / projected_TVL`); legacy pools use their
//!   administrator-supplied APY.
//! - `get_optimization_preview(total_amount, max_risk)` — read-only dry-run of
//!   the optimizer that returns expected allocations and weighted APY without
//!   modifying state.
//!
//! ### Multi-Pool Rebalancing
//! - `optimize_allocation(total_amount, max_risk_score)` — risk- and capacity-
//!   aware allocation targets across all active pools.
//! - `rebalance(user, max_risk_score)` — atomic compound-and-redistribute:
//!   compounds all user positions, then moves capital to the highest-scoring
//!   allocation. Reverts if the new portfolio does not improve weighted APY.
//! - `auto_rebalance_threshold(user, max_risk_score, min_improvement_bps)` —
//!   keeper-friendly: only rebalances if the improvement exceeds the caller's
//!   configured threshold.
//!
//! ### Pool Configuration
//! - `configure_pool(admin, strategy_id, annual_rewards, capacity, fee_bps,
//!                   risk_score, max_allocation_bps)` — optimizer metadata per pool.
//!
//! ### Strategy Management (admin-only)
//! - `add_strategy`, `update_strategy_apy`, `set_strategy_active`

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_pool_config, get_position, get_strategy, get_strategy_count, has_position,
    has_strategy, is_initialized, remove_position, set_admin, set_pool_config, set_position,
    set_strategy, set_strategy_count,
};
use crate::types::{Allocation, Error, PoolConfig, Position, RebalanceResult, Strategy};

/// Seconds in a year — used for pro-rata reward accrual.
const SECONDS_PER_YEAR: u64 = 31_536_000;
/// Basis points denominator (10_000 bps = 100%).
const BPS_DENOM: u32 = 10_000;
/// Maximum allowed APY in basis points (10_000 = 100%).
const MAX_APY_BPS: u32 = 10_000;
/// Maximum risk score accepted by the optimizer.
const MAX_RISK_SCORE: u32 = 100;

#[contract]
pub struct YieldFarmingContract;

#[contractimpl]
impl YieldFarmingContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_strategy_count(&env, 0);
        Ok(())
    }

    // ── Strategy management (admin only) ──────────────────────────────────────

    /// Register a new yield strategy. Returns the new strategy ID.
    pub fn add_strategy(
        env: Env,
        admin: Address,
        name: String,
        apy_bps: u32,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }

        let id = get_strategy_count(&env) + 1;
        let strategy = Strategy {
            name,
            apy_bps,
            total_deposited: 0,
            is_active: true,
            pending_rewards: 0,
            last_compound_ts: env.ledger().timestamp(),
        };
        set_strategy(&env, id, &strategy);
        set_strategy_count(&env, id);

        env.events()
            .publish((symbol_short!("strat_add"), id), apy_bps);

        Ok(id)
    }

    /// Update the APY of an existing strategy.
    pub fn update_strategy_apy(
        env: Env,
        admin: Address,
        strategy_id: u32,
        new_apy_bps: u32,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if new_apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        let mut strategy = get_strategy(&env, strategy_id)?;
        strategy.apy_bps = new_apy_bps;
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("apy_upd"), strategy_id), new_apy_bps);

        Ok(())
    }

    /// Pause or resume a strategy.
    pub fn set_strategy_active(
        env: Env,
        admin: Address,
        strategy_id: u32,
        is_active: bool,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut strategy = get_strategy(&env, strategy_id)?;
        strategy.is_active = is_active;
        set_strategy(&env, strategy_id, &strategy);
        Ok(())
    }

    /// Configure a strategy for dynamic APY calculation and portfolio optimization.
    ///
    /// `annual_rewards` models fixed yearly liquidity-mining emissions, allowing
    /// APY to change as pool TVL changes. Set it to zero to retain the strategy's
    /// quoted APY. A zero `capacity` means unlimited capacity.
    pub fn configure_pool(
        env: Env,
        admin: Address,
        strategy_id: u32,
        annual_rewards: i128,
        capacity: i128,
        fee_bps: u32,
        risk_score: u32,
        max_allocation_bps: u32,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        get_strategy(&env, strategy_id)?;
        if annual_rewards < 0 || capacity < 0 {
            return Err(Error::InvalidPoolConfig);
        }
        if fee_bps > BPS_DENOM || max_allocation_bps == 0 || max_allocation_bps > BPS_DENOM {
            return Err(Error::InvalidBasisPoints);
        }
        if risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRiskScore);
        }

        let config = PoolConfig {
            annual_rewards,
            capacity,
            fee_bps,
            risk_score,
            max_allocation_bps,
        };
        set_pool_config(&env, strategy_id, &config);
        env.events()
            .publish((symbol_short!("pool_cfg"), strategy_id), config);
        Ok(())
    }

    // ── User actions ──────────────────────────────────────────────────────────

    /// Deposit `amount` into a strategy.
    pub fn deposit(env: Env, user: Address, strategy_id: u32, amount: i128) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut strategy = get_strategy(&env, strategy_id)?;
        if !strategy.is_active {
            return Err(Error::StrategyPaused);
        }

        let now = env.ledger().timestamp();

        let mut accrued_reward = 0i128;
        let mut position = if has_position(&env, strategy_id, &user) {
            // Auto-compound existing position before adding new funds
            let pos = get_position(&env, strategy_id, &user)?;
            let previous_balance = pos.compounded_balance;
            let compounded = Self::compound_position(pos, &strategy, now);
            accrued_reward = compounded
                .compounded_balance
                .saturating_sub(previous_balance);
            compounded
        } else {
            Position {
                deposited: 0,
                compounded_balance: 0,
                last_update_ts: now,
            }
        };

        position.deposited += amount;
        position.compounded_balance += amount;
        position.last_update_ts = now;

        strategy.total_deposited = strategy
            .total_deposited
            .checked_add(accrued_reward)
            .and_then(|total| total.checked_add(amount))
            .ok_or(Error::ArithmeticOverflow)?;

        set_position(&env, strategy_id, &user, &position);
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("deposit"), strategy_id), (user, amount));

        Ok(())
    }

    /// Withdraw `amount` from a strategy (withdraws from compounded balance).
    pub fn withdraw(
        env: Env,
        user: Address,
        strategy_id: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut strategy = get_strategy(&env, strategy_id)?;
        let now = env.ledger().timestamp();

        let mut position = get_position(&env, strategy_id, &user)?;
        let previous_balance = position.compounded_balance;
        // Compound before withdrawal so user gets latest rewards
        position = Self::compound_position(position, &strategy, now);
        let accrued_reward = position.compounded_balance.saturating_sub(previous_balance);

        if amount > position.compounded_balance {
            return Err(Error::InsufficientBalance);
        }

        position.compounded_balance -= amount;
        // Reduce deposited proportionally (can't go below 0)
        let deposited_reduction = amount.min(position.deposited);
        position.deposited -= deposited_reduction;
        position.last_update_ts = now;

        strategy.total_deposited = strategy
            .total_deposited
            .checked_add(accrued_reward)
            .ok_or(Error::ArithmeticOverflow)?;
        let tvl_reduction = amount.min(strategy.total_deposited);
        strategy.total_deposited -= tvl_reduction;

        if position.compounded_balance == 0 {
            remove_position(&env, strategy_id, &user);
        } else {
            set_position(&env, strategy_id, &user, &position);
        }
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("withdraw"), strategy_id), (user, amount));

        Ok(amount)
    }

    /// Trigger auto-compounding for a user's position in a strategy.
    /// Anyone can call this (e.g. a keeper bot), but only the user's position is updated.
    pub fn compound(env: Env, user: Address, strategy_id: u32) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;

        let mut strategy = get_strategy(&env, strategy_id)?;
        let now = env.ledger().timestamp();

        let position = get_position(&env, strategy_id, &user)?;
        let previous_balance = position.compounded_balance;
        let compounded = Self::compound_position(position, &strategy, now);
        let new_balance = compounded.compounded_balance;
        let reward = new_balance.saturating_sub(previous_balance);

        set_position(&env, strategy_id, &user, &compounded);
        strategy.total_deposited = strategy.total_deposited.saturating_add(reward);
        strategy.last_compound_ts = now;
        set_strategy(&env, strategy_id, &strategy);

        env.events().publish(
            (symbol_short!("compound"), strategy_id),
            (user, new_balance),
        );

        Ok(new_balance)
    }

    /// Compound every position held by `user` in a single bounded transaction.
    ///
    /// This keeper-friendly operation requires no user authorization because it
    /// can only increase the user's balances. It returns total rewards reinvested.
    pub fn compound_all(env: Env, user: Address) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        let now = env.ledger().timestamp();
        let mut total_reward = 0i128;
        let mut found = false;

        for strategy_id in 1..=get_strategy_count(&env) {
            if !has_position(&env, strategy_id, &user) {
                continue;
            }
            found = true;
            let mut strategy = get_strategy(&env, strategy_id)?;
            let position = get_position(&env, strategy_id, &user)?;
            let previous_balance = position.compounded_balance;
            let compounded = Self::compound_position(position, &strategy, now);
            let reward = compounded
                .compounded_balance
                .saturating_sub(previous_balance);
            total_reward = total_reward
                .checked_add(reward)
                .ok_or(Error::ArithmeticOverflow)?;
            strategy.total_deposited = strategy
                .total_deposited
                .checked_add(reward)
                .ok_or(Error::ArithmeticOverflow)?;
            strategy.last_compound_ts = now;
            set_position(&env, strategy_id, &user, &compounded);
            set_strategy(&env, strategy_id, &strategy);
        }
        if !found {
            return Err(Error::NoPosition);
        }

        env.events()
            .publish((symbol_short!("comp_all"),), (user, total_reward));
        Ok(total_reward)
    }

    /// Calculate fee-adjusted APY for a pool after adding `additional_amount`.
    ///
    /// Pools configured with annual emissions use `rewards / projected TVL`;
    /// legacy pools continue to use their administrator-supplied APY.
    pub fn dynamic_apy(env: Env, strategy_id: u32, additional_amount: i128) -> Result<u32, Error> {
        if additional_amount < 0 {
            return Err(Error::InvalidPoolConfig);
        }
        let strategy = get_strategy(&env, strategy_id)?;
        let config = Self::pool_config_or_default(&env, strategy_id);
        let projected_tvl = strategy
            .total_deposited
            .checked_add(additional_amount)
            .ok_or(Error::ArithmeticOverflow)?;
        if config.capacity > 0 && projected_tvl > config.capacity {
            return Err(Error::InsufficientCapacity);
        }
        Self::calculate_dynamic_apy(&strategy, &config, projected_tvl)
    }

    /// Return capacity- and risk-aware targets for new capital across active pools.
    pub fn optimize_allocation(
        env: Env,
        total_amount: i128,
        max_risk_score: u32,
    ) -> Result<Vec<Allocation>, Error> {
        Self::build_allocation(&env, total_amount, max_risk_score, None)
    }

    /// **Read-only dry-run** of the multi-pool optimizer.
    ///
    /// Returns the same [`Vec<Allocation>`] that `rebalance` would write, plus
    /// the weighted projected APY (in bps) for the proposed portfolio.  No
    /// storage is modified.
    ///
    /// Useful for frontend "what-if" previews before committing a rebalance.
    ///
    /// # Arguments
    /// * `total_amount`    — capital to allocate (same unit as deposit amounts)
    /// * `max_risk_score`  — upper bound on pool risk_score (0–100)
    ///
    /// # Returns
    /// `(allocations, weighted_apy_bps)`
    pub fn get_optimization_preview(
        env: Env,
        total_amount: i128,
        max_risk_score: u32,
    ) -> Result<(Vec<Allocation>, u32), Error> {
        let allocations = Self::build_allocation(&env, total_amount, max_risk_score, None)?;

        // Compute portfolio-weighted APY from the proposed allocations
        let mut weighted_yield = 0i128;
        for alloc in allocations.iter() {
            weighted_yield = weighted_yield
                .checked_add(
                    alloc
                        .amount
                        .checked_mul(alloc.projected_apy_bps as i128)
                        .ok_or(Error::ArithmeticOverflow)?,
                )
                .ok_or(Error::ArithmeticOverflow)?;
        }
        let weighted_apy_bps = if total_amount > 0 {
            (weighted_yield / total_amount) as u32
        } else {
            0
        };

        Ok((allocations, weighted_apy_bps))
    }

    /// **Threshold-gated rebalance** — keeper-friendly variant that only
    /// executes the rebalance if the projected improvement in weighted APY
    /// meets or exceeds `min_improvement_bps`.
    ///
    /// Unlike `rebalance`, this function does **not** revert when APY would
    /// not improve; it returns `false` to signal a no-op, allowing callers
    /// (e.g. a cron keeper) to cheaply check without paying revert costs.
    ///
    /// # Arguments
    /// * `user`                — position owner (must authorize)
    /// * `max_risk_score`      — passed through to the optimizer (0–100)
    /// * `min_improvement_bps` — minimum APY improvement required (e.g. 50 = 0.50 %)
    ///
    /// # Returns
    /// `true`  — rebalance executed (improvement ≥ threshold).
    /// `false` — rebalance skipped (improvement below threshold or no positions).
    pub fn auto_rebalance_threshold(
        env: Env,
        user: Address,
        max_risk_score: u32,
        min_improvement_bps: u32,
    ) -> Result<bool, Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();
        if max_risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRiskScore);
        }

        // Compute current portfolio total and weighted APY
        let now = env.ledger().timestamp();
        let count = get_strategy_count(&env);
        let mut total_balance = 0i128;
        let mut current_weighted_yield = 0i128;
        let mut found = false;

        for strategy_id in 1..=count {
            if !has_position(&env, strategy_id, &user) {
                continue;
            }
            found = true;
            let strategy = get_strategy(&env, strategy_id)?;
            let position =
                Self::compound_position(get_position(&env, strategy_id, &user)?, &strategy, now);
            let config = Self::pool_config_or_default(&env, strategy_id);
            let apy = Self::calculate_dynamic_apy(&strategy, &config, strategy.total_deposited)?;
            total_balance = total_balance
                .checked_add(position.compounded_balance)
                .ok_or(Error::ArithmeticOverflow)?;
            current_weighted_yield = current_weighted_yield
                .checked_add(
                    position
                        .compounded_balance
                        .checked_mul(apy as i128)
                        .ok_or(Error::ArithmeticOverflow)?,
                )
                .ok_or(Error::ArithmeticOverflow)?;
        }

        if !found || total_balance <= 0 {
            return Ok(false);
        }

        let current_weighted_apy = (current_weighted_yield / total_balance) as u32;

        // Preview the proposed allocation
        let (_, proposed_apy) =
            Self::get_optimization_preview(env.clone(), total_balance, max_risk_score)?;

        // Check improvement threshold
        let improvement = proposed_apy.saturating_sub(current_weighted_apy);
        if improvement < min_improvement_bps {
            return Ok(false);
        }

        // Threshold met — execute the full rebalance
        YieldFarmingContract::rebalance(env, user, max_risk_score)?;
        Ok(true)
    }

    /// Atomically compound and redistribute all of a user's positions across
    /// the optimal active pools. Existing positions are removed only after a
    /// complete feasible allocation has been calculated.
    pub fn rebalance(
        env: Env,
        user: Address,
        max_risk_score: u32,
    ) -> Result<RebalanceResult, Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();
        if max_risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRiskScore);
        }

        let now = env.ledger().timestamp();
        let count = get_strategy_count(&env);
        let mut total_balance = 0i128;
        let mut previous_weighted_yield = 0i128;
        let mut found = false;

        for strategy_id in 1..=count {
            if !has_position(&env, strategy_id, &user) {
                continue;
            }
            found = true;
            let strategy = get_strategy(&env, strategy_id)?;
            let position =
                Self::compound_position(get_position(&env, strategy_id, &user)?, &strategy, now);
            let config = Self::pool_config_or_default(&env, strategy_id);
            let apy = Self::calculate_dynamic_apy(&strategy, &config, strategy.total_deposited)?;
            total_balance = total_balance
                .checked_add(position.compounded_balance)
                .ok_or(Error::ArithmeticOverflow)?;
            previous_weighted_yield = previous_weighted_yield
                .checked_add(
                    position
                        .compounded_balance
                        .checked_mul(apy as i128)
                        .ok_or(Error::ArithmeticOverflow)?,
                )
                .ok_or(Error::ArithmeticOverflow)?;
        }
        if !found || total_balance <= 0 {
            return Err(Error::NoPosition);
        }

        let allocations = Self::build_allocation(&env, total_balance, max_risk_score, Some(&user))?;
        let previous_weighted_apy_bps = (previous_weighted_yield / total_balance) as u32;
        let mut new_weighted_yield = 0i128;
        for allocation in allocations.iter() {
            new_weighted_yield = new_weighted_yield
                .checked_add(
                    allocation
                        .amount
                        .checked_mul(allocation.projected_apy_bps as i128)
                        .ok_or(Error::ArithmeticOverflow)?,
                )
                .ok_or(Error::ArithmeticOverflow)?;
        }
        let new_weighted_apy_bps = (new_weighted_yield / total_balance) as u32;
        if new_weighted_apy_bps <= previous_weighted_apy_bps {
            return Err(Error::NoOptimizableStrategy);
        }

        // Remove the old portfolio from pool TVL before writing target positions.
        for strategy_id in 1..=count {
            if !has_position(&env, strategy_id, &user) {
                continue;
            }
            let mut strategy = get_strategy(&env, strategy_id)?;
            let position =
                Self::compound_position(get_position(&env, strategy_id, &user)?, &strategy, now);
            strategy.total_deposited = strategy
                .total_deposited
                .saturating_sub(position.deposited.min(strategy.total_deposited));
            remove_position(&env, strategy_id, &user);
            set_strategy(&env, strategy_id, &strategy);
        }

        for allocation in allocations.iter() {
            let mut strategy = get_strategy(&env, allocation.strategy_id)?;
            strategy.total_deposited = strategy
                .total_deposited
                .checked_add(allocation.amount)
                .ok_or(Error::ArithmeticOverflow)?;
            set_strategy(&env, allocation.strategy_id, &strategy);
            set_position(
                &env,
                allocation.strategy_id,
                &user,
                &Position {
                    deposited: allocation.amount,
                    compounded_balance: allocation.amount,
                    last_update_ts: now,
                },
            );
        }

        let result = RebalanceResult {
            total_balance,
            previous_weighted_apy_bps,
            new_weighted_apy_bps,
            allocations,
        };
        env.events()
            .publish((symbol_short!("rebalance"),), (user, result.clone()));
        Ok(result)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Return strategy details by ID.
    pub fn get_strategy(env: Env, strategy_id: u32) -> Result<Strategy, Error> {
        get_strategy(&env, strategy_id)
    }

    /// Return the total number of registered strategies.
    pub fn strategy_count(env: Env) -> u32 {
        get_strategy_count(&env)
    }

    /// Return a user's position in a strategy (with up-to-date compounded balance).
    pub fn get_position(env: Env, user: Address, strategy_id: u32) -> Result<Position, Error> {
        let strategy = get_strategy(&env, strategy_id)?;
        let position = get_position(&env, strategy_id, &user)?;
        let now = env.ledger().timestamp();
        Ok(Self::compound_position(position, &strategy, now))
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Return optimizer configuration, including defaults for legacy pools.
    pub fn get_pool_config(env: Env, strategy_id: u32) -> Result<PoolConfig, Error> {
        get_strategy(&env, strategy_id)?;
        Ok(Self::pool_config_or_default(&env, strategy_id))
    }

    /// Return whether the contract is initialized.
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Return all strategy IDs that exist (up to strategy_count).
    pub fn list_strategies(env: Env) -> Vec<u32> {
        let count = get_strategy_count(&env);
        let mut ids = Vec::new(&env);
        for i in 1..=count {
            if has_strategy(&env, i) {
                ids.push_back(i);
            }
        }
        ids
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Compute accrued rewards and return an updated Position (pure, no storage writes).
    fn compound_position(mut position: Position, strategy: &Strategy, now: u64) -> Position {
        let elapsed = now.saturating_sub(position.last_update_ts);
        if elapsed == 0 || strategy.apy_bps == 0 || position.compounded_balance == 0 {
            return position;
        }

        // reward = balance * apy_bps / BPS_DENOM * elapsed / SECONDS_PER_YEAR
        // Use i128 arithmetic to avoid overflow on large balances.
        let reward = (position.compounded_balance as i128)
            .saturating_mul(strategy.apy_bps as i128)
            .saturating_mul(elapsed as i128)
            / (BPS_DENOM as i128 * SECONDS_PER_YEAR as i128);

        position.compounded_balance = position.compounded_balance.saturating_add(reward);
        position.last_update_ts = now;
        position
    }

    fn pool_config_or_default(env: &Env, strategy_id: u32) -> PoolConfig {
        get_pool_config(env, strategy_id).unwrap_or(PoolConfig {
            annual_rewards: 0,
            capacity: 0,
            fee_bps: 0,
            risk_score: 0,
            max_allocation_bps: BPS_DENOM,
        })
    }

    fn calculate_dynamic_apy(
        strategy: &Strategy,
        config: &PoolConfig,
        projected_tvl: i128,
    ) -> Result<u32, Error> {
        let gross_apy = if config.annual_rewards > 0 && projected_tvl > 0 {
            let calculated = config
                .annual_rewards
                .checked_mul(BPS_DENOM as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / projected_tvl;
            calculated.min(MAX_APY_BPS as i128) as u32
        } else {
            strategy.apy_bps
        };
        Ok(gross_apy.saturating_mul(BPS_DENOM - config.fee_bps) / BPS_DENOM)
    }

    fn build_allocation(
        env: &Env,
        total_amount: i128,
        max_risk_score: u32,
        excluded_user: Option<&Address>,
    ) -> Result<Vec<Allocation>, Error> {
        if total_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if max_risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRiskScore);
        }

        let count = get_strategy_count(env);
        let mut scores = Vec::new(env);
        let mut total_score = 0u64;
        for strategy_id in 1..=count {
            let strategy = get_strategy(env, strategy_id)?;
            let config = Self::pool_config_or_default(env, strategy_id);
            let base_tvl = Self::tvl_excluding_user(env, strategy_id, &strategy, excluded_user)?;
            let has_capacity = config.capacity == 0 || base_tvl < config.capacity;
            if !strategy.is_active || config.risk_score > max_risk_score || !has_capacity {
                scores.push_back(0u32);
                continue;
            }
            let portfolio_cap = total_amount
                .checked_mul(config.max_allocation_bps as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / BPS_DENOM as i128;
            let capacity_room = if config.capacity == 0 {
                total_amount
            } else {
                config.capacity.saturating_sub(base_tvl)
            };
            let probe_amount = portfolio_cap.min(capacity_room).max(1);
            let probe_tvl = base_tvl
                .checked_add(probe_amount)
                .ok_or(Error::ArithmeticOverflow)?;
            let net_apy = Self::calculate_dynamic_apy(&strategy, &config, probe_tvl)?;
            let score = net_apy.saturating_mul(MAX_RISK_SCORE - config.risk_score) / MAX_RISK_SCORE;
            scores.push_back(score);
            total_score = total_score.saturating_add(score as u64);
        }
        if total_score == 0 {
            return Err(Error::NoOptimizableStrategy);
        }

        let mut allocations = Vec::new(env);
        let mut allocated = 0i128;
        for strategy_id in 1..=count {
            let score = scores.get(strategy_id - 1).unwrap_or(0);
            if score == 0 {
                continue;
            }
            let strategy = get_strategy(env, strategy_id)?;
            let config = Self::pool_config_or_default(env, strategy_id);
            let base_tvl = Self::tvl_excluding_user(env, strategy_id, &strategy, excluded_user)?;
            let proportional = total_amount
                .checked_mul(score as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / total_score as i128;
            let portfolio_cap = total_amount
                .checked_mul(config.max_allocation_bps as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / BPS_DENOM as i128;
            let capacity = if config.capacity == 0 {
                total_amount
            } else {
                config.capacity.saturating_sub(base_tvl)
            };
            let amount = proportional.min(portfolio_cap).min(capacity);
            allocated = allocated
                .checked_add(amount)
                .ok_or(Error::ArithmeticOverflow)?;
            allocations.push_back(Allocation {
                strategy_id,
                amount,
                weight_bps: 0,
                projected_apy_bps: 0,
            });
        }

        // Assign rounding residual and capped excess to the best pool with room.
        let mut remaining = total_amount.saturating_sub(allocated);
        while remaining > 0 {
            let mut best_index: Option<u32> = None;
            let mut best_score = 0u32;
            let mut best_room = 0i128;
            for index in 0..allocations.len() {
                let allocation = allocations.get(index).unwrap();
                let score = scores.get(allocation.strategy_id - 1).unwrap_or(0);
                let strategy = get_strategy(env, allocation.strategy_id)?;
                let config = Self::pool_config_or_default(env, allocation.strategy_id);
                let base_tvl = Self::tvl_excluding_user(
                    env,
                    allocation.strategy_id,
                    &strategy,
                    excluded_user,
                )?;
                let portfolio_cap = total_amount
                    .checked_mul(config.max_allocation_bps as i128)
                    .ok_or(Error::ArithmeticOverflow)?
                    / BPS_DENOM as i128;
                let capacity = if config.capacity == 0 {
                    total_amount
                } else {
                    config.capacity.saturating_sub(base_tvl)
                };
                let room = portfolio_cap
                    .min(capacity)
                    .saturating_sub(allocation.amount);
                if room > 0 && (best_index.is_none() || score > best_score) {
                    best_index = Some(index);
                    best_score = score;
                    best_room = room;
                }
            }
            let index = best_index.ok_or(Error::InsufficientCapacity)?;
            let mut allocation = allocations.get(index).unwrap();
            let added = remaining.min(best_room);
            allocation.amount = allocation
                .amount
                .checked_add(added)
                .ok_or(Error::ArithmeticOverflow)?;
            allocations.set(index, allocation);
            remaining -= added;
        }

        let mut final_allocations = Vec::new(env);
        let mut assigned_weight = 0u32;
        for index in 0..allocations.len() {
            let mut allocation = allocations.get(index).unwrap();
            if allocation.amount == 0 {
                continue;
            }
            let strategy = get_strategy(env, allocation.strategy_id)?;
            let config = Self::pool_config_or_default(env, allocation.strategy_id);
            let base_tvl =
                Self::tvl_excluding_user(env, allocation.strategy_id, &strategy, excluded_user)?;
            allocation.projected_apy_bps = Self::calculate_dynamic_apy(
                &strategy,
                &config,
                base_tvl
                    .checked_add(allocation.amount)
                    .ok_or(Error::ArithmeticOverflow)?,
            )?;
            allocation.weight_bps = ((allocation
                .amount
                .checked_mul(BPS_DENOM as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / total_amount) as u32)
                .min(BPS_DENOM.saturating_sub(assigned_weight));
            assigned_weight = assigned_weight.saturating_add(allocation.weight_bps);
            final_allocations.push_back(allocation);
        }
        let last_index = final_allocations
            .len()
            .checked_sub(1)
            .ok_or(Error::InsufficientCapacity)?;
        let mut last = final_allocations.get(last_index).unwrap();
        last.weight_bps = last
            .weight_bps
            .saturating_add(BPS_DENOM.saturating_sub(assigned_weight));
        final_allocations.set(last_index, last);
        Ok(final_allocations)
    }

    fn tvl_excluding_user(
        env: &Env,
        strategy_id: u32,
        strategy: &Strategy,
        excluded_user: Option<&Address>,
    ) -> Result<i128, Error> {
        let Some(user) = excluded_user else {
            return Ok(strategy.total_deposited);
        };
        if !has_position(env, strategy_id, user) {
            return Ok(strategy.total_deposited);
        }
        let position = get_position(env, strategy_id, user)?;
        Ok(strategy
            .total_deposited
            .saturating_sub(position.deposited.min(strategy.total_deposited)))
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
