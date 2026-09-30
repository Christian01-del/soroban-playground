// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';
import yieldOptimizerService from '../src/services/yieldOptimizerService.js';

const { adminAddress, executorAddress } = yieldOptimizerService.getConfig();

describe('yieldOptimizerService', () => {
  it('create strategy + deposit + withdraw lifecycle', async () => {
    yieldOptimizerService.reset();

    const strategy = await yieldOptimizerService.createStrategy({
      actor: adminAddress,
      name: 'Cross-Protocol Stable Blend',
      protocol: 'Blend + Aquarius',
      apyBps: 1320,
      feeBps: 250,
      compoundInterval: 86400,
    });

    expect(strategy.name).toBe('Cross-Protocol Stable Blend');

    const deposited = await yieldOptimizerService.deposit(
      strategy.id,
      'GUSEROPT1',
      5000
    );
    expect(deposited.sharesMinted).toBe(5000);

    const withdrawn = await yieldOptimizerService.withdraw(
      strategy.id,
      'GUSEROPT1',
      1200
    );
    expect(withdrawn.withdrawnAmount).toBe(1200);
    expect(withdrawn.strategy.tvl).toBeGreaterThanOrEqual(3800);
  });

  it('compound restricted to admin or executor', async () => {
    yieldOptimizerService.reset();

    const strategy = await yieldOptimizerService.createStrategy({
      actor: adminAddress,
      name: 'Keeper Compound Vault',
      protocol: 'Blend + Wave',
      apyBps: 1500,
      feeBps: 300,
      compoundInterval: 1,
    });

    await yieldOptimizerService.deposit(strategy.id, 'GUSEROPT2', 10000);

    await expect(
      yieldOptimizerService.compound(strategy.id, 'GUNAUTHORIZED')
    ).rejects.toThrow(/Only the admin or executor can compound a strategy/);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const result = await yieldOptimizerService.compound(
      strategy.id,
      executorAddress
    );
    expect(result.compoundedTvl).toBeGreaterThanOrEqual(10000);
  });

  it('backtest is deterministic for same inputs', async () => {
    yieldOptimizerService.reset();

    const payload = {
      depositAmount: 10000,
      days: 30,
      apyBps: 1200,
      feeBps: 250,
      compoundEveryDays: 7,
    };

    const first = await yieldOptimizerService.backtest(payload);
    const second = await yieldOptimizerService.backtest(payload);

    expect(first).toEqual(second);
    expect(first.series).toHaveLength(30);
    expect(first.assumptions.deterministicSeries).toBe(true);
  });
});
