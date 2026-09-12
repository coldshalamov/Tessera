import {
  base58AddressToBytes,
  base58Encode,
  encodeIntentV1,
  hexToBytes,
  intentDigestHex,
  parseEvidenceBundleV1,
  parseIntentV1,
  portErr,
  sha256Hex,
  verifyEd25519Detached,
  type ContributionInput,
  type EconomicPreview,
  type EvidenceBundleV1,
  type EvidenceFileEntry,
  type ExactPayoutTable,
  type IntentV1,
  type NodeRecordV1,
  type NodeRef,
  type PayoutEntry,
  type PortResult,
  type ProjectV1,
  type SettlementPreview,
  type SignedIntent,
  type SigningIntent,
  type Submission,
  type TesseraPort,
  type VerificationCheck,
  type VerificationReport,
  type VerifiedNode,
} from '@tessera/types';
import { allocateMinorUnits, compareBytes } from './allocate.js';
import {
  U,
  append,
  isAppendableState,
  portableStep,
  previewAppend as previewAppendMath,
  type EconomicStep,
  type NodeLifecycleState,
} from './economics.js';
import { integer } from './guards.js';

/**
 * Local TesseraPort simulator (shared/INTEGRATION_CONTRACT.md `mode: 'local'`).
 *
 * Honest labeling contract:
 *  - mode is always 'local'; submission.finality is 'local', meaning simulated
 *    finality only — nothing here is a chain proof or a "recorded on Solana".
 *  - Node addresses are deterministic SHA-256 derivations over the normative
 *    PDA seeds (tessera_node || project || contributor || nonce) — they are
 *    simulated identifiers, NOT real Solana PDA derivations (no curve check).
 *  - Detached Ed25519 signatures ARE genuinely verified over the 32-byte
 *    intent digest; that proves a key approved the intent, not anchoring.
 *  - REVIEWED projects require controller_cosigned at prepare time; the
 *    consent is frozen to the prepared intent digest (CONSENT_EXPIRED).
 */

export interface LocalPortConfig {
  /** Simulated cluster identity (base58 genesis hash). */
  genesis_hash: string;
  /** Simulated program id (base58). */
  program_id: string;
  exporter?: string;
}

export interface CreateProjectInput {
  creator: string;
  controller?: string | null;
  title: string;
  extension_policy: 'OPEN' | 'REVIEWED';
  terms_sha256: string;
  /** 16-byte hex; generated when absent. */
  project_nonce?: string;
  /** Optional fixed address (base58, 32B) for deterministic fixtures. */
  project_address?: string;
}

interface StoredNode {
  readonly ref: NodeRef;
  readonly record: NodeRecordV1;
  readonly economics: EconomicStep;
  readonly status: NodeLifecycleState;
  readonly intent: IntentV1;
  readonly signature_base64: string;
  readonly signature_valid: boolean;
}

interface StoredProject {
  readonly project: ProjectV1;
  root_node: string | null;
}

interface PreparedConsent {
  readonly input: ContributionInput;
  readonly controller_cosigned: boolean;
}

const LOCAL_LIMITATIONS = [
  'LOCAL MODE: in-memory simulation; no Solana network, account or finality exists.',
  'Node addresses are SHA-256-derived simulated identifiers, not real PDA derivations.',
  'Detached signatures prove a key approved the intent digest; they are not chain-finality evidence.',
  'observed_slot/observed_unix_time are simulated observations, not network truth.',
];

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

function bytesToBase64(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  // btoa exists in Node >=16 and Workers.
  return btoa(bin);
}

function base64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function randomHex16(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

async function deriveSimulatedAddress(
  label: string,
  parts: Uint8Array[],
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const labelBytes = new TextEncoder().encode(label);
  const total = labelBytes.length + parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  buf.set(labelBytes, 0);
  let off = labelBytes.length;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return new Uint8Array(await subtle.digest('SHA-256', buf));
}

export interface LocalTesseraPort extends TesseraPort {
  readonly mode: 'local';
  createProject(input: CreateProjectInput): Promise<PortResult<ProjectV1>>;
  /** Settlement preview: largest-remainder allocation at an exact version. */
  previewSettlement(ref: NodeRef, amountMinor: unknown): Promise<PortResult<SettlementPreview>>;
  /** Test/support helper: stored nodes count in one project. */
  projectNodeCount(projectAddress: string): number;
}

export function createLocalTesseraPort(config: LocalPortConfig): LocalTesseraPort {
  const projects = new Map<string, StoredProject>();
  const nodes = new Map<string, StoredNode>(); // key: node_address
  const submissions = new Map<string, Submission>();
  const idempotency = new Map<string, string>(); // key -> submission id
  const nonceIndex = new Map<string, string>(); // project|contributor|nonce -> intent digest
  const prepared = new Map<string, PreparedConsent>(); // intent digest -> consent
  let slotCounter = 1;

  const exporter = config.exporter ?? '@tessera/math local-port/0.1.0';

  function scopeOf(projectAddress: string) {
    return {
      genesis_hash: config.genesis_hash,
      program_id: config.program_id,
      project_address: projectAddress,
    };
  }

  function findProject(address: string): PortResult<StoredProject> {
    const p = projects.get(address);
    if (!p) return portErr('PROJECT_NOT_FOUND', `unknown project ${address}`);
    return { ok: true, value: p };
  }

  type ParentResolution =
    | { readonly kind: 'root' }
    | { readonly kind: 'child'; readonly node: StoredNode };

  function resolveParent(
    parentRef: NodeRef | null,
    projectAddress: string,
  ): PortResult<ParentResolution> {
    if (parentRef === null) return { ok: true, value: { kind: 'root' } };
    if (parentRef.genesis_hash !== config.genesis_hash) {
      return portErr('PARENT_NETWORK_MISMATCH', 'parent ref is scoped to a different genesis hash');
    }
    if (parentRef.program_id !== config.program_id) {
      return portErr('PARENT_PROGRAM_MISMATCH', 'parent ref is scoped to a different program');
    }
    if (parentRef.project_address !== projectAddress) {
      return portErr('PARENT_PROJECT_MISMATCH', 'parent ref belongs to a different project');
    }
    const node = nodes.get(parentRef.node_address);
    if (!node || node.ref.project_address !== projectAddress) {
      return portErr('PARENT_NOT_FOUND', `unknown parent node ${parentRef.node_address}`);
    }
    if (!isAppendableState(node.status)) {
      return portErr('PARENT_NOT_FINALIZED', `parent state '${node.status}' cannot accept children`);
    }
    return { ok: true, value: { kind: 'child', node } };
  }

  function checkReferences(refs: string[], projectAddress: string): PortResult<void> {
    for (const ref of refs) {
      const n = nodes.get(ref);
      if (!n || n.ref.project_address !== projectAddress) {
        return portErr('REFERENCE_NOT_FOUND', `referenced node ${ref} not found in project`);
      }
    }
    return { ok: true, value: undefined };
  }

  function toPreview(
    parentRef: NodeRef | null,
    step: EconomicStep,
    depth: number,
  ): EconomicPreview {
    const p = portableStep(step);
    const notes = [...LOCAL_LIMITATIONS];
    if (step.issued === 0n) {
      notes.push('issued_total_units is 0: this version cannot be monetized (ZERO_ISSUED).');
    }
    return {
      mode: 'local',
      parent: parentRef,
      claim_bps: p.claim_bps,
      residual_in_units: p.residual_in_units,
      effective_units: p.effective_units,
      residual_out_units: p.residual_out_units,
      issued_total_units: p.issued_total_units,
      own_payout_numerator_units: p.own_payout_numerator_units,
      own_payout_denominator_units: p.own_payout_denominator_units,
      depth,
      notes,
    };
  }

  function ancestorChain(leaf: StoredNode): StoredNode[] {
    const chain: StoredNode[] = [];
    let cur: StoredNode | undefined = leaf;
    while (cur) {
      chain.unshift(cur);
      const parentAddr: string | undefined = cur.record.economic_parent?.node_address;
      cur = parentAddr === undefined ? undefined : nodes.get(parentAddr);
    }
    return chain;
  }

  const port: LocalTesseraPort = {
    mode: 'local',

    async createProject(input: CreateProjectInput): Promise<PortResult<ProjectV1>> {
      const nonce = input.project_nonce ?? randomHex16();
      if (!/^[0-9a-f]{32}$/.test(nonce)) {
        return portErr('INVALID_INTENT', 'project_nonce must be 16 bytes (32 lowercase hex chars)');
      }
      let address = input.project_address;
      if (address === undefined) {
        const creatorBytes = base58AddressToBytes(input.creator);
        if (creatorBytes === null) {
          return portErr('INVALID_INTENT', 'creator is not a valid base58 32-byte key');
        }
        const nonceBytes = hexToBytes(nonce)!;
        const derived = await deriveSimulatedAddress('tessera_project', [creatorBytes, nonceBytes]);
        address = base58Encode(derived);
      } else if (base58AddressToBytes(address) === null) {
        return portErr('INVALID_INTENT', 'project_address is not a valid base58 32-byte key');
      }
      if (projects.has(address)) {
        return portErr('PROJECT_EXISTS', `project ${address} already exists`);
      }
      if (base58AddressToBytes(input.creator) === null) {
        return portErr('INVALID_INTENT', 'creator is not a valid base58 32-byte key');
      }
      if (input.controller !== undefined && input.controller !== null && base58AddressToBytes(input.controller) === null) {
        return portErr('INVALID_INTENT', 'controller is not a valid base58 32-byte key');
      }
      const project: ProjectV1 = {
        format_version: 1,
        genesis_hash: config.genesis_hash,
        program_id: config.program_id,
        project_address: address,
        creator: input.creator,
        controller: input.controller ?? null,
        root_node: null,
        project_nonce: nonce,
        title: input.title,
        economic_rule: 'residual-v1',
        total_units: '1000000000000',
        extension_policy: input.extension_policy,
        terms_sha256: input.terms_sha256,
      };
      projects.set(address, { project, root_node: null });
      return { ok: true, value: project };
    },

    async previewAppend(parent: NodeRef | null, claimBps: number): Promise<PortResult<EconomicPreview>> {
      if (parent === null) {
        // Root math is project-independent; scope is irrelevant for the preview.
        const r = previewAppendMath(null, claimBps, scopeOf(''));
        if (!r.ok) return r;
        return { ok: true, value: toPreview(null, r.value.step, r.value.depth) };
      }
      if (parent.genesis_hash !== config.genesis_hash) {
        return portErr('PARENT_NETWORK_MISMATCH', 'parent ref is scoped to a different genesis hash');
      }
      if (parent.program_id !== config.program_id) {
        return portErr('PARENT_PROGRAM_MISMATCH', 'parent ref is scoped to a different program');
      }
      const stored = nodes.get(parent.node_address);
      if (!stored || stored.ref.project_address !== parent.project_address) {
        return portErr('PARENT_NOT_FOUND', `unknown parent node ${parent.node_address}`);
      }
      const r = previewAppendMath(
        {
          ref: stored.ref,
          residual_out_units: stored.economics.residual_out,
          depth: stored.record.depth,
          status: stored.status,
        },
        claimBps,
        scopeOf(parent.project_address),
      );
      if (!r.ok) return r;
      return { ok: true, value: toPreview(parent, r.value.step, r.value.depth) };
    },

    async prepareContribution(input: ContributionInput): Promise<PortResult<SigningIntent>> {
      const proj = findProject(input.project_address);
      if (!proj.ok) return proj;
      const project = proj.value.project;

      if (project.extension_policy === 'REVIEWED' && input.controller_cosigned !== true) {
        return portErr('CONTROLLER_CONSENT_REQUIRED', 'REVIEWED project requires controller co-signature');
      }
      if (input.terms_sha256 !== project.terms_sha256) {
        return portErr('TERMS_MISMATCH', 'terms_sha256 must equal the project master agreement hash');
      }
      const resolved = resolveParent(input.economic_parent, input.project_address);
      if (!resolved.ok) return resolved;
      if (resolved.value.kind === 'root' && proj.value.root_node !== null) {
        return portErr('PROJECT_ROOT_EXISTS', 'project already has a root contribution');
      }

      const refs = input.references ?? [];
      const refCheck = checkReferences(refs, input.project_address);
      if (!refCheck.ok) return refCheck;

      const parentDescriptor =
        resolved.value.kind === 'child'
          ? {
              ref: resolved.value.node.ref,
              residual_out_units: resolved.value.node.economics.residual_out,
              depth: resolved.value.node.record.depth,
              status: resolved.value.node.status,
            }
          : null;
      const preview = previewAppendMath(parentDescriptor, input.claim_bps, scopeOf(input.project_address));
      if (!preview.ok) return preview;

      const intent: IntentV1 = {
        format_version: 1,
        network_genesis: config.genesis_hash,
        program_id: config.program_id,
        project_address: input.project_address,
        economic_parent: input.economic_parent?.node_address ?? null,
        references: refs,
        nonce: input.nonce ?? randomHex16(),
        contributor: input.contributor,
        name: input.name,
        title: input.title,
        artifact_sha256: input.artifact_sha256,
        metadata_sha256: input.metadata_sha256 ?? null,
        terms_sha256: input.terms_sha256,
        claim_bps: input.claim_bps,
        statement_code: 'CONTRIBUTE_AND_ACCEPT_TERMS',
        declared_at: input.declared_at ?? Math.floor(Date.now() / 1000).toString(10),
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

      prepared.set(digest.value, {
        input,
        controller_cosigned: input.controller_cosigned === true,
      });

      return {
        ok: true,
        value: {
          mode: 'local',
          intent,
          intent_bytes_base64: bytesToBase64(encoded.value),
          intent_sha256: digest.value,
          preview: toPreview(input.economic_parent, preview.value.step, preview.value.depth),
          warnings: [...LOCAL_LIMITATIONS],
        },
      };
    },

    async submitSignedContribution(
      signed: SignedIntent,
      idempotencyKey: string,
    ): Promise<PortResult<Submission>> {
      const seen = idempotency.get(idempotencyKey);
      if (seen !== undefined) {
        const existing = submissions.get(seen);
        if (existing) return { ok: true, value: existing };
      }

      const valid = parseIntentV1(signed.intent);
      if (!valid.ok) {
        return portErr('INVALID_INTENT', `${valid.error.code} at ${valid.error.path}: ${valid.error.message}`);
      }
      const intent = valid.value;
      const digest = await intentDigestHex(intent);
      if (!digest.ok) return portErr('CRYPTO_UNAVAILABLE', digest.error.message);

      if (signed.signer !== intent.contributor) {
        return portErr('SIGNER_MISMATCH', 'signer must equal intent.contributor in v1');
      }
      const pubBytes = base58AddressToBytes(signed.signer);
      const sigBytes = base64ToBytes(signed.signature_base64);
      if (pubBytes === null || sigBytes === null) {
        return portErr('INVALID_SIGNATURE', 'signer or signature encoding invalid');
      }
      const digestBytes = hexToBytes(digest.value)!;
      const sigOk = await verifyEd25519Detached(pubBytes, sigBytes, digestBytes);
      if (!sigOk.ok) return portErr('CRYPTO_UNAVAILABLE', sigOk.error.message);
      if (!sigOk.value) {
        return portErr('INVALID_SIGNATURE', 'Ed25519 signature does not verify over the intent digest');
      }

      const consent = prepared.get(digest.value);
      if (!consent) {
        return portErr('CONSENT_EXPIRED', 'intent was not prepared/frozen for consent in this adapter');
      }

      const proj = findProject(intent.project_address);
      if (!proj.ok) return proj;
      const stored = proj.value;
      const project = stored.project;

      if (project.extension_policy === 'REVIEWED' && !consent.controller_cosigned) {
        return portErr('CONTROLLER_CONSENT_REQUIRED', 'REVIEWED project requires controller co-signature');
      }
      if (intent.terms_sha256 !== project.terms_sha256) {
        return portErr('TERMS_MISMATCH', 'terms_sha256 must equal the project master agreement hash');
      }

      const parentRef: NodeRef | null =
        intent.economic_parent === null
          ? null
          : {
              genesis_hash: intent.network_genesis,
              program_id: intent.program_id,
              project_address: intent.project_address,
              node_address: intent.economic_parent,
            };
      const resolved = resolveParent(parentRef, intent.project_address);
      if (!resolved.ok) return resolved;
      if (resolved.value.kind === 'root' && stored.root_node !== null) {
        return portErr('PROJECT_ROOT_EXISTS', 'project already has a root contribution');
      }
      const refCheck = checkReferences(intent.references, intent.project_address);
      if (!refCheck.ok) return refCheck;

      // Nonce reuse within a project: same nonce must mean the same intent digest.
      const nonceKey = `${intent.project_address}|${intent.contributor}|${intent.nonce}`;
      const existingDigest = nonceIndex.get(nonceKey);
      if (existingDigest !== undefined) {
        if (existingDigest !== digest.value) {
          return portErr('NONCE_REUSE_MISMATCH', 'nonce reused with a different intent in this project');
        }
        const existing = submissions.get(digest.value);
        if (existing) {
          idempotency.set(idempotencyKey, existing.id);
          return { ok: true, value: existing };
        }
      }

      const parentDescriptor =
        resolved.value.kind === 'child'
          ? {
              ref: resolved.value.node.ref,
              residual_out_units: resolved.value.node.economics.residual_out,
              depth: resolved.value.node.record.depth,
              status: resolved.value.node.status,
            }
          : null;
      const preview = previewAppendMath(parentDescriptor, intent.claim_bps, scopeOf(intent.project_address));
      if (!preview.ok) return preview;
      const { step, depth } = preview.value;

      const nodeAddressBytes = await deriveSimulatedAddress('tessera_node', [
        base58AddressToBytes(intent.project_address)!,
        pubBytes,
        hexToBytes(intent.nonce)!,
      ]);
      const nodeAddress = base58Encode(nodeAddressBytes);
      const ref: NodeRef = {
        genesis_hash: config.genesis_hash,
        program_id: config.program_id,
        project_address: intent.project_address,
        node_address: nodeAddress,
      };
      const p = portableStep(step);
      const record: NodeRecordV1 = {
        format_version: 1,
        economic_rule: 'residual-v1',
        node_ref: ref,
        economic_parent: parentRef,
        references: [...intent.references],
        contributor: intent.contributor,
        name: intent.name,
        title: intent.title,
        nonce: intent.nonce,
        intent_digest: digest.value,
        artifact_sha256: intent.artifact_sha256,
        metadata_sha256: intent.metadata_sha256,
        metadata_schema: consent.input.metadata_schema ?? null,
        terms_sha256: intent.terms_sha256,
        claim_bps: intent.claim_bps,
        residual_in_units: p.residual_in_units,
        effective_units: p.effective_units,
        residual_out_units: p.residual_out_units,
        issued_total_units: p.issued_total_units,
        own_payout_numerator_units: p.own_payout_numerator_units,
        own_payout_denominator_units: p.own_payout_denominator_units,
        observed_slot: String(slotCounter++),
        declared_at: intent.declared_at,
        observed_unix_time: Math.floor(Date.now() / 1000).toString(10),
        depth,
        custody_mode: intent.custody_mode,
      };
      const storedNode: StoredNode = {
        ref,
        record,
        economics: step,
        status: 'finalized',
        intent,
        signature_base64: signed.signature_base64,
        signature_valid: true,
      };
      nodes.set(nodeAddress, storedNode);
      if (resolved.value.kind === 'root') stored.root_node = nodeAddress;
      nonceIndex.set(nonceKey, digest.value);

      const submission: Submission = {
        id: digest.value,
        status: 'finalized',
        finality: 'local',
        mode: 'local',
        node_ref: ref,
        observed_slot: record.observed_slot,
        observed_unix_time: record.observed_unix_time,
      };
      submissions.set(submission.id, submission);
      idempotency.set(idempotencyKey, submission.id);
      return { ok: true, value: submission };
    },

    async getSubmission(id: string): Promise<PortResult<Submission>> {
      const s = submissions.get(id);
      if (!s) return portErr('NOT_FOUND', `unknown submission ${id}`);
      return { ok: true, value: s };
    },

    async getNode(ref: NodeRef): Promise<PortResult<VerifiedNode>> {
      const node = nodes.get(ref.node_address);
      if (
        !node ||
        node.ref.genesis_hash !== ref.genesis_hash ||
        node.ref.program_id !== ref.program_id ||
        node.ref.project_address !== ref.project_address
      ) {
        return portErr('NOT_FOUND', `unknown node ${ref.node_address}`);
      }
      // Recompute economics live from the stored parent for honest verification.
      const parentResidual =
        node.record.economic_parent === null
          ? U
          : nodes.get(node.record.economic_parent.node_address)!.economics.residual_out;
      const recomputed = append(parentResidual, node.record.claim_bps);
      const match =
        recomputed.ok &&
        recomputed.value.effective === node.economics.effective &&
        recomputed.value.residual_out === node.economics.residual_out &&
        recomputed.value.issued === node.economics.issued;
      return {
        ok: true,
        value: {
          node: node.record,
          verification: {
            mode: 'local',
            signature: node.signature_valid ? 'valid-local' : 'invalid',
            economics: match ? 'recomputed-match' : 'mismatch',
            chain_finality: 'none-local-simulation',
            notes: [...LOCAL_LIMITATIONS],
          },
        },
      };
    },

    async getPayouts(ref: NodeRef): Promise<PortResult<ExactPayoutTable>> {
      const leaf = nodes.get(ref.node_address);
      if (!leaf || leaf.ref.project_address !== ref.project_address) {
        return portErr('NOT_FOUND', `unknown node ${ref.node_address}`);
      }
      const chain = ancestorChain(leaf);
      const issued = leaf.economics.issued;
      const entries: PayoutEntry[] = chain
        .filter((n) => n.economics.effective > 0n)
        .map((n) => ({
          node_address: n.ref.node_address,
          beneficiary: n.record.contributor,
          effective_units: n.economics.effective.toString(10),
          numerator_units: n.economics.effective.toString(10),
          denominator_units: issued.toString(10),
        }));
      return {
        ok: true,
        value: {
          mode: 'local',
          node_ref: ref,
          issued_total_units: issued.toString(10),
          zero_issued: issued === 0n,
          entries,
        },
      };
    },

    async previewSettlement(ref: NodeRef, amountMinor: unknown): Promise<PortResult<SettlementPreview>> {
      const leaf = nodes.get(ref.node_address);
      if (!leaf || leaf.ref.project_address !== ref.project_address) {
        return portErr('NOT_FOUND', `unknown node ${ref.node_address}`);
      }
      const amt = integer(amountMinor, 0n, (1n << 63n) - 1n, 'INVALID_AMOUNT');
      if (!amt.ok) return amt;
      const chain = ancestorChain(leaf);
      const contributions = chain.map(
        (n) => [n.record.contributor, n.economics.effective] as const,
      );
      const allocated = allocateMinorUnits(amt.value, contributions, base58AddressToBytes);
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
          mode: 'local',
          node_ref: ref,
          amount_minor: amt.value.toString(10),
          issued_total_units: leaf.economics.issued.toString(10),
          allocations,
        },
      };
    },

    async verifyRelease(bundle: EvidenceBundleV1): Promise<PortResult<VerificationReport>> {
      const parsed = parseEvidenceBundleV1(bundle);
      if (!parsed.ok) {
        return portErr('BUNDLE_INVALID', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
      }
      const checks: VerificationCheck[] = [];
      const leaf = nodes.get(bundle.selected_leaf.node_address);
      checks.push({
        name: 'selected_leaf_known',
        result: leaf ? 'pass' : 'incomplete',
        detail: leaf
          ? 'leaf node present in local store'
          : 'leaf node not present in local store — cannot confirm economics',
      });
      let anyFail = false;
      let anyIncomplete = !leaf;
      const encoder = new TextEncoder();
      for (const f of bundle.files) {
        if (f.kind === 'record') {
          const m = /^records\/([1-9A-HJ-NP-Za-km-z]+)\.json$/.exec(f.path);
          const addr = m?.[1];
          const stored = addr === undefined ? undefined : nodes.get(addr);
          if (!stored) {
            checks.push({ name: `record:${f.path}`, result: 'incomplete', detail: 'node not in local store' });
            anyIncomplete = true;
            continue;
          }
          const body = encoder.encode(stableStringify(stored.record));
          const hash = await sha256Hex(body);
          const pass = hash.ok && hash.value === f.sha256 && String(body.length) === f.bytes;
          checks.push({
            name: `record:${f.path}`,
            result: pass ? 'pass' : 'fail',
            detail: pass ? 'sha256 and byte length match stored record' : 'hash/length mismatch',
          });
          if (!pass) anyFail = true;
        } else {
          checks.push({
            name: `${f.kind}:${f.path}`,
            result: 'incomplete',
            detail: 'content bytes are not embedded in the bundle manifest; hash recorded, content unverified',
          });
          anyIncomplete = true;
        }
      }
      checks.push({
        name: 'chain_finality',
        result: 'incomplete',
        detail: 'local mode — no chain anchoring exists to verify',
      });
      anyIncomplete = true;
      const status = anyFail ? 'invalid' : anyIncomplete ? 'incomplete' : 'valid-local';
      return { ok: true, value: { mode: 'local', status, checks } };
    },

    async exportBranch(ref: NodeRef): Promise<PortResult<EvidenceBundleV1>> {
      const leaf = nodes.get(ref.node_address);
      if (!leaf || leaf.ref.project_address !== ref.project_address) {
        return portErr('NOT_FOUND', `unknown node ${ref.node_address}`);
      }
      if (!globalThis.crypto?.subtle) {
        return portErr('CRYPTO_UNAVAILABLE', 'WebCrypto SHA-256 is unavailable in this runtime');
      }
      const chain = ancestorChain(leaf);
      const files: EvidenceFileEntry[] = [];
      const encoder = new TextEncoder();
      const pushFile = async (
        filePath: string,
        body: string,
        kind: EvidenceFileEntry['kind'],
      ): Promise<PortResult<void>> => {
        const bytes = encoder.encode(body);
        const hash = await sha256Hex(bytes);
        if (!hash.ok) return portErr('CRYPTO_UNAVAILABLE', hash.error.message);
        files.push({ path: filePath, sha256: hash.value, bytes: String(bytes.length), kind });
        return { ok: true, value: undefined };
      };
      for (const n of chain) {
        let r = await pushFile(`records/${n.ref.node_address}.json`, stableStringify(n.record), 'record');
        if (!r.ok) return r;
        r = await pushFile(`intents/${n.ref.node_address}.json`, stableStringify(n.intent), 'intent');
        if (!r.ok) return r;
        r = await pushFile(`signatures/${n.ref.node_address}.txt`, n.signature_base64, 'signature');
        if (!r.ok) return r;
      }
      return {
        ok: true,
        value: {
          format_version: 1,
          selected_leaf: ref,
          exporter,
          files,
          limitations: [
            ...LOCAL_LIMITATIONS,
            'Export contains local node/intent records only; artifact/metadata/terms bytes are external.',
          ],
        },
      };
    },

    projectNodeCount(projectAddress: string): number {
      let n = 0;
      for (const node of nodes.values()) {
        if (node.ref.project_address === projectAddress) n++;
      }
      return n;
    },
  };

  return port;
}
