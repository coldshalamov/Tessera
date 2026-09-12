import {
  isLowerHex,
  isPlainObject,
  parseEvidenceBundleV1,
  parseU64Decimal,
  type EvidenceBundleV1,
  type EvidenceFileEntry,
  type EvidenceFileKind,
  type ValidationIssue,
} from '@tessera/types';
import { sha256Hex } from '@tessera/types';
import type { Result } from '@tessera/types';
import { err, ok } from '@tessera/types';
import { stableJsonBytes } from './json.js';
import { unsafePathReason } from './paths.js';

/**
 * bundle.json construction and reading.
 *
 * STRICT path (v1): `parseEvidenceBundleV1` — full schema + semantic rules.
 * LENIENT path (any version): `parseManifestLenient` extracts only what is
 * needed to inventory and hash-check files on unknown schema versions,
 * WITHOUT claiming semantic validation. This is how unknown-schema bundles
 * stay inspectable and exportable (docs/06: "Unknown schema is preserved
 * without claiming semantic validation").
 */

export interface PendingFile {
  readonly path: string;
  readonly kind: EvidenceFileKind;
  readonly data: Uint8Array;
}

export interface ManifestBuild {
  readonly manifest: EvidenceBundleV1;
  /** Canonical bytes of bundle.json as stored in the archive. */
  readonly manifestBytes: Uint8Array;
  /** path → sha256 for every payload file (manifest itself excluded). */
  readonly entries: EvidenceFileEntry[];
}

/** Hash payload files and assemble a schema-valid v1 manifest. */
export async function buildManifest(
  files: readonly PendingFile[],
  selectedLeaf: EvidenceBundleV1['selected_leaf'],
  exporter: string,
  limitations: readonly string[],
): Promise<Result<ManifestBuild, ValidationIssue>> {
  const entries: EvidenceFileEntry[] = [];
  for (const f of files) {
    const reason = unsafePathReason(f.path);
    if (reason !== null) {
      return err({ code: 'FIELD_OUT_OF_RANGE', path: `files[${f.path}]`, message: `unsafe bundle path: ${reason}` });
    }
    const hash = await sha256Hex(f.data);
    if (!hash.ok) return hash;
    entries.push({ path: f.path, sha256: hash.value, bytes: String(f.data.length), kind: f.kind });
  }
  const manifest: EvidenceBundleV1 = {
    format_version: 1,
    selected_leaf: selectedLeaf,
    exporter,
    files: entries,
    limitations: [...limitations],
  };
  const parsed = parseEvidenceBundleV1(manifest);
  if (!parsed.ok) return parsed;
  return ok({ manifest, manifestBytes: stableJsonBytes(manifest), entries });
}

/** Canonical serialization of a v1 manifest (sorted keys, UTF-8). */
export function manifestToBytes(manifest: EvidenceBundleV1): Uint8Array {
  return stableJsonBytes(manifest);
}

// ---------------------------------------------------------------------------
// Lenient reading for forward compatibility
// ---------------------------------------------------------------------------

export interface LenientFileEntry {
  readonly path: string;
  readonly sha256: string | null;
  readonly bytes: bigint | null;
  readonly kind: string;
  /** Fields were present and well-typed enough for integrity checking. */
  readonly wellFormed: boolean;
}

export interface LenientManifest {
  readonly formatVersion: unknown;
  readonly isV1Shape: boolean;
  readonly exporter: string | null;
  readonly files: LenientFileEntry[];
  readonly limitations: string[];
  /** Present only when the raw value passes strict v1 validation. */
  readonly v1: EvidenceBundleV1 | null;
  readonly structuralProblems: string[];
}

/**
 * Inventory an unknown bundle.json without claiming to understand it.
 * Collects structural problems instead of rejecting outright so callers can
 * still hash-check what is hashable and extract what is extractable.
 */
export function parseManifestLenient(value: unknown): LenientManifest {
  const problems: string[] = [];
  const files: LenientFileEntry[] = [];
  let exporter: string | null = null;
  let limitations: string[] = [];
  let formatVersion: unknown;

  if (!isPlainObject(value)) {
    problems.push('bundle.json is not a JSON object');
    return { formatVersion: undefined, isV1Shape: false, exporter, files, limitations, v1: null, structuralProblems: problems };
  }
  formatVersion = value['format_version'];
  if (typeof value['exporter'] === 'string') exporter = value['exporter'];
  else if ('exporter' in value) problems.push('exporter is not a string');

  if (Array.isArray(value['limitations'])) {
    limitations = value['limitations'].filter((l): l is string => typeof l === 'string');
    if (limitations.length !== value['limitations'].length) {
      problems.push('some limitations entries are not strings');
    }
  } else if ('limitations' in value) {
    problems.push('limitations is not an array');
  } else {
    problems.push('limitations missing');
  }

  const rawFiles = value['files'];
  if (!Array.isArray(rawFiles)) {
    problems.push('files is missing or not an array');
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < rawFiles.length; i++) {
      const f = rawFiles[i];
      if (!isPlainObject(f)) {
        problems.push(`files[${i}] is not an object`);
        continue;
      }
      const path = typeof f['path'] === 'string' ? f['path'] : '';
      const sha = typeof f['sha256'] === 'string' && isLowerHex(f['sha256'], 64) ? f['sha256'] : null;
      let bytes: bigint | null = null;
      if (typeof f['bytes'] === 'string') {
        const b = parseU64Decimal(f['bytes'], `files[${i}].bytes`);
        if (b.ok) bytes = b.value;
      }
      const kind = typeof f['kind'] === 'string' ? f['kind'] : '';
      const wellFormed =
        path.length > 0 &&
        unsafePathReason(path) === null &&
        sha !== null &&
        bytes !== null &&
        kind.length > 0;
      if (!wellFormed) {
        problems.push(`files[${i}] missing/invalid path/sha256/bytes/kind`);
      }
      if (path.length > 0) {
        if (seen.has(path)) problems.push(`duplicate path '${path}'`);
        seen.add(path);
      }
      files.push({ path, sha256: sha, bytes, kind, wellFormed });
    }
  }

  const strict = parseEvidenceBundleV1(value);
  return {
    formatVersion,
    isV1Shape: strict.ok,
    exporter,
    files,
    limitations,
    v1: strict.ok ? strict.value : null,
    structuralProblems: problems,
  };
}
