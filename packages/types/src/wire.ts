import { base58AddressToBytes } from './base58.js';
import { issue, type ValidationIssue } from './errors.js';
import { hexToBytes } from './hex.js';
import type {
  CustodyMode,
  IntentV1,
  StatementType,
  StatementV1,
} from './records.js';
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
import { I64_MAX, I64_MIN, parseI64Decimal } from './units.js';

/**
 * Deterministic Borsh-compatible wire encoding per docs/14_BINARY_LAYOUT_V1.
 * All integers unsigned little-endian; i64 signed LE; strings u32 length +
 * UTF-8 bytes; optional 32-byte values are a tag byte plus payload when
 * present. No padding, no trailing bytes. This is the pinned v1 layout;
 * after deployment these bytes never change in place.
 *
 * IntentV1 is verified byte-for-byte against fixtures/intent-v1-signature.json.
 * StatementV1 follows the same spec table; no golden vector exists yet (T02).
 */

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u8(v: number): void {
    this.push(Uint8Array.of(v & 0xff));
  }

  u16(v: number): void {
    this.push(Uint8Array.of(v & 0xff, (v >> 8) & 0xff));
  }

  u32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.push(b);
  }

  i64(v: bigint): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    this.push(b);
  }

  ascii(s: string): void {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0x7f;
    this.push(b);
  }

  bytes32(value: Uint8Array): void {
    if (value.length !== 32) throw new Error('bytes32 requires exactly 32 bytes');
    this.push(value);
  }

  optBytes32(value: Uint8Array | null): void {
    if (value === null) {
      this.u8(0);
    } else {
      this.u8(1);
      this.bytes32(value);
    }
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

const utf8enc = new TextEncoder();

function addr(value: string, path: string): Result<Uint8Array, ValidationIssue> {
  const b = base58AddressToBytes(value);
  if (b === null) {
    return err(issue('INVALID_BASE58', path, 'address must decode to exactly 32 bytes'));
  }
  return ok(b);
}

function digest32(value: string, path: string): Result<Uint8Array, ValidationIssue> {
  const b = hexToBytes(value);
  if (b === null || b.length !== 32) {
    return err(issue('INVALID_HEX', path, 'expected 64 lowercase hex chars (32 bytes)'));
  }
  return ok(b);
}

function optDigest32(value: string | null, path: string): Result<Uint8Array | null, ValidationIssue> {
  if (value === null) return ok(null);
  return digest32(value, path);
}

function optAddr(value: string | null, path: string): Result<Uint8Array | null, ValidationIssue> {
  if (value === null) return ok(null);
  return addr(value, path);
}

const CUSTODY_WIRE: Record<CustodyMode, number> = {
  user_controlled: 1,
  embedded_provider: 2,
  server_custodied: 3,
};

const STATEMENT_TYPE_WIRE: Record<StatementType, number> = {
  APP_DEFINED: 1,
  KEY_CONTINUITY: 2,
  RELEASE_ANCHOR: 3,
  RETRACTION_OR_DISPUTE: 4,
};

/**
 * Encode a validated IntentV1 to its exact signing bytes (348 bytes for the
 * supplied fixture). Re-validates semantically before encoding; returns typed
 * errors rather than throwing.
 */
export function encodeIntentV1(intent: IntentV1): Result<Uint8Array, ValidationIssue> {
  const parsed = parseIntentV1(intent, 'intent');
  if (!parsed.ok) return parsed;

  const w = new ByteWriter();
  w.ascii(INTENT_DOMAIN);
  w.u8(1); // format_version

  const genesis = addr(intent.network_genesis, 'intent.network_genesis');
  if (!genesis.ok) return genesis;
  w.bytes32(genesis.value);

  const program = addr(intent.program_id, 'intent.program_id');
  if (!program.ok) return program;
  w.bytes32(program.value);

  const project = addr(intent.project_address, 'intent.project_address');
  if (!project.ok) return project;
  w.bytes32(project.value);

  const parent = optAddr(intent.economic_parent, 'intent.economic_parent');
  if (!parent.ok) return parent;
  w.optBytes32(parent.value);

  if (intent.references.length > MAX_REFERENCES) {
    return err(issue('REFERENCES_OUT_OF_RANGE', 'intent.references', `at most ${MAX_REFERENCES} entries`));
  }
  w.u8(intent.references.length);
  for (let i = 0; i < intent.references.length; i++) {
    const r = addr(intent.references[i]!, `intent.references[${i}]`);
    if (!r.ok) return r;
    w.bytes32(r.value);
  }

  const nonce = hexToBytes(intent.nonce);
  if (nonce === null || nonce.length !== 16) {
    return err(issue('NONCE_OUT_OF_RANGE', 'intent.nonce', 'expected 16 bytes as 32 lowercase hex chars'));
  }
  w.push(nonce);

  const contributor = addr(intent.contributor, 'intent.contributor');
  if (!contributor.ok) return contributor;
  w.bytes32(contributor.value);

  const nameBytes = utf8enc.encode(intent.name);
  if (nameBytes.length < 1 || nameBytes.length > MAX_NAME_UTF8_BYTES) {
    return err(issue('NAME_OUT_OF_RANGE', 'intent.name', 'UTF-8 length outside 1..64 bytes'));
  }
  w.u32(nameBytes.length);
  w.push(nameBytes);

  const titleBytes = utf8enc.encode(intent.title);
  if (titleBytes.length > MAX_TITLE_UTF8_BYTES) {
    return err(issue('TITLE_OUT_OF_RANGE', 'intent.title', 'UTF-8 length above 96 bytes'));
  }
  w.u32(titleBytes.length);
  w.push(titleBytes);

  const artifact = digest32(intent.artifact_sha256, 'intent.artifact_sha256');
  if (!artifact.ok) return artifact;
  w.bytes32(artifact.value);

  const metadata = optDigest32(intent.metadata_sha256, 'intent.metadata_sha256');
  if (!metadata.ok) return metadata;
  w.optBytes32(metadata.value);

  const terms = digest32(intent.terms_sha256, 'intent.terms_sha256');
  if (!terms.ok) return terms;
  w.bytes32(terms.value);

  w.u16(intent.claim_bps);
  w.u8(1); // statement_code: CONTRIBUTE_AND_ACCEPT_TERMS

  const declared = parseI64Decimal(intent.declared_at, 'intent.declared_at');
  if (!declared.ok) return declared;
  if (declared.value < I64_MIN || declared.value > I64_MAX) {
    return err(issue('I64_OUT_OF_RANGE', 'intent.declared_at', 'does not fit i64'));
  }
  w.i64(declared.value);

  w.u8(CUSTODY_WIRE[intent.custody_mode]);
  return ok(w.finish());
}

/**
 * Encode a validated StatementV1 (TESSERA:STATEMENT:1 family).
 * Implemented to the docs/14 table; no golden vector exists yet — T02 will
 * generate statement vectors in both repos.
 */
export function encodeStatementV1(statement: StatementV1): Result<Uint8Array, ValidationIssue> {
  const parsed = parseStatementV1(statement, 'statement');
  if (!parsed.ok) return parsed;

  const w = new ByteWriter();
  w.ascii(STATEMENT_DOMAIN);
  w.u8(1); // format_version

  const genesis = addr(statement.network_genesis, 'statement.network_genesis');
  if (!genesis.ok) return genesis;
  w.bytes32(genesis.value);

  const program = addr(statement.program_id, 'statement.program_id');
  if (!program.ok) return program;
  w.bytes32(program.value);

  const project = optAddr(statement.project_address, 'statement.project_address');
  if (!project.ok) return project;
  w.optBytes32(project.value);

  w.u8(STATEMENT_TYPE_WIRE[statement.statement_type]);

  const subject = optAddr(statement.subject_ref, 'statement.subject_ref');
  if (!subject.ok) return subject;
  w.optBytes32(subject.value);

  const aux = optAddr(statement.aux_key, 'statement.aux_key');
  if (!aux.ok) return aux;
  w.optBytes32(aux.value);

  const payload = digest32(statement.payload_sha256, 'statement.payload_sha256');
  if (!payload.ok) return payload;
  w.bytes32(payload.value);

  const declared = parseI64Decimal(statement.declared_at, 'statement.declared_at');
  if (!declared.ok) return declared;
  w.i64(declared.value);

  w.u8(CUSTODY_WIRE[statement.custody_mode]);
  return ok(w.finish());
}

/** SHA-256 over raw bytes via WebCrypto (Node >=20 and Workers both provide it). */
export async function sha256Hex(bytes: Uint8Array): Promise<Result<string, ValidationIssue>> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return err(issue('CRYPTO_UNAVAILABLE', 'crypto.subtle', 'WebCrypto SHA-256 is unavailable in this runtime'));
  }
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  const out = new Uint8Array(digest);
  let s = '';
  for (const b of out) s += b.toString(16).padStart(2, '0');
  return ok(s);
}

/** intent_digest = SHA256(IntentV1 bytes) per docs/14. */
export async function intentDigestHex(intent: IntentV1): Promise<Result<string, ValidationIssue>> {
  const encoded = encodeIntentV1(intent);
  if (!encoded.ok) return encoded;
  return sha256Hex(encoded.value);
}

/** Ed25519 detached-signature verification over a 32-byte digest (docs/03). */
export async function verifyEd25519Detached(
  publicKey32: Uint8Array,
  signature64: Uint8Array,
  message: Uint8Array,
): Promise<Result<boolean, ValidationIssue>> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return err(issue('CRYPTO_UNAVAILABLE', 'crypto.subtle', 'WebCrypto Ed25519 is unavailable in this runtime'));
  }
  if (publicKey32.length !== 32 || signature64.length !== 64) {
    return err(issue('INVALID_HEX', 'signature', 'expected 32-byte key and 64-byte signature'));
  }
  try {
    const key = await subtle.importKey(
      'raw',
      publicKey32 as Uint8Array<ArrayBuffer>,
      'Ed25519',
      false,
      ['verify'],
    );
    const valid = await subtle.verify(
      'Ed25519',
      key,
      signature64 as Uint8Array<ArrayBuffer>,
      message as Uint8Array<ArrayBuffer>,
    );
    return ok(valid);
  } catch {
    return ok(false);
  }
}
