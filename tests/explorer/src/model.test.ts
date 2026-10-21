import { describe, expect, it } from 'vitest';
import { allocateMinorUnits, base58AddressToBytes } from '@tessera/math';
import { MANIFEST_PATH, readZip } from '@tessera/evidence';
import { buildStemsDemo } from '../../../apps/explorer/src/demo/stems.js';
import {
  buildNodeTree,
  flattenTree,
  loadBundleZipBytes,
  loadManifestJsonBytes,
  selectVersion,
  settlementPreview,
} from '../../../apps/explorer/src/lib/model.js';

/**
 * View-model tests for the explorer (packet T06): the loaders, tree model,
 * per-version re-denomination and settlement preview — each asserted against
 * the shared packages' own semantics so a broken behavior fails here.
 */

describe('loaders', () => {
  it('loads the demo zip with a valid-offline report and all five records', async () => {
    const demo = await buildStemsDemo();
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.records.nodes.size).toBe(5);
    expect(loaded.value.leafAddress).toBe(demo.leafAddress);
    expect(loaded.value.report.status).toBe('valid-offline');
    // Offline verification never upgrades itself to a chain claim.
    expect(loaded.value.report.mode).toBe('offline');
  });

  it('rejects bytes that are not a bundle', async () => {
    const loaded = await loadBundleZipBytes(new Uint8Array([0, 1, 2, 3]), 'junk.bin', 'file');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error).toMatch(/cannot read junk\.bin/);
  });

  it('a lone manifest yields records-empty + incomplete verification', async () => {
    const demo = await buildStemsDemo();
    const members = readZip(demo.zipBytes);
    expect(members.ok).toBe(true);
    if (!members.ok) return;
    const loaded = await loadManifestJsonBytes(members.value.get(MANIFEST_PATH)!, 'bundle.json');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.origin).toBe('manifest');
    expect(loaded.value.zipBytes).toBeNull();
    expect(loaded.value.records.nodes.size).toBe(0);
    expect(loaded.value.report.status).toBe('incomplete');
    // Manifest still exposes the declared leaf address for context display.
    expect(loaded.value.leafAddress).toBe(demo.leafAddress);
  });
});

describe('tree model', () => {
  it('groups siblings under their parent and flattens in display order', async () => {
    const demo = await buildStemsDemo();
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const tree = buildNodeTree(loaded.value.records.nodes);
    expect(tree.total).toBe(5);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]!.title).toContain('Composition seed');
    // The seed has two children (drums + bass sibling branch).
    const kids = tree.children.get(tree.roots[0]!.node_ref.node_address)!;
    expect(kids).toHaveLength(2);

    // Collapsed: only the root row. Expanded: all five in depth-first order.
    expect(flattenTree(tree, new Set())).toHaveLength(1);
    const flat = flattenTree(tree, new Set(tree.children.keys()));
    expect(flat).toHaveLength(5);
    expect(flat.map((f) => f.depth)).toEqual([0, 1, 2, 3, 1]);
    // Bass is depth 1 — a sibling branch, not a descendant of the drum chain.
    expect(flat[4]!.node.title).toContain('Bass stem');
  });
});

describe('per-version economics', () => {
  it('re-denominates the payout table at whatever node is selected', async () => {
    const demo = await buildStemsDemo();
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const nodes = loaded.value.records.nodes;

    const leaf = selectVersion(nodes, demo.leafAddress, 'local');
    expect(leaf).not.toBeNull();
    expect(leaf!.payout.issued_total_units).toBe('571600000000');
    expect(leaf!.payout.entries).toHaveLength(4);
    expect(leaf!.ancestors).toHaveLength(3);
    expect(leaf!.walkProblem).toBeNull();

    const bass = [...nodes.values()].find((n) => n.title.includes('Bass'))!;
    const bassView = selectVersion(nodes, bass.node_ref.node_address, 'local');
    expect(bassView!.payout.issued_total_units).toBe('400000000000');
    expect(bassView!.payout.entries).toHaveLength(2);
    // Bass's chain carries only itself + the root — the drum branch earns 0.
    for (const e of bassView!.payout.entries) {
      expect(e.denominator_units).toBe('400000000000');
    }
  });

  it('returns null for an address the bundle does not contain', async () => {
    const demo = await buildStemsDemo();
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(selectVersion(loaded.value.records.nodes, 'NoSuchNodeAddress1111111111111111111111', 'local')).toBeNull();
  });
});

describe('settlement preview', () => {
  it('matches allocateMinorUnits exactly and conserves the input', async () => {
    const demo = await buildStemsDemo();
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const view = selectVersion(loaded.value.records.nodes, demo.leafAddress, 'local')!;
    const result = settlementPreview(view.chain, '1000000');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = allocateMinorUnits(
      1_000_000n,
      view.chain.map((n) => [n.contributor, BigInt(n.effective_units)] as const),
      base58AddressToBytes,
    );
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(result.rows).toHaveLength(expected.value.size);
    for (const row of result.rows) {
      expect(row.amount_minor).toBe(expected.value.get(row.beneficiary)!.toString(10));
      expect(row.names.length).toBeGreaterThan(0);
    }
    expect(result.total).toBe('1000000');
  });

  it('rejects non-integer input without calling into the math layer', async () => {
    const demo = await buildStemsDemo();
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const view = selectVersion(loaded.value.records.nodes, demo.leafAddress, 'local')!;
    for (const bad of ['12.5', 'abc', '', '  ', '-5', '1e3']) {
      const r = settlementPreview(view.chain, bad);
      expect(r.ok, `input ${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_AMOUNT');
    }
  });

  it('rejects amounts above the MAX_MONEY bound with a typed error', async () => {
    const demo = await buildStemsDemo();
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const view = selectVersion(loaded.value.records.nodes, demo.leafAddress, 'local')!;
    // i64 max + 1 — passes the digits regex, rejected by the range guard.
    const r = settlementPreview(view.chain, '9223372036854775808');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_AMOUNT');
  });
});
