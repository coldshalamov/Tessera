import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MAX_DEPTH, U } from '@tessera/math';
import { buildStemsDemo } from '../../../apps/explorer/src/demo/stems.js';
import { loadBundleZipBytes, selectVersion, type SelectedView } from '../../../apps/explorer/src/lib/model.js';
import { previewDescendant } from '../../../apps/explorer/src/lib/descendant.js';
import { DescendantPanel } from '../../../apps/explorer/src/components/DescendantPanel.js';

let view: SelectedView;
beforeAll(async () => {
  const demo = await buildStemsDemo();
  const loaded = await loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo');
  if (!loaded.ok) throw new Error(loaded.error);
  view = selectVersion(loaded.value.records.nodes, demo.leafAddress, 'local')!;
});
afterEach(cleanup);

describe('hypothetical descendant', () => {
  it('uses exact residual arithmetic, preserves every existing record, and conserves capacity', () => {
    const before = JSON.stringify(view);
    const result = previewDescendant(view, '2000');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step).toMatchObject({
      residual_in_units: '428400000000', effective_units: '85680000000',
      residual_out_units: '342720000000', issued_total_units: '657280000000',
    });
    expect(view.chain.reduce((sum, node) => sum + BigInt(node.effective_units), 0n)
      + BigInt(result.step.effective_units) + BigInt(result.step.residual_out_units)).toBe(U);
    expect(JSON.stringify(view)).toBe(before);
  });

  it.each(['-1', '1.5', '10001', '1e3', '', 'Infinity'])('rejects invalid claim %s', (claim) => {
    expect(previewDescendant(view, claim)).toMatchObject({ ok: false, code: 'CLAIM_OUT_OF_RANGE' });
  });

  it('handles zero and full claims without float shares', () => {
    expect(previewDescendant(view, '0')).toMatchObject({ ok: true, step: {
      effective_units: '0', issued_total_units: '571600000000',
    } });
    expect(previewDescendant(view, '10000')).toMatchObject({ ok: true, step: {
      effective_units: '428400000000', residual_out_units: '0', issued_total_units: '1000000000000',
    } });
  });

  it('rejects exhausted capacity, zero-rounding, maximum depth and partial ancestry', () => {
    expect(previewDescendant({ ...view, node: { ...view.node, residual_out_units: '0' } }, '1'))
      .toMatchObject({ ok: false, code: 'BRANCH_CAPACITY_EXHAUSTED' });
    expect(previewDescendant({ ...view, node: { ...view.node, residual_out_units: '1' } }, '1'))
      .toMatchObject({ ok: false, code: 'CLAIM_ROUNDS_TO_ZERO' });
    expect(previewDescendant({ ...view, node: { ...view.node, depth: MAX_DEPTH } }, '0'))
      .toMatchObject({ ok: false, code: 'DEPTH_OUT_OF_RANGE' });
    expect(previewDescendant({ ...view, walkProblem: 'missing ancestor' }, '2000'))
      .toMatchObject({ ok: false, code: 'INCOMPLETE_ANCESTRY' });
  });

  it('updates the exact comparison on input and never enables invalid evidence', () => {
    const { rerender } = render(<DescendantPanel view={view} verified />);
    const comparison = screen.getByRole('region', { name: 'Hypothetical payout comparison' });
    expect(within(comparison).getByText('200000000000/657280000000')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New claim (basis points)'), { target: { value: '10000' } });
    expect(within(comparison).getByText('200000000000/1000000000000')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New claim (basis points)'), { target: { value: '10001' } });
    expect(screen.getByRole('status').textContent).toContain('CLAIM_OUT_OF_RANGE');
    expect(screen.queryByRole('region', { name: 'Hypothetical payout comparison' })).toBeNull();
    rerender(<DescendantPanel view={view} verified={false} />);
    expect(screen.queryByLabelText('New claim (basis points)')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Preview unavailable');
  });
});
