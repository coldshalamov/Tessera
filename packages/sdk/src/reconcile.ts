import type { PortResult } from '@tessera/types';
import { portErr } from '@tessera/types';
import { extractSimulationError, fail, mapThrown } from './errors.js';
import type { JsonRpcClient, SignatureStatus } from './rpc.js';

/**
 * Finality state machine + ambiguity reconciliation (docs/04: "Transactions
 * expired by blockhash can be refreshed without creating a new claim; when a
 * PDA already exists, compare committed intent digest and return the
 * existing record or conflict, never silently accept different data").
 *
 * pollSignature: bounded poll with backoff across processed → confirmed →
 * finalized. Transaction expiry is detected via lastValidBlockHeight; an
 * expired/ambiguous outcome NEVER triggers a blind resubmit — callers must
 * run reconcileByPda (account lookup) to determine whether the transaction
 * landed before deciding to rebuild+resign.
 */

export interface PollOptions {
  readonly target: 'confirmed' | 'finalized';
  readonly timeoutMs: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  /** lastValidBlockHeight from getLatestBlockhash for expiry detection. */
  readonly lastValidBlockHeight?: bigint;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type PollOutcome =
  | { readonly kind: 'reached'; readonly status: SignatureStatus }
  | { readonly kind: 'failed'; readonly error: unknown; readonly status: SignatureStatus }
  | { readonly kind: 'expired' } // blockhash past lastValidBlockHeight, status unknown
  | { readonly kind: 'timeout' } // poll budget exhausted, status still unknown
  | { readonly kind: 'aborted' };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const CONFIRMATION_ORDER = { processed: 0, confirmed: 1, finalized: 2 } as const;

export async function pollSignature(
  rpc: JsonRpcClient,
  signature: string,
  opts: PollOptions,
): Promise<PollOutcome> {
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = Date.now() + opts.timeoutMs;
  let delay = opts.initialDelayMs ?? 400;
  const maxDelay = opts.maxDelayMs ?? 2_000;
  const targetRank = CONFIRMATION_ORDER[opts.target];

  for (;;) {
    if (opts.signal?.aborted) return { kind: 'aborted' };
    try {
      const status = await rpc.getSignatureStatus(signature);
      if (status !== null) {
        if (status.err !== null && status.err !== undefined) {
          return { kind: 'failed', error: status.err, status };
        }
        if (CONFIRMATION_ORDER[status.confirmationStatus] >= targetRank) {
          return { kind: 'reached', status };
        }
      }
      if (opts.lastValidBlockHeight !== undefined) {
        const height = await rpc.getBlockHeight();
        if (height > opts.lastValidBlockHeight && status === null) {
          return { kind: 'expired' };
        }
      }
    } catch (e) {
      // A transient poll failure is not fatal; the send itself may have
      // landed. Surface transport errors only via the timeout path.
      if (e instanceof Error && e.name === 'RpcTransportError') {
        // fall through to deadline check
      } else {
        throw e;
      }
    }
    if (Date.now() >= deadline) return { kind: 'timeout' };
    await sleep(Math.min(delay, Math.max(50, deadline - Date.now())));
    delay = Math.min(delay * 2, maxDelay);
  }
}

/**
 * Decide what an ambiguous outcome (timeout / expired / dropped response)
 * means by looking at the canonical node PDA. Returns:
 *  - 'landed': PDA exists and the stored intent_digest matches → same record
 *  - 'conflict': PDA exists under a different intent digest → NONCE_REUSE_MISMATCH
 *  - 'absent': no PDA — safe to rebuild with a fresh blockhash and resubmit
 */
export type PdaReconcile =
  | { readonly kind: 'landed' }
  | { readonly kind: 'conflict'; readonly storedDigest: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown'; readonly error: string };

export async function reconcileNodePda(
  expectedDigest: string,
  fetchNodeDigest: () => Promise<string | null>,
): Promise<PdaReconcile> {
  try {
    const digest = await fetchNodeDigest();
    if (digest === null) return { kind: 'absent' };
    if (digest === expectedDigest) return { kind: 'landed' };
    return { kind: 'conflict', storedDigest: digest };
  } catch (e) {
    return { kind: 'unknown', error: e instanceof Error ? e.message : 'lookup failed' };
  }
}

export function pollErrorResult(outcome: PollOutcome, where: string): PortResult<never> {
  switch (outcome.kind) {
    case 'failed': {
      const mapped = extractSimulationError(outcome.error);
      if (mapped) return portErr(mapped.code, mapped.message);
      return portErr('ANCHOR_FAILED', `${where}: transaction failed on-chain ${JSON.stringify(outcome.error)}`);
    }
    case 'expired':
      return portErr(
        'TRANSACTION_EXPIRED',
        `${where}: blockhash expired without confirmation; reconcile the PDA before any resubmit`,
      );
    case 'timeout':
      return portErr(
        'TRANSACTION_EXPIRED',
        `${where}: confirmation poll timed out; outcome ambiguous — reconcile the PDA before any resubmit`,
      );
    case 'aborted':
      return portErr('ANCHOR_FAILED', `${where}: polling aborted by caller`);
    case 'reached':
      return portErr('INTERNAL_INVARIANT', `${where}: unreachable poll state`);
  }
}

export function transportErrorResult(e: unknown, where: string): PortResult<never> {
  return fail(e, where);
}

export { mapThrown };
