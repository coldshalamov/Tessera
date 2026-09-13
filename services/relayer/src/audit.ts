import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Append-only audit log (JSONL). The record answers "what did the sponsor
 * sign and why" without ever containing secret material:
 *  - fields are restricted to the AuditEvent shape (digests, pubkeys, slot
 *    numbers, lamports, typed error codes);
 *  - a defense-in-depth scrub drops any key whose name resembles
 *    secret/seed/keypair/private and truncates oversized strings.
 * Signatures and pubkeys are not secret (they are published on-chain);
 * keypair files and seed bytes are.
 */

const SECRETISH = /secret|seed|keypair|private|password|token/i;
const MAX_FIELD_CHARS = 512;

export interface AuditEvent {
  readonly event:
    | 'intake_prepared'
    | 'intake_held'
    | 'intake_rejected'
    | 'signature_verified'
    | 'sponsor_signed'
    | 'submitted'
    | 'confirmed'
    | 'finalized'
    | 'failed'
    | 'retry_scheduled'
    | 'paused';
  readonly idempotency_key?: string;
  readonly intent_digest?: string;
  readonly node_address?: string;
  readonly contributor?: string;
  readonly instruction?: string;
  readonly lamports_estimate?: string;
  readonly tx_signature?: string;
  readonly error_code?: string;
  readonly detail?: string;
}

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof v === 'string') return v.length > MAX_FIELD_CHARS ? `${v.slice(0, MAX_FIELD_CHARS)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return v;
  if (typeof v === 'bigint') return v.toString(10);
  if (Array.isArray(v)) return v.slice(0, 64).map((x) => scrub(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRETISH.test(k) ? '[withheld]' : scrub(x, depth + 1);
    }
    return out;
  }
  return '[unrepresentable]';
}

export class AuditLog {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
  }

  record(event: AuditEvent): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...(scrub(event) as object) });
    try {
      appendFileSync(this.path, `${line}\n`);
    } catch {
      // Audit sink failure must not crash the pipeline; the outbox remains
      // authoritative and the next event will retry the file.
    }
  }

  get filePath(): string {
    return this.path;
  }
}
