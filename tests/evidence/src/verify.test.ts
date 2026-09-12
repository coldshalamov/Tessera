import { describe, expect, it } from 'vitest';
import {
  contentsFromFileMap,
  readBundleZip,
  stableJsonBytes,
  verifyBundle,
  type EvidenceCheck,
} from '@tessera/evidence';
import { sha256Hex } from '@tessera/types';
import { makeDemo, rezip, utf8 } from './helpers.js';
import type { EvidenceBundleV1, EvidenceFileEntry } from '@tessera/types';

/**
 * Offline verification: happy path plus every tamper/mutation class from the
 * packet — file bytes, manifest hash entries, paths, signatures, economic
 * fields, missing ancestors, wrong digests, missing terms, unsupported
 * versions. Each must produce its distinct outcome.
 */

function checkByName(report: { checks: EvidenceCheck[] }, name: string): EvidenceCheck {
  const c = report.checks.find((x) => x.name === name);
  if (c === undefined) throw new Error(`check '${name}' missing from report`);
  return c;
}

/** Recompute every manifest entry's sha256/bytes against the current file
 *  map — simulates a manifest regenerated to match tampered payloads, so
 *  deeper checks (not integrity) must catch the lie. */
async function retargetManifest(
  manifest: EvidenceBundleV1,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<EvidenceBundleV1> {
  const entries: EvidenceFileEntry[] = [];
  for (const f of manifest.files) {
    const data = files.get(f.path);
    if (data === undefined) continue; // drop listing for removed members
    const h = await sha256Hex(data);
    entries.push({ ...f, sha256: h.ok ? h.value : f.sha256, bytes: String(data.length) });
  }
  return { ...manifest, files: entries };
}

async function verifyZip(zip: Uint8Array) {
  const c = readBundleZip(zip);
  if (!c.ok) throw new Error(`readBundleZip rejected: ${c.error.code} ${c.error.message}`);
  return verifyBundle(c.value);
}

describe('verifyBundle — happy path', () => {
  it('valid-offline on the complete demo bundle, never a bare verified', async () => {
    const { zip } = await makeDemo();
    const report = await verifyZip(zip);
    expect(report.status).toBe('valid-offline');
    expect(report.counts.fail).toBe(0);
    expect(report.counts.incomplete).toBe(0);
    // The acceptance numbers: leaf chain root→2000→1000→2500 branch.
    const table = checkByName(report, 'payout_table.frozen');
    expect(table.result).toBe('pass');
    expect(table.detail).toContain('541000000000');
    // Honest labels: chain finality and identity are warns, never pass.
    expect(checkByName(report, 'chain.finality').result).toBe('warn');
    expect(checkByName(report, 'identity.rights').result).toBe('warn');
    expect(report.limitations.join('\n')).toContain('NOT establish live Solana finality');
    expect(report.limitations.join('\n')).toContain('LOCAL MODE');
  });

  it('local-port verifyRelease accepts the same manifest without fails (contract interop)', async () => {
    const { demo, built } = await makeDemo();
    const rep = await demo.port.verifyRelease(built.manifest);
    expect(rep.ok).toBe(true);
    if (rep.ok) {
      expect(rep.value.checks.every((c) => c.result !== 'fail')).toBe(true);
      expect(rep.value.status).not.toBe('invalid');
    }
  });
});

describe('verifyBundle — tamper classes', () => {
  it('file byte mutation → payload.integrity fail → invalid', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    const target = [...files.keys()].find((p) => p.startsWith('metadata/'))!;
    const mutated = new Uint8Array(files.get(target)!);
    mutated[0] = mutated[0]! ^ 0xff;
    files.set(target, mutated);
    const report = await verifyZip(rezip(contents.manifestV1, files));
    expect(checkByName(report, 'payload.integrity').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });

  it('manifest hash-entry mutation → payload.integrity fail → invalid', async () => {
    const { contents } = await makeDemo();
    const m = contents.manifestV1!;
    const files = [...m.files];
    files[0] = { ...files[0]!, sha256: '0'.repeat(64) };
    const report = await verifyZip(rezip({ ...m, files }, contents.files));
    expect(checkByName(report, 'payload.integrity').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });

  it('manifest path mutation → inventory fail → invalid', async () => {
    const { contents } = await makeDemo();
    const m = contents.manifestV1!;
    const files = m.files.map((f, i) => (i === 0 ? { ...f, path: 'renamed/evil.json' } : f));
    const report = await verifyZip(rezip({ ...m, files }, contents.files));
    expect(checkByName(report, 'container.inventory').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });

  it('signature byte mutation with retargeted manifest → signatures.intent fail only', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    const sigPath = [...files.keys()].find((p) => p.endsWith('.sig'))!;
    const sig = new Uint8Array(files.get(sigPath)!);
    sig[7] = sig[7]! ^ 0x01;
    files.set(sigPath, sig);
    const m = await retargetManifest(contents.manifestV1!, files);
    const report = await verifyZip(rezip(m, files));
    expect(checkByName(report, 'payload.integrity').result).toBe('pass');
    expect(checkByName(report, 'signatures.intent').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });

  it('economic field mutation with retargeted manifest → economics.recompute fail', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    const leaf = contents.manifestV1!.selected_leaf.node_address;
    const recPath = `records/${leaf}.json`;
    const record = JSON.parse(new TextDecoder().decode(files.get(recPath)!)) as Record<string, unknown>;
    record['claim_bps'] = (record['claim_bps'] as number) + 100; // 2600 instead of 2500
    files.set(recPath, utf8(JSON.stringify(record)));
    const m = await retargetManifest(contents.manifestV1!, files);
    const report = await verifyZip(rezip(m, files));
    expect(checkByName(report, 'payload.integrity').result).toBe('pass');
    expect(checkByName(report, 'economics.recompute').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });

  it('missing ancestor → ancestry incomplete → status incomplete', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    // Remove the middle (sound-design) ancestor record and its manifest entry.
    const leaf = contents.manifestV1!.selected_leaf.node_address;
    const leafRec = JSON.parse(new TextDecoder().decode(files.get(`records/${leaf}.json`)!)) as {
      economic_parent: { node_address: string };
    };
    const parentAddr = leafRec.economic_parent.node_address;
    const grandRec = JSON.parse(
      new TextDecoder().decode(files.get(`records/${parentAddr}.json`)!),
    ) as { economic_parent: { node_address: string } };
    const midAddr = grandRec.economic_parent.node_address;
    files.delete(`records/${midAddr}.json`);
    const m = await retargetManifest(contents.manifestV1!, files);
    const report = await verifyZip(rezip(m, files));
    expect(checkByName(report, 'ancestry.reconstruct').result).toBe('incomplete');
    expect(report.status).toBe('incomplete');
  });

  it('wrong intent_digest in record → intents.digest + signatures fail', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    const leaf = contents.manifestV1!.selected_leaf.node_address;
    const recPath = `records/${leaf}.json`;
    const record = JSON.parse(new TextDecoder().decode(files.get(recPath)!)) as Record<string, unknown>;
    const d = record['intent_digest'] as string;
    record['intent_digest'] = (d[0] === 'a' ? 'b' : 'a') + d.slice(1);
    files.set(recPath, utf8(JSON.stringify(record)));
    const m = await retargetManifest(contents.manifestV1!, files);
    const report = await verifyZip(rezip(m, files));
    expect(checkByName(report, 'intents.digest').result).toBe('fail');
    expect(checkByName(report, 'signatures.intent').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });

  it('terms payload missing → terms.coverage incomplete (not a green badge)', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    const termsPath = [...files.keys()].find((p) => p.startsWith('terms/'))!;
    files.delete(termsPath);
    const m = await retargetManifest(contents.manifestV1!, files);
    const report = await verifyZip(rezip(m, files));
    expect(checkByName(report, 'terms.coverage').result).toBe('incomplete');
    expect(report.status).toBe('incomplete');
  });

  it('unsupported format_version → status unsupported, files still integrity-checked', async () => {
    const { contents } = await makeDemo();
    const m = contents.manifestV1!;
    const report = await verifyZip(rezip({ ...m, format_version: 99 }, contents.files));
    expect(report.status).toBe('unsupported');
    expect(checkByName(report, 'manifest.schema').result).toBe('incomplete');
    expect(checkByName(report, 'payload.integrity').result).toBe('pass');
    expect(checkByName(report, 'economics.recompute').result).toBe('skipped');
  });

  it('manifest claiming v1 with duplicate paths → invalid, not unsupported', async () => {
    const { contents } = await makeDemo();
    const m = contents.manifestV1!;
    const dup = { ...m, files: [...m.files, m.files[0]!] };
    const report = await verifyZip(rezip(dup, contents.files));
    expect(report.status).toBe('invalid');
    expect(checkByName(report, 'manifest.schema').result).toBe('fail');
  });

  it('unlisted archive member → container.inventory fail', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    files.set('smuggled.txt', utf8('unlisted payload'));
    const report = await verifyZip(rezip(contents.manifestV1, files));
    expect(checkByName(report, 'container.inventory').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });

  it('tampered release manifest breaks RELEASE_ANCHOR binding → warn + integrity fail', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    const manifestPath = [...files.keys()].find((p) => p.startsWith('manifests/'))!;
    files.set(manifestPath, utf8('{"release_id":"forged"}'));
    const report = await verifyZip(rezip(contents.manifestV1, files));
    expect(checkByName(report, 'payload.integrity').result).toBe('fail');
    expect(report.status).toBe('invalid');
  });
});

describe('forward compatibility', () => {
  it('unknown-format bundle files remain extractable byte-exact', async () => {
    const { contents } = await makeDemo();
    const m = contents.manifestV1!;
    const weird = { ...m, format_version: 2, future_field: { anything: true } };
    const c = contentsFromFileMap(
      (() => {
        const map = new Map(contents.files);
        map.set('bundle.json', stableJsonBytes(weird));
        return map;
      })(),
    );
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.manifestV1).toBeNull();
    // Every payload file is still present and hash-checkable.
    for (const f of c.value.lenient!.files) {
      const bytes = c.value.files.get(f.path);
      expect(bytes).toBeDefined();
      const h = await sha256Hex(bytes!);
      expect(h.ok && h.value === f.sha256).toBe(true);
    }
    const report = await verifyBundle(c.value);
    expect(report.status).toBe('unsupported');
  });

  it('unresolved cross-branch reference → references.resolve incomplete', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    // The composer references the sibling 5000-bps performer branch — pick
    // the reference that is NOT the leaf's direct economic parent.
    const leaf = contents.manifestV1!.selected_leaf.node_address;
    const leafRec = JSON.parse(new TextDecoder().decode(files.get(`records/${leaf}.json`)!)) as {
      references: string[];
      economic_parent: { node_address: string };
    };
    const sibling = leafRec.references.find((r) => r !== leafRec.economic_parent.node_address)!;
    files.delete(`records/${sibling}.json`);
    const m = await retargetManifest(contents.manifestV1!, files);
    const report = await verifyZip(rezip(m, files));
    expect(checkByName(report, 'references.resolve').result).toBe('incomplete');
    expect(report.status).toBe('incomplete');
  });
});
