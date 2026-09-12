import { base58AddressToBytes, isBase58AddressShape } from './base58.js';
import { issue, type ValidationIssue, type ValidationCode } from './errors.js';
import { hexToBytes, isLowerHex } from './hex.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';
import {
  isPlainObject,
  parseBoundedDecimal,
  parseI64Decimal,
  parseU64Decimal,
} from './units.js';

/**
 * Portable JSON record types mirroring schemas/ (draft 2020-12). These enforce
 * the semantic invariants JSON schema cannot express: base58 decodes to exactly
 * 32 bytes, UTF-8 byte bounds, u64/i64 ranges, rights-space unit bounds
 * (0..U), claim range, references count and strict key sets
 * (additionalProperties: false in every draft schema).
 *
 * Bounds verified against docs/03, docs/14 and schemas/*.json:
 *  - name: 1..64 UTF-8 bytes (schema maxLength 64 chars AND "maximum 64 encoded bytes")
 *  - title: 0..96 UTF-8 bytes
 *  - references: 0..8 base58 node addresses
 *  - claim_bps: integer 0..10_000
 *  - depth: 0..1024
 *  - metadata_schema: <=256 chars; NOTE docs/03 defines no byte bound for the
 *    off-chain metadata document itself — only the 32-byte digest is on the wire.
 *    No 4096-byte bound exists in the specs, so none is encoded here.
 */

export const TOTAL_CAPACITY_UNITS = 1_000_000_000_000n; // U = 10^12
export const BPS_DENOMINATOR = 10_000;
export const MAX_CLAIM_BPS = 10_000;
export const MAX_REFERENCES = 8;
export const MAX_NAME_UTF8_BYTES = 64;
export const MAX_TITLE_UTF8_BYTES = 96;
export const MAX_METADATA_SCHEMA_CHARS = 256;
export const MAX_DEPTH = 1024;
export const NONCE_HEX_CHARS = 32; // 16 bytes
export const DIGEST_HEX_CHARS = 64; // 32 bytes
export const MAX_BUNDLE_FILES = 10_000;
export const MAX_BUNDLE_PATH_CHARS = 512;
export const MAX_EXPORTER_CHARS = 128;
export const MAX_LIMITATION_CHARS = 1_000;

export const INTENT_DOMAIN = 'TESSERA:CONTRIBUTION:1';
export const STATEMENT_DOMAIN = 'TESSERA:STATEMENT:1';

export type V<T> = Result<T, ValidationIssue>;

function fail(code: ValidationCode, path: string, message: string): V<never> {
  return err(issue(code, path, message));
}

function expectKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  path: string,
): V<void> {
  for (const key of required) {
    if (!(key in obj)) return fail('MISSING_FIELD', `${path}.${key}`, 'required field missing');
  }
  for (const key of Object.keys(obj)) {
    if (!required.includes(key)) {
      return fail('UNEXPECTED_FIELD', `${path}.${key}`, 'field not present in draft schema (additionalProperties: false)');
    }
  }
  return ok(undefined);
}

function expectBase58Address(value: unknown, path: string): V<string> {
  if (!isBase58AddressShape(value)) {
    return fail('INVALID_BASE58', path, 'expected base58 address matching ^[1-9A-HJ-NP-Za-km-z]{32,44}$');
  }
  if (base58AddressToBytes(value) === null) {
    return fail('INVALID_BASE58', path, 'base58 address does not decode to exactly 32 bytes');
  }
  return ok(value);
}

function expectNullableBase58Address(value: unknown, path: string): V<string | null> {
  if (value === null) return ok(null);
  return expectBase58Address(value, path);
}

function expectHex(value: unknown, chars: number, path: string, code: ValidationCode = 'INVALID_HEX'): V<string> {
  if (!isLowerHex(value, chars)) {
    return fail(code, path, `expected ${chars} lowercase hex chars (${chars / 2} bytes)`);
  }
  return ok(value);
}

function expectNullableHex(value: unknown, chars: number, path: string): V<string | null> {
  if (value === null) return ok(null);
  return expectHex(value, chars, path);
}

/** Detects lone (unpaired) UTF-16 surrogates, i.e. text that is not well-formed UTF-8 input. */
function hasLoneSurrogates(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= s.length) return true;
      const d = s.charCodeAt(i + 1);
      if (d < 0xdc00 || d > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Prohibited characters per docs/14 ("reject invalid UTF-8 and prohibited
 * control characters before consent"): all Cc controls (C0, DEL, C1), the
 * bidi control/format characters used for display spoofing, BOM and the two
 * noncharacters U+FFFE/U+FFFF. Display-layer escaping never changes signed bytes.
 */
function hasProhibitedControl(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
    if (
      cp === 0x061c || // ARABIC LETTER MARK
      cp === 0x200e || cp === 0x200f || // LRM/RLM
      (cp >= 0x202a && cp <= 0x202e) || // bidi embeddings/overrides
      (cp >= 0x2066 && cp <= 0x2069) || // bidi isolates
      cp === 0xfeff || cp === 0xfffe || cp === 0xffff
    ) {
      return true;
    }
  }
  return false;
}

const utf8 = new TextEncoder();

/** Bounded UTF-8 string: byte length in [minBytes, maxBytes], well-formed, no prohibited controls. */
function expectUtf8Bounded(
  value: unknown,
  minBytes: number,
  maxBytes: number,
  path: string,
  code: ValidationCode,
): V<string> {
  if (typeof value !== 'string') {
    return fail('INVALID_TYPE', path, 'expected a string');
  }
  if (hasLoneSurrogates(value)) {
    return fail('INVALID_UTF8', path, 'unpaired UTF-16 surrogate; not valid UTF-8 input');
  }
  if (hasProhibitedControl(value)) {
    return fail('PROHIBITED_CONTROL_CHARACTER', path, 'contains control/bidi/noncharacter code points');
  }
  const bytes = utf8.encode(value).length;
  if (bytes < minBytes || bytes > maxBytes) {
    return fail(code, path, `UTF-8 byte length ${bytes} outside [${minBytes}, ${maxBytes}]`);
  }
  return ok(value);
}

function expectClaimBps(value: unknown, path: string): V<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_CLAIM_BPS) {
    return fail('CLAIM_OUT_OF_RANGE', path, 'claim_bps must be an integer in 0..10000');
  }
  return ok(value);
}

function expectReferences(value: unknown, path: string): V<string[]> {
  if (!Array.isArray(value)) {
    return fail('INVALID_TYPE', path, 'references must be an array');
  }
  if (value.length > MAX_REFERENCES) {
    return fail('REFERENCES_OUT_OF_RANGE', path, `references allows at most ${MAX_REFERENCES} entries`);
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const r = expectBase58Address(value[i], `${path}[${i}]`);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): V<T> {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return fail('INVALID_ENUM', path, `expected one of ${allowed.join(', ')}`);
  }
  return ok(value as T);
}

function expectUnitsDecimal(value: unknown, path: string): V<string> {
  const r = parseBoundedDecimal(value, 0n, TOTAL_CAPACITY_UNITS, path, 'UNITS_OUT_OF_RANGE');
  if (!r.ok) return r;
  return ok(value as string);
}

// ---------------------------------------------------------------------------
// Shared identity types
// ---------------------------------------------------------------------------

/** Fully scoped node identity; genesis hash separates networks. */
export interface NodeRef {
  genesis_hash: string;
  program_id: string;
  project_address: string;
  node_address: string;
}

export function parseNodeRef(value: unknown, path = 'node_ref'): V<NodeRef> {
  if (!isPlainObject(value)) return fail('INVALID_TYPE', path, 'expected object');
  const k = expectKeys(value, ['genesis_hash', 'program_id', 'project_address', 'node_address'], path);
  if (!k.ok) return k;
  for (const f of ['genesis_hash', 'program_id', 'project_address', 'node_address'] as const) {
    const r = expectBase58Address(value[f], `${path}.${f}`);
    if (!r.ok) return r;
  }
  return ok(value as unknown as NodeRef);
}

export type CustodyMode = 'user_controlled' | 'embedded_provider' | 'server_custodied';
export const CUSTODY_MODES: readonly CustodyMode[] = [
  'user_controlled',
  'embedded_provider',
  'server_custodied',
];

// ---------------------------------------------------------------------------
// IntentV1 — contribution intent (TESSERA:CONTRIBUTION:1)
// ---------------------------------------------------------------------------

export type StatementCode = 'CONTRIBUTE_AND_ACCEPT_TERMS';

export interface IntentV1 {
  format_version: 1;
  network_genesis: string;
  program_id: string;
  project_address: string;
  /** Economic parent node address, or null for a root contribution. */
  economic_parent: string | null;
  /** Signed non-economic descriptive ancestry, 0..8 node addresses in scope. */
  references: string[];
  /** 16 random bytes as 32 lowercase hex chars. */
  nonce: string;
  contributor: string;
  /** Self-chosen label; 1..64 UTF-8 bytes; not verified identity. */
  name: string;
  /** Artifact label; 0..96 UTF-8 bytes. */
  title: string;
  artifact_sha256: string;
  metadata_sha256: string | null;
  terms_sha256: string;
  claim_bps: number;
  statement_code: StatementCode;
  /** Untrusted client-declared Unix time, i64 decimal string. */
  declared_at: string;
  custody_mode: CustodyMode;
}

const INTENT_KEYS = [
  'format_version', 'network_genesis', 'program_id', 'project_address',
  'economic_parent', 'references', 'nonce', 'contributor', 'name', 'title',
  'artifact_sha256', 'metadata_sha256', 'terms_sha256', 'claim_bps',
  'statement_code', 'declared_at', 'custody_mode',
] as const;

export function parseIntentV1(value: unknown, path = 'intent'): V<IntentV1> {
  if (!isPlainObject(value)) return fail('INVALID_TYPE', path, 'expected object');
  const k = expectKeys(value, INTENT_KEYS, path);
  if (!k.ok) return k;
  if (value['format_version'] !== 1) {
    return fail('INVALID_FORMAT_VERSION', `${path}.format_version`, 'expected const 1');
  }
  for (const f of ['network_genesis', 'program_id', 'project_address', 'contributor'] as const) {
    const r = expectBase58Address(value[f], `${path}.${f}`);
    if (!r.ok) return r;
  }
  {
    const r = expectNullableBase58Address(value['economic_parent'], `${path}.economic_parent`);
    if (!r.ok) return r;
  }
  {
    const r = expectReferences(value['references'], `${path}.references`);
    if (!r.ok) return r;
  }
  {
    const r = expectHex(value['nonce'], NONCE_HEX_CHARS, `${path}.nonce`, 'NONCE_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  {
    const r = expectUtf8Bounded(value['name'], 1, MAX_NAME_UTF8_BYTES, `${path}.name`, 'NAME_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  {
    const r = expectUtf8Bounded(value['title'], 0, MAX_TITLE_UTF8_BYTES, `${path}.title`, 'TITLE_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  {
    const r = expectHex(value['artifact_sha256'], DIGEST_HEX_CHARS, `${path}.artifact_sha256`);
    if (!r.ok) return r;
  }
  {
    const r = expectNullableHex(value['metadata_sha256'], DIGEST_HEX_CHARS, `${path}.metadata_sha256`);
    if (!r.ok) return r;
  }
  {
    const r = expectHex(value['terms_sha256'], DIGEST_HEX_CHARS, `${path}.terms_sha256`);
    if (!r.ok) return r;
  }
  {
    const r = expectClaimBps(value['claim_bps'], `${path}.claim_bps`);
    if (!r.ok) return r;
  }
  if (value['statement_code'] !== 'CONTRIBUTE_AND_ACCEPT_TERMS') {
    return fail('INVALID_ENUM', `${path}.statement_code`, 'expected CONTRIBUTE_AND_ACCEPT_TERMS');
  }
  {
    const r = parseI64Decimal(value['declared_at'], `${path}.declared_at`);
    if (!r.ok) return r;
  }
  {
    const r = expectEnum(value['custody_mode'], CUSTODY_MODES, `${path}.custody_mode`);
    if (!r.ok) return r;
  }
  return ok(value as unknown as IntentV1);
}

// ---------------------------------------------------------------------------
// StatementV1 — append-only annotation family (TESSERA:STATEMENT:1)
// ---------------------------------------------------------------------------

export type StatementType =
  | 'APP_DEFINED'
  | 'KEY_CONTINUITY'
  | 'RELEASE_ANCHOR'
  | 'RETRACTION_OR_DISPUTE';

export const STATEMENT_TYPES: readonly StatementType[] = [
  'APP_DEFINED',
  'KEY_CONTINUITY',
  'RELEASE_ANCHOR',
  'RETRACTION_OR_DISPUTE',
];

export interface StatementV1 {
  format_version: 1;
  network_genesis: string;
  program_id: string;
  /** Absent for identity-scoped statements such as KEY_CONTINUITY. */
  project_address: string | null;
  statement_type: StatementType;
  /** Node address being annotated/finalized; RELEASE_ANCHOR uses the leaf. */
  subject_ref: string | null;
  /** KEY_CONTINUITY: the new public key; signer is the old key. */
  aux_key: string | null;
  payload_sha256: string;
  declared_at: string;
  custody_mode: CustodyMode;
}

const STATEMENT_KEYS = [
  'format_version', 'network_genesis', 'program_id', 'project_address',
  'statement_type', 'subject_ref', 'aux_key', 'payload_sha256',
  'declared_at', 'custody_mode',
] as const;

export function parseStatementV1(value: unknown, path = 'statement'): V<StatementV1> {
  if (!isPlainObject(value)) return fail('INVALID_TYPE', path, 'expected object');
  const k = expectKeys(value, STATEMENT_KEYS, path);
  if (!k.ok) return k;
  if (value['format_version'] !== 1) {
    return fail('INVALID_FORMAT_VERSION', `${path}.format_version`, 'expected const 1');
  }
  for (const f of ['network_genesis', 'program_id'] as const) {
    const r = expectBase58Address(value[f], `${path}.${f}`);
    if (!r.ok) return r;
  }
  for (const f of ['project_address', 'subject_ref', 'aux_key'] as const) {
    const r = expectNullableBase58Address(value[f], `${path}.${f}`);
    if (!r.ok) return r;
  }
  {
    const r = expectEnum(value['statement_type'], STATEMENT_TYPES, `${path}.statement_type`);
    if (!r.ok) return r;
  }
  {
    const r = expectHex(value['payload_sha256'], DIGEST_HEX_CHARS, `${path}.payload_sha256`);
    if (!r.ok) return r;
  }
  {
    const r = parseI64Decimal(value['declared_at'], `${path}.declared_at`);
    if (!r.ok) return r;
  }
  {
    const r = expectEnum(value['custody_mode'], CUSTODY_MODES, `${path}.custody_mode`);
    if (!r.ok) return r;
  }
  // Semantic rules from docs/14: KEY_CONTINUITY must carry aux_key;
  // RELEASE_ANCHOR must reference its economic leaf via subject_ref.
  if (value['statement_type'] === 'KEY_CONTINUITY' && value['aux_key'] === null) {
    return fail('MISSING_FIELD', `${path}.aux_key`, 'KEY_CONTINUITY requires aux_key (new public key)');
  }
  if (value['statement_type'] === 'RELEASE_ANCHOR' && value['subject_ref'] === null) {
    return fail('MISSING_FIELD', `${path}.subject_ref`, 'RELEASE_ANCHOR requires subject_ref (economic leaf)');
  }
  return ok(value as unknown as StatementV1);
}

// ---------------------------------------------------------------------------
// NodeV1 — portable finalized node record view
// ---------------------------------------------------------------------------

export interface NodeRecordV1 {
  format_version: 1;
  economic_rule: 'residual-v1';
  node_ref: NodeRef;
  economic_parent: NodeRef | null;
  references: string[];
  contributor: string;
  name: string;
  title: string;
  nonce: string;
  intent_digest: string;
  artifact_sha256: string;
  metadata_sha256: string | null;
  metadata_schema: string | null;
  terms_sha256: string;
  claim_bps: number;
  residual_in_units: string;
  effective_units: string;
  residual_out_units: string;
  issued_total_units: string;
  own_payout_numerator_units: string;
  own_payout_denominator_units: string;
  observed_slot: string;
  declared_at: string;
  observed_unix_time: string;
  depth: number;
  custody_mode: CustodyMode;
}

const NODE_KEYS = [
  'format_version', 'economic_rule', 'node_ref', 'economic_parent', 'references',
  'contributor', 'name', 'title', 'nonce', 'intent_digest', 'artifact_sha256',
  'metadata_sha256', 'metadata_schema', 'terms_sha256', 'claim_bps',
  'residual_in_units', 'effective_units', 'residual_out_units',
  'issued_total_units', 'own_payout_numerator_units',
  'own_payout_denominator_units', 'observed_slot', 'declared_at',
  'observed_unix_time', 'depth', 'custody_mode',
] as const;

const UNIT_FIELDS = [
  'residual_in_units', 'effective_units', 'residual_out_units',
  'issued_total_units', 'own_payout_numerator_units', 'own_payout_denominator_units',
] as const;

export function parseNodeRecordV1(value: unknown, path = 'node'): V<NodeRecordV1> {
  if (!isPlainObject(value)) return fail('INVALID_TYPE', path, 'expected object');
  const k = expectKeys(value, NODE_KEYS, path);
  if (!k.ok) return k;
  if (value['format_version'] !== 1) {
    return fail('INVALID_FORMAT_VERSION', `${path}.format_version`, 'expected const 1');
  }
  if (value['economic_rule'] !== 'residual-v1') {
    return fail('INVALID_ENUM', `${path}.economic_rule`, 'expected residual-v1');
  }
  {
    const r = parseNodeRef(value['node_ref'], `${path}.node_ref`);
    if (!r.ok) return r;
  }
  {
    const p = value['economic_parent'];
    if (p !== null) {
      const r = parseNodeRef(p, `${path}.economic_parent`);
      if (!r.ok) return r;
    }
  }
  {
    const r = expectReferences(value['references'], `${path}.references`);
    if (!r.ok) return r;
  }
  {
    const r = expectBase58Address(value['contributor'], `${path}.contributor`);
    if (!r.ok) return r;
  }
  {
    const r = expectUtf8Bounded(value['name'], 1, MAX_NAME_UTF8_BYTES, `${path}.name`, 'NAME_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  {
    const r = expectUtf8Bounded(value['title'], 0, MAX_TITLE_UTF8_BYTES, `${path}.title`, 'TITLE_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  {
    const r = expectHex(value['nonce'], NONCE_HEX_CHARS, `${path}.nonce`, 'NONCE_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  for (const f of ['intent_digest', 'artifact_sha256', 'terms_sha256'] as const) {
    const r = expectHex(value[f], DIGEST_HEX_CHARS, `${path}.${f}`);
    if (!r.ok) return r;
  }
  {
    const r = expectNullableHex(value['metadata_sha256'], DIGEST_HEX_CHARS, `${path}.metadata_sha256`);
    if (!r.ok) return r;
  }
  {
    const ms = value['metadata_schema'];
    if (ms !== null && (typeof ms !== 'string' || ms.length > MAX_METADATA_SCHEMA_CHARS)) {
      return fail('FIELD_OUT_OF_RANGE', `${path}.metadata_schema`, `expected null or string <= ${MAX_METADATA_SCHEMA_CHARS} chars`);
    }
  }
  {
    const r = expectClaimBps(value['claim_bps'], `${path}.claim_bps`);
    if (!r.ok) return r;
  }
  for (const f of UNIT_FIELDS) {
    const r = expectUnitsDecimal(value[f], `${path}.${f}`);
    if (!r.ok) return r;
  }
  {
    const r = parseU64Decimal(value['observed_slot'], `${path}.observed_slot`);
    if (!r.ok) return r;
  }
  {
    const r = parseI64Decimal(value['declared_at'], `${path}.declared_at`);
    if (!r.ok) return r;
  }
  {
    const r = parseI64Decimal(value['observed_unix_time'], `${path}.observed_unix_time`);
    if (!r.ok) return r;
  }
  {
    const d = value['depth'];
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > MAX_DEPTH) {
      return fail('DEPTH_OUT_OF_RANGE', `${path}.depth`, `expected integer in 0..${MAX_DEPTH}`);
    }
  }
  {
    const r = expectEnum(value['custody_mode'], CUSTODY_MODES, `${path}.custody_mode`);
    if (!r.ok) return r;
  }
  // Semantic invariant: numerator must equal effective; denominator must equal
  // issued (validated caches, not independent inputs).
  const eff = BigInt(value['effective_units'] as string);
  const num = BigInt(value['own_payout_numerator_units'] as string);
  const iss = BigInt(value['issued_total_units'] as string);
  const den = BigInt(value['own_payout_denominator_units'] as string);
  if (num !== eff) {
    return fail('FIELD_OUT_OF_RANGE', `${path}.own_payout_numerator_units`, 'numerator must equal effective_units');
  }
  if (den !== iss) {
    return fail('FIELD_OUT_OF_RANGE', `${path}.own_payout_denominator_units`, 'denominator must equal issued_total_units');
  }
  return ok(value as unknown as NodeRecordV1);
}

// ---------------------------------------------------------------------------
// ProjectV1
// ---------------------------------------------------------------------------

export type ExtensionPolicy = 'OPEN' | 'REVIEWED';
export const EXTENSION_POLICIES: readonly ExtensionPolicy[] = ['OPEN', 'REVIEWED'];

export interface ProjectV1 {
  format_version: 1;
  genesis_hash: string;
  program_id: string;
  project_address: string;
  creator: string;
  controller: string | null;
  root_node: string | null;
  project_nonce: string;
  title: string;
  economic_rule: 'residual-v1';
  total_units: '1000000000000';
  extension_policy: ExtensionPolicy;
  terms_sha256: string;
}

const PROJECT_KEYS = [
  'format_version', 'genesis_hash', 'program_id', 'project_address', 'creator',
  'controller', 'root_node', 'project_nonce', 'title', 'economic_rule',
  'total_units', 'extension_policy', 'terms_sha256',
] as const;

export function parseProjectV1(value: unknown, path = 'project'): V<ProjectV1> {
  if (!isPlainObject(value)) return fail('INVALID_TYPE', path, 'expected object');
  const k = expectKeys(value, PROJECT_KEYS, path);
  if (!k.ok) return k;
  if (value['format_version'] !== 1) {
    return fail('INVALID_FORMAT_VERSION', `${path}.format_version`, 'expected const 1');
  }
  for (const f of ['genesis_hash', 'program_id', 'project_address', 'creator'] as const) {
    const r = expectBase58Address(value[f], `${path}.${f}`);
    if (!r.ok) return r;
  }
  for (const f of ['controller', 'root_node'] as const) {
    const r = expectNullableBase58Address(value[f], `${path}.${f}`);
    if (!r.ok) return r;
  }
  {
    const r = expectHex(value['project_nonce'], NONCE_HEX_CHARS, `${path}.project_nonce`, 'NONCE_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  {
    const r = expectUtf8Bounded(value['title'], 0, MAX_TITLE_UTF8_BYTES, `${path}.title`, 'TITLE_OUT_OF_RANGE');
    if (!r.ok) return r;
  }
  if (value['economic_rule'] !== 'residual-v1') {
    return fail('INVALID_ENUM', `${path}.economic_rule`, 'expected residual-v1');
  }
  if (value['total_units'] !== '1000000000000') {
    return fail('FIELD_OUT_OF_RANGE', `${path}.total_units`, 'expected const "1000000000000"');
  }
  {
    const r = expectEnum(value['extension_policy'], EXTENSION_POLICIES, `${path}.extension_policy`);
    if (!r.ok) return r;
  }
  {
    const r = expectHex(value['terms_sha256'], DIGEST_HEX_CHARS, `${path}.terms_sha256`);
    if (!r.ok) return r;
  }
  return ok(value as unknown as ProjectV1);
}

// ---------------------------------------------------------------------------
// EvidenceBundleV1
// ---------------------------------------------------------------------------

export type EvidenceFileKind =
  | 'record' | 'intent' | 'signature' | 'statement' | 'manifest'
  | 'metadata' | 'terms' | 'artifact' | 'report';

export const EVIDENCE_FILE_KINDS: readonly EvidenceFileKind[] = [
  'record', 'intent', 'signature', 'statement', 'manifest',
  'metadata', 'terms', 'artifact', 'report',
];

export interface EvidenceFileEntry {
  path: string;
  sha256: string;
  bytes: string;
  kind: EvidenceFileKind;
}

export interface EvidenceBundleV1 {
  format_version: 1;
  selected_leaf: NodeRef;
  exporter: string;
  files: EvidenceFileEntry[];
  limitations: string[];
}

const BUNDLE_KEYS = ['format_version', 'selected_leaf', 'exporter', 'files', 'limitations'] as const;
const FILE_KEYS = ['path', 'sha256', 'bytes', 'kind'] as const;

/** Safe relative path: no absolute paths, no traversal, no backslashes/NUL. */
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0 || p.length > MAX_BUNDLE_PATH_CHARS) return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('\\\\')) return false;
  if (p.includes('\\') || p.includes('\u0000')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.');
}

export function parseEvidenceBundleV1(value: unknown, path = 'bundle'): V<EvidenceBundleV1> {
  if (!isPlainObject(value)) return fail('INVALID_TYPE', path, 'expected object');
  const k = expectKeys(value, BUNDLE_KEYS, path);
  if (!k.ok) return k;
  if (value['format_version'] !== 1) {
    return fail('INVALID_FORMAT_VERSION', `${path}.format_version`, 'expected const 1');
  }
  {
    const r = parseNodeRef(value['selected_leaf'], `${path}.selected_leaf`);
    if (!r.ok) return r;
  }
  {
    const e = value['exporter'];
    if (typeof e !== 'string' || e.length > MAX_EXPORTER_CHARS) {
      return fail('FIELD_OUT_OF_RANGE', `${path}.exporter`, `expected string <= ${MAX_EXPORTER_CHARS} chars`);
    }
  }
  const files = value['files'];
  if (!Array.isArray(files) || files.length > MAX_BUNDLE_FILES) {
    return fail('FIELD_OUT_OF_RANGE', `${path}.files`, `expected array of at most ${MAX_BUNDLE_FILES} entries`);
  }
  const seenPaths = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fp = `${path}.files[${i}]`;
    if (!isPlainObject(f)) return fail('INVALID_TYPE', fp, 'expected object');
    const fk = expectKeys(f, FILE_KEYS, fp);
    if (!fk.ok) return fk;
    if (typeof f['path'] !== 'string' || !isSafeRelativePath(f['path'])) {
      return fail('FIELD_OUT_OF_RANGE', `${fp}.path`, 'unsafe or out-of-range relative path');
    }
    if (seenPaths.has(f['path'])) {
      return fail('FIELD_OUT_OF_RANGE', `${fp}.path`, 'duplicate path in bundle');
    }
    seenPaths.add(f['path']);
    {
      const r = expectHex(f['sha256'], DIGEST_HEX_CHARS, `${fp}.sha256`);
      if (!r.ok) return r;
    }
    {
      const r = parseU64Decimal(f['bytes'], `${fp}.bytes`);
      if (!r.ok) return r;
    }
    {
      const r = expectEnum(f['kind'], EVIDENCE_FILE_KINDS, `${fp}.kind`);
      if (!r.ok) return r;
    }
  }
  const limitations = value['limitations'];
  if (!Array.isArray(limitations)) {
    return fail('INVALID_TYPE', `${path}.limitations`, 'expected array');
  }
  for (let i = 0; i < limitations.length; i++) {
    const l = limitations[i];
    if (typeof l !== 'string' || l.length > MAX_LIMITATION_CHARS) {
      return fail('FIELD_OUT_OF_RANGE', `${path}.limitations[${i}]`, `expected string <= ${MAX_LIMITATION_CHARS} chars`);
    }
  }
  return ok(value as unknown as EvidenceBundleV1);
}

/** Byte-level helpers used by codecs and the local adapter. */
export function hexBytes(value: string): Uint8Array {
  const b = hexToBytes(value);
  if (b === null) throw new Error('unreachable: hex validated before decode');
  return b;
}
