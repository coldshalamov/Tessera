import {
  allocateMinorUnits,
  append,
  compareBytes,
  portableStep,
  previewAppend as previewAppendMath,
} from '@tessera/math';
import {
  base58AddressToBytes,
  encodeIntentV1,
  encodeStatementV1,
  hexToBytes,
  intentDigestHex,
  isLowerHex,
  parseEvidenceBundleV1,
  parseIntentV1,
  parseStatementV1,
  portErr,
  sha256Hex,
  verifyEd25519Detached,
  type ContributionInput,
  type EconomicPreview,
  type EvidenceBundleV1,
  type EvidenceFileEntry,
  type ExactPayoutTable,
  type IntentV1,
  type NodeRef,
  type PayoutEntry,
  type PortMode,
  type PortResult,
  type ProjectV1,
  type SettlementPreview,
  type SignedIntent,
  type SigningIntent,
  type StatementV1,
  type Submission,
  type TesseraPort,
  type VerificationCheck,
  type VerificationReport,
  type VerifiedNode,
} from '@tessera/types';
import {
  decodeContributionNode,
  decodeDeploymentConfig,
  decodeProjectAccount,
  intentFromNode,
  nodeToRecordV1,
  projectToV1,
  type ContributionNodeData,
  type DeploymentConfigAccount,
  type ProjectAccountData,
} from './accounts.js';
import { bytesToBase64 } from './bytes.js';
import {
  CONTRIBUTION_NODE_SPACE,
  EXTENSION_POLICY_REVIEWED,
  FEE_LAMPORTS_PER_SIGNATURE,
  MAX_DEPTH,
  NODE_STATE_FINALIZED,
  ONCHAIN_ERROR_MAP,
  TESSERA_PROGRAM_ID,
  TESSERA_STATE_VERSION,
} from './contract.js';
import { fail, mapThrown } from './errors.js';
import {
  appendContributionIx,
  createProjectIx,
  initializeDeploymentIx,
  publishRootIx,
  type BuiltInstruction,
  type CreateProjectInput,
} from './instructions.js';
import { findDeploymentConfigPda, findNodePda, findProjectPda } from './pubkey.js';
import { pollErrorResult, pollSignature, reconcileNodePda } from './reconcile.js';
import { JsonRpcClient } from './rpc.js';
import { resolveSigner, type TransactionSigner } from './signer.js';
import { compileMessage, serializeTransaction } from './tx.js';

/**
 * SolanaTesseraPort — the TesseraPort contract over real JSON-RPC.
 *
 * Modes (honest labeling):
 *  - 'local'  → a local validator (127.0.0.1:8899 class). Finality values are
 *               real cluster states on THAT validator — never a mainnet claim.
 *  - 'devnet' → Solana devnet; test evidence only, labeled 'devnet' everywhere.
 *  - 'mainnet'→ READ-ONLY. Write methods return MAINNET_WRITES_DISABLED;
 *               writes on mainnet are an explicit approval gate (T09), and
 *               this SDK never silently enables them.
 *
 * Submission lifecycle (docs/04 + shared contract):
 *   validate intent → verify detached consent signature → existing-PDA
 *   compare (idempotent replay/conflict) → build ix → simulate → sign
 *   (contributor [+controller] as native signers, payer as fee payer) →
 *   send → poll confirmed/finalized → on timeout/expiry reconcile by PDA
 *   lookup — NEVER blind-resubmit a transaction whose outcome is unknown.
 */

export interface SolanaPortConfig {
  readonly mode: PortMode;
  readonly rpcUrl: string;
  /** Defaults to the pinned v1 program id; a different id means a different deployment. */
  readonly programId?: string;
  /** When set, the resolved cluster genesis MUST equal this or every call fails. */
  readonly expectedGenesisHash?: string;
  /** Fee payer for transactions (the sponsor role). Defaults to the contributor. */
  readonly payer?: TransactionSigner;
  /** Signer registry: contributor/controller/payer keys, injected. */
  readonly signers?: readonly TransactionSigner[];
  /** Optional dynamic signer lookup (wallet adapters). */
  readonly resolveSigner?: (pubkey: string) => TransactionSigner | undefined;
  readonly fetchImpl?: typeof fetch;
  readonly rpcTimeoutMs?: number;
  /** Poll target after send (default 'confirmed'). */
  readonly confirmTarget?: 'confirmed' | 'finalized';
  readonly confirmTimeoutMs?: number;
  readonly exporter?: string;
  /** Injectable clock for declared_at (Unix seconds). */
  readonly nowUnix?: () => bigint;
}

export interface ConnectInfo {
  readonly genesisHash: string;
  readonly programDeployed: boolean;
  readonly deployment: DeploymentConfigAccount | null;
  readonly deploymentAddress: string;
}

interface SubmissionInternal {
  readonly submission: Submission;
  readonly signature?: string;
  readonly intent?: IntentV1;
  readonly intentDigest?: string;
}

/** Result of pre-submit on-chain state validation (shared with the relayer). */
export interface IntentPreflight {
  readonly nodeAddress: string;
  readonly nodeRef: NodeRef;
  /** Non-null when the node PDA already exists AND stores this same intent digest. */
  readonly existing: ContributionNodeData | null;
  readonly existingFinality: 'confirmed' | 'finalized';
  readonly project: ProjectAccountData;
  /** REVIEWED co-signer when required, else null. */
  readonly controller: string | null;
}

const CHAIN_NOTES = {
  local: [
    'LOCAL MODE: a real local validator (e.g. solana-test-validator); finality is real for THAT cluster only — not a devnet/mainnet claim.',
  ],
  devnet: [
    'DEVNET MODE: Solana devnet test evidence; devnet SOL has no value and records are labeled test evidence, not mainnet permanence.',
  ],
  mainnet: ['MAINNET READ-ONLY: this SDK build performs no mainnet writes.'],
} as const;

export interface SolanaTesseraPort extends TesseraPort {
  connect(): Promise<PortResult<ConnectInfo>>;
  initializeDeployment(input?: {
    authority?: string;
    payer?: string;
  }): Promise<PortResult<{ config_address: string; signature: string }>>;
  createProject(
    input: CreateProjectInput & { creator: string },
  ): Promise<PortResult<{ project: ProjectV1; signature: string }>>;
  getProject(projectAddress: string): Promise<PortResult<ProjectV1>>;
  quoteContribution(
    signedOrIntent: IntentV1,
  ): Promise<PortResult<{ rent_lamports: string; fee_lamports: string; total_lamports: string; notes: string[] }>>;
  previewSettlement(ref: NodeRef, amountMinor: unknown): Promise<PortResult<SettlementPreview>>;
  prepareStatement(statement: StatementV1): Promise<
    PortResult<{ statement: StatementV1; statement_bytes_base64: string; statement_sha256: string }>
  >;
  submitStatement(
    statement: StatementV1,
    signatureBase64: string,
    author: string,
  ): Promise<PortResult<never>>;
  /**
   * Pre-submit on-chain validation for a parsed intent (domain fields, PDA
   * compare, project/terms/parent/controller). Shared by
   * submitSignedContribution, buildContributionMessage and the sponsor
   * relayer so all paths enforce identical policy.
   */
  preflightContribution(
    intent: IntentV1,
  ): Promise<PortResult<IntentPreflight & { intentDigest: string }>>;
  /** Exposed for the sponsor relayer: build the unsigned compiled message for an intent. */
  buildContributionMessage(
    intent: IntentV1,
    feePayer: string,
  ): Promise<PortResult<{ message: Uint8Array; signerKeys: readonly string[]; lastValidBlockHeight: bigint; blockhash: string; nodeAddress: string }>>;
  /** Exposed for the sponsor relayer: send a fully-signed wire transaction through the same simulate/poll/reconcile path. */
  submitSignedWire(
    wire: Uint8Array,
    meta: { intentDigest: string; nodeAddress: string; lastValidBlockHeight: bigint },
  ): Promise<PortResult<Submission>>;
}

function stableStringify(value: unknown): string {
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

function base64Decode(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function createSolanaTesseraPort(config: SolanaPortConfig): SolanaTesseraPort {
  const mode = config.mode;
  const programId = config.programId ?? TESSERA_PROGRAM_ID;
  const rpc = new JsonRpcClient(config.rpcUrl, {
    timeoutMs: config.rpcTimeoutMs ?? 15_000,
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  });
  const notes = CHAIN_NOTES[mode];
  const confirmTarget = config.confirmTarget ?? 'confirmed';
  const confirmTimeoutMs = config.confirmTimeoutMs ?? 30_000;
  const now = config.nowUnix ?? (() => BigInt(Math.floor(Date.now() / 1000)));

  let connectCache: ConnectInfo | null = null;
  const nodeCache = new Map<string, ContributionNodeData>(); // immutable ancestors
  const projectCache = new Map<string, { data: ProjectAccountData; }>(); // cache only decode; root_node may change once
  const submissions = new Map<string, SubmissionInternal>();
  const idem = new Map<string, string>();

  async function connect(): Promise<PortResult<ConnectInfo>> {
    if (connectCache) return { ok: true, value: connectCache };
    try {
      const genesisHash = await rpc.getGenesisHash();
      if (
        config.expectedGenesisHash !== undefined &&
        genesisHash !== config.expectedGenesisHash
      ) {
        return portErr(
          'NETWORK_MISMATCH',
          `cluster genesis ${genesisHash} does not match configured expectedGenesisHash — refusing to talk to the wrong network`,
        );
      }
      const progAcct = await rpc.getAccountInfo(programId, 'confirmed');
      if (progAcct === null || !progAcct.executable) {
        return portErr(
          'PROGRAM_NOT_DEPLOYED',
          `program ${programId} is not deployed/executable on this cluster`,
        );
      }
      const deploymentAddress = (await findDeploymentConfigPda(programId)).address;
      const cfgAcct = await rpc.getAccountInfo(deploymentAddress, 'confirmed');
      let deployment: DeploymentConfigAccount | null = null;
      if (cfgAcct !== null) {
        if (cfgAcct.owner !== programId) {
          return portErr(
            'PROGRAM_NOT_DEPLOYED',
            'deployment config PDA exists but is not owned by the program',
          );
        }
        try {
          deployment = decodeDeploymentConfig(cfgAcct.data);
        } catch (e) {
          return portErr('UNSUPPORTED_VERSION', `deployment config decode failed: ${mapThrown(e, 'connect').message}`);
        }
        if (deployment.stateVersion !== TESSERA_STATE_VERSION) {
          return portErr(
            'UNSUPPORTED_VERSION',
            `deployment state_version ${deployment.stateVersion} is not v1`,
          );
        }
        if (deployment.programId !== programId) {
          return portErr(
            'PROGRAM_NOT_DEPLOYED',
            'deployment config commits a different program id — refusing to interpret foreign state',
          );
        }
        if (deployment.networkGenesis !== genesisHash) {
          return portErr(
            'NETWORK_MISMATCH',
            'deployment config genesis differs from the cluster genesis hash',
          );
        }
      }
      connectCache = {
        genesisHash,
        programDeployed: true,
        deployment,
        deploymentAddress,
      };
      return { ok: true, value: connectCache };
    } catch (e) {
      return fail(e, 'connect');
    }
  }

  function requireDeployment(info: ConnectInfo): PortResult<DeploymentConfigAccount> {
    if (info.deployment === null) {
      return portErr(
        'PROGRAM_NOT_DEPLOYED',
        'deployment config is not initialized; run initialize_deployment before submitting intents',
      );
    }
    return { ok: true, value: info.deployment };
  }

  async function fetchNode(
    address: string,
    commitment: 'confirmed' | 'finalized' = 'confirmed',
  ): Promise<PortResult<ContributionNodeData | null>> {
    try {
      const acct = await rpc.getAccountInfo(address, commitment);
      if (acct === null) return { ok: true, value: null };
      if (acct.owner !== programId) {
        return portErr('PARENT_PROGRAM_MISMATCH', `account ${address} is not owned by the tessera program`);
      }
      return { ok: true, value: decodeContributionNode(acct.data) };
    } catch (e) {
      return fail(e, `getNode(${address})`);
    }
  }

  /** Immutable-ancestor cache: finalized node accounts never change. */
  async function fetchNodeCached(
    address: string,
    commitment: 'confirmed' | 'finalized' = 'confirmed',
  ): Promise<PortResult<ContributionNodeData | null>> {
    const hit = nodeCache.get(address);
    if (hit) return { ok: true, value: hit };
    const r = await fetchNode(address, commitment);
    if (r.ok && r.value !== null) nodeCache.set(address, r.value);
    return r;
  }

  async function fetchProject(address: string): Promise<PortResult<ProjectAccountData | null>> {
    try {
      const acct = await rpc.getAccountInfo(address, 'confirmed');
      if (acct === null) return { ok: true, value: null };
      if (acct.owner !== programId) {
        return portErr('PARENT_PROGRAM_MISMATCH', `project ${address} is not owned by the tessera program`);
      }
      const data = decodeProjectAccount(acct.data);
      projectCache.set(address, { data });
      return { ok: true, value: data };
    } catch (e) {
      return fail(e, `getProject(${address})`);
    }
  }

  function scope(genesis: string): {
    genesis_hash: string;
    program_id: string;
    project_address: string;
  } {
    return { genesis_hash: genesis, program_id: programId, project_address: '' };
  }

  function toPreview(
    parent: NodeRef | null,
    step: import('@tessera/math').EconomicStep,
    depth: number,
  ): EconomicPreview {
    const p = portableStep(step);
    const out: EconomicPreview = {
      mode,
      parent,
      claim_bps: p.claim_bps,
      residual_in_units: p.residual_in_units,
      effective_units: p.effective_units,
      residual_out_units: p.residual_out_units,
      issued_total_units: p.issued_total_units,
      own_payout_numerator_units: p.own_payout_numerator_units,
      own_payout_denominator_units: p.own_payout_denominator_units,
      depth,
      notes: [...notes],
    };
    if (step.issued === 0n) {
      out.notes.push('issued_total_units is 0: this version cannot be monetized (ZERO_ISSUED).');
    }
    return out;
  }

  /** Resolve all required native signers; payer may differ (sponsor role). */
  function gatherSigners(
    required: readonly string[],
  ): PortResult<Map<string, TransactionSigner>> {
    const out = new Map<string, TransactionSigner>();
    for (const pubkey of required) {
      const s = resolveSigner(pubkey, config.signers, config.resolveSigner);
      if (!s) {
        return portErr(
          'AUTH_REQUIRED',
          `no transaction signer available for required key ${pubkey} (signing is injected; provide it via config.signers/resolveSigner)`,
        );
      }
      out.set(pubkey, s);
    }
    return { ok: true, value: out };
  }

  async function signAll(
    message: Uint8Array,
    signers: Map<string, TransactionSigner>,
    keys: readonly string[],
  ): Promise<PortResult<Map<string, Uint8Array>>> {
    const sigs = new Map<string, Uint8Array>();
    for (const k of keys) {
      const s = signers.get(k);
      if (!s) return portErr('AUTH_REQUIRED', `missing signer ${k}`);
      const sig = await s.sign(message);
      if (sig.length !== 64) {
        return portErr('INVALID_SIGNATURE', `signer ${k} returned a non-64-byte signature`);
      }
      sigs.set(k, sig);
    }
    return { ok: true, value: sigs };
  }

  /**
   * The shared simulate→send→poll→reconcile path. `meta.nodeAddress` +
   * `meta.intentDigest` enable ambiguity reconciliation; for operations
   * without a node PDA (deployment init, project creation) pass
   * `reconcile` = undefined and ambiguity maps to TRANSACTION_EXPIRED with
   * instructions to check the account directly.
   */
  async function sendWire(
    wire: Uint8Array,
    meta: {
      lastValidBlockHeight: bigint;
      nodeAddress?: string;
      intentDigest?: string;
    },
    submissionId: string,
    nodeRefFor: () => NodeRef | null,
  ): Promise<PortResult<Submission>> {
    const b64 = bytesToBase64(wire);
    try {
      const sim = await rpc.simulateTransaction(b64, { sigVerify: true });
      if (sim.err !== null && sim.err !== undefined) {
        const mapped = extractSimError(sim.err);
        return mapped;
      }
    } catch (e) {
      return fail(e, 'simulate');
    }
    let signature: string;
    try {
      signature = await rpc.sendTransaction(b64, { skipPreflight: true, maxRetries: 3 });
    } catch (e) {
      // The send response can be ambiguous: the RPC may have processed the
      // request and the transport failed afterwards. Reconcile by PDA.
      return reconcileAmbiguous(e, meta, submissionId, nodeRefFor, undefined);
    }

    const poll = await pollSignature(rpc, signature, {
      target: confirmTarget,
      timeoutMs: confirmTimeoutMs,
      lastValidBlockHeight: meta.lastValidBlockHeight,
    });

    if (poll.kind === 'reached') {
      const sub: Submission = {
        id: submissionId,
        status: confirmTarget,
        finality: confirmTarget,
        mode,
        node_ref: nodeRefFor(),
        observed_slot: poll.status.slot.toString(10),
      };
      submissions.set(submissionId, { submission: sub, signature });
      return { ok: true, value: sub };
    }
    return reconcileAmbiguous(
      null,
      meta,
      submissionId,
      nodeRefFor,
      { poll, signature },
    );
  }

  function extractSimError(err: unknown): PortResult<never> {
    // Reuse the instruction-error search via a synthetic RpcResponseError path.
    if (err !== null && typeof err === 'object') {
      const custom = findCustom(err);
      if (custom !== null) {
        const mapErr = mapCustom(custom, 'simulation');
        return portErr(mapErr.code, mapErr.message);
      }
    }
    return portErr('ANCHOR_FAILED', `simulation failed: ${JSON.stringify(err)}`);
  }

  function findCustom(v: unknown): number | null {
    if (v === null || typeof v !== 'object') return null;
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = findCustom(item);
        if (r !== null) return r;
      }
      return null;
    }
    const rec = v as Record<string, unknown>;
    if (typeof rec['Custom'] === 'number') return rec['Custom'];
    for (const k of Object.keys(rec)) {
      const r = findCustom(rec[k]);
      if (r !== null) return r;
    }
    return null;
  }

  function mapCustom(custom: number, where: string): { code: import('@tessera/types').PortErrorCode; message: string } {
    const mapped = ONCHAIN_ERROR_MAP.get(custom);
    if (mapped) return { code: mapped.code as import('@tessera/types').PortErrorCode, message: `${where}: on-chain ${mapped.name} (${custom})` };
    return { code: 'INSTRUCTION_REJECTED', message: `${where}: unrecognized program error ${custom}` };
  }

  /**
   * Ambiguity resolution: the transaction may or may not have landed. We
   * NEVER silently resubmit — we look at the canonical PDA first.
   *   landed  → identical intent digest on-chain: report the real outcome.
   *   conflict→ different digest at the same PDA: NONCE_REUSE_MISMATCH.
   *   absent  → provably not landed: TRANSACTION_EXPIRED (caller may rebuild
   *             with a fresh blockhash and resubmit the SAME intent safely —
   *             the nonce makes it idempotent).
   *   unknown → RPC unreachable mid-reconcile: RPC_UNREACHABLE.
   */
  async function reconcileAmbiguous(
    sendError: unknown,
    meta: { nodeAddress?: string; intentDigest?: string },
    submissionId: string,
    nodeRefFor: () => NodeRef | null,
    ctx: { poll: Awaited<ReturnType<typeof pollSignature>>; signature: string } | undefined,
  ): Promise<PortResult<Submission>> {
    if (meta.nodeAddress !== undefined && meta.intentDigest !== undefined) {
      const recon = await reconcileNodePda(meta.intentDigest, async () => {
        const existing = await fetchNode(meta.nodeAddress!, 'confirmed');
        if (!existing.ok) throw new Error(existing.error.message);
        return existing.value === null ? null : existing.value.intentDigest;
      });
      if (recon.kind === 'landed') {
        // The transaction DID land; our response was lost. Poll once more for
        // the signature status if we have one, else report confirmed-by-PDA.
        let status: Submission['status'] = 'confirmed';
        let slot: string | undefined;
        if (ctx?.signature) {
          const again = await pollSignature(rpc, ctx.signature, {
            target: confirmTarget,
            timeoutMs: confirmTimeoutMs,
          });
          if (again.kind === 'reached') {
            status = again.status.confirmationStatus === 'finalized' ? 'finalized' : 'confirmed';
            slot = again.status.slot.toString(10);
          }
        }
        const sub: Submission = {
          id: submissionId,
          status,
          finality: status === 'finalized' ? 'finalized' : 'confirmed',
          mode,
          node_ref: nodeRefFor(),
          ...(slot ? { observed_slot: slot } : {}),
        };
        submissions.set(submissionId, {
          submission: sub,
          ...(ctx?.signature ? { signature: ctx.signature } : {}),
        });
        return { ok: true, value: sub };
      }
      if (recon.kind === 'conflict') {
        return portErr(
          'NONCE_REUSE_MISMATCH',
          `node PDA exists with a different intent digest (${recon.storedDigest}); refusing to overwrite`,
        );
      }
      if (recon.kind === 'unknown') {
        return portErr('RPC_UNREACHABLE', `reconciliation lookup failed: ${recon.error}`);
      }
      // absent: provably not landed
      if (sendError !== null) {
        const mapped = mapThrown(sendError, 'sendTransaction');
        if (mapped.code === 'RPC_UNREACHABLE' || mapped.code === 'RPC_RATE_LIMITED') {
          return portErr(
            mapped.code,
            `${mapped.message} (node PDA confirmed absent — safe to resubmit the same intent)`,
          );
        }
        return portErr(mapped.code, mapped.message);
      }
      const p = ctx!.poll;
      return pollErrorResult(p, 'submit');
    }
    // No PDA to reconcile against (deployment init / project creation).
    if (sendError !== null) return fail(sendError, 'sendTransaction');
    return pollErrorResult(ctx!.poll, 'submit');
  }

  /**
   * Full pre-submit validation against live on-chain state — the same checks
   * the program enforces, run client-side so failures are typed before any
   * transaction is built. Shared by submitSignedContribution and the sponsor
   * relayer (which must validate an intent before it signs anything).
   *
   * Order: deployment present → domain fields → PDA lookup (finalized first
   * so a replay reports honest finality; a same-digest existing PDA is the
   * idempotent-replay case, a different digest is NONCE_REUSE_MISMATCH) →
   * project/terms/creator → parent appendability → REVIEWED controller.
   */
  async function preflightIntent(
    intent: IntentV1,
    intentDigest: string,
  ): Promise<PortResult<IntentPreflight>> {
    const info = await connect();
    if (!info.ok) return info;
    const dep = requireDeployment(info.value);
    if (!dep.ok) return dep;
    if (intent.network_genesis !== info.value.genesisHash) {
      return portErr('NETWORK_MISMATCH', 'intent.network_genesis does not match this cluster');
    }
    if (intent.program_id !== programId) {
      return portErr('INVALID_INTENT', 'intent.program_id targets a different program');
    }

    const nodePda = await findNodePda(
      programId,
      intent.project_address,
      intent.contributor,
      intent.nonce,
    );
    const nodeRef: NodeRef = {
      genesis_hash: info.value.genesisHash,
      program_id: programId,
      project_address: intent.project_address,
      node_address: nodePda.address,
    };

    const fin = await fetchNode(nodePda.address, 'finalized');
    if (!fin.ok) return fin;
    let existing = fin.value;
    let existingFinality: 'confirmed' | 'finalized' = 'finalized';
    if (existing === null) {
      const con = await fetchNode(nodePda.address, 'confirmed');
      if (!con.ok) return con;
      existing = con.value;
      existingFinality = 'confirmed';
    }
    if (existing !== null && existing.intentDigest !== intentDigest) {
      return portErr(
        'NONCE_REUSE_MISMATCH',
        'node PDA already exists under a different intent digest; the nonce cannot be reused for different data',
      );
    }

    const projR = await fetchProject(intent.project_address);
    if (!projR.ok) return projR;
    if (projR.value === null) {
      return portErr('PROJECT_NOT_FOUND', `project ${intent.project_address} not found on-chain`);
    }
    const project = projR.value;
    if (intent.terms_sha256 !== project.termsSha256) {
      return portErr('TERMS_MISMATCH', 'intent terms_sha256 differs from project master terms');
    }

    let controller: string | null = null;
    if (intent.economic_parent === null) {
      if (intent.contributor !== project.creator) {
        return portErr('SIGNER_MISMATCH', 'publish_root signer must be the project creator');
      }
      if (project.rootNode !== null && existing === null) {
        return portErr('PROJECT_ROOT_EXISTS', 'project root already set');
      }
    } else {
      const parentR = await fetchNodeCached(intent.economic_parent);
      if (!parentR.ok) return parentR;
      if (parentR.value === null) {
        return portErr('PARENT_NOT_FOUND', `parent ${intent.economic_parent} not found on-chain`);
      }
      if (parentR.value.project !== intent.project_address) {
        return portErr('PARENT_PROJECT_MISMATCH', 'parent belongs to a different project');
      }
      if (parentR.value.nodeState !== NODE_STATE_FINALIZED) {
        return portErr('PARENT_NOT_FINALIZED', 'parent node is not finalized');
      }
      if (project.extensionPolicy === EXTENSION_POLICY_REVIEWED) {
        if (project.controller === null) {
          return portErr('CONTROLLER_CONSENT_REQUIRED', 'REVIEWED project records no controller');
        }
        controller = project.controller;
      }
    }

    return {
      ok: true,
      value: { nodeAddress: nodePda.address, nodeRef, existing, existingFinality, project, controller },
    };
  }

  /**
   * Walk economic_parent links from leaf to root (root-first order), keeping
   * each node's on-chain address alongside the decoded data. Immutable node
   * accounts are served from the cache after first fetch.
   */
  async function ancestorChain(
    leafAddress: string,
  ): Promise<PortResult<{ data: ContributionNodeData; address: string }[]>> {
    const chain: { data: ContributionNodeData; address: string }[] = [];
    let cur: string | null = leafAddress;
    const seen = new Set<string>();
    while (cur !== null) {
      if (seen.has(cur)) return portErr('INTERNAL_INVARIANT', 'cycle detected in ancestor chain');
      seen.add(cur);
      const address = cur;
      const r = await fetchNodeCached(address, 'confirmed');
      if (!r.ok) return r;
      if (r.value === null) return portErr('PARENT_NOT_FOUND', `ancestor ${address} not found on-chain`);
      chain.unshift({ data: r.value, address });
      cur = r.value.economicParent;
      if (chain.length > MAX_DEPTH + 1) {
        return portErr('DEPTH_OUT_OF_RANGE', `ancestor chain exceeds MAX_DEPTH ${MAX_DEPTH}`);
      }
    }
    return { ok: true, value: chain };
  }

  const port: SolanaTesseraPort = {
    mode,

    connect,

    async previewAppend(parent: NodeRef | null, claimBps: number): Promise<PortResult<EconomicPreview>> {
      const info = await connect();
      if (!info.ok) return info;
      if (parent === null) {
        const r = previewAppendMath(null, claimBps, scope(info.value.genesisHash));
        if (!r.ok) return r;
        return { ok: true, value: toPreview(null, r.value.step, r.value.depth) };
      }
      if (parent.genesis_hash !== info.value.genesisHash) {
        return portErr('PARENT_NETWORK_MISMATCH', 'parent ref genesis differs from this cluster');
      }
      if (parent.program_id !== programId) {
        return portErr('PARENT_PROGRAM_MISMATCH', 'parent ref targets a different program');
      }
      const stored = await fetchNodeCached(parent.node_address);
      if (!stored.ok) return stored;
      if (stored.value === null || stored.value.project !== parent.project_address) {
        return portErr('PARENT_NOT_FOUND', `parent node ${parent.node_address} not found on-chain`);
      }
      const r = previewAppendMath(
        {
          ref: parent,
          residual_out_units: stored.value.residualOutUnits,
          depth: stored.value.depth,
          status: 'finalized', // all on-chain v1 nodes are FINALIZED
        },
        claimBps,
        { genesis_hash: info.value.genesisHash, program_id: programId, project_address: parent.project_address },
      );
      if (!r.ok) return r;
      return { ok: true, value: toPreview(parent, r.value.step, r.value.depth) };
    },

    async prepareContribution(input: ContributionInput): Promise<PortResult<SigningIntent>> {
      if (mode === 'mainnet') {
        return portErr('MAINNET_WRITES_DISABLED', 'mainnet mode is read-only in this SDK build');
      }
      const info = await connect();
      if (!info.ok) return info;
      const dep = requireDeployment(info.value);
      if (!dep.ok) return dep;

      const projR = await fetchProject(input.project_address);
      if (!projR.ok) return projR;
      if (projR.value === null) {
        return portErr('PROJECT_NOT_FOUND', `project ${input.project_address} not found on-chain`);
      }
      const project = projR.value;
      if (input.terms_sha256 !== project.termsSha256) {
        return portErr('TERMS_MISMATCH', 'terms_sha256 must equal the project master terms digest');
      }
      if (
        project.extensionPolicy === EXTENSION_POLICY_REVIEWED &&
        input.controller_cosigned !== true
      ) {
        return portErr('CONTROLLER_CONSENT_REQUIRED', 'REVIEWED project requires controller co-signature');
      }

      // Parent must exist on-chain before we build the intent.
      let parentDescriptor = null;
      if (input.economic_parent !== null) {
        const ref = input.economic_parent;
        if (ref.genesis_hash !== info.value.genesisHash) {
          return portErr('PARENT_NETWORK_MISMATCH', 'parent ref genesis differs from this cluster');
        }
        if (ref.program_id !== programId) {
          return portErr('PARENT_PROGRAM_MISMATCH', 'parent ref targets a different program');
        }
        if (ref.project_address !== input.project_address) {
          return portErr('PARENT_PROJECT_MISMATCH', 'parent belongs to a different project');
        }
        const parentR = await fetchNodeCached(ref.node_address);
        if (!parentR.ok) return parentR;
        if (parentR.value === null) {
          return portErr('PARENT_NOT_FOUND', `parent ${ref.node_address} not found on-chain`);
        }
        if (parentR.value.project !== input.project_address) {
          return portErr('PARENT_PROJECT_MISMATCH', 'parent account belongs to a different project');
        }
        parentDescriptor = {
          ref,
          residual_out_units: parentR.value.residualOutUnits,
          depth: parentR.value.depth,
          status: 'finalized' as const,
        };
      } else if (project.rootNode !== null) {
        return portErr('PROJECT_ROOT_EXISTS', 'project already has a root contribution');
      }

      // Reference nodes must exist on-chain in the same project.
      const refs = input.references ?? [];
      for (const r of refs) {
        const refR = await fetchNodeCached(r);
        if (!refR.ok) return refR;
        if (refR.value === null || refR.value.project !== input.project_address) {
          return portErr('REFERENCE_NOT_FOUND', `referenced node ${r} not found in project`);
        }
      }

      const preview = previewAppendMath(
        parentDescriptor,
        input.claim_bps,
        { genesis_hash: info.value.genesisHash, program_id: programId, project_address: input.project_address },
      );
      if (!preview.ok) return preview;

      const nonce =
        input.nonce ??
        (() => {
          const b = new Uint8Array(16);
          globalThis.crypto.getRandomValues(b);
          let s = '';
          for (const x of b) s += x.toString(16).padStart(2, '0');
          return s;
        })();
      const intent: IntentV1 = {
        format_version: 1,
        network_genesis: info.value.genesisHash,
        program_id: programId,
        project_address: input.project_address,
        economic_parent: input.economic_parent?.node_address ?? null,
        references: refs,
        nonce,
        contributor: input.contributor,
        name: input.name,
        title: input.title,
        artifact_sha256: input.artifact_sha256,
        metadata_sha256: input.metadata_sha256 ?? null,
        terms_sha256: input.terms_sha256,
        claim_bps: input.claim_bps,
        statement_code: 'CONTRIBUTE_AND_ACCEPT_TERMS',
        declared_at: input.declared_at ?? now().toString(10),
        custody_mode: input.custody_mode,
      };
      const valid = parseIntentV1(intent);
      if (!valid.ok) {
        return portErr('VALIDATION_FAILED', `${valid.error.code} at ${valid.error.path}: ${valid.error.message}`);
      }
      const encoded = encodeIntentV1(intent);
      if (!encoded.ok) {
        return portErr('VALIDATION_FAILED', `${encoded.error.code} at ${encoded.error.path}: ${encoded.error.message}`);
      }
      const digest = await sha256Hex(encoded.value);
      if (!digest.ok) return portErr('CRYPTO_UNAVAILABLE', digest.error.message);
      return {
        ok: true,
        value: {
          mode,
          intent,
          intent_bytes_base64: bytesToBase64(encoded.value),
          intent_sha256: digest.value,
          preview: toPreview(input.economic_parent, preview.value.step, preview.value.depth),
          warnings: [...notes],
        },
      };
    },

    async submitSignedContribution(
      signed: SignedIntent,
      idempotencyKey: string,
    ): Promise<PortResult<Submission>> {
      if (mode === 'mainnet') {
        return portErr('MAINNET_WRITES_DISABLED', 'mainnet mode is read-only in this SDK build');
      }
      const valid = parseIntentV1(signed.intent);
      if (!valid.ok) {
        return portErr('INVALID_INTENT', `${valid.error.code} at ${valid.error.path}: ${valid.error.message}`);
      }
      const intent = valid.value;
      const digest = await intentDigestHex(intent);
      if (!digest.ok) return portErr('CRYPTO_UNAVAILABLE', digest.error.message);

      // Idempotency-key semantics: same key + same intent digest returns the
      // stored submission; same key + DIFFERENT intent is a conflict (a key
      // must never silently alias two payloads).
      const seen = idem.get(idempotencyKey);
      if (seen !== undefined) {
        const existing = submissions.get(seen);
        if (existing) {
          if (existing.intent && (existing.intentDigest ?? seen) !== digest.value) {
            return portErr(
              'NONCE_REUSE_MISMATCH',
              'idempotency key was already used for a different intent digest; choose a new key',
            );
          }
          return { ok: true, value: existing.submission };
        }
      }

      if (signed.signer !== intent.contributor) {
        return portErr('SIGNER_MISMATCH', 'signer must equal intent.contributor in v1');
      }
      const pubBytes = base58AddressToBytes(signed.signer);
      const sigBytes = base64Decode(signed.signature_base64);
      if (pubBytes === null || sigBytes === null) {
        return portErr('INVALID_SIGNATURE', 'signer or signature encoding invalid');
      }
      const digestBytes = hexToBytes(digest.value)!;
      const sigOk = await verifyEd25519Detached(pubBytes, sigBytes, digestBytes);
      if (!sigOk.ok) return portErr('CRYPTO_UNAVAILABLE', sigOk.error.message);
      if (!sigOk.value) {
        return portErr('INVALID_SIGNATURE', 'detached Ed25519 signature does not verify over the intent digest');
      }

      const pre = await preflightIntent(intent, digest.value);
      if (!pre.ok) return pre;
      const pf = pre.value;
      const nodePda = { address: pf.nodeAddress };

      // Existing-PDA compare BEFORE building anything (idempotent replay).
      if (pf.existing !== null) {
        if (pf.existing.intentDigest === digest.value) {
          const sub: Submission = {
            id: digest.value,
            status: pf.existingFinality,
            finality: pf.existingFinality,
            mode,
            node_ref: pf.nodeRef,
            observed_slot: pf.existing.observedSlot.toString(10),
            observed_unix_time: pf.existing.observedUnixTime.toString(10),
          };
          submissions.set(sub.id, { submission: sub, intent, intentDigest: digest.value });
          idem.set(idempotencyKey, sub.id);
          return { ok: true, value: sub };
        }
        return portErr(
          'NONCE_REUSE_MISMATCH',
          'node PDA already exists under a different intent digest; the nonce cannot be reused for different data',
        );
      }

      const controller = pf.controller;
      const payerKey = config.payer?.publicKey ?? intent.contributor;
      const ix: BuiltInstruction =
        intent.economic_parent === null
          ? publishRootIx({
              project: intent.project_address,
              nodePda: nodePda.address,
              contributor: intent.contributor,
              payer: payerKey,
              intent,
            })
          : appendContributionIx({
              project: intent.project_address,
              parent: intent.economic_parent,
              nodePda: nodePda.address,
              contributor: intent.contributor,
              controller,
              payer: payerKey,
              intent,
            });

      const required = new Set<string>([intent.contributor, payerKey]);
      if (controller !== null) required.add(controller);
      const signers = gatherSigners([...required]);
      if (!signers.ok) return signers;

      const nodeRef = (): NodeRef => pf.nodeRef;

      const result = await sendPlan([ix], payerKey, signers.value, {
        submissionId: digest.value,
        nodeAddress: nodePda.address,
        intentDigest: digest.value,
        nodeRefFor: nodeRef,
        intent,
      });
      if (result.ok) {
        idem.set(idempotencyKey, result.value.id);
        submissions.set(result.value.id, {
          submission: result.value,
          intent,
          intentDigest: digest.value,
        });
      }
      return result;
    },

    async getSubmission(id: string): Promise<PortResult<Submission>> {
      const s = submissions.get(id);
      if (!s) return portErr('NOT_FOUND', `unknown submission ${id}`);
      // Upgrade a live submission's finality when the signature is known.
      if (s.signature && s.submission.status !== 'finalized') {
        try {
          const status = await rpc.getSignatureStatus(s.signature);
          if (status && status.confirmationStatus === 'finalized') {
            const upgraded: Submission = {
              ...s.submission,
              status: 'finalized',
              finality: 'finalized',
            };
            submissions.set(id, { ...s, submission: upgraded });
            return { ok: true, value: upgraded };
          }
        } catch {
          /* stale read; return last known status */
        }
      }
      return { ok: true, value: s.submission };
    },

    async getNode(ref: NodeRef): Promise<PortResult<VerifiedNode>> {
      const info = await connect();
      if (!info.ok) return info;
      if (ref.genesis_hash !== info.value.genesisHash) {
        return portErr('PARENT_NETWORK_MISMATCH', 'node ref genesis differs from this cluster');
      }
      if (ref.program_id !== programId) {
        return portErr('PARENT_PROGRAM_MISMATCH', 'node ref targets a different program');
      }
      const r = await fetchNode(ref.node_address, 'finalized');
      if (!r.ok) return r;
      if (r.value === null) return portErr('NOT_FOUND', `node ${ref.node_address} not found on-chain (finalized)`);
      const node = r.value;
      if (node.project !== ref.project_address) {
        return portErr('PARENT_PROJECT_MISMATCH', 'node belongs to a different project');
      }

      // Honest verification: recompute economics from the stored parent and
      // recompute the intent digest from the stored semantic fields.
      const notesOut: string[] = [...notes];
      let parentResidual: bigint | undefined;
      if (node.economicParent === null) {
        parentResidual = 1_000_000_000_000n;
      } else {
        const parentR = await fetchNodeCached(node.economicParent);
        if (parentR.ok) parentResidual = parentR.value?.residualOutUnits;
      }
      let economics: VerifiedNode['verification']['economics'] = 'not-checked';
      if (parentResidual === undefined || parentResidual === null) {
        economics = 'not-checked';
        notesOut.push('parent account unavailable; economics could not be recomputed');
      } else {
        const recomputed = append(parentResidual, node.claimBps);
        economics =
          recomputed.ok &&
          recomputed.value.effective === node.effectiveUnits &&
          recomputed.value.residual_out === node.residualOutUnits &&
          recomputed.value.issued === node.issuedTotalUnits
            ? 'recomputed-match'
            : 'mismatch';
      }
      let signature: VerifiedNode['verification']['signature'] = 'not-checked';
      try {
        const reconstructed = intentFromNode(node, {
          genesis_hash: info.value.genesisHash,
          program_id: programId,
        });
        const redigest = await intentDigestHex(reconstructed);
        if (redigest.ok && redigest.value === node.intentDigest) {
          signature = 'valid-local';
          notesOut.push(
            'stored intent_digest recomputes from on-chain fields; the detached consent signature itself is not stored on-chain',
          );
        } else {
          signature = 'invalid';
          notesOut.push('stored intent_digest does NOT match its stored semantic fields');
        }
      } catch {
        notesOut.push('intent digest recompute failed (custody/encoding edge)');
      }
      return {
        ok: true,
        value: {
          node: nodeToRecordV1(node, ref.node_address, {
            genesis_hash: info.value.genesisHash,
            program_id: programId,
          }),
          verification: {
            mode,
            signature,
            economics,
            chain_finality: 'finalized',
            notes: notesOut,
          },
        },
      };
    },

    async getPayouts(ref: NodeRef): Promise<PortResult<ExactPayoutTable>> {
      const info = await connect();
      if (!info.ok) return info;
      if (ref.genesis_hash !== info.value.genesisHash || ref.program_id !== programId) {
        return portErr('PARENT_NETWORK_MISMATCH', 'node ref is out of scope for this cluster/program');
      }
      const chainR = await ancestorChain(ref.node_address);
      if (!chainR.ok) return chainR;
      const leaf = chainR.value[chainR.value.length - 1]!;
      const issued = leaf.data.issuedTotalUnits;
      const entries: PayoutEntry[] = chainR.value
        .filter((e) => e.data.effectiveUnits > 0n)
        .map((e) => ({
          node_address: e.address,
          beneficiary: e.data.contributor,
          effective_units: e.data.effectiveUnits.toString(10),
          numerator_units: e.data.effectiveUnits.toString(10),
          denominator_units: issued.toString(10),
        }));
      return {
        ok: true,
        value: {
          mode,
          node_ref: ref,
          issued_total_units: issued.toString(10),
          zero_issued: issued === 0n,
          entries,
        },
      };
    },

    async previewSettlement(ref: NodeRef, amountMinor: unknown): Promise<PortResult<SettlementPreview>> {
      const info = await connect();
      if (!info.ok) return info;
      const chainR = await ancestorChain(ref.node_address);
      if (!chainR.ok) return chainR;
      let amt: bigint;
      if (typeof amountMinor === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(amountMinor)) {
        amt = BigInt(amountMinor);
      } else if (typeof amountMinor === 'number' && Number.isInteger(amountMinor) && amountMinor >= 0) {
        amt = BigInt(amountMinor);
      } else if (typeof amountMinor === 'bigint' && amountMinor >= 0n) {
        amt = amountMinor;
      } else {
        return portErr('INVALID_AMOUNT', 'amount must be a non-negative integer (string/number/bigint)');
      }
      const leaf = chainR.value[chainR.value.length - 1]!;
      const contributions = chainR.value.map(
        (e) => [e.data.contributor, e.data.effectiveUnits] as const,
      );
      const allocated = allocateMinorUnits(amt, contributions, base58AddressToBytes);
      if (!allocated.ok) return allocated;
      const allocations = [...allocated.value.entries()]
        .sort((a, b) => compareBytes(base58AddressToBytes(a[0])!, base58AddressToBytes(b[0])!))
        .map(([beneficiary, amount]) => ({
          beneficiary,
          amount_minor: amount.toString(10),
        }));
      return {
        ok: true,
        value: {
          mode,
          node_ref: ref,
          amount_minor: amt.toString(10),
          issued_total_units: leaf.data.issuedTotalUnits.toString(10),
          allocations,
        },
      };
    },

    async verifyRelease(bundle: EvidenceBundleV1): Promise<PortResult<VerificationReport>> {
      const info = await connect();
      if (!info.ok) return info;
      const parsed = parseEvidenceBundleV1(bundle);
      if (!parsed.ok) {
        return portErr('BUNDLE_INVALID', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
      }
      const checks: VerificationCheck[] = [];
      let anyFail = false;
      let anyIncomplete = false;
      const encoder = new TextEncoder();
      for (const f of bundle.files) {
        if (f.kind === 'record' || f.kind === 'intent') {
          const m = /^(records|intents)\/([1-9A-HJ-NP-Za-km-z]+)\.json$/.exec(f.path);
          const addr = m?.[2];
          const node = addr === undefined ? null : (await fetchNodeCached(addr, 'finalized'));
          if (node === null || (node && !node.ok)) {
            checks.push({ name: `${f.kind}:${f.path}`, result: 'incomplete', detail: 'referenced account unavailable on-chain' });
            anyIncomplete = true;
            continue;
          }
          if (node!.ok && node!.value === null) {
            checks.push({ name: `${f.kind}:${f.path}`, result: 'fail', detail: 'node account absent on-chain (finalized)' });
            anyFail = true;
            continue;
          }
          const n = node!.value!;
          const canonical =
            f.kind === 'record'
              ? nodeToRecordV1(n, addr!, { genesis_hash: info.value.genesisHash, program_id: programId })
              : intentFromNode(n, { genesis_hash: info.value.genesisHash, program_id: programId });
          const body = encoder.encode(stableStringify(canonical));
          const hash = await sha256Hex(body);
          const pass = hash.ok && hash.value === f.sha256 && String(body.length) === f.bytes;
          checks.push({
            name: `${f.kind}:${f.path}`,
            result: pass ? 'pass' : 'fail',
            detail: pass
              ? 'on-chain account re-encodes to the exact bundled bytes'
              : 'bundle hash/length contradicts on-chain state',
          });
          if (!pass) anyFail = true;
        } else {
          checks.push({
            name: `${f.kind}:${f.path}`,
            result: 'incomplete',
            detail: 'content bytes are external to the bundle manifest; hash recorded, content unverified',
          });
          anyIncomplete = true;
        }
      }
      checks.push({
        name: 'chain_finality',
        result: 'pass',
        detail: `node accounts were read at finalized commitment on ${config.rpcUrl} (single-endpoint trust assumption; no independent archival proof)`,
      });
      const status = anyFail ? 'invalid' : anyIncomplete ? 'incomplete' : 'valid-local';
      return { ok: true, value: { mode, status, checks } };
    },

    async exportBranch(ref: NodeRef): Promise<PortResult<EvidenceBundleV1>> {
      const info = await connect();
      if (!info.ok) return info;
      const chainR = await ancestorChain(ref.node_address);
      if (!chainR.ok) return chainR;
      const scopeV = { genesis_hash: info.value.genesisHash, program_id: programId };
      const files: EvidenceFileEntry[] = [];
      const pushJson = async (
        path: string,
        value: unknown,
        kind: EvidenceFileEntry['kind'],
      ): Promise<PortResult<void>> => {
        const bytes = new TextEncoder().encode(stableStringify(value));
        const hash = await sha256Hex(bytes);
        if (!hash.ok) return portErr('CRYPTO_UNAVAILABLE', hash.error.message);
        files.push({ path, sha256: hash.value, bytes: String(bytes.length), kind });
        return { ok: true, value: undefined };
      };
      for (const { data: n, address: addr } of chainR.value) {
        let r = await pushJson(`records/${addr}.json`, nodeToRecordV1(n, addr, scopeV), 'record');
        if (!r.ok) return r;
        r = await pushJson(`intents/${addr}.json`, intentFromNode(n, scopeV), 'intent');
        if (!r.ok) return r;
      }
      return {
        ok: true,
        value: {
          format_version: 1,
          selected_leaf: ref,
          exporter: config.exporter ?? '@tessera/sdk solana-port/0.1.0',
          files,
          limitations: [
            ...notes,
            'Detached consent signatures are NOT stored on-chain; the bundle records prove chain state, signature evidence must come from application consent records.',
            'Intent wire bytes are reconstructable from on-chain fields (all fields stored); the stored intent_digest re-verifies them.',
            'Artifact/metadata/terms payload bytes are external to the chain record; only their SHA-256 digests are on-chain.',
          ],
        },
      };
    },

    async getProject(projectAddress: string): Promise<PortResult<ProjectV1>> {
      const info = await connect();
      if (!info.ok) return info;
      const r = await fetchProject(projectAddress);
      if (!r.ok) return r;
      if (r.value === null) return portErr('PROJECT_NOT_FOUND', `project ${projectAddress} not found`);
      return { ok: true, value: projectToV1(r.value, projectAddress) };
    },

    async initializeDeployment(input = {}): Promise<PortResult<{ config_address: string; signature: string }>> {
      if (mode === 'mainnet') {
        return portErr('MAINNET_WRITES_DISABLED', 'mainnet mode is read-only in this SDK build');
      }
      const info = await connect();
      if (!info.ok) return info;
      if (info.value.deployment !== null) {
        // Idempotent: the program compares params; pre-check the common case.
        return portErr(
          'INTERNAL_INVARIANT',
          `deployment already initialized at ${info.value.deploymentAddress} (authority ${info.value.deployment.authority})`,
        );
      }
      const payerKey = input.payer ?? config.payer?.publicKey;
      const authorityKey = input.authority ?? payerKey;
      if (!payerKey || !authorityKey) {
        return portErr('AUTH_REQUIRED', 'initialize_deployment requires payer/authority signers');
      }
      const ix = initializeDeploymentIx({
        programId,
        configPda: info.value.deploymentAddress,
        authority: authorityKey,
        payer: payerKey,
        networkGenesis: info.value.genesisHash,
      });
      const required = new Set([authorityKey, payerKey]);
      const signers = gatherSigners([...required]);
      if (!signers.ok) return signers;
      const result = await sendPlan([ix], payerKey, signers.value, {
        submissionId: `init:${info.value.deploymentAddress}`,
        nodeRefFor: () => null,
      });
      if (!result.ok) return result;
      connectCache = null; // re-resolve: config now exists
      return {
        ok: true,
        value: { config_address: info.value.deploymentAddress, signature: result.value.id },
      };
    },

    async createProject(
      input: CreateProjectInput & { creator: string },
    ): Promise<PortResult<{ project: ProjectV1; signature: string }>> {
      if (mode === 'mainnet') {
        return portErr('MAINNET_WRITES_DISABLED', 'mainnet mode is read-only in this SDK build');
      }
      const info = await connect();
      if (!info.ok) return info;
      const dep = requireDeployment(info.value);
      if (!dep.ok) return dep;
      const nonce =
        input.project_nonce ??
        (() => {
          const b = new Uint8Array(16);
          globalThis.crypto.getRandomValues(b);
          let s = '';
          for (const x of b) s += x.toString(16).padStart(2, '0');
          return s;
        })();
      if (!isLowerHex(nonce, 32)) {
        return portErr('INVALID_INTENT', 'project_nonce must be 16 bytes (32 lowercase hex chars)');
      }
      const projectPda = await findProjectPda(programId, input.creator, nonce);
      // Existing-PDA compare: same params → idempotent return; different → conflict.
      const existingR = await fetchProject(projectPda.address);
      if (!existingR.ok) return existingR;
      if (existingR.value !== null) {
        const e = existingR.value;
        const identical =
          e.creator === input.creator &&
          e.projectNonce === nonce &&
          e.title === input.title &&
          e.termsSha256 === input.terms_sha256 &&
          ((input.extension_policy === 'OPEN' && e.extensionPolicy === 1) ||
            (input.extension_policy === 'REVIEWED' && e.extensionPolicy === 2)) &&
          e.controller === (input.controller ?? null);
        if (identical) {
          return {
            ok: true,
            value: { project: projectToV1(e, projectPda.address), signature: '' },
          };
        }
        return portErr('PROJECT_EXISTS', 'project PDA exists with different parameters');
      }
      const payerKey = config.payer?.publicKey ?? input.creator;
      const ix = createProjectIx({
        programId,
        configPda: info.value.deploymentAddress,
        projectPda: projectPda.address,
        creator: input.creator,
        payer: payerKey,
        args: input,
      });
      const required = new Set([input.creator, payerKey]);
      const signers = gatherSigners([...required]);
      if (!signers.ok) return signers;
      const result = await sendPlan([ix], payerKey, signers.value, {
        submissionId: `create_project:${projectPda.address}`,
        nodeRefFor: () => null,
      });
      if (!result.ok) return result;
      const read = await fetchProject(projectPda.address);
      if (!read.ok) return read;
      if (read.value === null) {
        return portErr('INTERNAL_INVARIANT', 'project absent immediately after confirmed create');
      }
      return {
        ok: true,
        value: { project: projectToV1(read.value, projectPda.address), signature: result.value.id },
      };
    },

    async quoteContribution(intent: IntentV1): Promise<
      PortResult<{ rent_lamports: string; fee_lamports: string; total_lamports: string; notes: string[] }>
    > {
      const info = await connect();
      if (!info.ok) return info;
      const nodePda = await findNodePda(programId, intent.project_address, intent.contributor, intent.nonce);
      const existing = await fetchNode(nodePda.address);
      if (!existing.ok) return existing;
      const rent =
        existing.value === null
          ? await rpc.getMinimumBalanceForRentExemption(CONTRIBUTION_NODE_SPACE)
          : 0n;
      const sigs = intent.economic_parent === null ? 2n : 2n; // payer+contributor (+1 if REVIEWED)
      const proj = await fetchProject(intent.project_address);
      const extra =
        proj.ok && proj.value?.extensionPolicy === EXTENSION_POLICY_REVIEWED ? 1n : 0n;
      const fee = FEE_LAMPORTS_PER_SIGNATURE * (sigs + extra);
      return {
        ok: true,
        value: {
          rent_lamports: rent.toString(10),
          fee_lamports: fee.toString(10),
          total_lamports: (rent + fee).toString(10),
          notes: [
            'Estimate only: getMinimumBalanceForRentExemption + fee schedule at quote time; not a guarantee against fee/rent changes.',
            'Rent is a one-time deposit into an immutable account (never reclaimed; records are never closed).',
          ],
        },
      };
    },

    async prepareStatement(statement: StatementV1): Promise<
      PortResult<{ statement: StatementV1; statement_bytes_base64: string; statement_sha256: string }>
    > {
      const parsed = parseStatementV1(statement);
      if (!parsed.ok) {
        return portErr('VALIDATION_FAILED', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
      }
      const encoded = encodeStatementV1(parsed.value);
      if (!encoded.ok) {
        return portErr('VALIDATION_FAILED', `${encoded.error.code} at ${encoded.error.path}: ${encoded.error.message}`);
      }
      const digest = await sha256Hex(encoded.value);
      if (!digest.ok) return portErr('CRYPTO_UNAVAILABLE', digest.error.message);
      return {
        ok: true,
        value: {
          statement: parsed.value,
          statement_bytes_base64: bytesToBase64(encoded.value),
          statement_sha256: digest.value,
        },
      };
    },

    async submitStatement(): Promise<PortResult<never>> {
      return portErr(
        'UNSUPPORTED_VERSION',
        'publish_statement is NOT deployed in program v1 — the StatementRecord layout is committed and this scaffold produces correct wire bytes, but no on-chain instruction exists yet',
      );
    },

    async preflightContribution(intent) {
      const parsed = parseIntentV1(intent);
      if (!parsed.ok) {
        return portErr('INVALID_INTENT', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
      }
      const digest = await intentDigestHex(parsed.value);
      if (!digest.ok) return portErr('CRYPTO_UNAVAILABLE', digest.error.message);
      const pre = await preflightIntent(parsed.value, digest.value);
      if (!pre.ok) return pre;
      return { ok: true, value: { ...pre.value, intentDigest: digest.value } };
    },

    async buildContributionMessage(intent, feePayer) {
      const parsed = parseIntentV1(intent);
      if (!parsed.ok) {
        return portErr('INVALID_INTENT', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
      }
      const digest = await intentDigestHex(parsed.value);
      if (!digest.ok) return portErr('CRYPTO_UNAVAILABLE', digest.error.message);
      const pre = await preflightIntent(parsed.value, digest.value);
      if (!pre.ok) return pre;
      const pf = pre.value;
      const ix =
        parsed.value.economic_parent === null
          ? publishRootIx({
              project: parsed.value.project_address,
              nodePda: pf.nodeAddress,
              contributor: parsed.value.contributor,
              payer: feePayer,
              intent: parsed.value,
            })
          : appendContributionIx({
              project: parsed.value.project_address,
              parent: parsed.value.economic_parent,
              nodePda: pf.nodeAddress,
              contributor: parsed.value.contributor,
              controller: pf.controller,
              payer: feePayer,
              intent: parsed.value,
            });
      const bh = await rpc.getLatestBlockhash('confirmed');
      const message = compileMessage([ix], feePayer, bh.blockhash);
      return {
        ok: true,
        value: {
          message: message.bytes,
          signerKeys: message.signerKeys,
          lastValidBlockHeight: bh.lastValidBlockHeight,
          blockhash: bh.blockhash,
          nodeAddress: pf.nodeAddress,
        },
      };
    },

    async submitSignedWire(wire, meta) {
      return sendWire(wire, meta, meta.intentDigest, () => null);
    },
  };

  /**
   * Build → sign → send → poll → reconcile for a fully-local signer set.
   */
  async function sendPlan(
    ixs: BuiltInstruction[],
    payerKey: string,
    signers: Map<string, TransactionSigner>,
    meta: {
      submissionId: string;
      nodeAddress?: string;
      intentDigest?: string;
      nodeRefFor: () => NodeRef | null;
      intent?: IntentV1;
    },
  ): Promise<PortResult<Submission>> {
    try {
      const bh = await rpc.getLatestBlockhash('confirmed');
      const message = compileMessage(ixs, payerKey, bh.blockhash);
      const sigs = await signAll(message.bytes, signers, message.signerKeys);
      if (!sigs.ok) return sigs;
      const wire = serializeTransaction(message, sigs.value);
      return await sendWire(
        wire,
        {
          lastValidBlockHeight: bh.lastValidBlockHeight,
          ...(meta.nodeAddress !== undefined ? { nodeAddress: meta.nodeAddress } : {}),
          ...(meta.intentDigest !== undefined ? { intentDigest: meta.intentDigest } : {}),
        },
        meta.submissionId,
        meta.nodeRefFor,
      );
    } catch (e) {
      return fail(e, 'sendPlan');
    }
  }

  return port;
}
