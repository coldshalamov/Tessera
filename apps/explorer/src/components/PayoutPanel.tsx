import { useState, type FormEvent } from 'react';
import type { NodeRecordV1 } from '@tessera/types';
import { abbreviate, formatClaimBps, formatUnits, ratioPercentDisplay } from '../lib/format.js';
import { settlementPreview, type SelectedView, type SettlementResult } from '../lib/model.js';
import { Copyable } from './Copyable.js';

/**
 * Exact as-is payout table for the SELECTED version + a hypothetical
 * settlement preview at a chosen amount. Numbers are integer ratios
 * recomputed from the bundle records by packages/math — percentages shown
 * beside them are display-only, never the authority.
 *
 * Deliberate wording: this is a calculation of what a distributable receipt
 * WOULD split into. Nothing was paid, escrowed or settled.
 */
export function PayoutPanel(props: {
  view: SelectedView;
  /** Bundle-wide contributors absent from this version's chain. */
  readonly notInChain: readonly { beneficiary: string; names: readonly string[]; node: NodeRecordV1 }[];
}): React.JSX.Element {
  const { payout, chain } = props.view;
  const [amount, setAmount] = useState('100000');
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);

  const nodeByAddr = new Map<string, NodeRecordV1>(chain.map((n) => [n.node_ref.node_address, n]));
  const namesFor = (beneficiary: string): string[] => {
    const out = new Set<string>();
    for (const n of chain) if (n.contributor === beneficiary) out.add(n.name);
    return [...out];
  };

  const sumEffective = payout.entries.reduce((acc, e) => acc + BigInt(e.numerator_units), 0n);
  const issued = BigInt(payout.issued_total_units);

  const onPreview = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = amount.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      setSettlement({ ok: false, code: 'INVALID_AMOUNT', message: 'enter a non-negative integer minor-unit amount (digits only)' });
      return;
    }
    setSettlement(settlementPreview(chain, trimmed));
  };

  return (
    <section aria-labelledby="payout-heading" className="panel">
      <h2 id="payout-heading">As-is payout — selected version</h2>
      <p className="hint">
        If this exact version received a distributable receipt, it would split by these integer ratios.
        The numerator/denominator columns are authoritative; percentages are display-only rounding.
        This is a calculation, not a payment — no money moved.
      </p>
      {payout.zero_issued ? (
        <p className="note warn-text" role="status">
          Issued total is 0 units — this version cannot be monetized, so there is no payout table.
        </p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Payout table" tabIndex={0}>
          <table className="payout-table">
            <caption>
              Exact payout table — denominator is this version's issued total ({formatUnits(payout.issued_total_units)} units)
            </caption>
            <thead>
              <tr>
                <th scope="col">contribution</th>
                <th scope="col">beneficiary key</th>
                <th scope="col">claim</th>
                <th scope="col">effective units</th>
                <th scope="col">exact share</th>
                <th scope="col">share % (display)</th>
              </tr>
            </thead>
            <tbody>
              {payout.entries.map((e) => {
                const rec = nodeByAddr.get(e.node_address);
                const names = namesFor(e.beneficiary);
                return (
                  <tr key={e.node_address}>
                    <th scope="row">
                      {rec === undefined ? abbreviate(e.node_address) : (rec.title === '' ? '(untitled)' : rec.title)}
                      <span className="muted"> · {names.join(', ')}</span>
                    </th>
                    <td className="mono"><Copyable value={e.beneficiary} display={abbreviate(e.beneficiary)} /></td>
                    <td className="num">{rec === undefined ? '—' : formatClaimBps(rec.claim_bps)}</td>
                    <td className="num mono">{formatUnits(e.effective_units)}</td>
                    <td className="num mono">{e.numerator_units}/{e.denominator_units}</td>
                    <td className="num">{ratioPercentDisplay(e.numerator_units, e.denominator_units) ?? 'n/a'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">total issued</th>
                <td colSpan={3} />
                <td className="num mono">{formatUnits(payout.issued_total_units)}</td>
                <td className="num">
                  {sumEffective === issued ? 'Σ shares = issued' : `Σ shares ${sumEffective} ≠ issued ${issued} (INCONSISTENT)`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {props.notInChain.length > 0 && (
        <p className="note">
          Recorded in this project but outside the selected version's ancestor chain — earns nothing
          from this version:{' '}
          {props.notInChain.map((x, i) => (
            <span key={x.node.node_ref.node_address}>
              {i > 0 && ', '}
              <strong>{x.node.title === '' ? '(untitled)' : x.node.title}</strong>
              <span className="muted"> ({x.names.join(', ')})</span>
            </span>
          ))}
          .
        </p>
      )}

      <form className="settlement" onSubmit={onPreview} aria-labelledby="settlement-heading">
        <h3 id="settlement-heading">Settlement preview — hypothetical</h3>
        <p className="hint">
          Split a chosen distributable amount across beneficiaries with the largest-remainder rule
          (grouped by beneficiary before rounding; leftover minor units go to the largest remainders,
          ties by raw key bytes). Conserves every minor unit by construction.
        </p>
        <div className="row">
          <label htmlFor="settle-amount">amount (minor units, integer)</label>
          <input
            id="settle-amount"
            type="text"
            inputMode="numeric"
            // No `pattern` attribute: native constraint validation would block
            // submission silently before our own honest INVALID_AMOUNT message
            // could render (verified: jsdom enforces pattern on submit).
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
          />
          <button type="submit" disabled={payout.zero_issued}>Preview split</button>
        </div>
        {settlement !== null && (
          settlement.ok ? (
            <div className="table-scroll" role="region" aria-label="Settlement preview" tabIndex={0}>
              <table className="payout-table">
                <caption>
                  Allocation of {formatUnits(amount.trim() === '' ? '0' : amount.trim())} minor units
                  at the selected version — preview only
                </caption>
                <thead>
                  <tr>
                    <th scope="col">beneficiary key</th>
                    <th scope="col">names seen</th>
                    <th scope="col">amount (minor units)</th>
                  </tr>
                </thead>
                <tbody>
                  {settlement.rows.map((r) => (
                    <tr key={r.beneficiary}>
                      <td className="mono"><Copyable value={r.beneficiary} display={abbreviate(r.beneficiary)} /></td>
                      <td>{r.names.join(', ')}</td>
                      <td className="num mono">{formatUnits(r.amount_minor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">conservation</th>
                    <td />
                    <td className="num mono">
                      Σ {formatUnits(settlement.total)}{' '}
                      {settlement.total === amount.trim() ? '= input (conserved)' : `≠ input ${amount.trim()} (INCONSISTENT)`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="note warn-text" role="status">Cannot preview: {settlement.code} — {settlement.message}</p>
          )
        )}
      </form>
    </section>
  );
}
