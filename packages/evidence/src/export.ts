import {
  base58AddressToBytes,
  encodeIntentV1,
  encodeStatementV1,
  hexToBytes,
  parseIntentV1,
  parseNodeRecordV1,
  parseProjectV1,
  parseStatementV1,
  sha256Hex,
  verifyEd25519Detached,
  type EvidenceBundleV1,
  type EvidenceFileKind,
  type ExactPayoutTable,
  type IntentV1,
  type NodeRecordV1,
  type NodeRef,
  type ProjectV1,
  type StatementV1,
  type ValidationIssue,
} from '@tessera/types';
import type { Result } from '@tessera/types';
import { ok } from '@tessera/types';
import { bytesEqual, utf8Bytes } from './bytes.js';
import { bundleMemberMap, contentsFromFileMap } from './bundle.js';
import { stableJsonBytes } from './json.js';
import { buildManifest, type PendingFile } from './manifest.js';
import { unsafePathReason } from './paths.js';
import { PAYOUT_TABLE_PATH, payoutTableForLeaf, reconstructChain } from './recover.js';
import type { EvidenceVerificationReport } from './report.js';
import { verifyBundle } from './verify.js';
import { writeZip } from './zip.js';

/**
 * Evidence-bundle writer (docs/06). All retained payloads are stored
 * BYTE-EXACT — nothing is reserialized. Records/intents/statements are
 * stored both as their canonical JSON view AND as exact wire bytes, and the
 * detached signatures are raw 64-byte Ed25519 values over the record digest.
 *
 * Content-addressed paths: metadata/<sha256>, terms/<sha256>,
 * artifacts/<sha256> — shared payloads dedupe automatically and coverage is
 * checkable by name alone. Release manifests keep a caller-chosen name.
 */

export const REPORT_SNAPSHOT_PATH = 'verification/report.json';

export interface ContributionEvidence {
  readonly record: NodeRecordV1;
  readonly intent: IntentV1;
  /** Exact canonical signing bytes (encodeIntentV1 output). */
  readonly intent_wire: Uint8Array;
  /** 64-byte detached Ed25519 signature over the intent digest. */
  readonly signature: Uint8Array;
}

export interface StatementEvidence {
  readonly record: StatementV1;
  readonly wire: Uint8Array;
  /** Statement author's public key (the record itself carries no signer). */
  readonly signer: string;
  /** 64-byte detached Ed25519 over sha256(statement wire bytes). */
  readonly signature: Uint8Array;
}

export type PayloadKind = 'metadata' | 'terms' | 'artifact' | 'manifest';

export interface PayloadFile {
  readonly kind: PayloadKind;
  readonly data: Uint8Array;
  /**
   * Required for 'manifest' (used as manifests/<name>.json); ignored for
   * content-addressed kinds. Must be a single safe path segment.
   */
  readonly name?: string;
}

export interface BuildBundleInput {
  readonly selected_leaf: NodeRef;
  readonly project?: ProjectV1 | null;
  readonly contributions: readonly ContributionEvidence[];
  readonly payloads?: readonly PayloadFile[];
  readonly statements?: readonly StatementEvidence[];
  /** Frozen table from the producing port; recomputed and equality-checked
   *  when absent. */
  readonly payout_table?: ExactPayoutTable | null;
  readonly exporter: string;
  readonly limitations?: readonly string[];
  /** Include an exporter self-check snapshot at verification/report.json
   *  (default true). The snapshot is generated before report.json is added
   *  to the manifest and says so in its limitations. */
  readonly includeSelfCheck?: boolean;
}

export interface BuiltBundle {
  readonly manifest: EvidenceBundleV1;
  /** payload path → bytes (no bundle.json entry). */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Exporter self-verification snapshot (also stored as a file when
   *  includeSelfCheck). */
  readonly selfReport: EvidenceVerificationReport;
}

export type BuildErrorCode =
  | 'VALIDATION_FAILED'
  | 'WIRE_MISMATCH'
  | 'DIGEST_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'SCOPE_MISMATCH'
  | 'LEAF_NOT_IN_CONTRIBUTIONS'
  | 'PAYOUT_MISMATCH'
  | 'UNSAFE_PATH'
  | 'DUPLICATE_PATH'
  | 'CRYPTO_UNAVAILABLE';

export interface BuildError {
  readonly code: BuildErrorCode;
  readonly message: string;
  readonly issue?: ValidationIssue;
}

function bErr(code: BuildErrorCode, message: string, issue?: ValidationIssue): Result<never, BuildError> {
  return { ok: false, error: issue === undefined ? { code, message } : { code, message, issue } };
}

function sameScope(a: NodeRef, b: NodeRef): boolean {
  return (
    a.genesis_hash === b.genesis_hash &&
    a.program_id === b.program_id &&
    a.project_address === b.project_address
  );
}

function intentRecordDiffs(intent: IntentV1, record: NodeRecordV1): string[] {
  const diffs: string[] = [];
  const cmp = (field: string, i: unknown, r: unknown): void => {
    if (i !== r) diffs.push(field);
  };
  cmp('network_genesis', intent.network_genesis, record.node_ref.genesis_hash);
  cmp('program_id', intent.program_id, record.node_ref.program_id);
  cmp('project_address', intent.project_address, record.node_ref.project_address);
  cmp('economic_parent', intent.economic_parent, record.economic_parent?.node_address ?? null);
  if (intent.references.length !== record.references.length || intent.references.some((r, i) => r !== record.references[i])) {
    diffs.push('references');
  }
  cmp('nonce', intent.nonce, record.nonce);
  cmp('contributor', intent.contributor, record.contributor);
  cmp('name', intent.name, record.name);
  cmp('title', intent.title, record.title);
  cmp('artifact_sha256', intent.artifact_sha256, record.artifact_sha256);
  cmp('metadata_sha256', intent.metadata_sha256, record.metadata_sha256);
  cmp('terms_sha256', intent.terms_sha256, record.terms_sha256);
  cmp('claim_bps', intent.claim_bps, record.claim_bps);
  cmp('declared_at', intent.declared_at, record.declared_at);
  cmp('custody_mode', intent.custody_mode, record.custody_mode);
  return diffs;
}

/** Path where a payload lands inside the bundle. */
export function payloadPath(kind: PayloadKind, sha256: string, name?: string): string {
  switch (kind) {
    case 'metadata':
      return `metadata/${sha256}`;
    case 'terms':
      return `terms/${sha256}`;
    case 'artifact':
      return `artifacts/${sha256}`;
    case 'manifest':
      return `manifests/${name ?? sha256}.json`;
  }
}

export async function buildBundle(input: BuildBundleInput): Promise<Result<BuiltBundle, BuildError>> {
  const leaf = input.selected_leaf;
  const files = new Map<string, Uint8Array>();
  const pending: PendingFile[] = [];
  const limitations: string[] = [...(input.limitations ?? [])];
  const addFile = (path: string, kind: EvidenceFileKind, data: Uint8Array): Result<void, BuildError> => {
    const reason = unsafePathReason(path);
    if (reason !== null) return bErr('UNSAFE_PATH', `${path}: ${reason}`);
    if (files.has(path)) return bErr('DUPLICATE_PATH', `duplicate bundle path ${path}`);
    files.set(path, data);
    pending.push({ path, kind, data });
    return ok(undefined);
  };

  // Project record (optional but expected).
  if (input.project !== undefined && input.project !== null) {
    const p = parseProjectV1(input.project, 'project');
    if (!p.ok) return bErr('VALIDATION_FAILED', `project: ${p.error.code} at ${p.error.path}: ${p.error.message}`, p.error);
    if (input.project.project_address !== leaf.project_address) {
      return bErr('SCOPE_MISMATCH', 'project_address does not match selected_leaf');
    }
    const r = addFile('project.json', 'record', stableJsonBytes(p.value));
    if (!r.ok) return r;
  }

  // Contributions: validate + add records/intents/signatures.
  const nodeMap = new Map<string, NodeRecordV1>();
  let leafPresent = false;
  for (const c of input.contributions) {
    const rec = parseNodeRecordV1(c.record, 'record');
    if (!rec.ok) return bErr('VALIDATION_FAILED', `record: ${rec.error.code} at ${rec.error.path}: ${rec.error.message}`, rec.error);
    const addr = rec.value.node_ref.node_address;
    if (!sameScope(rec.value.node_ref, leaf)) {
      return bErr('SCOPE_MISMATCH', `record ${addr} is outside the selected_leaf scope`);
    }
    const int = parseIntentV1(c.intent, 'intent');
    if (!int.ok) return bErr('VALIDATION_FAILED', `intent for ${addr}: ${int.error.code} at ${int.error.path}: ${int.error.message}`, int.error);
    const enc = encodeIntentV1(int.value);
    if (!enc.ok) return bErr('VALIDATION_FAILED', `intent for ${addr} cannot be encoded: ${enc.error.code}`, enc.error);
    if (!bytesEqual(enc.value, c.intent_wire)) {
      return bErr('WIRE_MISMATCH', `intent wire bytes for ${addr} are not the canonical IntentV1 encoding`);
    }
    const digest = await sha256Hex(c.intent_wire);
    if (!digest.ok) return bErr('CRYPTO_UNAVAILABLE', digest.error.message);
    if (digest.value !== rec.value.intent_digest) {
      return bErr('DIGEST_MISMATCH', `sha256(intent wire) != record.intent_digest for ${addr}`);
    }
    const diffs = intentRecordDiffs(int.value, rec.value);
    if (diffs.length > 0) {
      return bErr('WIRE_MISMATCH', `intent fields differ from record for ${addr}: ${diffs.join(', ')}`);
    }
    if (c.signature.length !== 64) {
      return bErr('INVALID_SIGNATURE', `signature for ${addr} is ${c.signature.length} bytes, expected 64`);
    }
    const pub = base58AddressToBytes(int.value.contributor);
    if (pub === null) return bErr('VALIDATION_FAILED', `contributor for ${addr} is not a 32-byte base58 key`);
    const sigOk = await verifyEd25519Detached(pub, c.signature, hexToBytes(digest.value)!);
    if (!sigOk.ok) return bErr('CRYPTO_UNAVAILABLE', sigOk.error.message);
    if (!sigOk.value) {
      return bErr('INVALID_SIGNATURE', `Ed25519 signature does not verify for ${addr}`);
    }
    if (nodeMap.has(addr)) return bErr('DUPLICATE_PATH', `duplicate contribution for ${addr}`);
    nodeMap.set(addr, rec.value);
    if (addr === leaf.node_address) leafPresent = true;

    let r = addFile(`records/${addr}.json`, 'record', stableJsonBytes(rec.value));
    if (!r.ok) return r;
    r = addFile(`intents/${addr}.json`, 'intent', stableJsonBytes(int.value));
    if (!r.ok) return r;
    r = addFile(`intents/${addr}.wire`, 'intent', c.intent_wire);
    if (!r.ok) return r;
    r = addFile(`signatures/${addr}.sig`, 'signature', c.signature);
    if (!r.ok) return r;
  }
  if (!leafPresent) {
    return bErr('LEAF_NOT_IN_CONTRIBUTIONS', 'no contribution supplies the selected_leaf record');
  }

  // Ancestry completeness check: partial exports are allowed but must say so.
  const walk = reconstructChain(nodeMap, leaf.node_address);
  if (walk.cycle) {
    return bErr('VALIDATION_FAILED', 'economic_parent cycle among contributed records');
  }
  if (walk.missingAncestor !== null) {
    limitations.push(`PARTIAL EXPORT: ancestor record ${walk.missingAncestor} is not included; verification reports incomplete ancestry.`);
  }

  // Statements.
  const statements = input.statements ?? [];
  for (let i = 0; i < statements.length; i++) {
    const s = statements[i]!;
    const st = parseStatementV1(s.record, `statements[${i}]`);
    if (!st.ok) return bErr('VALIDATION_FAILED', `statement ${i}: ${st.error.code} at ${st.error.path}: ${st.error.message}`, st.error);
    const enc = encodeStatementV1(st.value);
    if (!enc.ok) return bErr('VALIDATION_FAILED', `statement ${i} cannot be encoded`, enc.error);
    if (!bytesEqual(enc.value, s.wire)) {
      return bErr('WIRE_MISMATCH', `statement ${i} wire bytes are not the canonical StatementV1 encoding`);
    }
    if (s.signature.length !== 64) {
      return bErr('INVALID_SIGNATURE', `statement ${i} signature is ${s.signature.length} bytes, expected 64`);
    }
    const pub = base58AddressToBytes(s.signer);
    if (pub === null) return bErr('VALIDATION_FAILED', `statement ${i} signer is not a 32-byte base58 key`);
    const sDigest = await sha256Hex(s.wire);
    if (!sDigest.ok) return bErr('CRYPTO_UNAVAILABLE', sDigest.error.message);
    const sigOk = await verifyEd25519Detached(pub, s.signature, hexToBytes(sDigest.value)!);
    if (!sigOk.ok) return bErr('CRYPTO_UNAVAILABLE', sigOk.error.message);
    if (!sigOk.value) {
      return bErr('INVALID_SIGNATURE', `statement ${i} signature does not verify`);
    }
    const base = `${String(i).padStart(3, '0')}-${st.value.statement_type}`;
    let r = addFile(`statements/${base}.json`, 'statement', stableJsonBytes(st.value));
    if (!r.ok) return r;
    r = addFile(`statements/${base}.wire`, 'statement', s.wire);
    if (!r.ok) return r;
    r = addFile(
      `statements/${base}.sig.json`,
      'signature',
      utf8Bytes(JSON.stringify({ signer: s.signer, signature_base64: btoa(String.fromCharCode(...s.signature)) })),
    );
    if (!r.ok) return r;
  }

  // Payloads: hash everything; content-addressed path per kind.
  for (const pl of input.payloads ?? []) {
    const hash = await sha256Hex(pl.data);
    if (!hash.ok) return bErr('CRYPTO_UNAVAILABLE', hash.error.message);
    if (pl.kind === 'manifest' && pl.name !== undefined) {
      if (unsafePathReason(`manifests/${pl.name}.json`) !== null) {
        return bErr('UNSAFE_PATH', `manifest name '${pl.name}' is not a safe file name`);
      }
    }
    const r = addFile(payloadPath(pl.kind, hash.value, pl.name), pl.kind, pl.data);
    if (!r.ok) return r;
  }

  // Frozen payout table: provided value must equal recomputation.
  const chain = walk.chain;
  const leafRecord = nodeMap.get(leaf.node_address)!;
  const recomputed = payoutTableForLeaf(chain, leafRecord, input.payout_table?.mode ?? 'local');
  const table = input.payout_table ?? recomputed;
  if (input.payout_table !== undefined && input.payout_table !== null) {
    // Canonical-JSON byte equality: the frozen table must be exactly the
    // recomputed residual-v1 table.
    if (!bytesEqual(stableJsonBytes(input.payout_table), stableJsonBytes(recomputed))) {
      return bErr('PAYOUT_MISMATCH', 'provided frozen payout table differs from recomputed residual-v1 table');
    }
  }
  {
    const r = addFile(PAYOUT_TABLE_PATH, 'report', stableJsonBytes(table));
    if (!r.ok) return r;
  }

  // Manifest + self-check snapshot.
  const built = await buildManifest(pending, leaf, input.exporter, limitations);
  if (!built.ok) {
    return { ok: false, error: { code: 'VALIDATION_FAILED', message: `manifest: ${built.error.code} at ${built.error.path}: ${built.error.message}`, issue: built.error } };
  }

  const includeSelfCheck = input.includeSelfCheck !== false;
  let selfReport: EvidenceVerificationReport;
  if (includeSelfCheck) {
    const memberMap = bundleMemberMap(built.value.manifest, files);
    const contents = contentsFromFileMap(memberMap);
    if (contents.ok) {
      const report = await verifyBundle(contents.value);
      selfReport = {
        ...report,
        limitations: [
          `exporter self-check snapshot: generated before ${REPORT_SNAPSHOT_PATH} was added to the manifest; recompute with the verifier for the authoritative result`,
          ...report.limitations,
        ],
      };
      const r = addFile(REPORT_SNAPSHOT_PATH, 'report', stableJsonBytes(selfReport));
      if (!r.ok) return r;
      const rebuilt = await buildManifest(pending, leaf, input.exporter, limitations);
      if (!rebuilt.ok) {
        return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'manifest rebuild failed', issue: rebuilt.error } };
      }
      return ok({ manifest: rebuilt.value.manifest, files, selfReport });
    }
    selfReport = {
      verifier: 'unavailable',
      format: 'tessera-evidence/1',
      mode: 'offline',
      status: 'unreadable',
      selected_leaf: leaf,
      project_address: leaf.project_address,
      checks: [],
      limitations: ['self-check could not run'],
      counts: { pass: 0, fail: 0, warn: 0, incomplete: 0, skipped: 0 },
    };
    return ok({ manifest: built.value.manifest, files, selfReport });
  }
  selfReport = {
    verifier: 'not-run',
    format: 'tessera-evidence/1',
    mode: 'offline',
    status: 'incomplete',
    selected_leaf: leaf,
    project_address: leaf.project_address,
    checks: [],
    limitations: ['self-check disabled'],
    counts: { pass: 0, fail: 0, warn: 0, incomplete: 0, skipped: 0 },
  };
  return ok({ manifest: built.value.manifest, files, selfReport });
}

/** Serialize a built bundle to a deterministic zip. */
export function bundleToZip(built: Pick<BuiltBundle, 'manifest' | 'files'>): Uint8Array {
  return writeZip(bundleMemberMap(built.manifest, built.files));
}
