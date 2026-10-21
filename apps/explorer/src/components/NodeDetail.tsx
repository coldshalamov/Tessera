import { abbreviate, formatClaimBps, formatUnits, formatUnixTime } from '../lib/format.js';
import { Copyable } from './Copyable.js';
import type { SelectedView } from '../lib/model.js';

/**
 * The selected version's facts — self-chosen name next to the contributor
 * key, exact unit fields, digests and custody. Names render as text only
 * (React escapes; no HTML injection path exists).
 */
export function NodeDetail(props: {
  view: SelectedView;
  onSelect: (address: string) => void;
}): React.JSX.Element {
  const { node } = props.view;
  const addr = node.node_ref.node_address;

  const digest = (label: string, value: string | null): React.JSX.Element => (
    <div className="fact" key={label}>
      <dt>{label}</dt>
      <dd className="mono">
        {value === null ? (
          <span className="muted">not present</span>
        ) : (
          <Copyable value={value} display={abbreviate(value, 12, 8)} />
        )}
      </dd>
    </div>
  );

  return (
    <section aria-labelledby="detail-heading" className="panel">
      <h2 id="detail-heading">Selected version</h2>
      {props.view.walkProblem !== null && (
        <p className="note warn-text" role="status">{props.view.walkProblem}</p>
      )}
      <dl className="facts">
        <div className="fact">
          <dt>title</dt>
          <dd>{node.title === '' ? '(untitled)' : node.title}</dd>
        </div>
        <div className="fact">
          <dt>contributor (self-chosen name)</dt>
          <dd>{node.name} <span className="muted">— a label the signer picked, not a verified identity</span></dd>
        </div>
        <div className="fact">
          <dt>contributor key</dt>
          <dd className="mono"><Copyable value={node.contributor} display={abbreviate(node.contributor, 12, 8)} /></dd>
        </div>
        <div className="fact">
          <dt>node address</dt>
          <dd className="mono"><Copyable value={addr} display={abbreviate(addr, 12, 8)} /></dd>
        </div>
        <div className="fact">
          <dt>economic parent</dt>
          <dd className="mono">
            {node.economic_parent === null ? (
              'none — project root'
            ) : (
              <button
                type="button"
                className="linklike mono"
                onClick={() => props.onSelect(node.economic_parent!.node_address)}
              >
                {abbreviate(node.economic_parent.node_address, 12, 8)}
              </button>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>claim against incoming residual</dt>
          <dd>{formatClaimBps(node.claim_bps)}</dd>
        </div>
        <div className="fact">
          <dt>residual in → out (units)</dt>
          <dd className="mono">{formatUnits(node.residual_in_units)} → {formatUnits(node.residual_out_units)}</dd>
        </div>
        <div className="fact">
          <dt>effective capacity (units)</dt>
          <dd className="mono">{formatUnits(node.effective_units)}</dd>
        </div>
        <div className="fact">
          <dt>issued total at this version</dt>
          <dd className="mono">{formatUnits(node.issued_total_units)}</dd>
        </div>
        <div className="fact">
          <dt>as-is payout (exact ratio)</dt>
          <dd className="mono">{node.own_payout_numerator_units}/{node.own_payout_denominator_units}</dd>
        </div>
        <div className="fact">
          <dt>depth</dt><dd>{node.depth}</dd>
        </div>
        <div className="fact">
          <dt>custody mode (declared)</dt>
          <dd>{node.custody_mode.replaceAll('_', ' ')}</dd>
        </div>
        <div className="fact">
          <dt>declared at (signer-claimed time)</dt>
          <dd>{formatUnixTime(node.declared_at)}</dd>
        </div>
        <div className="fact">
          <dt>observed slot / time (recorded claim)</dt>
          <dd className="mono">slot {node.observed_slot} · {formatUnixTime(node.observed_unix_time)}</dd>
        </div>
        {digest('artifact sha256', node.artifact_sha256)}
        {digest('metadata sha256', node.metadata_sha256)}
        {digest('terms sha256', node.terms_sha256)}
        {digest('intent digest', node.intent_digest)}
        <div className="fact">
          <dt>descriptive references</dt>
          <dd>
            {node.references.length === 0 ? 'none' : (
              <ul className="ref-list">
                {node.references.map((r) => (
                  <li key={r} className="mono">
                    <button type="button" className="linklike mono" onClick={() => props.onSelect(r)}>
                      {abbreviate(r, 12, 8)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>economic ancestors</dt>
          <dd>
            {props.view.ancestors.length === 0 ? 'none — this is the root' : (
              <ol className="ancestor-list">
                {props.view.ancestors.map((a) => (
                  <li key={a.node_ref.node_address}>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => props.onSelect(a.node_ref.node_address)}
                    >
                      {a.title === '' ? '(untitled)' : a.title}
                    </button>
                    <span className="muted mono"> · {a.name} · {abbreviate(a.node_ref.node_address)}</span>
                  </li>
                ))}
              </ol>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
