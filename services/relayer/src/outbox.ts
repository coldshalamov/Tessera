import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { portErr, type IntentV1, type PortResult } from '@tessera/types';

/**
 * Durable outbox (packet T04: "outbox persistence (SQLite/file) with
 * retry/backoff"). File-backed JSON document written atomically via
 * tmp-file + rename after every mutation — surviving a mid-write crash is
 * the property that matters at this scale, and rename(2) gives it.
 *
 * Row lifecycle:
 *   pending_signature  — message built server-side; awaiting the
 *                        contributor(/controller) transaction signatures.
 *   held               — valid intake refused for now (paused or budget);
 *                        nothing is signed; resubmittable when unpaused.
 *   ready              — all client signatures verified, review passed,
 *                        sponsor has not yet co-signed/sent.
 *   submitted          — wire transaction sent; signature recorded; the
 *                        finality poll is in progress or resumable.
 *   confirmed/finalized— terminal success states.
 *   failed             — terminal failure (typed error preserved).
 *
 * Retries NEVER re-sign a stale message: an expired blockhash moves the row
 * back to pending_signature with a freshly built message, requiring a new
 * client signature over it — the intent nonce keeps that replay idempotent.
 */

export type OutboxStatus =
  | 'pending_signature'
  | 'held'
  | 'ready'
  | 'submitted'
  | 'confirmed'
  | 'finalized'
  | 'failed';

export interface OutboxRow {
  /** Client-supplied idempotency key — the unique row id. */
  readonly idempotency_key: string;
  readonly intent: IntentV1;
  readonly intent_digest: string;
  readonly node_address: string;
  readonly contributor: string;
  /** Server-compiled message (base64) + its blockhash context. Rebuilt in
   *  place when the blockhash expires (the intent/nonce keep it idempotent). */
  message_base64: string;
  blockhash: string;
  last_valid_block_height: string;
  /** Estimated sponsor outlay computed at review time. */
  estimated_lamports: string;
  /** Signer pubkeys (base58) the client must provide signatures for. */
  required_client_signers: readonly string[];
  status: OutboxStatus;
  /** Reason a row is held/failed (typed code + message, no secrets). */
  error?: { code: string; message: string } | undefined;
  /** Transaction signature once sent. */
  signature?: string | undefined;
  attempts: number;
  /** Unix-ms before which the row must not be retried. */
  next_attempt_at?: number | undefined;
  readonly created_at: number;
  updated_at: number;
}

interface OutboxFile {
  format_version: 1;
  /** lamports spent per UTC day (decimal strings). */
  daily_spend: Record<string, string>;
  /** lamports spent per contributor account (decimal strings). */
  account_spend: Record<string, string>;
  rows: OutboxRow[];
}

export class OutboxStore {
  private readonly path: string;
  private state: OutboxFile;

  private constructor(path: string, state: OutboxFile) {
    this.path = path;
    this.state = state;
  }

  /** Load the outbox file; a missing file starts empty. A corrupt file is a
   *  hard failure (never silently drop recorded intents). */
  static load(path: string): PortResult<OutboxStore> {
    const p = resolve(path);
    if (!existsSync(p)) {
      return { ok: true, value: new OutboxStore(p, { format_version: 1, daily_spend: {}, account_spend: {}, rows: [] }) };
    }
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as OutboxFile;
      if (parsed.format_version !== 1 || !Array.isArray(parsed.rows)) {
        return portErr('UNSUPPORTED_VERSION', `outbox file ${p} has an unsupported format`);
      }
      return { ok: true, value: new OutboxStore(p, parsed) };
    } catch (e) {
      return portErr(
        'ANCHOR_FAILED',
        `outbox file ${p} is unreadable/corrupt: ${e instanceof Error ? e.message : 'parse failed'} — refusing to lose recorded intents`,
      );
    }
  }

  /** Atomic persist: tmp file + rename. Called after every mutation. */
  save(): PortResult<void> {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      renameSync(tmp, this.path);
      return { ok: true, value: undefined };
    } catch (e) {
      return portErr('ANCHOR_FAILED', `outbox persist failed: ${e instanceof Error ? e.message : 'write failed'}`);
    }
  }

  get(key: string): OutboxRow | undefined {
    return this.state.rows.find((r) => r.idempotency_key === key);
  }

  put(row: OutboxRow): PortResult<void> {
    const i = this.state.rows.findIndex((r) => r.idempotency_key === row.idempotency_key);
    const stamped = { ...row, updated_at: Date.now() };
    if (i === -1) this.state.rows.push(stamped);
    else this.state.rows[i] = stamped;
    return this.save();
  }

  rows(): readonly OutboxRow[] {
    return this.state.rows;
  }

  dayKey(now: number): string {
    return new Date(now).toISOString().slice(0, 10); // UTC day
  }

  dailySpend(now: number): bigint {
    return BigInt(this.state.daily_spend[this.dayKey(now)] ?? '0');
  }

  accountSpend(contributor: string): bigint {
    return BigInt(this.state.account_spend[contributor] ?? '0');
  }

  recordSpend(contributor: string, lamports: bigint, now: number): PortResult<void> {
    const dk = this.dayKey(now);
    this.state.daily_spend[dk] = (this.dailySpend(now) + lamports).toString(10);
    this.state.account_spend[contributor] = (this.accountSpend(contributor) + lamports).toString(10);
    return this.save();
  }
}
