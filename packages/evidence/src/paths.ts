import { isSafeRelativePath, MAX_BUNDLE_PATH_CHARS } from '@tessera/types';

/**
 * Archive-member path safety, layered on top of the schema rule
 * (`isSafeRelativePath`: no absolute paths, drive letters, UNC, backslashes,
 * NUL, or `.`/`..`/empty segments).
 *
 * `isExtractionSafePath` additionally rejects what a naive extractor on a
 * real filesystem could still mishandle: Windows reserved device names
 * (CON, PRN, AUX, NUL, COM1-9, LPT1-9), trailing dots/spaces in segments,
 * and leading whitespace. Writers MUST satisfy the stricter rule; readers
 * treat violations as hard failures.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function segmentUnsafeExtra(seg: string): string | null {
  if (seg.length === 0) return 'empty path segment';
  if (seg !== seg.trim()) return 'segment has leading/trailing whitespace';
  if (seg.endsWith('.')) return 'segment ends with a dot (stripped on Windows)';
  const stem = seg.split('.')[0]!;
  if (WINDOWS_RESERVED.test(stem)) return `reserved device name '${stem}'`;
  return null;
}

/** Strictest form: schema-safe AND extraction-safe on Windows/POSIX. */
export function isExtractionSafePath(p: string): boolean {
  if (!isSafeRelativePath(p)) return false;
  return p.split('/').every((seg) => segmentUnsafeExtra(seg) === null);
}

/** Human-readable reason a path is unsafe, or null when safe. */
export function unsafePathReason(p: string): string | null {
  if (p.length === 0) return 'empty path';
  if (p.length > MAX_BUNDLE_PATH_CHARS) return `path exceeds ${MAX_BUNDLE_PATH_CHARS} chars`;
  if ([...p].some((ch) => ch.charCodeAt(0) === 0)) return 'NUL byte in path';
  if (p.startsWith('/')) return 'absolute path';
  if (p.startsWith('\\\\')) return 'UNC path';
  if (/^[A-Za-z]:/.test(p)) return 'drive-letter path';
  if (p.includes('\\')) return 'backslash separator (non-portable, zip-slip vector)';
  const segs = p.split('/');
  for (const seg of segs) {
    if (seg === '..') return "'..' traversal segment";
    if (seg === '.') return "'.' segment";
    if (seg === '') return 'empty segment (duplicate/leading/trailing slash)';
    const extra = segmentUnsafeExtra(seg);
    if (extra !== null) return extra;
  }
  return null;
}

/**
 * Case-folded duplicate detection. Schema requires exact-path uniqueness;
 * extraction on case-insensitive filesystems (Windows, default macOS) would
 * collide on paths differing only by case, so writers and readers reject
 * case-fold duplicates too.
 */
export function findDuplicatePath(paths: Iterable<string>): string | null {
  const seen = new Set<string>();
  for (const p of paths) {
    const folded = p.toLowerCase();
    if (seen.has(folded)) return p;
    seen.add(folded);
  }
  return null;
}
