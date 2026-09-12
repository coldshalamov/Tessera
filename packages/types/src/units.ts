import type { Result } from './result.js';
import { err, ok } from './result.js';
import { issue, type ValidationIssue } from './errors.js';

/**
 * Integer/decimal-string primitives. All u64-class values are decimal strings
 * at JSON boundaries and bigint internally. No floats ever participate.
 */

export const U64_MAX = (1n << 64n) - 1n;
export const I64_MIN = -(1n << 63n);
export const I64_MAX = (1n << 63n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;

/** Canonical decimal encoding of a bigint (always matches ^(0|[1-9][0-9]*)$ for v >= 0). */
export function decimalString(value: bigint): string {
  return value.toString(10);
}

const U64_DECIMAL_RE = /^(0|[1-9][0-9]{0,19})$/;
const I64_DECIMAL_RE = /^-?(0|[1-9][0-9]{0,18})$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export { isPlainObject };

/**
 * Parse an unsigned decimal string into bigint with an inclusive [lo, hi] bound.
 * Rejects empty strings, leading zeros, signs, exponents, whitespace and
 * non-integer forms — the JSON boundary is decimal-string only.
 */
export function parseBoundedDecimal(
  value: unknown,
  lo: bigint,
  hi: bigint,
  path: string,
  rangeCode: 'U64_OUT_OF_RANGE' | 'UNITS_OUT_OF_RANGE' | 'FIELD_OUT_OF_RANGE' = 'U64_OUT_OF_RANGE',
): Result<bigint, ValidationIssue> {
  if (typeof value !== 'string' || !U64_DECIMAL_RE.test(value)) {
    return err(issue('INVALID_DECIMAL', path, 'expected a base-10 decimal string without leading zeros'));
  }
  const v = BigInt(value);
  if (v < lo || v > hi) {
    return err(issue(rangeCode, path, `decimal value out of range [${lo}, ${hi}]`));
  }
  return ok(v);
}

/** u64 decimal string → bigint, enforcing 0..2^64-1. */
export function parseU64Decimal(value: unknown, path: string): Result<bigint, ValidationIssue> {
  return parseBoundedDecimal(value, 0n, U64_MAX, path, 'U64_OUT_OF_RANGE');
}

/** i64 decimal string → bigint, enforcing -2^63..2^63-1 and the schema pattern. */
export function parseI64Decimal(value: unknown, path: string): Result<bigint, ValidationIssue> {
  if (typeof value !== 'string' || !I64_DECIMAL_RE.test(value)) {
    return err(issue('INVALID_DECIMAL', path, 'expected a signed base-10 decimal string'));
  }
  const v = BigInt(value);
  if (v < I64_MIN || v > I64_MAX) {
    return err(issue('I64_OUT_OF_RANGE', path, 'value does not fit in i64'));
  }
  return ok(v);
}


