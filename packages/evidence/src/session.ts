import {
  isLowerHex,
  isPlainObject,
  parseIntentV1,
  parseNodeRecordV1,
  parseNodeRef,
  parseProjectV1,
  parseStatementV1,
  type ExactPayoutTable,
  type IntentV1,
  type NodeRecordV1,
  type NodeRef,
  type PortMode,
  type ProjectV1,
  type StatementV1,
  type ValidationIssue,
} from '@tessera/types';
import type { Result } from '@tessera/types';
import { err, ok } from '@tessera/types';
import { sha256Hex } from '@tessera/types';
import { base64ToBytes } from './bytes.js';
import type { BuildBundleInput, ContributionEvidence, PayloadFile, StatementEvidence } from './export.js';
import { unsafePathReason } from './paths.js';

/**
 * `tessera-port-session/1` — the recorded local-adapter session format that
 * `tessera-evidence export --from-port <dir>` consumes.
 *
 * A session directory holds `session.json` plus the payload bytes it lists.
 * It is the honest persistence story for the in-memory local TesseraPort:
 * whatever drove prepare→sign→submit records exact wire bytes and detached
 * signatures here so a bundle can be built later without re-deriving or
 * reserializing anything. T04's SDK can emit the same format for real
 * network sessions; mode records which adapter produced it.
 */

export const SESSION_FORMAT = 'tessera-port-session/1' as const;
export const SESSION_FILE = 'session.json';

export type SessionPayloadRole = 'metadata' | 'terms' | 'artifact' | 'manifest';

export interface SessionFileEntry {
  /** Path relative to the session directory (must be a safe relative path). */
  readonly path: string;
  /** Expected sha256 of the file bytes (checked when read). */
  readonly sha256: string;
  readonly role: SessionPayloadRole;
  /** For role 'manifest': the release manifest name used in the bundle. */
  readonly name?: string;
}

export interface SessionContribution {
  readonly record: NodeRecordV1;
  readonly intent: IntentV1;
  readonly intent_wire_base64: string;
  readonly signature_base64: string;
}

export interface SessionStatement {
  readonly record: StatementV1;
  readonly wire_base64: string;
  readonly signer: string;
  readonly signature_base64: string;
}

export interface PortSessionV1 {
  readonly format_version: typeof SESSION_FORMAT;
  readonly mode: PortMode;
  readonly genesis_hash: string;
  readonly program_id: string;
  readonly project: ProjectV1;
  readonly files: readonly SessionFileEntry[];
  readonly contributions: readonly SessionContribution[];
  readonly statements: readonly SessionStatement[];
  readonly selected_leaf: NodeRef | null;
  readonly payout_table: ExactPayoutTable | null;
}

function fail(code: ValidationIssue['code'], path: string, message: string): Result<never, ValidationIssue> {
  return err({ code, path, message });
}

const PAYLOAD_ROLES: readonly SessionPayloadRole[] = ['metadata', 'terms', 'artifact', 'manifest'];

export function parsePortSession(value: unknown, path = 'session'): Result<PortSessionV1, ValidationIssue> {
  if (!isPlainObject(value)) return fail('INVALID_TYPE', path, 'expected object');
  if (value['format_version'] !== SESSION_FORMAT) {
    return fail('INVALID_FORMAT_VERSION', `${path}.format_version`, `expected '${SESSION_FORMAT}'`);
  }
  if (value['mode'] !== 'local' && value['mode'] !== 'devnet' && value['mode'] !== 'mainnet') {
    return fail('INVALID_ENUM', `${path}.mode`, 'expected local|devnet|mainnet');
  }
  for (const f of ['genesis_hash', 'program_id'] as const) {
    if (typeof value[f] !== 'string') return fail('INVALID_TYPE', `${path}.${f}`, 'expected string');
  }
  const proj = parseProjectV1(value['project'], `${path}.project`);
  if (!proj.ok) return proj;

  const files = value['files'];
  if (!Array.isArray(files)) return fail('INVALID_TYPE', `${path}.files`, 'expected array');
  const fileEntries: SessionFileEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fp = `${path}.files[${i}]`;
    if (!isPlainObject(f)) return fail('INVALID_TYPE', fp, 'expected object');
    if (typeof f['path'] !== 'string' || unsafePathReason(f['path']) !== null) {
      return fail('FIELD_OUT_OF_RANGE', `${fp}.path`, 'not a safe relative path');
    }
    if (!isLowerHex(f['sha256'], 64)) return fail('INVALID_HEX', `${fp}.sha256`, 'expected 64 lowercase hex chars');
    if (typeof f['role'] !== 'string' || !PAYLOAD_ROLES.includes(f['role'] as SessionPayloadRole)) {
      return fail('INVALID_ENUM', `${fp}.role`, `expected one of ${PAYLOAD_ROLES.join(', ')}`);
    }
    if (f['name'] !== undefined && typeof f['name'] !== 'string') {
      return fail('INVALID_TYPE', `${fp}.name`, 'expected string');
    }
    const entry: SessionFileEntry = { path: f['path'], sha256: f['sha256'], role: f['role'] as SessionPayloadRole };
    fileEntries.push(typeof f['name'] === 'string' ? { ...entry, name: f['name'] } : entry);
  }

  const contributions = value['contributions'];
  if (!Array.isArray(contributions) || contributions.length === 0) {
    return fail('INVALID_TYPE', `${path}.contributions`, 'expected non-empty array');
  }
  const contribs: SessionContribution[] = [];
  for (let i = 0; i < contributions.length; i++) {
    const c = contributions[i];
    const cp = `${path}.contributions[${i}]`;
    if (!isPlainObject(c)) return fail('INVALID_TYPE', cp, 'expected object');
    const rec = parseNodeRecordV1(c['record'], `${cp}.record`);
    if (!rec.ok) return rec;
    const int = parseIntentV1(c['intent'], `${cp}.intent`);
    if (!int.ok) return int;
    if (typeof c['intent_wire_base64'] !== 'string' || base64ToBytes(c['intent_wire_base64']) === null) {
      return fail('INVALID_TYPE', `${cp}.intent_wire_base64`, 'expected base64');
    }
    if (typeof c['signature_base64'] !== 'string' || base64ToBytes(c['signature_base64']) === null) {
      return fail('INVALID_TYPE', `${cp}.signature_base64`, 'expected base64');
    }
    contribs.push({
      record: rec.value,
      intent: int.value,
      intent_wire_base64: c['intent_wire_base64'],
      signature_base64: c['signature_base64'],
    });
  }

  const statements = value['statements'];
  const stmts: SessionStatement[] = [];
  if (statements !== undefined && statements !== null) {
    if (!Array.isArray(statements)) return fail('INVALID_TYPE', `${path}.statements`, 'expected array');
    for (let i = 0; i < statements.length; i++) {
      const s = statements[i];
      const sp = `${path}.statements[${i}]`;
      if (!isPlainObject(s)) return fail('INVALID_TYPE', sp, 'expected object');
      const rec = parseStatementV1(s['record'], `${sp}.record`);
      if (!rec.ok) return rec;
      if (typeof s['wire_base64'] !== 'string' || base64ToBytes(s['wire_base64']) === null) {
        return fail('INVALID_TYPE', `${sp}.wire_base64`, 'expected base64');
      }
      if (typeof s['signer'] !== 'string' || typeof s['signature_base64'] !== 'string' || base64ToBytes(s['signature_base64']) === null) {
        return fail('INVALID_TYPE', `${sp}.signature_base64`, 'expected base64 signer/signature');
      }
      stmts.push({
        record: rec.value,
        wire_base64: s['wire_base64'],
        signer: s['signer'],
        signature_base64: s['signature_base64'],
      });
    }
  }

  let leaf: NodeRef | null = null;
  if (value['selected_leaf'] !== undefined && value['selected_leaf'] !== null) {
    const l = parseNodeRef(value['selected_leaf'], `${path}.selected_leaf`);
    if (!l.ok) return l;
    leaf = l.value;
  }
  let payout: ExactPayoutTable | null = null;
  if (value['payout_table'] !== undefined && value['payout_table'] !== null) {
    if (!isPlainObject(value['payout_table'])) {
      return fail('INVALID_TYPE', `${path}.payout_table`, 'expected object or null');
    }
    payout = value['payout_table'] as unknown as ExactPayoutTable;
  }

  return ok({
    format_version: SESSION_FORMAT,
    mode: value['mode'] as PortMode,
    genesis_hash: value['genesis_hash'] as string,
    program_id: value['program_id'] as string,
    project: proj.value,
    files: fileEntries,
    contributions: contribs,
    statements: stmts,
    selected_leaf: leaf,
    payout_table: payout,
  });
}

export interface SessionLoadError {
  readonly code: 'MISSING_FILE' | 'HASH_MISMATCH' | 'DECODE';
  readonly message: string;
}

/**
 * Turn a validated session into bundle-builder input, reading payload bytes
 * through `readFile` (session-dir relative). Every listed file's sha256 is
 * re-checked before it enters the bundle — a session lying about content
 * fails at export, not at verify time.
 */
export async function sessionToBundleInput(
  session: PortSessionV1,
  readFile: (relPath: string) => Promise<Uint8Array | null>,
  exporter: string,
): Promise<Result<BuildBundleInput, SessionLoadError>> {
  const payloads: PayloadFile[] = [];
  for (const f of session.files) {
    const data = await readFile(f.path);
    if (data === null) {
      return err({ code: 'MISSING_FILE', message: `session payload missing: ${f.path}` });
    }
    const hash = await sha256Hex(data);
    if (!hash.ok) return err({ code: 'DECODE', message: 'sha256 unavailable' });
    if (hash.value !== f.sha256) {
      return err({ code: 'HASH_MISMATCH', message: `${f.path}: sha256 mismatch (session declares ${f.sha256})` });
    }
    const p: PayloadFile = { kind: f.role, data };
    payloads.push(f.name === undefined ? p : { ...p, name: f.name });
  }

  const contributions: ContributionEvidence[] = session.contributions.map((c) => ({
    record: c.record,
    intent: c.intent,
    intent_wire: base64ToBytes(c.intent_wire_base64)!,
    signature: base64ToBytes(c.signature_base64)!,
  }));
  const statements: StatementEvidence[] = session.statements.map((s) => ({
    record: s.record,
    wire: base64ToBytes(s.wire_base64)!,
    signer: s.signer,
    signature: base64ToBytes(s.signature_base64)!,
  }));

  const leaf =
    session.selected_leaf ??
    session.contributions[session.contributions.length - 1]!.record.node_ref;

  const modeLimitation =
    session.mode === 'local'
      ? 'LOCAL MODE: exported from a local TesseraPort session — simulated records, no chain anchoring exists.'
      : `Exported from a ${session.mode} port session.`;

  const input: BuildBundleInput = {
    selected_leaf: leaf,
    project: session.project,
    contributions,
    payloads,
    statements,
    exporter,
    limitations: [modeLimitation],
    ...(session.payout_table !== null ? { payout_table: session.payout_table } : {}),
  };
  return ok(input);
}
