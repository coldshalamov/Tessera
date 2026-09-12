import type { NodeRef } from '@tessera/types';
import type { EvidenceCheck } from './report.js';

/**
 * Minimal read-only Solana JSON-RPC check: `getAccountInfo` on the selected
 * leaf at 'finalized' commitment. Deliberately narrow — it can prove an
 * account EXISTS and is owned by the claimed program (or contradict the
 * bundle), nothing more. Account bytes are not decoded: no on-chain layout
 * codec exists until T03, and a single RPC response is a labeled trust
 * assumption, not independent finality.
 *
 * Workers-safe (fetch only). Unreachable endpoints produce 'incomplete',
 * never a fabricated pass; contradictory owner/absent account produces
 * 'fail'.
 */

export interface RpcOptions {
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

interface AccountInfoResult {
  readonly exists: boolean;
  readonly owner: string | null;
  readonly executable: boolean | null;
}

async function fetchAccountInfo(
  rpcUrl: string,
  address: string,
  opts: RpcOptions,
): Promise<{ ok: true; value: AccountInfoResult } | { ok: false; error: string }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) return { ok: false, error: 'fetch unavailable in this runtime' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [address, { encoding: 'base64', commitment: 'finalized' }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as {
      error?: { message?: string };
      result?: { value?: { owner?: string; executable?: boolean } | null };
    };
    if (body.error) return { ok: false, error: body.error.message ?? 'RPC error' };
    const value = body.result?.value;
    if (value === null || value === undefined) {
      return { ok: true, value: { exists: false, owner: null, executable: null } };
    }
    return {
      ok: true,
      value: {
        exists: true,
        owner: typeof value.owner === 'string' ? value.owner : null,
        executable: typeof value.executable === 'boolean' ? value.executable : null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read-only `getMinimumBalanceForRentExemption(bytes)` — the live rent
 * quote for a given account size (docs/04: "Quote rent with the live
 * getMinimumBalanceForRentExemption for exact bytes"). The byte count is a
 * caller-supplied ESTIMATE until T03 fixes the layout, so callers must
 * label results accordingly. Returns lamports as a decimal string.
 */
export async function rpcRentExemption(
  rpcUrl: string,
  bytes: number,
  opts: RpcOptions,
): Promise<{ ok: true; lamports: string } | { ok: false; error: string }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) return { ok: false, error: 'fetch unavailable in this runtime' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getMinimumBalanceForRentExemption',
        params: [bytes],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { error?: { message?: string }; result?: number };
    if (body.error) return { ok: false, error: body.error.message ?? 'RPC error' };
    if (typeof body.result !== 'number' || !Number.isSafeInteger(body.result) || body.result < 0) {
      return { ok: false, error: 'malformed getMinimumBalanceForRentExemption result' };
    }
    return { ok: true, lamports: body.result.toString(10) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function rpcAccountChecks(
  rpcUrl: string,
  leaf: NodeRef,
  opts: RpcOptions,
): Promise<EvidenceCheck[]> {
  const checks: EvidenceCheck[] = [];
  const host = (() => {
    try {
      return new URL(rpcUrl).host;
    } catch {
      return rpcUrl;
    }
  })();
  const info = await fetchAccountInfo(rpcUrl, leaf.node_address, opts);
  if (!info.ok) {
    checks.push({
      name: 'chain.rpc',
      result: 'incomplete',
      detail: `RPC ${host} unreachable/failed: ${info.error} — offline checks only; unavailable network is not a verdict`,
    });
    return checks;
  }
  if (!info.value.exists) {
    checks.push({
      name: 'chain.rpc',
      result: 'fail',
      detail: `leaf account ${leaf.node_address} absent on ${host} at finalized commitment — bundle claims contradict queried chain state`,
    });
    return checks;
  }
  if (info.value.owner !== leaf.program_id) {
    checks.push({
      name: 'chain.rpc',
      result: 'fail',
      detail: `leaf account owner ${info.value.owner ?? 'unknown'} != expected program ${leaf.program_id} — contradictory chain state`,
    });
    return checks;
  }
  checks.push({
    name: 'chain.rpc',
    result: 'pass',
    detail: `leaf account exists on ${host} and is owned by the claimed program (account bytes NOT decoded — no on-chain layout codec until T03)`,
  });
  checks.push({
    name: 'chain.finality',
    result: 'warn',
    detail: `single-RPC getAccountInfo(finalized) on ${host} is a trust assumption about that endpoint, not independent finality verification; no archival proof/checkpoint system is used`,
  });
  return checks;
}
