import type { PortResult } from '@tessera/types';
import { portErr } from '@tessera/types';
import { MAX_MONEY, U } from './economics.js';
import { checkedMulU128, integer } from './guards.js';

/**
 * Largest-remainder minor-unit allocation — exact port of `allocate()` in
 * tools/reference_economics.py.
 *
 * 1. Aggregate effective weights by beneficiary identity BEFORE rounding, so
 *    splitting one person's labor into many nodes cannot win extra dust.
 * 2. floor allocation = amount * weight / issued.
 * 3. Remaining minor units go to the largest remainders
 *    (amount * weight) mod issued, descending.
 * 4. Ties break by ASCENDING RAW BENEFICIARY KEY BYTES — never names or
 *    arrival order. `decodeKey` is caller-supplied: production callers pass a
 *    base58 decoder (public keys are 32 raw bytes); the vector suite passes
 *    `hexTestKeyToBytes` because the reference fixtures encode keys as
 *    lowercase hex. Ordering is lexicographic over the decoded 32 bytes,
 *    identical to the reference's `raw_key` sort.
 */

export type KeyDecoder = (key: string) => Uint8Array | null;

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

export type WeightEntry = readonly [beneficiary: string, weight: unknown];

export function allocateMinorUnits(
  amount: unknown,
  contributions: Iterable<WeightEntry>,
  decodeKey: KeyDecoder,
): PortResult<ReadonlyMap<string, bigint>> {
  const amt = integer(amount, 0n, MAX_MONEY, 'INVALID_AMOUNT');
  if (!amt.ok) return amt;

  const grouped = new Map<string, bigint>();
  const raw = new Map<string, Uint8Array>();
  for (const [key, w] of contributions) {
    const keyBytes = decodeKey(key);
    if (keyBytes === null || keyBytes.length !== 32) {
      return portErr('INVALID_BENEFICIARY_KEY', `beneficiary key does not decode to 32 bytes: ${String(key)}`);
    }
    const weight = integer(w, 0n, U, 'INVALID_WEIGHT');
    if (!weight.ok) return weight;
    grouped.set(key, (grouped.get(key) ?? 0n) + weight.value);
    raw.set(key, keyBytes);
  }

  let issued = 0n;
  for (const w of grouped.values()) issued += w;
  if (issued === 0n) {
    return portErr('ZERO_ISSUED', 'no issued units: version cannot be monetized');
  }
  if (issued > U) {
    return portErr('ISSUED_OUT_OF_RANGE', `aggregated weight ${issued} exceeds U`);
  }

  const keys = [...grouped.keys()].sort((a, b) => compareBytes(raw.get(a)!, raw.get(b)!));

  const allocated = new Map<string, bigint>();
  const remainders = new Map<string, bigint>();
  let allocatedSum = 0n;
  for (const key of keys) {
    const product = checkedMulU128(amt.value, grouped.get(key)!);
    if (!product.ok) return product;
    const share = product.value / issued;
    allocated.set(key, share);
    remainders.set(key, product.value % issued);
    allocatedSum += share;
  }

  const dust = amt.value - allocatedSum;
  if (dust < 0n) {
    return portErr('INTERNAL_INVARIANT', 'floor allocation exceeded amount');
  }
  const ranked = [...keys].sort((a, b) => {
    const ra = remainders.get(a)!;
    const rb = remainders.get(b)!;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return compareBytes(raw.get(a)!, raw.get(b)!);
  });
  const dustN = Number(dust);
  for (let i = 0; i < dustN && i < ranked.length; i++) {
    const key = ranked[i]!;
    allocated.set(key, allocated.get(key)! + 1n);
  }

  let total = 0n;
  for (const v of allocated.values()) total += v;
  if (total !== amt.value) {
    return portErr('INTERNAL_INVARIANT', 'allocation did not conserve minor units');
  }
  return { ok: true, value: allocated };
}
