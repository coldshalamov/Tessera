import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  JsonRpcClient,
  LocalTransactionSigner,
  appendContributionIx,
  bytesToBase64,
  compileMessage,
  createSolanaTesseraPort,
  publishRootIx,
  serializeTransaction,
  transactionSignatures,
  type SolanaTesseraPort,
  type TransactionSigner,
} from '@tessera/sdk';
import {
  base58AddressToBytes,
  base58Encode,
  intentDigestHex,
  parseIntentV1,
  portErr,
  verifyEd25519Detached,
  type IntentV1,
  type NodeRef,
  type PortResult,
  type Submission,
} from '@tessera/types';
import type { AuditLog } from './audit.js';
import type { RelayerConfig } from './config.js';
import type { OutboxRow, OutboxStore } from './outbox.js';
import { decodeFieldBase64, reviewSponsoredMessage } from './review.js';

/**
 * RelayerService — bounded sponsor for Tessera writes (docs/04 "Funds and
 * sponsor service"; packet T04).
 *
 * Two-call flow (the server compiles the transaction; clients never hand it
 * wire bytes):
 *   1. prepare({intent, consent_signature_base64, idempotency_key})
 *      → parse + verify the detached consent signature → on-chain preflight
 *      → build the message (fresh blockhash) → persist outbox row → return
 *      {message_base64, required_client_signers, …}.
 *   2. submit({idempotency_key, tx_signatures})
 *      → load row → verify each required signature over the stored message
 *      → review the stored message against the relayer's own instruction
 *        build (exact match) → hard cap check → sponsor co-signs →
 *        simulate → send → poll → PDA reconcile on ambiguity → persist row.
 *
 * Expiry rule: a dead blockhash moves the row back to pending_signature with
 * a NEW message (the client must re-sign it). The intent/nonce is unchanged,
 * so even a late-landing old transaction is an idempotent replay, and the
 * PDA compare runs before any resend — never a blind resubmit.
 *
 * Hard caps: daily (UTC) and per-contributor lamport ceilings are enforced
 * before the sponsor signs; a denied intake is preserved as a `held` row
 * with SPONSOR_BUDGET_EXHAUSTED, not dropped. The kill switch (env or file)
 * pauses the service while preserving every recorded intent.
 */

export interface PrepareRequest {
  readonly intent: unknown;
  /** Detached Ed25519 consent signature over the intent digest (base64). */
  readonly consent_signature_base64: string;
  readonly idempotency_key: string;
}

export interface PrepareResult {
  readonly idempotency_key: string;
  readonly status: 'pending_signature' | 'confirmed' | 'finalized';
  readonly intent_sha256: string;
  readonly node_address: string;
  readonly message_base64?: string;
  readonly blockhash?: string;
  readonly last_valid_block_height?: string;
  /** Signer pubkeys the client must provide tx signatures for. */
  readonly required_client_signers?: readonly string[];
}

export interface SubmitRequest {
  readonly idempotency_key: string;
  /** base58 pubkey → base64 Ed25519 signature over the stored message. */
  readonly tx_signatures: Record<string, string>;
}

export interface RelayerStatus {
  readonly mode: RelayerConfig['mode'];
  readonly paused: boolean;
  readonly sponsor: string;
  readonly program_id: string;
  readonly daily_cap_lamports: string;
  readonly daily_spent_lamports: string;
  readonly per_account_cap_lamports: string;
  readonly outbox: { pending: number; submitted: number; terminal: number };
}

/** Relayer-local codes layered on the contract vocabulary. */
type RelayerErrorCode =
  | 'SPONSOR_PAUSED'
  | 'MISSING_TX_SIGNATURES'
  | 'MALFORMED_REQUEST';

function relayerErr(code: RelayerErrorCode, message: string): PortResult<never> {
  // These codes are registered in @tessera/types as relayer extensions.
  return portErr(code as never, message);
}

function toSubmission(row: OutboxRow, mode: RelayerConfig['mode'], genesis: string): Submission {
  const statusMap: Record<OutboxRow['status'], Submission['status']> = {
    pending_signature: 'awaiting_signature',
    held: 'queued',
    ready: 'queued',
    submitted: 'submitted',
    confirmed: 'confirmed',
    finalized: 'finalized',
    failed: 'submitted',
  };
  const node_ref: NodeRef | null =
    row.status === 'confirmed' || row.status === 'finalized' || row.status === 'submitted'
      ? {
          genesis_hash: genesis,
          program_id: row.intent.program_id,
          project_address: row.intent.project_address,
          node_address: row.node_address,
        }
      : null;
  return {
    id: row.intent_digest,
    status: statusMap[row.status],
    // 'local' = no chain commitment yet — an honest "not final" marker, never
    // a simulated-success claim (the mode field still says local/devnet).
    finality:
      row.status === 'finalized' ? 'finalized' : row.status === 'confirmed' ? 'confirmed' : 'local',
    mode,
    node_ref,
    ...(row.error !== undefined
      ? { error: { code: row.error.code as never, message: row.error.message } }
      : {}),
  };
}

export class RelayerService {
  private readonly cfg: RelayerConfig;
  private readonly sponsor: TransactionSigner;
  private readonly outbox: OutboxStore;
  private readonly audit: AuditLog;
  private readonly port: SolanaTesseraPort;
  private readonly rpc: JsonRpcClient;
  private readonly now: () => number;

  private constructor(args: {
    cfg: RelayerConfig;
    sponsor: TransactionSigner;
    outbox: OutboxStore;
    audit: AuditLog;
    port: SolanaTesseraPort;
    rpc: JsonRpcClient;
    now?: () => number;
  }) {
    this.cfg = args.cfg;
    this.sponsor = args.sponsor;
    this.outbox = args.outbox;
    this.audit = args.audit;
    this.port = args.port;
    this.rpc = args.rpc;
    this.now = args.now ?? (() => Date.now());
  }

  /** Build the service: load the sponsor key (file/env ref), open stores. */
  static async create(args: {
    cfg: RelayerConfig;
    outbox: OutboxStore;
    audit: AuditLog;
    env?: NodeJS.ProcessEnv;
    port?: SolanaTesseraPort;
    rpc?: JsonRpcClient;
    sponsor?: TransactionSigner;
    now?: () => number;
  }): Promise<PortResult<RelayerService>> {
    let sponsor = args.sponsor;
    if (!sponsor) {
      const ref = args.cfg.sponsorKeyRef;
      let json: string;
      try {
        json =
          ref.kind === 'file'
            ? await readFile(ref.ref, 'utf8')
            : (args.env ?? process.env)[ref.ref] ?? '';
      } catch (e) {
        return portErr(
          'AUTH_REQUIRED',
          `sponsor keypair unreadable at configured ref: ${e instanceof Error ? e.message : 'read failed'}`,
        );
      }
      const loaded = await LocalTransactionSigner.fromKeypairJson(json);
      if (!loaded) {
        return portErr(
          'AUTH_REQUIRED',
          'sponsor keypair ref did not contain a valid 32/64-byte Solana JSON keypair',
        );
      }
      sponsor = loaded;
    }
    const rpc = args.rpc ?? new JsonRpcClient(args.cfg.rpcUrl);
    const port =
      args.port ??
      createSolanaTesseraPort({
        mode: args.cfg.mode,
        rpcUrl: args.cfg.rpcUrl,
        programId: args.cfg.programId,
        ...(args.cfg.expectedGenesisHash !== undefined
          ? { expectedGenesisHash: args.cfg.expectedGenesisHash }
          : {}),
        payer: sponsor,
        signers: [sponsor],
        confirmTarget: args.cfg.confirmTarget,
        confirmTimeoutMs: args.cfg.confirmTimeoutMs,
      });
    return {
      ok: true,
      value: new RelayerService({
        cfg: args.cfg,
        sponsor,
        outbox: args.outbox,
        audit: args.audit,
        port,
        rpc,
        ...(args.now ? { now: args.now } : {}),
      }),
    };
  }

  get sponsorPubkey(): string {
    return this.sponsor.publicKey;
  }

  /** Kill switch: env flag or kill-file presence. Cheap, checked per call. */
  paused(): boolean {
    if (this.cfg.killSwitchEnv) return true;
    if (this.cfg.killFilePath !== undefined && existsSync(this.cfg.killFilePath)) return true;
    return false;
  }

  async status(): Promise<RelayerStatus> {
    const rows = this.outbox.rows();
    return {
      mode: this.cfg.mode,
      paused: this.paused(),
      sponsor: this.sponsor.publicKey,
      program_id: this.cfg.programId,
      daily_cap_lamports: this.cfg.dailyCapLamports.toString(10),
      daily_spent_lamports: this.outbox.dailySpend(this.now()).toString(10),
      per_account_cap_lamports: this.cfg.perAccountCapLamports.toString(10),
      outbox: {
        pending: rows.filter(
          (r) => r.status === 'pending_signature' || r.status === 'held' || r.status === 'ready',
        ).length,
        submitted: rows.filter((r) => r.status === 'submitted').length,
        terminal: rows.filter(
          (r) => r.status === 'confirmed' || r.status === 'finalized' || r.status === 'failed',
        ).length,
      },
    };
  }

  // ------------------------------------------------------------------------
  // Step 1 — prepare
  // ------------------------------------------------------------------------

  async prepare(req: PrepareRequest): Promise<PortResult<PrepareResult>> {
    if (
      typeof req.idempotency_key !== 'string' ||
      req.idempotency_key.length === 0 ||
      req.idempotency_key.length > 128
    ) {
      return portErr('INVALID_INTENT', 'idempotency_key is required (1..128 chars)');
    }
    const parsed = parseIntentV1(req.intent);
    if (!parsed.ok) {
      return portErr(
        'INVALID_INTENT',
        `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`,
      );
    }
    const intent: IntentV1 = parsed.value;
    const digest = await intentDigestHex(intent);
    if (!digest.ok) return portErr('CRYPTO_UNAVAILABLE', digest.error.message);

    const prior = this.outbox.get(req.idempotency_key);
    if (prior) {
      if (prior.intent_digest !== digest.value) {
        return portErr(
          'NONCE_REUSE_MISMATCH',
          'idempotency key already bound to a different intent digest',
        );
      }
      return this.currentPrepareState(prior);
    }

    // The detached consent signature binds the contributor key to this digest.
    const sig = decodeFieldBase64(req.consent_signature_base64, 'consent_signature_base64');
    if (!sig.ok) return sig;
    const pub = base58AddressToBytes(intent.contributor);
    if (pub === null) return portErr('INVALID_INTENT', 'intent.contributor is not a base58 key');
    const digestBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) digestBytes[i] = parseInt(digest.value.slice(i * 2, i * 2 + 2), 16);
    const okSig = await verifyEd25519Detached(pub, sig.value, digestBytes);
    if (!okSig.ok) return portErr('CRYPTO_UNAVAILABLE', okSig.error.message);
    if (!okSig.value) {
      this.audit.record({
        event: 'intake_rejected',
        idempotency_key: req.idempotency_key,
        intent_digest: digest.value,
        contributor: intent.contributor,
        error_code: 'INVALID_SIGNATURE',
        detail: 'consent signature does not verify over the intent digest',
      });
      return portErr(
        'INVALID_SIGNATURE',
        'detached consent signature does not verify over the intent digest',
      );
    }

    const pre = await this.port.preflightContribution(intent);
    if (!pre.ok) {
      this.audit.record({
        event: 'intake_rejected',
        idempotency_key: req.idempotency_key,
        intent_digest: digest.value,
        contributor: intent.contributor,
        error_code: pre.error.code,
        detail: pre.error.message,
      });
      return pre;
    }

    // Already on-chain under the same digest → terminal idempotent answer.
    if (pre.value.existing !== null) {
      const row = this.baseRow(req, intent, digest.value, pre.value.nodeAddress);
      row.status = pre.value.existingFinality;
      const saved = this.outbox.put(row);
      if (!saved.ok) return saved;
      this.audit.record({
        event: pre.value.existingFinality,
        idempotency_key: row.idempotency_key,
        intent_digest: digest.value,
        node_address: row.node_address,
        detail: 'already on-chain (idempotent intake)',
      });
      return {
        ok: true,
        value: {
          idempotency_key: row.idempotency_key,
          status: pre.value.existingFinality,
          intent_sha256: digest.value,
          node_address: row.node_address,
        },
      };
    }

    if (this.paused()) {
      const row = this.baseRow(req, intent, digest.value, pre.value.nodeAddress);
      return this.hold(
        row,
        'SPONSOR_PAUSED',
        'relayer is paused (kill switch); the intent is preserved, nothing was signed',
      );
    }

    const built = await this.port.buildContributionMessage(intent, this.sponsor.publicKey);
    if (!built.ok) return built;

    const required = built.value.signerKeys.filter((k) => k !== this.sponsor.publicKey);
    const row = this.baseRow(req, intent, digest.value, built.value.nodeAddress);
    row.message_base64 = bytesToBase64(built.value.message);
    row.blockhash = built.value.blockhash;
    row.last_valid_block_height = built.value.lastValidBlockHeight.toString(10);
    row.required_client_signers = required;
    row.status = 'pending_signature';
    const saved = this.outbox.put(row);
    if (!saved.ok) return saved;
    this.audit.record({
      event: 'intake_prepared',
      idempotency_key: row.idempotency_key,
      intent_digest: digest.value,
      node_address: row.node_address,
      contributor: intent.contributor,
      instruction: intent.economic_parent === null ? 'publish_root' : 'append_contribution',
    });
    return {
      ok: true,
      value: {
        idempotency_key: row.idempotency_key,
        status: 'pending_signature',
        intent_sha256: digest.value,
        node_address: row.node_address,
        message_base64: row.message_base64,
        blockhash: row.blockhash,
        last_valid_block_height: row.last_valid_block_height,
        required_client_signers: required,
      },
    };
  }

  private baseRow(
    req: PrepareRequest,
    intent: IntentV1,
    digest: string,
    nodeAddress: string,
  ): OutboxRow {
    return {
      idempotency_key: req.idempotency_key,
      intent,
      intent_digest: digest,
      node_address: nodeAddress,
      contributor: intent.contributor,
      message_base64: '',
      blockhash: '',
      last_valid_block_height: '0',
      estimated_lamports: '0',
      required_client_signers: [],
      status: 'held',
      attempts: 0,
      created_at: this.now(),
      updated_at: this.now(),
    };
  }

  private currentPrepareState(row: OutboxRow): PortResult<PrepareResult> {
    if (row.status === 'confirmed' || row.status === 'finalized') {
      return {
        ok: true,
        value: {
          idempotency_key: row.idempotency_key,
          status: row.status,
          intent_sha256: row.intent_digest,
          node_address: row.node_address,
        },
      };
    }
    if (row.status === 'held') {
      return relayerErr(
        'SPONSOR_PAUSED',
        `intake is held: ${row.error?.message ?? 'awaiting resume'} — the intent is preserved`,
      );
    }
    if (row.status === 'pending_signature') {
      return {
        ok: true,
        value: {
          idempotency_key: row.idempotency_key,
          status: 'pending_signature',
          intent_sha256: row.intent_digest,
          node_address: row.node_address,
          message_base64: row.message_base64,
          blockhash: row.blockhash,
          last_valid_block_height: row.last_valid_block_height,
          required_client_signers: row.required_client_signers,
        },
      };
    }
    // ready/submitted/failed: the client already signed; resubmission path.
    return {
      ok: true,
      value: {
        idempotency_key: row.idempotency_key,
        status: 'pending_signature',
        intent_sha256: row.intent_digest,
        node_address: row.node_address,
      },
    };
  }

  private hold(row: OutboxRow, code: string, message: string): PortResult<never> {
    row.status = 'held';
    row.error = { code, message };
    const saved = this.outbox.put(row);
    this.audit.record({
      event: 'intake_held',
      idempotency_key: row.idempotency_key,
      intent_digest: row.intent_digest,
      node_address: row.node_address,
      contributor: row.contributor,
      error_code: code,
      detail: message,
    });
    if (!saved.ok) return saved;
    return portErr(code as never, message);
  }

  // ------------------------------------------------------------------------
  // Step 2 — submit
  // ------------------------------------------------------------------------

  async submit(req: SubmitRequest): Promise<PortResult<Submission>> {
    const row = this.outbox.get(req.idempotency_key);
    if (!row) return portErr('NOT_FOUND', `unknown idempotency key ${req.idempotency_key}`);

    if (row.status === 'confirmed' || row.status === 'finalized') {
      return this.currentSubmission(row);
    }

    if (this.paused()) {
      row.status = 'held';
      row.error = {
        code: 'SPONSOR_PAUSED',
        message: 'relayer is paused (kill switch); the intent is preserved',
      };
      const s = this.outbox.put(row);
      if (!s.ok) return s;
      this.audit.record({
        event: 'paused',
        idempotency_key: row.idempotency_key,
        intent_digest: row.intent_digest,
      });
      return relayerErr('SPONSOR_PAUSED', 'relayer is paused; the intent is preserved in the outbox');
    }
    if (row.status === 'held') {
      // Held rows become submittable when the hold reason clears.
      row.status = 'pending_signature';
      row.error = undefined;
    }

    // Expired blockhash → rebuild the message and ask the client to re-sign
    // (same intent/nonce; the on-chain PDA compare keeps it idempotent).
    if (row.status === 'pending_signature' && row.message_base64 !== '') {
      const stale = await this.messageStale(row);
      if (stale.ok && stale.value) {
        const rebuilt = await this.rebuildMessage(row);
        if (!rebuilt.ok) return rebuilt;
        return portErr(
          'TRANSACTION_EXPIRED',
          'stored message blockhash expired; a fresh message was built — sign it and resubmit under the same idempotency key',
        );
      }
      if (!stale.ok) return stale;
    }

    if (row.status === 'pending_signature') {
      // Verify every required client signature over the STORED message.
      const msgBytes = decodeFieldBase64(row.message_base64, 'stored message');
      if (!msgBytes.ok) return msgBytes;
      const supplied = req.tx_signatures ?? {};
      const sigs = new Map<string, Uint8Array>();
      const missing: string[] = [];
      for (const signerKey of row.required_client_signers) {
        const raw = supplied[signerKey];
        if (raw === undefined) {
          missing.push(signerKey);
          continue;
        }
        const dec = decodeFieldBase64(raw, `tx_signatures[${signerKey}]`);
        if (!dec.ok) return portErr('INVALID_SIGNATURE', `tx signature for ${signerKey} is not base64`);
        if (dec.value.length !== 64) {
          return portErr('INVALID_SIGNATURE', `tx signature for ${signerKey} is not 64 bytes`);
        }
        const pk = base58AddressToBytes(signerKey);
        if (pk === null) return portErr('INTERNAL_INVARIANT', `stored signer key ${signerKey} invalid`);
        const okSig = await verifyEd25519Detached(pk, dec.value, msgBytes.value);
        if (!okSig.ok) return portErr('CRYPTO_UNAVAILABLE', okSig.error.message);
        if (!okSig.value) {
          return portErr(
            'INVALID_SIGNATURE',
            `transaction signature for ${signerKey} does not verify over the stored message`,
          );
        }
        sigs.set(signerKey, dec.value);
      }
      for (const k of Object.keys(supplied)) {
        if (!row.required_client_signers.includes(k)) {
          return portErr('INSTRUCTION_REJECTED', `signature supplied for unexpected key ${k}`);
        }
      }
      if (missing.length > 0) {
        return relayerErr(
          'MISSING_TX_SIGNATURES',
          `transaction signatures required for: ${missing.join(', ')}`,
        );
      }
      this.audit.record({
        event: 'signature_verified',
        idempotency_key: row.idempotency_key,
        intent_digest: row.intent_digest,
        contributor: row.contributor,
      });
      const advanced = await this.reviewCapAndSend(row, msgBytes.value, sigs);
      return advanced;
    }

    if (row.status === 'submitted' && row.signature) {
      // Resume the finality poll for an in-flight transaction (e.g. after a
      // restart): check signature status, fall back to PDA reconciliation.
      const st = await this.rpc.getSignatureStatus(row.signature);
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        row.status = st.confirmationStatus === 'finalized' ? 'finalized' : 'confirmed';
        const s = this.outbox.put(row);
        if (!s.ok) return s;
        return this.currentSubmission(row);
      }
      const pre = await this.port.preflightContribution(row.intent);
      if (!pre.ok) return pre;
      if (pre.value.existing !== null) {
        row.status = pre.value.existingFinality;
        const s = this.outbox.put(row);
        if (!s.ok) return s;
        return this.currentSubmission(row);
      }
      return this.currentSubmission(row);
    }

    // 'ready' or 'failed' with retries left: nothing to do without fresh
    // client signatures (the message may have been superseded).
    return this.currentSubmission(row);
  }

  private async reviewCapAndSend(
    row: OutboxRow,
    message: Uint8Array,
    sigs: Map<string, Uint8Array>,
  ): Promise<PortResult<Submission>> {
    // Recompute on-chain state, rebuild the reviewed instruction from the
    // stored intent, and require the stored message to match it exactly.
    const pre = await this.port.preflightContribution(row.intent);
    if (!pre.ok) return pre;
    if (pre.value.existing !== null) {
      row.status = pre.value.existingFinality;
      const s = this.outbox.put(row);
      if (!s.ok) return s;
      this.audit.record({
        event: pre.value.existingFinality,
        idempotency_key: row.idempotency_key,
        intent_digest: row.intent_digest,
        node_address: row.node_address,
        detail: 'landed before sponsor send (PDA reconcile)',
      });
      return this.currentSubmission(row);
    }
    const expectedIx =
      row.intent.economic_parent === null
        ? publishRootIx({
            project: row.intent.project_address,
            nodePda: row.node_address,
            contributor: row.intent.contributor,
            payer: this.sponsor.publicKey,
            intent: row.intent,
          })
        : appendContributionIx({
            project: row.intent.project_address,
            parent: row.intent.economic_parent,
            nodePda: row.node_address,
            contributor: row.intent.contributor,
            controller: pre.value.controller,
            payer: this.sponsor.publicKey,
            intent: row.intent,
          });
    const reviewed = reviewSponsoredMessage({
      message,
      expected: expectedIx,
      sponsorPubkey: this.sponsor.publicKey,
      programId: this.cfg.programId,
    });
    if (!reviewed.ok) {
      this.audit.record({
        event: 'intake_rejected',
        idempotency_key: row.idempotency_key,
        intent_digest: row.intent_digest,
        error_code: reviewed.error.code,
        detail: reviewed.error.message,
      });
      return reviewed;
    }

    // Hard caps BEFORE sponsor signing.
    const estimate = await this.estimateOutlay(row);
    if (!estimate.ok) return estimate;
    const capCheck = this.checkCaps(row.contributor, estimate.value);
    if (!capCheck.ok) {
      this.hold(row, 'SPONSOR_BUDGET_EXHAUSTED', capCheck.error.message);
      return portErr('SPONSOR_BUDGET_EXHAUSTED', capCheck.error.message);
    }
    row.estimated_lamports = estimate.value.toString(10);

    const sponsorSig = await this.sponsor.sign(message);
    sigs.set(this.sponsor.publicKey, sponsorSig);

    let wire: Uint8Array;
    try {
      const rebuilt = compileMessage([expectedIx], this.sponsor.publicKey, row.blockhash);
      if (rebuilt.bytes.length !== message.length || !rebuilt.bytes.every((v, i) => v === message[i])) {
        return portErr('INTERNAL_INVARIANT', 'rebuilt message differs from the stored reviewed message');
      }
      wire = serializeTransaction(rebuilt, sigs);
    } catch (e) {
      return portErr(
        'ANCHOR_FAILED',
        `transaction assembly failed: ${e instanceof Error ? e.message : 'build error'}`,
      );
    }
    this.audit.record({
      event: 'sponsor_signed',
      idempotency_key: row.idempotency_key,
      intent_digest: row.intent_digest,
      instruction: reviewed.value.instructionName,
      lamports_estimate: row.estimated_lamports,
    });

    row.status = 'ready';
    let s = this.outbox.put(row);
    if (!s.ok) return s;

    const result = await this.port.submitSignedWire(wire, {
      intentDigest: row.intent_digest,
      nodeAddress: row.node_address,
      lastValidBlockHeight: BigInt(row.last_valid_block_height),
    });

    if (!result.ok) {
      return this.handleSendFailure(row, result.error.code, result.error.message);
    }
    const firstSig = transactionSignatures(wire)[0];
    if (firstSig) row.signature = base58Encode(firstSig);
    row.status = result.value.status === 'finalized' ? 'finalized' : 'confirmed';
    row.error = undefined;
    const spend = this.outbox.recordSpend(row.contributor, BigInt(row.estimated_lamports), this.now());
    if (!spend.ok) return spend;
    s = this.outbox.put(row);
    if (!s.ok) return s;
    this.audit.record({
      event: row.status === 'finalized' ? 'finalized' : 'confirmed',
      idempotency_key: row.idempotency_key,
      intent_digest: row.intent_digest,
      node_address: row.node_address,
      ...(row.signature !== undefined ? { tx_signature: row.signature } : {}),
      lamports_estimate: row.estimated_lamports,
    });
    return result;
  }

  private async messageStale(row: OutboxRow): Promise<PortResult<boolean>> {
    if (row.last_valid_block_height === '0') return { ok: true, value: false };
    try {
      const height = await this.rpc.getBlockHeight('confirmed');
      return { ok: true, value: height > BigInt(row.last_valid_block_height) };
    } catch (e) {
      return portErr(
        'RPC_UNREACHABLE',
        `block-height check failed: ${e instanceof Error ? e.message : 'rpc error'}`,
      );
    }
  }

  private async rebuildMessage(row: OutboxRow): Promise<PortResult<void>> {
    const built = await this.port.buildContributionMessage(row.intent, this.sponsor.publicKey);
    if (!built.ok) return built;
    row.message_base64 = bytesToBase64(built.value.message);
    row.blockhash = built.value.blockhash;
    row.last_valid_block_height = built.value.lastValidBlockHeight.toString(10);
    row.required_client_signers = built.value.signerKeys.filter(
      (k) => k !== this.sponsor.publicKey,
    );
    row.status = 'pending_signature';
    const s = this.outbox.put(row);
    if (!s.ok) return s;
    this.audit.record({
      event: 'retry_scheduled',
      idempotency_key: row.idempotency_key,
      intent_digest: row.intent_digest,
      detail: 'message rebuilt with a fresh blockhash; awaiting re-signature',
    });
    return { ok: true, value: undefined };
  }

  private checkCaps(contributor: string, lamports: bigint): PortResult<void> {
    const now = this.now();
    const dailyAfter = this.outbox.dailySpend(now) + lamports;
    if (dailyAfter > this.cfg.dailyCapLamports) {
      return portErr(
        'SPONSOR_BUDGET_EXHAUSTED',
        `daily sponsor cap would be exceeded: ${this.outbox.dailySpend(now)} + ${lamports} > cap ${this.cfg.dailyCapLamports} lamports (UTC day)`,
      );
    }
    const accountAfter = this.outbox.accountSpend(contributor) + lamports;
    if (accountAfter > this.cfg.perAccountCapLamports) {
      return portErr(
        'SPONSOR_BUDGET_EXHAUSTED',
        `per-account sponsor cap would be exceeded for ${contributor}: ${this.outbox.accountSpend(contributor)} + ${lamports} > cap ${this.cfg.perAccountCapLamports} lamports`,
      );
    }
    return { ok: true, value: undefined };
  }

  private async estimateOutlay(row: OutboxRow): Promise<PortResult<bigint>> {
    const q = await this.port.quoteContribution(row.intent);
    if (!q.ok) return q;
    return { ok: true, value: BigInt(q.value.total_lamports) };
  }

  private async handleSendFailure(
    row: OutboxRow,
    code: string,
    message: string,
  ): Promise<PortResult<Submission>> {
    row.attempts += 1;
    if (code === 'TRANSACTION_EXPIRED') {
      const rebuilt = await this.rebuildMessage(row);
      if (rebuilt.ok) {
        return portErr(
          'TRANSACTION_EXPIRED',
          `${message} — message rebuilt with a fresh blockhash; re-sign and resubmit under the same idempotency key`,
        );
      }
      // fall through to generic retry accounting when rebuild itself failed
    }
    if (row.attempts >= this.cfg.maxAttempts) {
      row.status = 'failed';
      row.error = { code, message };
      const s = this.outbox.put(row);
      if (!s.ok) return s;
      this.audit.record({
        event: 'failed',
        idempotency_key: row.idempotency_key,
        intent_digest: row.intent_digest,
        error_code: code,
        detail: `attempts exhausted (${row.attempts}): ${message}`,
      });
      return portErr(code as never, `attempts exhausted (${row.attempts}): ${message}`);
    }
    const backoff = Math.min(
      this.cfg.baseRetryDelayMs * 2 ** (row.attempts - 1),
      this.cfg.maxRetryDelayMs,
    );
    row.status = 'ready';
    row.next_attempt_at = this.now() + backoff;
    row.error = { code, message };
    const s = this.outbox.put(row);
    if (!s.ok) return s;
    this.audit.record({
      event: 'retry_scheduled',
      idempotency_key: row.idempotency_key,
      intent_digest: row.intent_digest,
      error_code: code,
      detail: `retry ${row.attempts}/${this.cfg.maxAttempts} in ${backoff}ms`,
    });
    return portErr(code as never, `${message} (retry ${row.attempts}/${this.cfg.maxAttempts} in ${backoff} ms)`);
  }

  private async currentSubmission(row: OutboxRow): Promise<PortResult<Submission>> {
    const info = await this.port.connect();
    const genesis = info.ok ? info.value.genesisHash : '';
    return { ok: true, value: toSubmission(row, this.cfg.mode, genesis) };
  }

  /**
   * Outbox processor: resume finality polling for `submitted` rows after a
   * restart (or on a timer). Rows whose transactions expired unlanded are
   * reconciled by PDA, then rebuilt for re-signature.
   */
  async processOutbox(): Promise<{ processed: number }> {
    let processed = 0;
    for (const row of this.outbox.rows()) {
      if (row.status !== 'submitted') continue;
      if (row.signature) {
        try {
          const st = await this.rpc.getSignatureStatus(row.signature);
          if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
            row.status = st.confirmationStatus === 'finalized' ? 'finalized' : 'confirmed';
            const s = this.outbox.put(row);
            if (!s.ok) continue;
            this.audit.record({
              event: row.status === 'finalized' ? 'finalized' : 'confirmed',
              idempotency_key: row.idempotency_key,
              intent_digest: row.intent_digest,
              tx_signature: row.signature,
            });
            processed += 1;
            continue;
          }
        } catch {
          continue; // transient RPC failure; next pass retries
        }
      }
      const pre = await this.port.preflightContribution(row.intent);
      if (pre.ok && pre.value.existing !== null) {
        row.status = pre.value.existingFinality;
        const s = this.outbox.put(row);
        if (s.ok) processed += 1;
      }
    }
    return { processed };
  }

  /** Status lookup by idempotency key OR intent digest. */
  async submission(key: string): Promise<PortResult<Submission>> {
    const row =
      this.outbox.get(key) ??
      [...this.outbox.rows()].find((r) => r.intent_digest === key);
    if (!row) return portErr('NOT_FOUND', `unknown submission ${key}`);
    return this.currentSubmission(row);
  }
}
