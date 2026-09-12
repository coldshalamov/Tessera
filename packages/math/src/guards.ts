import type { PortErrorCode, PortResult } from '@tessera/types';
import { portErr, U128_MAX, U64_MAX } from '@tessera/types';

/**
 * Strict integer acceptance mirroring reference_economics.py `integer()`:
 * accepts bigint or a safe-integer number; rejects booleans, strings, floats,
 * NaN/Infinity, null and out-of-range values. Returns typed errors — these
 * functions never throw on expected-invalid input.
 */
export function integer(
  value: unknown,
  lo: bigint,
  hi: bigint,
  code: PortErrorCode,
): PortResult<bigint> {
  let v: bigint;
  if (typeof value === 'bigint') {
    v = value;
  } else if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value)
  ) {
    v = BigInt(value);
  } else {
    return portErr(code, `expected integer in [${lo}, ${hi}], got ${typeof value}`);
  }
  if (v < lo || v > hi) {
    return portErr(code, `integer ${v} outside [${lo}, ${hi}]`);
  }
  return { ok: true, value: v };
}

/** Checked multiply in the u128 domain; overflow returns ARITHMETIC_OVERFLOW. */
export function checkedMulU128(a: bigint, b: bigint): PortResult<bigint> {
  if (a < 0n || b < 0n || a > U128_MAX || b > U128_MAX) {
    return portErr('ARITHMETIC_OVERFLOW', 'operand outside u128 domain');
  }
  const p = a * b;
  if (p > U128_MAX) {
    return portErr('ARITHMETIC_OVERFLOW', 'product exceeds u128');
  }
  return { ok: true, value: p };
}

export { U64_MAX, U128_MAX };
