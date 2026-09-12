import { Inflate, zipSync } from 'fflate';
import { findDuplicatePath, unsafePathReason } from './paths.js';

/**
 * Minimal, fail-safe ZIP container handling for evidence bundles.
 *
 * WRITE: fflate `zipSync` with a fixed DOS-epoch mtime so output is
 * deterministic for identical inputs.
 *
 * READ: the container is parsed by hand (EOCD → central directory → local
 * headers) and each entry is decompressed through a streaming fflate
 * `Inflate` with a hard output cap. This rejects — before or during
 * decompression, never silently —
 *  - encrypted / zip64 / multi-disk archives, unsupported methods,
 *  - symlink or device entries (unix mode in external attributes),
 *  - non-UTF-8, non-ASCII entry names,
 *  - absolute/traversal/backslash/NUL/reserved-name members,
 *  - duplicate (incl. case-folded) member names,
 *  - entries whose declared or actual uncompressed size exceeds caps,
 *  - deflate streams that emit more bytes than the header declares
 *    (header-lying zip bombs), or fewer.
 *
 * CRC-32 is intentionally not the integrity authority: the bundle manifest's
 * SHA-256 supersedes it. Unlisted members are rejected by the bundle reader,
 * not here.
 */

export interface ZipLimits {
  /** Max uncompressed bytes for a single entry. */
  readonly maxFileBytes: number;
  /** Max summed uncompressed bytes across all entries. */
  readonly maxTotalBytes: number;
  /** Max central-directory entries (files + directories). */
  readonly maxEntries: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxEntries: 10_000,
};

export type ZipReadCode =
  | 'NOT_ZIP'
  | 'TRUNCATED'
  | 'UNSUPPORTED_FEATURE'
  | 'UNSAFE_NAME'
  | 'DUPLICATE_NAME'
  | 'SIZE_CAP_EXCEEDED'
  | 'INFLATE_FAILED'
  | 'SIZE_MISMATCH';

export interface ZipReadError {
  readonly code: ZipReadCode;
  readonly message: string;
  readonly entry?: string;
}

export type ZipResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ZipReadError };

function zerr(code: ZipReadCode, message: string, entry?: string): ZipResult<never> {
  return { ok: false, error: entry === undefined ? { code, message } : { code, message, entry } };
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_EOCD_SEARCH = 65_557; // 22-byte record + max 64KiB comment

/** Allowed general-purpose flag bits: 1-2 deflate level hints, 3 data
 *  descriptor, 11 UTF-8 names. Everything else (encryption bit 0/6, patched
 *  data bit 5, masked CD bit 13, compression tricks) is rejected. */
const ALLOWED_FLAGS = 0x080e;

interface CdEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly isDir: boolean;
}

function findEocd(data: Uint8Array): number {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const start = Math.max(0, data.length - MAX_EOCD_SEARCH);
  for (let i = data.length - 22; i >= start; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/** Decompress one deflate stream with a hard output cap (streaming Inflate;
 *  the cap throw propagates synchronously through push()). */
function inflateCapped(
  compressed: Uint8Array,
  expectedSize: number,
): { ok: true; value: Uint8Array } | { ok: false; error: string } {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let capHit = false;
  const inflate = new Inflate((chunk: Uint8Array) => {
    total += chunk.length;
    if (total > expectedSize) {
      capHit = true;
      throw new Error('inflated data exceeds declared uncompressed size');
    }
    chunks.push(chunk);
  });
  try {
    inflate.push(compressed, true);
  } catch (e) {
    if (capHit) return { ok: false, error: 'inflated data exceeds declared uncompressed size' };
    return { ok: false, error: e instanceof Error ? e.message : 'inflate failed' };
  }
  if (total !== expectedSize) {
    return {
      ok: false,
      error: `inflated ${total} bytes, header declares ${expectedSize}`,
    };
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return { ok: true, value: out };
}

/**
 * Parse and decompress a zip archive into a name → bytes map.
 * Directory entries (names ending '/') are validated then skipped.
 */
export function readZip(data: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipResult<Map<string, Uint8Array>> {
  if (data.length < 22) return zerr('NOT_ZIP', 'input shorter than an end-of-central-directory record');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(data);
  if (eocd < 0) return zerr('NOT_ZIP', 'no end-of-central-directory signature found');

  const disk = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const diskEntries = dv.getUint16(eocd + 8, true);
  const cdEntries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0 || diskEntries !== cdEntries) {
    return zerr('UNSUPPORTED_FEATURE', 'multi-disk archive');
  }
  if (cdEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    return zerr('UNSUPPORTED_FEATURE', 'zip64 archive not supported');
  }
  if (cdEntries > limits.maxEntries) {
    return zerr('SIZE_CAP_EXCEEDED', `${cdEntries} central-directory entries exceeds cap ${limits.maxEntries}`);
  }
  if (cdOffset + cdSize > data.length) {
    return zerr('TRUNCATED', 'central directory extends past end of input');
  }

  const entries: CdEntry[] = [];
  let totalClaimed = 0;
  let off = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (off + 46 > data.length) return zerr('TRUNCATED', 'central directory entry truncated');
    if (dv.getUint32(off, true) !== CD_SIG) {
      return zerr('TRUNCATED', 'bad central-directory signature');
    }
    const flags = dv.getUint16(off + 8, true);
    const method = dv.getUint16(off + 10, true);
    const compressedSize = dv.getUint32(off + 20, true);
    const uncompressedSize = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const diskStart = dv.getUint16(off + 34, true);
    const externalAttrs = dv.getUint32(off + 38, true);
    const localOffset = dv.getUint32(off + 42, true);
    const nameStart = off + 46;
    if (nameStart + nameLen + extraLen + commentLen > data.length) {
      return zerr('TRUNCATED', 'central-directory name/extra/comment truncated');
    }
    off = nameStart + nameLen + extraLen + commentLen;

    if (diskStart !== 0) return zerr('UNSUPPORTED_FEATURE', 'entry starts on another disk');
    if ((flags & ~ALLOWED_FLAGS) !== 0) {
      return zerr('UNSUPPORTED_FEATURE', `unsupported general-purpose flags 0x${flags.toString(16)}`);
    }
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      return zerr('UNSUPPORTED_FEATURE', 'zip64 entry not supported');
    }
    if (method !== 0 && method !== 8) {
      return zerr('UNSUPPORTED_FEATURE', `compression method ${method} (only store/deflate supported)`);
    }
    // Unix file type lives in the high 16 bits of external attributes when
    // version_made_by's high byte is 3; reject symlinks outright and any
    // non-regular, non-directory type.
    const unixType = (externalAttrs >>> 16) & 0xf000;
    if (unixType === 0xa000) {
      return zerr('UNSAFE_NAME', 'symlink entry cannot be extracted safely');
    }
    if (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000) {
      return zerr('UNSAFE_NAME', `non-regular unix file type 0x${unixType.toString(16)}`);
    }

    const nameBytes = data.subarray(nameStart, nameStart + nameLen);
    let asciiOnly = true;
    for (const b of nameBytes) if (b >= 0x80) asciiOnly = false;
    if ((flags & 0x0800) === 0 && !asciiOnly) {
      return zerr('UNSAFE_NAME', 'non-ASCII entry name without UTF-8 flag (CP437 ambiguous)');
    }
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    const isDir = name.endsWith('/');
    if (isDir && uncompressedSize > 0) {
      return zerr('UNSAFE_NAME', 'directory entry carrying payload bytes', name);
    }
    if (!isDir) {
      const reason = unsafePathReason(name);
      if (reason !== null) return zerr('UNSAFE_NAME', reason, name);
      totalClaimed += uncompressedSize;
      if (uncompressedSize > limits.maxFileBytes) {
        return zerr('SIZE_CAP_EXCEEDED', `declared size ${uncompressedSize} exceeds per-file cap ${limits.maxFileBytes}`, name);
      }
      if (totalClaimed > limits.maxTotalBytes) {
        return zerr('SIZE_CAP_EXCEEDED', `claimed uncompressed total exceeds cap ${limits.maxTotalBytes}`, name);
      }
    }
    if (localOffset + 30 > data.length) return zerr('TRUNCATED', 'local header offset out of range', name);
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset, isDir });
  }

  const names = entries.filter((e) => !e.isDir).map((e) => e.name);
  const dup = findDuplicatePath(names);
  if (dup !== null) return zerr('DUPLICATE_NAME', 'duplicate (case-insensitive) member name', dup);

  const out = new Map<string, Uint8Array>();
  let totalActual = 0;
  for (const e of entries) {
    if (e.isDir) continue;
    const lh = e.localOffset;
    if (dv.getUint32(lh, true) !== LOCAL_SIG) {
      return zerr('TRUNCATED', 'bad local-header signature', e.name);
    }
    const lNameLen = dv.getUint16(lh + 26, true);
    const lExtraLen = dv.getUint16(lh + 28, true);
    const dataStart = lh + 30 + lNameLen + lExtraLen;
    if (dataStart + e.compressedSize > data.length) {
      return zerr('TRUNCATED', 'compressed data extends past end of input', e.name);
    }
    const compressed = data.subarray(dataStart, dataStart + e.compressedSize);
    let content: Uint8Array;
    if (e.method === 0) {
      if (e.compressedSize !== e.uncompressedSize) {
        return zerr('SIZE_MISMATCH', 'stored entry size fields disagree', e.name);
      }
      content = new Uint8Array(compressed);
    } else {
      const inflated = inflateCapped(compressed, e.uncompressedSize);
      if (!inflated.ok) return zerr('INFLATE_FAILED', inflated.error, e.name);
      content = inflated.value;
    }
    totalActual += content.length;
    if (totalActual > limits.maxTotalBytes) {
      return zerr('SIZE_CAP_EXCEEDED', `decompressed total exceeds cap ${limits.maxTotalBytes}`, e.name);
    }
    out.set(e.name, content);
  }
  return { ok: true, value: out };
}

/** Deterministic zip: entries sorted by path, fixed mtime (1980-06-01 UTC —
 *  inside the DOS 1980..2099 window for every timezone fflate may convert). */
export function writeZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const sorted = [...files.keys()].sort();
  const mtime = new Date(Date.UTC(1980, 5, 1, 12, 0, 0));
  const zippable: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const name of sorted) {
    zippable[name] = [files.get(name)!, { mtime }];
  }
  return new Uint8Array(zipSync(zippable, { level: 6 }));
}
