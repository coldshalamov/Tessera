import { base58Encode } from './base58.js';
import { issue, type ValidationIssue } from './errors.js';
import { bytesToHex } from './hex.js';
import type { CustodyMode, IntentV1, StatementType, StatementV1 } from './records.js';
import {
  INTENT_DOMAIN,
  MAX_NAME_UTF8_BYTES,
  MAX_REFERENCES,
  MAX_TITLE_UTF8_BYTES,
  STATEMENT_DOMAIN,
  parseIntentV1,
  parseStatementV1,
} from './records.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

/**
 * Strict decoders for the pinned docs/14 wire layout — the inverse of
 * `encodeIntentV1`/`encodeStatementV1`. Rules enforced at the byte level:
 * fixed ASCII domain, `format_version`/`statement_code` const bytes, option
 * tags restricted to 0/1, `references` count ≤ 8, string byte bounds checked
 * before allocation semantics apply (length prefix is read, then exactly that
 * many bytes are consumed), fatal UTF-8 decoding, and **no trailing bytes**.
 * The recovered JSON view is then re-validated by the same semantic parser
 * used for untrusted JSON input, so decoded records can never violate the
 * invariants a hand-written record must satisfy.
 *
 * decode → encode round-trips byte-for-byte: every 32-byte field is re-encoded
 * from raw bytes, and base58Encode produces the canonical address spelling.
 */

class ByteReader {
  private off = 0;
  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.off;
  }

  take(n: number): Uint8Array | null {
    if (n < 0 || this.off + n > this.buf.length) return null;
    const out = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return out;
  }

  u8(): number | null {
    const b = this.take(1);
    return b === null ? null : b[0]!;
  }

  u16(): number | null {
    const b = this.take(2);
    return b === null ? null : b[0]! | (b[1]! << 8);
  }

  u32(): number | null {
    const b = this.take(4);
    if (b === null) return null;
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }

  i64(): bigint | null {
    const b = this.take(8);
    if (b === null) return null;
    return new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true);
  }
}

function fail(code: ValidationIssue['code'], path: string, message: string): Result<never, ValidationIssue> {
  return err(issue(code, path, message));
}

function expectDomain(r: ByteReader, domain: string, path: string): Result<void, ValidationIssue> {
  const got = r.take(domain.length);
  if (got === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated before domain separator');
  for (let i = 0; i < domain.length; i++) {
    if (got[i] !== domain.charCodeAt(i)) {
      return fail('WIRE_LENGTH_MISMATCH', path, `missing ${domain} domain separator`);
    }
  }
  return ok(undefined);
}

/** Read an optional-32 field: tag byte 0|1, then 32 bytes when tag = 1. */
function readOpt32(
  r: ByteReader,
  path: string,
): Result<Uint8Array | null, ValidationIssue> {
  const tag = r.u8();
  if (tag === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated at option tag');
  if (tag === 0) return ok(null);
  if (tag !== 1) return fail('INVALID_ENUM', path, `option tag must be 0 or 1, got ${tag}`);
  const b = r.take(32);
  if (b === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated inside option payload');
  return ok(b);
}

function read32(r: ByteReader, path: string): Result<Uint8Array, ValidationIssue> {
  const b = r.take(32);
  if (b === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated 32-byte field');
  return ok(b);
}

const utf8dec = new TextDecoder('utf-8', { fatal: true });

function readBoundedString(
  r: ByteReader,
  minBytes: number,
  maxBytes: number,
  path: string,
  rangeCode: 'NAME_OUT_OF_RANGE' | 'TITLE_OUT_OF_RANGE',
): Result<string, ValidationIssue> {
  const len = r.u32();
  if (len === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated at string length prefix');
  if (len > maxBytes || len < minBytes) {
    return fail(rangeCode, path, `string byte length ${len} outside [${minBytes}, ${maxBytes}]`);
  }
  const raw = r.take(len);
  if (raw === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated inside string bytes');
  try {
    return ok(utf8dec.decode(raw));
  } catch {
    return fail('INVALID_UTF8', path, 'bytes are not well-formed UTF-8');
  }
}

const CUSTODY_FROM_WIRE: Record<number, CustodyMode> = {
  1: 'user_controlled',
  2: 'embedded_provider',
  3: 'server_custodied',
};

const STATEMENT_TYPE_FROM_WIRE: Record<number, StatementType> = {
  1: 'APP_DEFINED',
  2: 'KEY_CONTINUITY',
  3: 'RELEASE_ANCHOR',
  4: 'RETRACTION_OR_DISPUTE',
};

function readCustody(r: ByteReader, path: string): Result<CustodyMode, ValidationIssue> {
  const b = r.u8();
  if (b === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated at custody_mode');
  const mode = CUSTODY_FROM_WIRE[b];
  if (mode === undefined) return fail('INVALID_ENUM', path, `custody_mode byte must be 1..3, got ${b}`);
  return ok(mode);
}

function readI64Field(r: ByteReader, path: string): Result<string, ValidationIssue> {
  const v = r.i64();
  if (v === null) return fail('WIRE_LENGTH_MISMATCH', path, 'truncated at declared_at');
  return ok(v.toString(10));
}

/**
 * Decode the exact IntentV1 signing bytes back to the portable JSON view.
 * Rejects truncated input, trailing bytes, bad option tags, oversized strings,
 * malformed UTF-8 and out-of-enum bytes; the result still passes through
 * `parseIntentV1` so semantic bounds are enforced identically on both paths.
 */
export function decodeIntentV1(bytes: Uint8Array): Result<IntentV1, ValidationIssue> {
  const r = new ByteReader(bytes);
  {
    const d = expectDomain(r, INTENT_DOMAIN, 'intent.domain');
    if (!d.ok) return d;
  }
  {
    const v = r.u8();
    if (v === null) return fail('WIRE_LENGTH_MISMATCH', 'intent.format_version', 'truncated');
    if (v !== 1) return fail('INVALID_FORMAT_VERSION', 'intent.format_version', `expected 1, got ${v}`);
  }

  const g = read32(r, 'intent.network_genesis'); if (!g.ok) return g;
  const p = read32(r, 'intent.program_id'); if (!p.ok) return p;
  const pr = read32(r, 'intent.project_address'); if (!pr.ok) return pr;
  const parent = readOpt32(r, 'intent.economic_parent'); if (!parent.ok) return parent;

  const refCount = r.u8();
  if (refCount === null) return fail('WIRE_LENGTH_MISMATCH', 'intent.references', 'truncated at count');
  if (refCount > MAX_REFERENCES) {
    return fail('REFERENCES_OUT_OF_RANGE', 'intent.references', `count ${refCount} exceeds ${MAX_REFERENCES}`);
  }
  const references: string[] = [];
  for (let i = 0; i < refCount; i++) {
    const b = read32(r, `intent.references[${i}]`);
    if (!b.ok) return b;
    references.push(base58Encode(b.value));
  }

  const nonce = r.take(16);
  if (nonce === null) return fail('WIRE_LENGTH_MISMATCH', 'intent.nonce', 'truncated 16-byte nonce');
  const contributor = read32(r, 'intent.contributor'); if (!contributor.ok) return contributor;

  const name = readBoundedString(r, 1, MAX_NAME_UTF8_BYTES, 'intent.name', 'NAME_OUT_OF_RANGE');
  if (!name.ok) return name;
  const title = readBoundedString(r, 0, MAX_TITLE_UTF8_BYTES, 'intent.title', 'TITLE_OUT_OF_RANGE');
  if (!title.ok) return title;

  const artifact = read32(r, 'intent.artifact_sha256'); if (!artifact.ok) return artifact;
  const metadata = readOpt32(r, 'intent.metadata_sha256'); if (!metadata.ok) return metadata;
  const terms = read32(r, 'intent.terms_sha256'); if (!terms.ok) return terms;

  const claim = r.u16();
  if (claim === null) return fail('WIRE_LENGTH_MISMATCH', 'intent.claim_bps', 'truncated');

  const scode = r.u8();
  if (scode === null) return fail('WIRE_LENGTH_MISMATCH', 'intent.statement_code', 'truncated');
  if (scode !== 1) return fail('INVALID_ENUM', 'intent.statement_code', `expected 1, got ${scode}`);

  const declared = readI64Field(r, 'intent.declared_at'); if (!declared.ok) return declared;
  const custody = readCustody(r, 'intent.custody_mode'); if (!custody.ok) return custody;

  if (r.remaining !== 0) {
    return fail('WIRE_LENGTH_MISMATCH', 'intent', `${r.remaining} trailing byte(s) after last field`);
  }

  const candidate = {
    format_version: 1,
    network_genesis: base58Encode(g.value),
    program_id: base58Encode(p.value),
    project_address: base58Encode(pr.value),
    economic_parent: parent.value === null ? null : base58Encode(parent.value),
    references,
    nonce: bytesToHex(nonce),
    contributor: base58Encode(contributor.value),
    name: name.value,
    title: title.value,
    artifact_sha256: bytesToHex(artifact.value),
    metadata_sha256: metadata.value === null ? null : bytesToHex(metadata.value),
    terms_sha256: bytesToHex(terms.value),
    claim_bps: claim,
    statement_code: 'CONTRIBUTE_AND_ACCEPT_TERMS',
    declared_at: declared.value,
    custody_mode: custody.value,
  };
  return parseIntentV1(candidate, 'intent');
}

/**
 * Decode exact StatementV1 signing bytes (TESSERA:STATEMENT:1 family) back to
 * the portable JSON view, with the same strictness as `decodeIntentV1`.
 */
export function decodeStatementV1(bytes: Uint8Array): Result<StatementV1, ValidationIssue> {
  const r = new ByteReader(bytes);
  {
    const d = expectDomain(r, STATEMENT_DOMAIN, 'statement.domain');
    if (!d.ok) return d;
  }
  {
    const v = r.u8();
    if (v === null) return fail('WIRE_LENGTH_MISMATCH', 'statement.format_version', 'truncated');
    if (v !== 1) return fail('INVALID_FORMAT_VERSION', 'statement.format_version', `expected 1, got ${v}`);
  }

  const g = read32(r, 'statement.network_genesis'); if (!g.ok) return g;
  const p = read32(r, 'statement.program_id'); if (!p.ok) return p;
  const project = readOpt32(r, 'statement.project_address'); if (!project.ok) return project;

  const stype = r.u8();
  if (stype === null) return fail('WIRE_LENGTH_MISMATCH', 'statement.statement_type', 'truncated');
  const statementType = STATEMENT_TYPE_FROM_WIRE[stype];
  if (statementType === undefined) {
    return fail('INVALID_ENUM', 'statement.statement_type', `expected 1..4, got ${stype}`);
  }

  const subject = readOpt32(r, 'statement.subject_ref'); if (!subject.ok) return subject;
  const aux = readOpt32(r, 'statement.aux_key'); if (!aux.ok) return aux;
  const payload = read32(r, 'statement.payload_sha256'); if (!payload.ok) return payload;
  const declared = readI64Field(r, 'statement.declared_at'); if (!declared.ok) return declared;
  const custody = readCustody(r, 'statement.custody_mode'); if (!custody.ok) return custody;

  if (r.remaining !== 0) {
    return fail('WIRE_LENGTH_MISMATCH', 'statement', `${r.remaining} trailing byte(s) after last field`);
  }

  const candidate = {
    format_version: 1,
    network_genesis: base58Encode(g.value),
    program_id: base58Encode(p.value),
    project_address: project.value === null ? null : base58Encode(project.value),
    statement_type: statementType,
    subject_ref: subject.value === null ? null : base58Encode(subject.value),
    aux_key: aux.value === null ? null : base58Encode(aux.value),
    payload_sha256: bytesToHex(payload.value),
    declared_at: declared.value,
    custody_mode: custody.value,
  };
  return parseStatementV1(candidate, 'statement');
}
