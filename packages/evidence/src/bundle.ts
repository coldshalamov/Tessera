import type { EvidenceBundleV1 } from '@tessera/types';
import { parseEvidenceBundleV1 } from '@tessera/types';
import type { Result } from '@tessera/types';
import { ok } from '@tessera/types';
import { parseJsonBytes } from './json.js';
import { manifestToBytes, parseManifestLenient, type LenientManifest } from './manifest.js';
import { DEFAULT_ZIP_LIMITS, readZip, type ZipLimits, type ZipReadError } from './zip.js';

/**
 * `bundle.json` inventories every payload file; it is NOT listed in its own
 * files[] (a self-hash is uncomputable). Everything else in the container
 * must be listed and byte-identical to its manifest entry.
 */
export const MANIFEST_PATH = 'bundle.json';

export interface BundleContents {
  /** Raw parsed JSON of bundle.json (null when absent or unparseable). */
  readonly manifestRaw: unknown;
  /** Strict v1 parse result when the shape conforms, else null. */
  readonly manifestV1: EvidenceBundleV1 | null;
  /** Lenient inventory usable for any (including unknown) schema versions. */
  readonly lenient: LenientManifest | null;
  /** Exact bytes of bundle.json as found in the container. */
  readonly manifestBytes: Uint8Array | null;
  /** All non-directory archive members except bundle.json, verbatim. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Container-level problems found before manifest validation. */
  readonly containerProblems: readonly string[];
}

export type BundleReadCode =
  | 'CONTAINER' // underlying zip/dir failure (see zip codes)
  | 'MANIFEST_MISSING'
  | 'MANIFEST_UNREADABLE';

export interface BundleReadError {
  readonly code: BundleReadCode;
  readonly message: string;
  readonly zip?: ZipReadError;
}

function berr(code: BundleReadCode, message: string, zip?: ZipReadError): Result<never, BundleReadError> {
  return { ok: false, error: zip === undefined ? { code, message } : { code, message, zip } };
}

/**
 * Interpret a raw member map as an evidence bundle. Works for members read
 * from a zip (`readZip`), a directory listing, or any other container — the
 * verification semantics are identical.
 */
export function contentsFromFileMap(allMembers: ReadonlyMap<string, Uint8Array>): Result<BundleContents, BundleReadError> {
  const problems: string[] = [];
  const manifestBytes = allMembers.get(MANIFEST_PATH);
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of allMembers) {
    if (name === MANIFEST_PATH) continue;
    files.set(name, bytes);
  }
  if (manifestBytes === undefined) {
    return berr('MANIFEST_MISSING', `container has no ${MANIFEST_PATH}`);
  }
  const parsed = parseJsonBytes(manifestBytes);
  if (!parsed.ok) {
    return berr('MANIFEST_UNREADABLE', `${MANIFEST_PATH}: ${parsed.error.code}: ${parsed.error.message}`);
  }
  const strict = parseEvidenceBundleV1(parsed.value);
  const lenient = parseManifestLenient(parsed.value);
  for (const p of lenient.structuralProblems) problems.push(`manifest: ${p}`);
  return ok({
    manifestRaw: parsed.value,
    manifestV1: strict.ok ? strict.value : null,
    lenient,
    manifestBytes,
    files,
    containerProblems: problems,
  });
}

/** Read a zip-encoded bundle with size caps. */
export function readBundleZip(zipBytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Result<BundleContents, BundleReadError> {
  const unzipped = readZip(zipBytes, limits);
  if (!unzipped.ok) {
    return berr('CONTAINER', `${unzipped.error.code}: ${unzipped.error.message}`, unzipped.error);
  }
  return contentsFromFileMap(unzipped.value);
}

/** Assemble the on-disk member map for a bundle: manifest + payloads. */
export function bundleMemberMap(manifest: EvidenceBundleV1, payloads: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  out.set(MANIFEST_PATH, manifestToBytes(manifest));
  for (const [p, b] of payloads) out.set(p, b);
  return out;
}
