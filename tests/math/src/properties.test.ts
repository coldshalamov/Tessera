import { describe, expect, it } from 'vitest';
import { hexTestKeyToBytes } from '@tessera/types';
import {
  MAX_MONEY,
  U,
  allocateMinorUnits,
  append,
  path,
} from '@tessera/math';
import { choice, mulberry32, randint, testKey } from './helpers.js';

/**
 * Property suite mirroring the reference self-test (tools/reference_economics.py
 * lines 129–174): seeded PRNG, thousands of random paths. Asserts residual
 * conservation, money conservation with the dust rule, per-beneficiary
 * near-exactness, aggregation-before-rounding and input-order independence.
 * Failures are collected per run and asserted once — vitest's per-expect
 * overhead otherwise dominates a 2500-path loop — while still reporting the
 * exact iteration that broke. These tests genuinely fail on broken
 * arithmetic: a float-based or per-entry rounding implementation breaks
 * conservation immediately.
 */

const KEYS = Array.from({ length: 8 }, (_, i) => testKey(i + 1));
const CLAIM_CHOICES = [0, 1, 10_000] as const;
const AMOUNT_CHOICES = [0n, 1n, 1000n, MAX_MONEY] as const;

interface RunStats {
  paths: number;
  steps: number;
  allocations: number;
  failures: string[];
}

function runSeeded(seed: number, iterations: number): RunStats {
  const rng = mulberry32(seed);
  const stats: RunStats = { paths: 0, steps: 0, allocations: 0, failures: [] };
  const bad = (msg: string) => {
    if (stats.failures.length < 25) stats.failures.push(msg);
  };

  for (let iter = 0; iter < iterations; iter++) {
    let residual = U;
    const weights: Array<readonly [string, bigint]> = [];
    const steps = randint(rng, 1, 64);

    for (let s = 0; s < steps; s++) {
      const q = choice(rng, [...CLAIM_CHOICES, randint(rng, 1, 10_000)]);
      let step = append(residual, q);
      if (!step.ok) {
        // Reference behavior: these two are the only permissible failures.
        if (
          step.error.code !== 'CLAIM_ROUNDS_TO_ZERO' &&
          step.error.code !== 'BRANCH_CAPACITY_EXHAUSTED'
        ) {
          bad(`iter ${iter} step ${s}: unexpected error ${step.error.code}`);
        }
        step = append(residual, 0);
      }
      if (!step.ok) {
        bad(`iter ${iter} step ${s}: zero-claim fallback failed`);
        break;
      }
      const value = step.value;
      weights.push([choice(rng, KEYS), value.effective]);
      residual = value.residual_out;

      // Residual conservation: sum(effective along path) + residual == U.
      let sumW = 0n;
      for (const [, w] of weights) sumW += w;
      if (sumW + residual !== U) {
        bad(`iter ${iter} step ${s}: conservation broke (${sumW}+${residual}!=U)`);
      }
      if (residual < 0n || residual > U) {
        bad(`iter ${iter} step ${s}: residual ${residual} out of bounds`);
      }
      if (value.issued !== U - residual) {
        bad(`iter ${iter} step ${s}: issued mismatch`);
      }
      stats.steps++;
    }
    stats.paths++;

    let issued = 0n;
    for (const [, w] of weights) issued += w;
    if (issued === 0n) continue;

    const amount = choice(rng, [
      ...AMOUNT_CHOICES,
      BigInt(randint(rng, 0, 10_000_000)),
    ]);
    const paid = allocateMinorUnits(amount, weights, hexTestKeyToBytes);
    if (!paid.ok) {
      bad(`iter ${iter}: allocate failed ${paid.error.code}`);
      continue;
    }

    // Money conservation: allocations sum exactly to the amount.
    let total = 0n;
    for (const v of paid.value.values()) total += v;
    if (total !== amount) {
      bad(`iter ${iter}: allocation sum ${total} != amount ${amount}`);
    }

    const grouped = new Map<string, bigint>();
    for (const [k, w] of weights) grouped.set(k, (grouped.get(k) ?? 0n) + w);
    for (const [k, v] of paid.value) {
      // Each aggregated beneficiary is within one minor unit of exact share.
      const diff = v * issued - amount * grouped.get(k)!;
      if ((diff < 0n ? -diff : diff) >= issued) {
        bad(`iter ${iter}: beneficiary ${k.slice(0, 8)} off by >= 1 minor unit`);
      }
    }

    // Splitting a beneficiary's weight across entries must not change dust.
    const split: Array<readonly [string, bigint]> = [
      ...weights.map(([k, w]) => [k, w / 2n] as const),
      ...weights.map(([k, w]) => [k, w - w / 2n] as const),
    ];
    const paidSplit = allocateMinorUnits(amount, split, hexTestKeyToBytes);
    if (!paidSplit.ok || ![...paidSplit.value].every(([k, v]) => paid.value.get(k) === v) || paidSplit.value.size !== paid.value.size) {
      bad(`iter ${iter}: split-weight allocation changed the result`);
    }

    // Input order must not matter.
    const reversed = [...weights].reverse();
    const paidRev = allocateMinorUnits(amount, reversed, hexTestKeyToBytes);
    if (!paidRev.ok || ![...paidRev.value].every(([k, v]) => paid.value.get(k) === v) || paidRev.value.size !== paid.value.size) {
      bad(`iter ${iter}: input order changed the allocation`);
    }

    stats.allocations++;
  }
  return stats;
}

describe('seeded property runs', () => {
  it('reference seed 20260911: 2500 paths conserve capacity and money', { timeout: 60_000 }, () => {
    const stats = runSeeded(20_260_911, 2_500);
    expect(stats.failures).toEqual([]);
    expect(stats.paths).toBe(2_500);
    expect(stats.steps).toBeGreaterThan(2_500);
    expect(stats.allocations).toBeGreaterThan(0);
  });

  it.each([1, 42, 0xdeadbeef])('secondary seed %i: 500 paths', (seed) => {
    const stats = runSeeded(seed, 500);
    expect(stats.failures).toEqual([]);
    expect(stats.paths).toBe(500);
    expect(stats.allocations).toBeGreaterThan(0);
  }, 30_000);
});

describe('path-level invariants', () => {
  it('path() threads residual and conserves capacity for random claim lists', () => {
    const rng = mulberry32(7);
    const failures: string[] = [];
    for (let i = 0; i < 500; i++) {
      const claims = Array.from({ length: randint(rng, 1, 32) }, () =>
        randint(rng, 0, 10_000),
      );
      const steps = path(claims);
      if (!steps.ok) {
        if (
          steps.error.code !== 'CLAIM_ROUNDS_TO_ZERO' &&
          steps.error.code !== 'BRANCH_CAPACITY_EXHAUSTED'
        ) {
          failures.push(`iter ${i}: unexpected error ${steps.error.code}`);
        }
        continue;
      }
      let sumEff = 0n;
      let prevResidual = U;
      for (const s of steps.value) {
        if (s.residual_in !== prevResidual) {
          failures.push(`iter ${i}: residual not threaded`);
        }
        sumEff += s.effective;
        prevResidual = s.residual_out;
      }
      if (sumEff + prevResidual !== U) {
        failures.push(`iter ${i}: path conservation broke`);
      }
    }
    expect(failures).toEqual([]);
  });
});
