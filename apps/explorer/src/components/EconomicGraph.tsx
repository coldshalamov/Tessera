import { useMemo } from 'react';
import { flattenTree, type NodeTree } from '../lib/model.js';
import { formatClaimBps } from '../lib/format.js';

/** A bounded visual companion to the complete keyboard tree, using real records. */
export function EconomicGraph(props: {
  tree: NodeTree;
  selected: string | null;
  inPayoutChain: ReadonlySet<string>;
  onSelect: (address: string) => void;
}): React.JSX.Element | null {
  const items = useMemo(
    () => flattenTree(props.tree, new Set(props.tree.children.keys())),
    [props.tree],
  );
  if (items.length === 0) return null;
  // The accessible list remains available for larger imports; avoid an enormous canvas.
  if (items.length > 80) return (
    <p className="note">Visual map limited to 80 nodes. Use Project nodes to inspect this larger bundle.</p>
  );
  const width = Math.max(660, (Math.max(...items.map((item) => item.depth)) + 1) * 244);
  const height = items.length * 86 + 16;
  const positions = new Map(items.map((item, index) => [item.node.node_ref.node_address, {
    x: item.depth * 244 + 12,
    y: index * 86 + 8,
  }]));

  return (
    <section className="panel economic-map" aria-labelledby="map-heading">
      <h2 id="map-heading">Economic lineage map</h2>
      <p className="hint" id="map-help">
        Select a version to follow its payout path. Other branches receive no share from that version.
        Each line connects one economic parent to its child; the complete keyboard tree is below.
      </p>
      <div className="graph-scroll" role="region" aria-label="Economic lineage map" aria-describedby="map-help" tabIndex={0}>
        <div className="graph-surface" style={{ width, height }}>
          <svg width={width} height={height} aria-hidden="true" className="graph-lines">
            {items.map(({ node }) => {
              const parent = node.economic_parent === null ? undefined : positions.get(node.economic_parent.node_address);
              const here = positions.get(node.node_ref.node_address)!;
              if (parent === undefined) return null;
              return <path key={node.node_ref.node_address}
                className={props.inPayoutChain.has(node.node_ref.node_address) ? 'graph-edge active' : 'graph-edge'}
                d={`M ${parent.x + 218} ${parent.y + 32} H ${parent.x + 230} V ${here.y + 32} H ${here.x}`}
              />;
            })}
          </svg>
          {items.map(({ node }) => {
            const address = node.node_ref.node_address;
            const position = positions.get(address)!;
            const active = props.inPayoutChain.has(address);
            return (
              <button key={address} type="button"
                className={`graph-node${active ? ' on-path' : ''}`}
                style={{ left: position.x, top: position.y }}
                aria-pressed={props.selected === address}
                aria-label={`Inspect ${node.title || '(untitled)'} by ${node.name}`}
                onClick={() => props.onSelect(address)}
              >
                <strong>{node.title || '(untitled)'}</strong>
                <span>{node.name} · {formatClaimBps(node.claim_bps)}</span>
                <small>{props.selected === address ? 'Selected version' : active ? 'In payout path' : 'Outside payout path'}</small>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
