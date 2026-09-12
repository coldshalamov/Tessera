import { describe, expect, it } from 'vitest';
import { base58AddressToBytes, hexTestKeyToBytes } from '@tessera/types';
import {
  MAX_MONEY,
  U,
  U128_MAX,
  allocateMinorUnits,
  append,
  checkedMulU128,
  integer,
  previewAppend,
  type NodeRef,
} from '@tessera/math';
import { testKey } from './helpers.js';

/**
 * Rejection suite: malformed input, overflow, zero/100% boundaries and
 * wrong-scope parents must produce explicit typed errors — never throws,
 * never silent clamping, never a divide-by-zero fallback.
 */

const SCOPE = {
  genesis_hash: '11111111111111111111111111111111',
  program_id: '22222222222222222222222222222222',
  project_address: '33333333333333333333333333333333',
};

const PARENT_REF: NodeRef = { ...SCOPE, node_address: '44444444444444444444444444444444' };

describe('append() boundaries', () => {
  it('claim 0 is valid and issues nothing', () => {
    const r = append(U, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.effective).toBe(0n);
      expect(r.value.issued).toBe(0n);
      expect(r.value.payout_numerator).toBe(0n);
      expect(r.value.payout_denominator).toBe(0n);
    }
  });

  it('claim 10000 consumes all remaining capacity', () => {
    const r = append(U, 10_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.effective).toBe(U);
      expect(r.value.residual_out).toBe(0n);
      expect(r.value.issued).toBe(U);
    }
  });

  it.each([10_001, -1, 2n ** 32n])('rejects claim %s', (q) => {
    const r = append(U, q);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CLAIM_OUT_OF_RANGE');
  });

  it.each([U + 1n, -1n])('rejects residual %s', (r) => {
    const res = append(r, 500);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('RESIDUAL_OUT_OF_RANGE');
  });

  it('positive claim on exhausted residual -> BRANCH_CAPACITY_EXHAUSTED', () => {
    const r = append(0n, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BRANCH_CAPACITY_EXHAUSTED');
  });

  it('zero claim on exhausted residual still works (credit-only node)', () => {
    const r = append(0n, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.residual_out).toBe(0n);
      expect(r.value.issued).toBe(U);
    }
  });

  it('positive claim rounding to zero -> CLAIM_ROUNDS_TO_ZERO', () => {
    const r = append(1n, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CLAIM_ROUNDS_TO_ZERO');
  });
});

describe('integer() and u128 guards', () => {
  it.each(['5', 1.5, NaN, true, [], {}, null])('rejects %s', (v) => {
    expect(integer(v, 0n, U, 'CLAIM_OUT_OF_RANGE').ok).toBe(false);
  });

  it('checkedMulU128 overflows return ARITHMETIC_OVERFLOW', () => {
    const r = checkedMulU128(U128_MAX, 2n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ARITHMETIC_OVERFLOW');
    expect(checkedMulU128(U128_MAX, 1n).ok).toBe(true);
  });
});

describe('allocateMinorUnits() rejections', () => {
  const k = testKey(1);
  it.each([-1n, MAX_MONEY + 1n, '1000', 1.5])('rejects amount %s', (a) => {
    const r = allocateMinorUnits(a, [[k, 1n]], hexTestKeyToBytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_AMOUNT');
  });

  it('rejects weight above U', () => {
    const r = allocateMinorUnits(10n, [[k, U + 1n]], hexTestKeyToBytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_WEIGHT');
  });

  it('rejects malformed beneficiary keys', () => {
    for (const bad of [
      'zz',
      testKey(0xaa).toUpperCase(), // contains a-f letters -> uppercase differs
      testKey(1).slice(0, 62),
      5 as unknown as string,
    ]) {
      const r = allocateMinorUnits(10n, [[bad, 1n]], hexTestKeyToBytes);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_BENEFICIARY_KEY');
    }
  });

  it('all-zero weights -> ZERO_ISSUED, never a founder fallback', () => {
    const r = allocateMinorUnits(1000n, [[k, 0n]], hexTestKeyToBytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ZERO_ISSUED');
  });

  it('aggregated weight above U -> ISSUED_OUT_OF_RANGE', () => {
    const r = allocateMinorUnits(
      10n,
      [
        [k, U],
        [testKey(2), 1n],
      ],
      hexTestKeyToBytes,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ISSUED_OUT_OF_RANGE');
  });

  it('amount 0 allocates zeros for everyone', () => {
    const r = allocateMinorUnits(
      0n,
      [
        [testKey(1), 5n],
        [testKey(2), 5n],
      ],
      hexTestKeyToBytes,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.get(testKey(1))).toBe(0n);
      expect(r.value.get(testKey(2))).toBe(0n);
    }
  });

  it('accepts base58 32-byte keys too (production path)', () => {
    // 32 zero bytes -> '1' * 32
    const b58 = '11111111111111111111111111111111';
    expect(base58AddressToBytes(b58)).not.toBeNull();
    const r = allocateMinorUnits(
      7n,
      [[b58, 10n]],
      (key) => base58AddressToBytes(key),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.get(b58)).toBe(7n);
  });
});

describe('previewAppend() parent validation', () => {
  const parent = {
    ref: PARENT_REF,
    residual_out_units: 500_000_000_000n,
    depth: 3,
    status: 'finalized' as const,
  };

  it('null parent previews a root (residual_in = U)', () => {
    const r = previewAppend(null, 1500, SCOPE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.step.residual_in).toBe(U);
      expect(r.value.depth).toBe(0);
    }
  });

  it('rejects a parent on another network', () => {
    const bad = { ...parent, ref: { ...PARENT_REF, genesis_hash: '55555555555555555555555555555555' } };
    const r = previewAppend(bad, 100, SCOPE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PARENT_NETWORK_MISMATCH');
  });

  it('rejects a parent under another program', () => {
    const bad = { ...parent, ref: { ...PARENT_REF, program_id: '55555555555555555555555555555555' } };
    const r = previewAppend(bad, 100, SCOPE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PARENT_PROGRAM_MISMATCH');
  });

  it('rejects a cross-project parent', () => {
    const bad = { ...parent, ref: { ...PARENT_REF, project_address: '55555555555555555555555555555555' } };
    const r = previewAppend(bad, 100, SCOPE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PARENT_PROJECT_MISMATCH');
  });

  it.each(['draft', 'ready_for_consent', 'signed', 'submitted', 'confirmed'] as const)(
    'rejects a non-finalized parent in state %s',
    (status) => {
      const r = previewAppend({ ...parent, status }, 100, SCOPE);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('PARENT_NOT_FINALIZED');
    },
  );

  it.each(['restricted', 'disputed'] as const)(
    'annotation state %s remains economically appendable (docs/02)',
    (status) => {
      const r = previewAppend({ ...parent, status }, 100, SCOPE);
      expect(r.ok).toBe(true);
    },
  );

  it('rejects depth beyond 1024', () => {
    const r = previewAppend({ ...parent, depth: 1024 }, 100, SCOPE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEPTH_OUT_OF_RANGE');
  });

  it('propagates capacity exhaustion from a 100% parent', () => {
    const r = previewAppend({ ...parent, residual_out_units: 0n }, 1, SCOPE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BRANCH_CAPACITY_EXHAUSTED');
    const zero = previewAppend({ ...parent, residual_out_units: 0n }, 0, SCOPE);
    expect(zero.ok).toBe(true);
  });
});
