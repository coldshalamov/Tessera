import { portErr, type PortResult } from '@tessera/types';
import { TESSERA_PROGRAM_ID } from '@tessera/sdk';

/**
 * Relayer configuration — entirely environment-driven; no config files with
 * secrets are read from the repo. The sponsor key is referenced, never
 * embedded: TESSERA_SPONSOR_KEYPAIR_FILE points at a Solana-CLI-style JSON
 * keypair outside the repository (WSL path in this project's setup), or
 * TESSERA_SPONSOR_KEYPAIR_JSON carries the same JSON in an env var for
 * containers/tests. The secret material is loaded once at boot and never
 * written to the audit log or error messages.
 *
 * Hard requirement: the two budget caps MUST be configured — a sponsor
 * without explicit caps is refused, not defaulted to "unlimited".
 */

export type RelayerMode = 'local' | 'devnet'; // mainnet is not a relayer mode

export interface SponsorKeyRef {
  /** 'file': read JSON keypair bytes from an external path (never committed). */
  readonly kind: 'file' | 'env-json';
  /** file: filesystem path; env-json: NAME of the env var holding the JSON. */
  readonly ref: string;
}

export interface RelayerConfig {
  readonly mode: RelayerMode;
  readonly rpcUrl: string;
  readonly programId: string;
  /** When set, connect() hard-fails against any other cluster. */
  readonly expectedGenesisHash?: string;
  readonly sponsorKeyRef: SponsorKeyRef;
  /** Hard caps in lamports — both required, both enforced before signing. */
  readonly dailyCapLamports: bigint;
  readonly perAccountCapLamports: bigint;
  /** Bound on outbox retry attempts for the send/poll stage. */
  readonly maxAttempts: number;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly confirmTarget: 'confirmed' | 'finalized';
  readonly confirmTimeoutMs: number;
  /** Durable outbox state file (JSON, atomic tmp+rename). */
  readonly outboxPath: string;
  /** Append-only audit log (JSONL, no secrets). */
  readonly auditPath: string;
  /** Kill switch: env flag or the presence of this file pauses the service. */
  readonly killSwitchEnv: boolean;
  readonly killFilePath?: string;
  readonly listenHost: string;
  readonly listenPort: number;
}

function envStr(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v === '' ? undefined : v;
}

function envLamports(
  env: NodeJS.ProcessEnv,
  name: string,
): PortResult<bigint> {
  const v = envStr(env, name);
  if (v === undefined || !/^(0|[1-9][0-9]{0,19})$/.test(v)) {
    return portErr('INVALID_INTENT', `${name} must be a non-negative integer decimal string`);
  }
  return { ok: true, value: BigInt(v) };
}

export function loadRelayerConfig(env: NodeJS.ProcessEnv): PortResult<RelayerConfig> {
  const modeRaw = envStr(env, 'TESSERA_RELAYER_MODE') ?? 'local';
  if (modeRaw === 'mainnet') {
    return portErr(
      'MAINNET_WRITES_DISABLED',
      'TESSERA_RELAYER_MODE=mainnet is refused: mainnet writes are an explicit approval gate and this relayer only runs local/devnet',
    );
  }
  if (modeRaw !== 'local' && modeRaw !== 'devnet') {
    return portErr('INVALID_INTENT', `TESSERA_RELAYER_MODE must be 'local' or 'devnet', got '${modeRaw}'`);
  }
  const mode: RelayerMode = modeRaw;

  const rpcUrl = envStr(env, 'TESSERA_RELAYER_RPC_URL');
  if (!rpcUrl) return portErr('INVALID_INTENT', 'TESSERA_RELAYER_RPC_URL is required');

  const keyFile = envStr(env, 'TESSERA_SPONSOR_KEYPAIR_FILE');
  const keyJsonVar = envStr(env, 'TESSERA_SPONSOR_KEYPAIR_JSON') !== undefined
    ? 'TESSERA_SPONSOR_KEYPAIR_JSON'
    : undefined;
  let sponsorKeyRef: SponsorKeyRef;
  if (keyFile) {
    sponsorKeyRef = { kind: 'file', ref: keyFile };
  } else if (keyJsonVar) {
    sponsorKeyRef = { kind: 'env-json', ref: keyJsonVar };
  } else {
    return portErr(
      'AUTH_REQUIRED',
      'sponsor key reference required: set TESSERA_SPONSOR_KEYPAIR_FILE (external path) or TESSERA_SPONSOR_KEYPAIR_JSON',
    );
  }

  const daily = envLamports(env, 'TESSERA_SPONSOR_DAILY_CAP_LAMPORTS');
  if (!daily.ok) return portErr(daily.error.code, `${daily.error.message} (hard cap is mandatory)`);
  const perAccount = envLamports(env, 'TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS');
  if (!perAccount.ok) return portErr(perAccount.error.code, `${perAccount.error.message} (hard cap is mandatory)`);
  if (daily.value === 0n || perAccount.value === 0n) {
    return portErr('INVALID_INTENT', 'sponsor caps of 0 lamports make the relayer a no-op; set real caps');
  }

  const outboxPath = envStr(env, 'TESSERA_RELAYER_OUTBOX_FILE');
  const auditPath = envStr(env, 'TESSERA_RELAYER_AUDIT_FILE');
  if (!outboxPath) return portErr('INVALID_INTENT', 'TESSERA_RELAYER_OUTBOX_FILE is required');
  if (!auditPath) return portErr('INVALID_INTENT', 'TESSERA_RELAYER_AUDIT_FILE is required');

  const num = (name: string, dflt: number): number => {
    const v = envStr(env, name);
    if (v === undefined) return dflt;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : dflt;
  };

  const listenRaw = envStr(env, 'TESSERA_RELAYER_LISTEN') ?? '127.0.0.1:8787';
  const colon = listenRaw.lastIndexOf(':');
  const listenHost = colon > 0 ? listenRaw.slice(0, colon) : '127.0.0.1';
  const listenPort = colon > 0 ? Number(listenRaw.slice(colon + 1)) : 8787;

  const cfg: RelayerConfig = {
    mode,
    rpcUrl,
    programId: envStr(env, 'TESSERA_RELAYER_PROGRAM_ID') ?? TESSERA_PROGRAM_ID,
    ...(envStr(env, 'TESSERA_RELAYER_EXPECTED_GENESIS') !== undefined
      ? { expectedGenesisHash: envStr(env, 'TESSERA_RELAYER_EXPECTED_GENESIS')! }
      : {}),
    sponsorKeyRef,
    dailyCapLamports: daily.value,
    perAccountCapLamports: perAccount.value,
    maxAttempts: num('TESSERA_RELAYER_MAX_ATTEMPTS', 8),
    baseRetryDelayMs: num('TESSERA_RELAYER_BASE_RETRY_MS', 500),
    maxRetryDelayMs: num('TESSERA_RELAYER_MAX_RETRY_MS', 15_000),
    confirmTarget: envStr(env, 'TESSERA_RELAYER_CONFIRM_TARGET') === 'finalized' ? 'finalized' : 'confirmed',
    confirmTimeoutMs: num('TESSERA_RELAYER_CONFIRM_TIMEOUT_MS', 60_000),
    outboxPath,
    auditPath,
    killSwitchEnv: envStr(env, 'TESSERA_RELAYER_KILL_SWITCH') === '1',
    ...(envStr(env, 'TESSERA_RELAYER_KILL_FILE') !== undefined
      ? { killFilePath: envStr(env, 'TESSERA_RELAYER_KILL_FILE')! }
      : {}),
    listenHost,
    listenPort: Number.isInteger(listenPort) && listenPort > 0 ? listenPort : 8787,
  };
  return { ok: true, value: cfg };
}
