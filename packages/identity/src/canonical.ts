import {
  parseIntentV1,
  parseStatementV1,
  type IntentV1,
  type StatementV1,
  type ValidationIssue,
  type Result,
} from '@tessera/types';
import { idErr, type IdentityResult } from './errors.js';

/**
 * Canonical JSON per docs/03: deterministic sorted-key compact serialization.
 * Writers SHOULD use this form for any JSON whose bytes are hashed outside the
 * wire codec (e.g. the KEY_CONTINUITY identity-link payload); verifiers hash
 * the exact stored bytes and never reserialize before checking.
 *
 * The portable record view uses lower_snake_case keys, decimal strings for
 * u64/i64-class integers, plain integers for bps, explicit nulls for absent
 * values, base58 for keys/addresses and lowercase hex for digests — the
 * IntentV1/StatementV1 interfaces already are that view, so canonicalization
 * only fixes key order/whitespace.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Validate then canonically serialize an IntentV1 portable view. */
export function intentCanonicalJson(intent: IntentV1): Result<string, ValidationIssue> {
  const parsed = parseIntentV1(intent, 'intent');
  if (!parsed.ok) return parsed;
  return { ok: true, value: canonicalJsonStringify(parsed.value) };
}

/** Validate then canonically serialize a StatementV1 portable view. */
export function statementCanonicalJson(statement: StatementV1): Result<string, ValidationIssue> {
  const parsed = parseStatementV1(statement, 'statement');
  if (!parsed.ok) return parsed;
  return { ok: true, value: canonicalJsonStringify(parsed.value) };
}

/** utf8 bytes of a canonical JSON payload (the bytes that get SHA-256'd). */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJsonStringify(value));
}

/** Wrap a wire-validation failure as an identity-layer error. */
export function asInvalidRecord(e: ValidationIssue): IdentityResult<never> {
  return idErr('INVALID_RECORD', `${e.code} at ${e.path}: ${e.message}`);
}
