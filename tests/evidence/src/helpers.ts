import {
  buildBundle,
  buildDemoSession,
  bundleMemberMap,
  bundleToZip,
  contentsFromFileMap,
  sessionToBundleInput,
  stableJsonBytes,
  writeZip,
  type BuiltBundle,
  type BundleContents,
  type DemoSession,
} from '@tessera/evidence';
import { utf8Bytes } from '@tessera/evidence';
import type { EvidenceBundleV1 } from '@tessera/types';

/**
 * Build the deterministic demo session (Lantern Room, local port), convert
 * it to bundle-builder input and produce the bundle. Payload reads resolve
 * from the in-memory session file map — no disk access.
 */
export async function makeDemo(): Promise<{
  demo: DemoSession;
  built: BuiltBundle;
  zip: Uint8Array;
  contents: BundleContents;
}> {
  const demo = await buildDemoSession();
  const input = await sessionToBundleInput(
    demo.session,
    async (rel) => demo.files.get(rel) ?? null,
    'tessera-tests/evidence (local session)',
  );
  if (!input.ok) throw new Error(`sessionToBundleInput: ${input.error.code} ${input.error.message}`);
  const built = await buildBundle(input.value);
  if (!built.ok) throw new Error(`buildBundle: ${built.error.code} ${built.error.message}`);
  const zip = bundleToZip(built.value);
  const contents = contentsFromFileMap(bundleMemberMap(built.value.manifest, built.value.files));
  if (!contents.ok) throw new Error('contentsFromFileMap failed on our own bundle');
  return { demo, built: built.value, zip, contents: contents.value };
}

/** Re-zip a bundle after mutating its file map and/or manifest. */
export function rezip(
  manifest: EvidenceBundleV1 | unknown,
  files: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const members = new Map<string, Uint8Array>(files);
  members.set('bundle.json', stableJsonBytes(manifest));
  return writeZip(members);
}

/** Read a bundle zip back into contents (throws on rejection). */
export async function unzipContents(zip: Uint8Array): Promise<BundleContents> {
  const { readBundleZip } = await import('@tessera/evidence');
  const c = readBundleZip(zip);
  if (!c.ok) throw new Error(`readBundleZip: ${c.error.code} ${c.error.message}`);
  return c.value;
}

/** Clone the contents' file map (manifest stays in manifestV1/raw). */
export function filesOf(contents: BundleContents): Map<string, Uint8Array> {
  return new Map(contents.files);
}

export function utf8(s: string): Uint8Array {
  return utf8Bytes(s);
}
