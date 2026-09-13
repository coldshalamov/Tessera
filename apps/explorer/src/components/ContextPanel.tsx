import { abbreviate } from '../lib/format.js';
import { Copyable } from './Copyable.js';
import type { LoadedBundle } from '../lib/model.js';
export function ContextPanel(props: { loaded: LoadedBundle }): React.JSX.Element {
  const { contents, claimedMode, records } = props.loaded;
  const leaf = contents.manifestV1?.selected_leaf ?? null;
  const project = records.project;

  const rows: { label: string; value: string; mono?: boolean; copy?: string }[] = [
    {
      label: 'network genesis hash',
      value: leaf === null ? 'unknown' : abbreviate(leaf.genesis_hash, 12, 8),
      mono: true,
      ...(leaf !== null ? { copy: leaf.genesis_hash } : {}),
    },
    {
      label: 'program id',
      value: leaf === null ? 'unknown' : abbreviate(leaf.program_id, 12, 8),
      mono: true,
      ...(leaf !== null ? { copy: leaf.program_id } : {}),
    },
    {
      label: 'project address',
      value: leaf === null ? 'unknown' : abbreviate(leaf.project_address, 12, 8),
      mono: true,
      ...(leaf !== null ? { copy: leaf.project_address } : {}),
    },
    {
      label: 'project title',
      value: project?.title ?? '(no project record in bundle)',
    },
    {
      label: 'economic rule',
      value: project?.economic_rule ?? 'residual-v1 (record-declared)',
    },
    {
      label: 'extension policy',
      value: project?.extension_policy ?? 'unknown',
    },
    {
      label: 'mode label claimed by this data',
      value: `${claimedMode} — a recorded label, not a chain-finality claim`,
    },
    {
      label: 'exporter',
      value: contents.lenient?.exporter ?? 'unknown',
    },
    {
      label: 'records in bundle',
      value: `${records.nodes.size} node record(s)${project !== null ? ' + project record' : ''}`,
    },
  ];
  if (leaf !== null) {
    rows.push({
      label: 'bundle selected leaf',
      value: abbreviate(leaf.node_address, 12, 8),
      mono: true,
      copy: leaf.node_address,
    });
  }

  return (
    <section aria-labelledby="context-heading" className="panel">
      <h2 id="context-heading">Chain context</h2>
      <dl className="facts">
        {rows.map((r) => (
          <div className="fact" key={r.label}>
            <dt>{r.label}</dt>
            <dd className={r.mono === true ? 'mono' : undefined}>
              {r.copy !== undefined ? <Copyable value={r.copy} display={r.value} /> : r.value}
            </dd>
          </div>
        ))}
      </dl>
      {contents.manifestV1 !== null && contents.manifestV1.limitations.length > 0 && (
        <details className="limitations-block">
          <summary>Bundle-declared limitations ({contents.manifestV1.limitations.length})</summary>
          <ul>
            {contents.manifestV1.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
