import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stableStringify } from '@tessera/evidence';
import { makeDemo } from './helpers.js';

/**
 * RESTORE EXERCISE (packet acceptance): reconstruct project state + the
 * leaf's frozen payout table from ONLY an exported bundle, in a fresh
 * process in a temp dir whose sole Tessera import is the BUILT
 * @tessera/evidence dist — no repo source, no port, no index ("application
 * disabled"). Equality is asserted against the port's own pre-shutdown
 * payout table and the acceptance-scenario numbers.
 */

const EVIDENCE_DIST = pathToFileURL(
  path.resolve(__dirname, '../../../packages/evidence/dist/index.js'),
).href;

const RECOVER_SCRIPT = `
import { readFileSync } from 'node:fs';
import { readBundleZip, recoverBundle, verifyBundle } from ${JSON.stringify(EVIDENCE_DIST)};
const zip = new Uint8Array(readFileSync(process.argv[2]));
const contents = readBundleZip(zip);
if (!contents.ok) { console.error(contents.error.message); process.exit(5); }
const report = await verifyBundle(contents.value);
const recovered = recoverBundle(contents.value);
if ('error' in recovered) { console.error(recovered.error); process.exit(4); }
process.stdout.write(JSON.stringify({
  status: report.status,
  leaf: recovered.leaf.node_ref.node_address,
  chain: recovered.chain.map((n) => n.node_ref.node_address),
  project_title: recovered.project?.title ?? null,
  root_node: recovered.project?.root_node ?? null,
  payout_table: recovered.payout_table,
  economics_ok: recovered.economics.ok,
}) + '\\n');
`;

describe('restore exercise — bundle-only reconstruction', () => {
  it('reconstructs project + payout table from the exported bundle alone', async () => {
    const { demo, zip } = await makeDemo();

    // "Application/index disabled": a fresh node process in a temp dir, its
    // only Tessera import the built package; input is the zip bytes only.
    const dir = mkdtempSync(path.join(tmpdir(), 't05-restore-'));
    writeFileSync(path.join(dir, 'bundle.zip'), zip);
    writeFileSync(path.join(dir, 'recover.mjs'), RECOVER_SCRIPT);
    const out = execFileSync(process.execPath, [path.join(dir, 'recover.mjs'), path.join(dir, 'bundle.zip')], {
      cwd: dir,
      encoding: 'utf-8',
    });
    const result = JSON.parse(out) as {
      status: string;
      leaf: string;
      chain: string[];
      project_title: string;
      root_node: string;
      payout_table: {
        issued_total_units: string;
        zero_issued: boolean;
        entries: { node_address: string; beneficiary: string; numerator_units: string; denominator_units: string }[];
      };
      economics_ok: boolean;
    };

    expect(result.status).toBe('valid-offline');
    expect(result.economics_ok).toBe(true);
    expect(result.project_title).toBe('The Lantern Room');
    expect(result.chain.length).toBe(4); // root→2000→1000→2500 (sibling branch off-chain)
    expect(result.root_node).toBe(result.chain[0]);

    // Exact equality with the port's pre-shutdown payout table.
    const live = await demo.port.getPayouts(demo.session.selected_leaf!);
    expect(live.ok).toBe(true);
    if (live.ok) {
      expect(stableStringify(result.payout_table.entries)).toBe(stableStringify(live.value.entries));
      expect(result.payout_table.issued_total_units).toBe(live.value.issued_total_units);
    }

    // Acceptance-scenario numbers (shared/ACCEPTANCE_SCENARIO.md).
    expect(result.payout_table.issued_total_units).toBe('541000000000');
    const numerators = result.payout_table.entries.map((e) => e.numerator_units).sort();
    expect(numerators).toEqual(['150000000000', '153000000000', '170000000000', '68000000000']);
    for (const e of result.payout_table.entries) {
      expect(e.denominator_units).toBe('541000000000');
    }
  });

  it('reconstruction reports incomplete ancestry honestly when a record is gone', async () => {
    const { contents } = await makeDemo();
    const files = new Map(contents.files);
    const leaf = contents.manifestV1!.selected_leaf.node_address;
    const leafRec = JSON.parse(new TextDecoder().decode(files.get(`records/${leaf}.json`)!)) as {
      economic_parent: { node_address: string };
    };
    files.delete(`records/${leafRec.economic_parent.node_address}.json`);
    const m = { ...contents.manifestV1!, files: contents.manifestV1!.files.filter((f) => !f.path.includes(leafRec.economic_parent.node_address)) };
    const members = new Map(files);
    const { stableJsonBytes, recoverBundle, contentsFromFileMap } = await import('@tessera/evidence');
    members.set('bundle.json', stableJsonBytes(m));
    const c2 = contentsFromFileMap(members);
    expect(c2.ok).toBe(true);
    if (!c2.ok) return;
    const recovered = recoverBundle(c2.value);
    expect('error' in recovered).toBe(false);
    if ('error' in recovered) return;
    expect(recovered.walk.missingAncestor).toBe(leafRec.economic_parent.node_address);
    expect(recovered.economics.ok).toBe(false); // cannot recompute without root
  });
});
