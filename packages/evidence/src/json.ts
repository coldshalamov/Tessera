import { utf8Bytes, utf8String } from './bytes.js';

/**
 * Canonical JSON used for every bundle payload we generate. Keys are sorted
 * recursively; identical algorithm to the local adapter's stableStringify, so
 * records we export hash identically to `exportBranch` manifest entries.
 * Payloads we RECEIVE are never reserialized — they are stored verbatim.
 */

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

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export function stableJsonBytes(value: unknown): Uint8Array {
  return utf8Bytes(stableStringify(value));
}

export interface JsonParseIssue {
  readonly code: 'INVALID_UTF8' | 'INVALID_JSON';
  readonly message: string;
}

/** Strict JSON-from-bytes: rejects malformed UTF-8 and non-JSON. */
export function parseJsonBytes(
  bytes: Uint8Array,
): { ok: true; value: unknown } | { ok: false; error: JsonParseIssue } {
  const text = utf8String(bytes);
  if (text === null) {
    return { ok: false, error: { code: 'INVALID_UTF8', message: 'payload is not well-formed UTF-8' } };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return {
      ok: false,
      error: { code: 'INVALID_JSON', message: e instanceof Error ? e.message : 'JSON.parse failed' },
    };
  }
}
