import { describe, expect, it } from 'vitest';
import { hexTestKeyToBytes } from '@tessera/types';
import {
  U,
  allocateMinorUnits,
  append,
  portableStep,
  type EconomicStep,
} from '@tessera/math';
import sharedVectors from '../../../shared/economic-vectors.json';
import fixtureVectors from '../../../fixtures/economics.json';

/**
 * Conformance: every case in shared/economic-vectors.json AND
 * fixtures/economics.json (byte-identical files; both are run so drift in
 * either copy is caught). Exact equality on all stored fields and
 * allocations — no tolerance, no formatted percentages.
 */

interface VectorSet {
  total_units: string;
  nodes: Array<{
    id: string;
    parent: string | null;
    claim_bps: number;
    expected: Record<string, string | number>;
  }>;
  settlements: Array<{
    id: string;
    amount_minor: number;
    weights: Array<{ beneficiary_hex: string; effective_units: string }>;
    expected: Record<string, number>;
  }>;
  invalid_append: Array<{ residual: number; claim_bps: number; error: string }>;
}

const vectorFiles: Array<[string, VectorSet]> = [
  ['shared/economic-vectors.json', sharedVectors as VectorSet],
  ['fixtures/economics.json', fixtureVectors as VectorSet],
];

it('the two shipped vector files are identical', () => {
  expect(JSON.stringify(sharedVectors)).toBe(JSON.stringify(fixtureVectors));
});

for (const [label, vectors] of vectorFiles) {
  describe(`economic vectors: ${label}`, () => {
    it('declares U = 10^12', () => {
      expect(vectors.total_units).toBe('1000000000000');
      expect(U).toBe(1_000_000_000_000n);
    });

    describe.each(vectors.nodes.map((n) => [n.id, n] as const))(
      'node %s',
      (_id, row) => {
        it('matches stored economic fields exactly', () => {
          // Resolve through the row graph like the reference self-test.
          const byId = new Map<string, EconomicStep>();
          for (const r of vectors.nodes) {
            const residual = r.parent === null ? U : byId.get(r.parent)!.residual_out;
            const step = append(residual, r.claim_bps);
            expect(step.ok).toBe(true);
            if (step.ok) byId.set(r.id, step.value);
          }
          const step = byId.get(row.id)!;
          const portable = portableStep(step);
          expect(portable).toEqual(row.expected);
          // Explicit field-by-field assertions for readable failure output.
          expect(portable.residual_in_units).toBe(row.expected['residual_in_units']);
          expect(portable.claim_bps).toBe(row.expected['claim_bps']);
          expect(portable.effective_units).toBe(row.expected['effective_units']);
          expect(portable.residual_out_units).toBe(row.expected['residual_out_units']);
          expect(portable.issued_total_units).toBe(row.expected['issued_total_units']);
          expect(portable.own_payout_numerator_units).toBe(row.expected['own_payout_numerator_units']);
          expect(portable.own_payout_denominator_units).toBe(row.expected['own_payout_denominator_units']);
        });
      },
    );

    it('conserves capacity along every fixed node path', () => {
      const byId = new Map<string, EconomicStep>();
      for (const r of vectors.nodes) {
        const residual = r.parent === null ? U : byId.get(r.parent)!.residual_out;
        const step = append(residual, r.claim_bps);
        expect(step.ok).toBe(true);
        if (step.ok) {
          byId.set(r.id, step.value);
          expect(step.value.issued).toBe(U - step.value.residual_out);
        }
      }
      // Canonical branch A -> B -> C -> D: sum(effective) + residual == U
      const sumEffective =
        byId.get('A')!.effective +
        byId.get('B')!.effective +
        byId.get('C')!.effective +
        byId.get('D')!.effective;
      expect(sumEffective + byId.get('D')!.residual_out).toBe(U);
    });

    describe.each(vectors.settlements.map((s) => [s.id, s] as const))(
      'settlement %s',
      (_id, scase) => {
        it('allocates every minor unit exactly as stored', () => {
          const contributions = scase.weights.map(
            (w) => [w.beneficiary_hex, BigInt(w.effective_units)] as const,
          );
          const got = allocateMinorUnits(
            BigInt(scase.amount_minor),
            contributions,
            hexTestKeyToBytes,
          );
          expect(got.ok).toBe(true);
          if (!got.ok) return;
          const obj = Object.fromEntries(
            [...got.value.entries()].map(([k, v]) => [k, Number(v)]),
          );
          expect(obj).toEqual(scase.expected);
          let total = 0n;
          for (const v of got.value.values()) total += v;
          expect(total).toBe(BigInt(scase.amount_minor));
        });
      },
    );

    describe.each(vectors.invalid_append.map((c) => [c.error, c] as const))(
      'invalid append -> %s',
      (_code, c) => {
        it(`residual=${c.residual} claim=${c.claim_bps}`, () => {
          const r = append(c.residual, c.claim_bps);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.code).toBe(c.error);
        });
      },
    );
  });
}

describe('reference-level input hygiene', () => {
  it.each([true, -1, 1.2, '1000', null, undefined, NaN])(
    'rejects non-integer claim %s',
    (bad) => {
      const r = append(U, bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('CLAIM_OUT_OF_RANGE');
    },
  );

  it.each([true, 1.5, '850000000000', null])('rejects non-integer residual %s', (bad) => {
    const r = append(bad, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('RESIDUAL_OUT_OF_RANGE');
  });
});
