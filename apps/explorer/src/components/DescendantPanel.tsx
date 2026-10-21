import { useState } from 'react';
import type { SelectedView } from '../lib/model.js';
import { previewDescendant } from '../lib/descendant.js';
import { formatUnits, ratioPercentDisplay } from '../lib/format.js';

export function DescendantPanel(props: {
  view: SelectedView;
  verified: boolean;
}): React.JSX.Element {
  const [claim, setClaim] = useState('2000');
  const preview = previewDescendant(props.view, claim);
  const step = preview.ok ? preview.step : null;
  const usable = props.verified && props.view.walkProblem === null;

  return (
    <section className="panel descendant-panel" aria-labelledby="descendant-heading">
      <div className="preview-heading">
        <div>
          <h2 id="descendant-heading">What if someone contributes next?</h2>
          <p className="hint">Hypothetical descendant of <strong>{props.view.node.title || '(untitled)'}</strong>.</p>
        </div>
        <span className="preview-label">PREVIEW ONLY</span>
      </div>
      <p className="hint">
        Adjust a new contribution’s claim against the remaining capacity. Earlier effective units stay
        fixed; payout ratios change only for the hypothetical new version. No record is signed or saved.
      </p>
      {!usable ? (
        <p className="note warn-text" role="status">
          Preview unavailable: a bundle with valid offline checks and complete ancestry is required.
        </p>
      ) : (
        <>
          <div className="claim-control">
            <label htmlFor="descendant-claim">New claim (basis points)</label>
            <input id="descendant-claim" type="text" inputMode="numeric" value={claim}
              aria-invalid={!preview.ok} aria-describedby="claim-help"
              onChange={(event) => setClaim(event.currentTarget.value)} />
            <input type="range" min="0" max="10000" step="1"
              aria-label="Adjust new claim" value={preview.ok ? Number(claim) : 0}
              onChange={(event) => setClaim(event.currentTarget.value)} />
            <p className="hint" id="claim-help">10,000 basis points = 100% of the incoming residual, not 100% of the payout.</p>
          </div>
          {!preview.ok ? <p className="note warn-text" role="status">{preview.code} — {preview.message}</p> : step !== null && (
            <div aria-live="polite" aria-atomic="true">
              <dl className="preview-metrics">
                <div><dt>Incoming residual</dt><dd>{formatUnits(step.residual_in_units)} units</dd></div>
                <div><dt>New effective capacity</dt><dd>{formatUnits(step.effective_units)} units</dd></div>
                <div><dt>Remaining for collaborators</dt><dd>{formatUnits(step.residual_out_units)} units</dd></div>
                <div><dt>Hypothetical issued total</dt><dd>{formatUnits(step.issued_total_units)} units</dd></div>
              </dl>
              {step.issued_total_units === '0' ? (
                <p className="note">No issued units: this hypothetical version has no monetizable payout.</p>
              ) : (
                <div className="table-scroll" role="region" aria-label="Hypothetical payout comparison" tabIndex={0}>
                  <table>
                    <caption>Current version → hypothetical descendant. Percentages are display rounding; ratios are exact.</caption>
                    <thead><tr><th scope="col">Contribution</th><th scope="col">Current share</th><th scope="col">Hypothetical share</th></tr></thead>
                    <tbody>
                      {props.view.chain.map((node) => (
                        <tr key={node.node_ref.node_address}>
                          <th scope="row">{node.title || '(untitled)'}</th>
                          <td className="mono">{node.effective_units}/{props.view.payout.issued_total_units}<br />
                            <span className="muted">{ratioPercentDisplay(node.effective_units, props.view.payout.issued_total_units) ?? 'No payout'}</span></td>
                          <td className="mono">{node.effective_units}/{step.issued_total_units}<br />
                            <span className="muted">{ratioPercentDisplay(node.effective_units, step.issued_total_units)}</span></td>
                        </tr>
                      ))}
                      <tr className="hypothetical-row"><th scope="row">Hypothetical new contribution</th><td>—</td>
                        <td className="mono">{step.effective_units}/{step.issued_total_units}<br />
                          <span className="muted">{ratioPercentDisplay(step.effective_units, step.issued_total_units)}</span></td></tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="hint">Arithmetic preview only. Submission eligibility, consent, signatures and network state are not checked here. The loaded evidence and its download remain unchanged.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
