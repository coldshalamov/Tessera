import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { allocateMinorUnits, base58AddressToBytes } from '@tessera/math';
import { MANIFEST_PATH, readZip, reconstructChain, utf8String, writeZip } from '@tessera/evidence';
import App from '../../../apps/explorer/src/App.js';
import { buildStemsDemo, type StemsDemo } from '../../../apps/explorer/src/demo/stems.js';
import { loadBundleZipBytes } from '../../../apps/explorer/src/lib/model.js';
import { ratioPercentDisplay } from '../../../apps/explorer/src/lib/format.js';

/**
 * Component-level tests for the explorer (packet T06). These exercise real
 * behavior — the demo session is built through the actual local port and
 * bundle writer, loaded through the actual bundle reader, and verified by
 * the actual verifier. No part of the integration under test is mocked.
 */

let demo: StemsDemo;

const LOAD_TIMEOUT = { timeout: 30_000 };

async function renderLoadedDemo(): Promise<void> {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /load the music-stems demo/i }));
  // The demo leaf (Mix v2) becomes the selected version once loading finishes.
  // The build does real Ed25519/SHA-256 work — allow generous time.
  await screen.findByRole('treeitem', { name: /Mix v2/ }, LOAD_TIMEOUT);
  await screen.findByText(/VALID — OFFLINE CHECKS ONLY/i, undefined, LOAD_TIMEOUT);
}

/** Exact-ratio cell text of the row whose contribution title matches. */
function ratioCell(title: RegExp): string {
  const cell = screen.getByRole('rowheader', { name: title });
  const row = cell.closest('tr');
  const ratio = row?.querySelectorAll('td')[3]?.textContent ?? '';
  return ratio;
}

beforeAll(async () => {
  demo = await buildStemsDemo();
});

afterEach(cleanup);

describe('demo load', () => {
  it('builds a five-node stem session with a sibling branch and loads it', async () => {
    await renderLoadedDemo();
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(5);
    // Branch proof: two stems share the composition-seed parent.
    expect(screen.getByRole('treeitem', { name: /Drum stem/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /Bass stem/ })).toBeTruthy();
    // Honest mode labeling.
    expect(screen.getByText(/LOCAL DEMO — simulated records/i)).toBeTruthy();
    // Chain context carries scope.
    expect(screen.getByText('network genesis hash')).toBeTruthy();
    expect(screen.getByText('program id')).toBeTruthy();
    expect(screen.getByText(/stem collaboration \(DEMO\)/)).toBeTruthy();
  });
});

describe('payout table (acceptance: claim vs effective vs as-is)', () => {
  it('shows exact ratios denominating at the selected leaf', async () => {
    await renderLoadedDemo();
    const leaf = demo.leafRef.node_address;
    expect(window.location.hash).toBe(`#node=${leaf}`);
    // Leaf issued total: 200e9 + 240e9 + 84e9 + 47.6e9 = 571.6e9.
    expect(screen.getByText(/571,600,000,000 units/)).toBeTruthy();
    expect(ratioCell(/Composition seed/)).toBe('200000000000/571600000000');
    expect(ratioCell(/Drum stem/)).toBe('240000000000/571600000000');
    expect(ratioCell(/Melody stem/)).toBe('84000000000/571600000000');
    expect(ratioCell(/Mix v2/)).toBe('47600000000/571600000000');
    // The sibling bass stem is recorded but earns nothing from this version:
    // it appears in the tree AND is named in the outside-chain note.
    const note = screen.getByText(/outside the selected version's ancestor chain/);
    expect(note.textContent).toContain('Bass stem — sub line');
    expect(note.textContent).toContain('luz');
    expect(screen.getByRole('treeitem', { name: /Bass stem/ })).toBeTruthy();
  });

  it('re-denominates the whole table when another version is selected', async () => {
    await renderLoadedDemo();
    fireEvent.click(screen.getByRole('treeitem', { name: /Bass stem/ }));
    // Bass version: issued 400e9; only root + bass are in that chain.
    await waitFor(() => {
      expect(screen.getByText(/400,000,000,000 units/)).toBeTruthy();
    });
    expect(ratioCell(/Composition seed/)).toBe('200000000000/400000000000');
    expect(ratioCell(/Bass stem/)).toBe('200000000000/400000000000');
    expect(screen.queryByRole('rowheader', { name: /Drum stem/ })).toBeNull();
    // URL tracks the selected version.
    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#node=[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    });
    expect(window.location.hash).not.toBe(`#node=${demo.leafRef.node_address}`);
  });

  it('selecting the root collapses the table to a single 100% row', async () => {
    await renderLoadedDemo();
    fireEvent.click(screen.getByRole('treeitem', { name: /Composition seed/ }));
    await waitFor(() => {
      expect(screen.getByText(/200,000,000,000 units/)).toBeTruthy();
    });
    const rows = screen.getAllByRole('rowheader');
    const dataRows = rows.filter((r) => r.closest('tbody') !== null);
    expect(dataRows).toHaveLength(1);
    expect(ratioCell(/Composition seed/)).toBe('200000000000/200000000000');
  });
});

describe('settlement preview', () => {
  it('allocates a chosen amount and conserves every minor unit', async () => {
    await renderLoadedDemo();
    const input = screen.getByLabelText(/amount \(minor units, integer\)/i);
    fireEvent.change(input, { target: { value: '1000000' } });
    fireEvent.click(screen.getByRole('button', { name: /preview split/i }));
    await screen.findByText(/Σ 1,000,000 = input \(conserved\)/);

    // Cross-check the DOM rows against the library allocation itself.
    const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const walked = reconstructChain(loaded.value.records.nodes, demo.leafRef.node_address);
    const expected = allocateMinorUnits(
      1_000_000n,
      walked.chain.map((n) => [n.contributor, BigInt(n.effective_units)] as const),
      base58AddressToBytes,
    );
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const region = screen.getByRole('region', { name: /settlement preview/i });
    let shown = 0n;
    for (const [beneficiary, amount] of expected.value) {
      const cell = region.querySelector(`button[title^="${beneficiary}"]`);
      expect(cell, `row for ${beneficiary}`).not.toBeNull();
      const row = cell!.closest('tr')!;
      const amtText = row.querySelectorAll('td')[2]!.textContent!.replace(/[^0-9]/g, '');
      expect(BigInt(amtText)).toBe(amount);
      shown += amount;
    }
    expect(shown).toBe(1_000_000n);
  });

  it('rejects malformed amounts honestly', async () => {
    await renderLoadedDemo();
    const input = screen.getByLabelText(/amount \(minor units, integer\)/i);
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: /preview split/i }));
    await screen.findByText(/Cannot preview: INVALID_AMOUNT/);
  });
});

describe('verification panel', () => {
  it('renders per-check statuses with honest non-claims', async () => {
    await renderLoadedDemo();
    expect(screen.getByText(/VALID — OFFLINE CHECKS ONLY/)).toBeTruthy();
    expect(screen.getByText(/does NOT prove live chain anchoring or legal ownership/i)).toBeTruthy();
    // Chain finality is an explicit warn, never a green claim.
    const finality = screen.getByText('chain.finality').closest('li')!;
    expect(finality.textContent).toContain('WARN');
    expect(finality.textContent).toMatch(/cannot establish|no chain query|not attempted/i);
    // Identity caveat likewise.
    const identity = screen.getByText('identity.rights').closest('li')!;
    expect(identity.textContent).toContain('WARN');
    // Banned phrases must never appear anywhere in the app.
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/copyright verified/i);
    expect(body).not.toMatch(/court-proof/i);
    expect(body).not.toMatch(/permanent forever/i);
    expect(body).not.toMatch(/\bpaid\b/i);
    expect(body).not.toMatch(/finalized on/i);
  });
});

describe('keyboard + node-id paths', () => {
  it('exposes every node to keyboard navigation and selects with Enter', async () => {
    await renderLoadedDemo();
    const first = screen.getAllByRole('treeitem')[0]!;
    (first as HTMLElement).focus();
    expect(document.activeElement).toBe(first);
    // Keydown is dispatched on the focused treeitem, as a real browser does.
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = screen.getAllByRole('treeitem')[1]!;
    await waitFor(() => expect(document.activeElement).toBe(second));
    fireEvent.keyDown(second, { key: 'Enter' });
    await waitFor(() => {
      expect(second.getAttribute('aria-selected')).toBe('true');
    });
    expect(window.location.hash).toBe(`#node=${second.getAttribute('data-addr')!}`);
  });

  it('selects a node by pasted address and reports misses honestly', async () => {
    await renderLoadedDemo();
    const field = screen.getByLabelText(/inspect node by address/i);
    // Find the bass address from the loaded tree.
    const bassItem = screen.getByRole('treeitem', { name: /Bass stem/ });
    const bassAddr = bassItem.getAttribute('data-addr')!;
    fireEvent.change(field, { target: { value: bassAddr } });
    fireEvent.click(screen.getByRole('button', { name: /^inspect$/i }));
    await waitFor(() => expect(bassItem.getAttribute('aria-selected')).toBe('true'));

    fireEvent.change(field, { target: { value: 'SomeUnknownNodeAddress1111111111111111' } });
    fireEvent.click(screen.getByRole('button', { name: /^inspect$/i }));
    await screen.findByText(/Not present in the loaded data/);
  });
});

describe('file input and honest failure states', () => {
  it('loads a dropped .zip bundle file', async () => {
    render(<App />);
    const file = new File([demo.zipBytes as unknown as BlobPart], 'stems.zip', { type: 'application/zip' });
    const input = screen.getByLabelText(/choose an evidence bundle file/i);
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole('treeitem', { name: /Mix v2/ }, LOAD_TIMEOUT);
    expect(screen.getByText(/OFFLINE BUNDLE — local records/)).toBeTruthy();
  });

  it('loads a lone bundle.json as an honest MANIFEST-ONLY incomplete view', async () => {
    render(<App />);
    const members = readZip(demo.zipBytes);
    expect(members.ok).toBe(true);
    if (!members.ok) return;
    const manifest = members.value.get(MANIFEST_PATH)!;
    const file = new File([manifest as unknown as BlobPart], 'bundle.json', { type: 'application/json' });
    const input = screen.getByLabelText(/choose an evidence bundle file/i);
    fireEvent.change(input, { target: { files: [file] } });
    // Mode badge and status both say the truth: manifest alone is incomplete.
    await screen.findByText(/MANIFEST ONLY — payload bytes absent/, undefined, LOAD_TIMEOUT);
    await screen.findByText(/INCOMPLETE — evidence missing/i, undefined, LOAD_TIMEOUT);
    // No fake tree: without record payloads there is nothing to inspect.
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    expect(screen.getByText(/No parseable node records/i)).toBeTruthy();
  });

  it('rejects a non-bundle file without pretending otherwise', async () => {
    render(<App />);
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'notes.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/choose an evidence bundle file/i);
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(/cannot read notes\.txt/i);
  });

  it('surfaces tampered payloads as INVALID, not as valid', async () => {
    // Tamper with one record's bytes inside the real zip.
    const members = readZip(demo.zipBytes);
    expect(members.ok).toBe(true);
    if (!members.ok) return;
    // Find the record carrying claim_bps 1000 (the Mix v2 leaf) and tamper it.
    const recordPath = [...members.value.keys()].find(
      (p) => p.startsWith('records/') && p.endsWith('.json')
        && utf8String(members.value.get(p)!)?.includes('"claim_bps":1000'),
    )!;
    expect(recordPath).toBeTruthy();
    const original = utf8String(members.value.get(recordPath)!)!;
    const tampered = original.replace('"claim_bps":1000', '"claim_bps":9999');
    expect(tampered).not.toBe(original);
    members.value.set(recordPath, new TextEncoder().encode(tampered));
    const badZip = writeZip(members.value);

    const file = new File([badZip as unknown as BlobPart], 'tampered.zip', { type: 'application/zip' });
    render(<App />);
    const input = screen.getByLabelText(/choose an evidence bundle file/i);
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(/INVALID — contradictory evidence/, undefined, LOAD_TIMEOUT);
    const integrity = screen.getByText('payload.integrity').closest('li')!;
    expect(integrity.textContent).toContain('FAIL');
  });

  it('reports downloads honestly when object URLs are unsupported', async () => {
    // jsdom has no URL.createObjectURL: the app must say the download cannot
    // happen here rather than silently swallowing the click.
    await renderLoadedDemo();
    expect(typeof URL.createObjectURL === 'function' ? 'has' : 'lacks').toBe('lacks');
    fireEvent.click(screen.getByRole('button', { name: /download verification report/i }));
    await screen.findByText(/Download unavailable in this environment/i);
  });
});

describe('format helpers', () => {
  it('computes display percentages exactly (bigint floor, 4 decimals)', () => {
    expect(ratioPercentDisplay('200000000000', '571600000000')).toBe('34.9895%');
    expect(ratioPercentDisplay('200000000000', '400000000000')).toBe('50.0000%');
    expect(ratioPercentDisplay('1', '0')).toBeNull();
  });
});
