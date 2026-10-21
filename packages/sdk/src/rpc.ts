import { base64ToBytes } from './bytes.js';

/**
 * Minimal fetch-based Solana JSON-RPC client. No @solana/web3.js: the SDK
 * surface needs ~10 methods, and pulling the full client would drag a
 * Workers-incompatible dependency tree for no additional correctness —
 * every method below is exercised against a real `solana-test-validator`
 * by the gated localnet suite (tests/sdk).
 *
 * Errors are typed: `RpcTransportError` (HTTP/timeout/unreachable — never
 * contains secrets) and `RpcResponseError` (JSON-RPC error object, which
 * includes on-chain custom error codes used by errors.ts).
 */

export type Commitment = 'processed' | 'confirmed' | 'finalized';

export class RpcTransportError extends Error {
  readonly kind: 'http' | 'timeout' | 'network' | 'malformed';
  constructor(kind: RpcTransportError['kind'], message: string) {
    super(message);
    this.name = 'RpcTransportError';
    this.kind = kind;
  }
}

export interface RpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export class RpcResponseError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(payload: RpcErrorPayload) {
    super(payload.message);
    this.name = 'RpcResponseError';
    this.code = payload.code;
    this.data = payload.data;
  }
}

export interface RpcClientOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Static headers (e.g. devnet provider auth tokens — injected, never logged). */
  readonly headers?: Readonly<Record<string, string>>;
}

export class JsonRpcClient {
  readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly headers?: Readonly<Record<string, string>>;
  private nextId = 1;

  constructor(url: string, opts: RpcClientOptions = {}) {
    this.url = url;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    if (opts.fetchImpl) this.fetchImpl = opts.fetchImpl;
    if (opts.headers) this.headers = opts.headers;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    if (fetchImpl === undefined) {
      throw new RpcTransportError('network', 'fetch is unavailable in this runtime');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: controller.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch failed';
      throw new RpcTransportError(
        e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network',
        `${method}: ${msg}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new RpcTransportError('http', `${method}: HTTP ${res.status}`);
    let body: { result?: T; error?: RpcErrorPayload };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new RpcTransportError('malformed', `${method}: non-JSON response`);
    }
    if (body.error) throw new RpcResponseError(body.error);
    return body.result as T;
  }

  // -- typed surface -------------------------------------------------------

  async getGenesisHash(): Promise<string> {
    return this.call<string>('getGenesisHash');
  }

  async getLatestBlockhash(commitment: Commitment = 'confirmed'): Promise<{
    blockhash: string;
    lastValidBlockHeight: bigint;
  }> {
    const r = await this.call<{
      context: { slot: number };
      value: { blockhash: string; lastValidBlockHeight: number };
    }>('getLatestBlockhash', [{ commitment }]);
    return {
      blockhash: r.value.blockhash,
      lastValidBlockHeight: BigInt(r.value.lastValidBlockHeight),
    };
  }

  async getBlockHeight(commitment: Commitment = 'confirmed'): Promise<bigint> {
    const r = await this.call<number>('getBlockHeight', [{ commitment }]);
    return BigInt(r);
  }

  async getAccountInfo(
    address: string,
    commitment: Commitment = 'confirmed',
  ): Promise<RpcAccountInfo | null> {
    const r = await this.call<{ value: RawAccount | null }>('getAccountInfo', [
      address,
      { encoding: 'base64', commitment },
    ]);
    const v = r.value;
    if (v === null) return null;
    const data = base64ToBytes(v.data[0] ?? '');
    if (data === null) throw new RpcTransportError('malformed', 'getAccountInfo: bad base64 data');
    return {
      data,
      owner: v.owner,
      lamports: BigInt(v.lamports),
      executable: v.executable,
    };
  }

  async getMinimumBalanceForRentExemption(bytes: number): Promise<bigint> {
    const r = await this.call<number>('getMinimumBalanceForRentExemption', [bytes]);
    return BigInt(r);
  }

  async getBalance(address: string, commitment: Commitment = 'confirmed'): Promise<bigint> {
    const r = await this.call<{ value: number }>('getBalance', [address, { commitment }]);
    return BigInt(r.value);
  }

  async requestAirdrop(address: string, lamports: bigint): Promise<string> {
    return this.call<string>('requestAirdrop', [address, Number(lamports)]);
  }

  async sendTransaction(
    txBase64: string,
    opts: { skipPreflight?: boolean; preflightCommitment?: Commitment; maxRetries?: number } = {},
  ): Promise<string> {
    return this.call<string>('sendTransaction', [
      txBase64,
      {
        encoding: 'base64',
        skipPreflight: opts.skipPreflight ?? false,
        preflightCommitment: opts.preflightCommitment ?? 'confirmed',
        ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
      },
    ]);
  }

  async simulateTransaction(
    txBase64: string,
    opts: { sigVerify?: boolean; commitment?: Commitment } = {},
  ): Promise<SimulateResult> {
    const r = await this.call<{ value: SimulateResult }>('simulateTransaction', [
      txBase64,
      {
        encoding: 'base64',
        sigVerify: opts.sigVerify ?? true,
        commitment: opts.commitment ?? 'confirmed',
      },
    ]);
    return r.value;
  }

  async getSignatureStatus(signature: string): Promise<SignatureStatus | null> {
    const r = await this.call<{ value: (RawSignatureStatus | null)[] }>(
      'getSignatureStatuses',
      [[signature], { searchTransactionHistory: true }],
    );
    const v = r.value[0];
    if (v === null || v === undefined) return null;
    return {
      slot: BigInt(v.slot),
      confirmationStatus: v.confirmationStatus ?? 'processed',
      err: v.err,
    };
  }

  async getTransaction(signature: string): Promise<RawTransaction | null> {
    const r = await this.call<RawTransaction | null>('getTransaction', [
      signature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]);
    return r;
  }
}

export interface RawAccount {
  readonly data: [string, string];
  readonly owner: string;
  readonly lamports: number;
  readonly executable: boolean;
}

export interface RpcAccountInfo {
  readonly data: Uint8Array;
  readonly owner: string;
  readonly lamports: bigint;
  readonly executable: boolean;
}

export interface SimulateResult {
  readonly err: unknown;
  readonly logs: string[] | null;
  readonly unitsConsumed?: number;
  readonly accounts?: unknown;
}

export interface RawSignatureStatus {
  readonly slot: number;
  readonly confirmations: number | null;
  readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  readonly err: unknown;
}

export interface SignatureStatus {
  readonly slot: bigint;
  readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized';
  readonly err: unknown;
}

export interface RawTransaction {
  readonly slot: number;
  readonly transaction?: {
    readonly message?: { readonly accountKeys?: readonly string[] };
    readonly signatures?: readonly string[];
  };
  readonly meta?: {
    readonly fee?: number;
    readonly err?: unknown;
    readonly computeUnitsConsumed?: number;
  } | null;
}
