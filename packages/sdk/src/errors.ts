import { portErr, type PortError, type PortErrorCode, type PortResult } from '@tessera/types';
import { ONCHAIN_ERROR_MAP } from './contract.js';
import { RpcResponseError, RpcTransportError } from './rpc.js';
import { InstructionBuildError } from './instructions.js';
import { TxBuildError } from './tx.js';
import { AccountDecodeError } from './accounts.js';

/**
 * Error mapping. Rules:
 *  - Every public SDK path returns a typed PortError; nothing throws for
 *    expected failures and nothing leaks secrets (only public keys, digests,
 *    program-derived addresses and RPC-supplied messages appear in text —
 *    an RPC error echoing a transaction would expose no secret anyway since
 *    signatures are not secret).
 *  - On-chain custom errors map through the pinned IDL error table
 *    (ONCHAIN_ERROR_MAP); unmapped codes → INSTRUCTION_REJECTED with the
 *    numeric code so new program versions can't be silently misread.
 *  - Transport failures → RPC_UNREACHABLE (or RPC_RATE_LIMITED on HTTP 429 /
 *    Agave's -32429-style rate signals).
 */

export function mapThrown(e: unknown, where: string): PortError {
  if (e instanceof RpcTransportError) {
    const limited = e.kind === 'http' && e.message.includes('429');
    return {
      code: limited ? 'RPC_RATE_LIMITED' : 'RPC_UNREACHABLE',
      message: `${where}: ${e.message}`,
    };
  }
  if (e instanceof RpcResponseError) {
    if (e.code === -32429 || /rate.?limit|too many requests/i.test(e.message)) {
      return { code: 'RPC_RATE_LIMITED', message: `${where}: ${e.message}` };
    }
    const custom = extractCustomError(e);
    if (custom !== null) {
      const mapped = ONCHAIN_ERROR_MAP.get(custom);
      if (mapped) {
        return {
          code: mapped.code as PortErrorCode,
          message: `${where}: on-chain ${mapped.name} (${custom})`,
        };
      }
      return {
        code: 'INSTRUCTION_REJECTED',
        message: `${where}: unrecognized program error ${custom}`,
      };
    }
    if (/blockhash|expired/i.test(e.message)) {
      return { code: 'TRANSACTION_EXPIRED', message: `${where}: ${e.message}` };
    }
    if (/too large|exceeds.*size|packet/i.test(e.message)) {
      return { code: 'TRANSACTION_TOO_LARGE', message: `${where}: ${e.message}` };
    }
    return { code: 'ANCHOR_FAILED', message: `${where}: RPC ${e.code} ${e.message}` };
  }
  if (e instanceof AccountDecodeError) {
    return { code: 'UNSUPPORTED_VERSION', message: `${where}: ${e.message}` };
  }
  if (e instanceof TxBuildError) {
    return e.message.includes('exceeds')
      ? { code: 'TRANSACTION_TOO_LARGE', message: `${where}: ${e.message}` }
      : { code: 'INVALID_INTENT', message: `${where}: ${e.message}` };
  }
  if (e instanceof InstructionBuildError) {
    return { code: 'INVALID_INTENT', message: `${where}: ${e.message}` };
  }
  return {
    code: 'ANCHOR_FAILED',
    message: `${where}: ${e instanceof Error ? e.message : 'unknown error'}`,
  };
}

export function fail<T>(e: unknown, where: string): PortResult<T> {
  const err = mapThrown(e, where);
  return portErr(err.code, err.message);
}

/** Pull the program custom error code out of an RPC error payload. */
export function extractCustomError(e: RpcResponseError): number | null {
  const fromData = searchInstructionError(e.data);
  if (fromData !== null) return fromData;
  // Some surfaces carry the code only in the message/log tail:
  const m = /custom program error: (0x[0-9a-f]+|\d+)/i.exec(e.message);
  if (m) return m[1]!.startsWith('0x') ? parseInt(m[1]!, 16) : parseInt(m[1]!, 10);
  return null;
}

function searchInstructionError(v: unknown): number | null {
  if (v === null || typeof v !== 'object') return null;
  if (Array.isArray(v)) {
    // [instrIndex, { InstructionError: [idx, { Custom: n }] }] patterns
    for (const item of v) {
      const r = searchInstructionError(item);
      if (r !== null) return r;
    }
    return null;
  }
  const rec = v as Record<string, unknown>;
  if (typeof rec['Custom'] === 'number') return rec['Custom'];
  for (const k of Object.keys(rec)) {
    const r = searchInstructionError(rec[k]);
    if (r !== null) return r;
  }
  return null;
}

/** Simulation failure `err` values carry the same InstructionError shape. */
export function extractSimulationError(err: unknown): PortError | null {
  if (err === null || err === undefined) return null;
  const custom = searchInstructionError(err);
  if (custom !== null) {
    const mapped = ONCHAIN_ERROR_MAP.get(custom);
    if (mapped) {
      return {
        code: mapped.code as PortErrorCode,
        message: `simulation: on-chain ${mapped.name} (${custom})`,
      };
    }
    return {
      code: 'INSTRUCTION_REJECTED',
      message: `simulation: unrecognized program error ${custom}`,
    };
  }
  return {
    code: 'ANCHOR_FAILED',
    message: `simulation failed: ${JSON.stringify(err)}`,
  };
}
