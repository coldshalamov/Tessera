import { useRef, useState, type DragEvent, type FormEvent } from 'react';

/**
 * Data-source controls: evidence-bundle file (drop or picker), the bundled
 * local demo, and a node-address inspector scoped to the loaded data.
 *
 * There is deliberately no RPC/network input in T06: a bare node address is
 * only resolvable against bytes the user supplied, and the label says so.
 */
export interface SourcePanelProps {
  readonly loaded: boolean;
  readonly busy: string | null;
  readonly onOpenDemo: () => void;
  readonly onOpenFile: (file: File) => void;
  readonly onInspectNode: (address: string) => boolean;
}

export function SourcePanel(props: SourcePanelProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false);
  const [nodeQuery, setNodeQuery] = useState('');
  const [nodeNote, setNodeNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file !== undefined) props.onOpenFile(file);
  };

  const onInspect = (e: FormEvent): void => {
    e.preventDefault();
    const q = nodeQuery.trim();
    if (q.length === 0) return;
    const found = props.onInspectNode(q);
    setNodeNote(
      found
        ? null
        : props.loaded
          ? 'Not present in the loaded data. Node lookup needs a network source (not built in T06) or a bundle containing that node.'
          : 'Nothing is loaded. Load the demo or drop an evidence bundle first — there is no network source configured.',
    );
  };

  return (
    <section aria-labelledby="source-heading" className="panel">
      <h2 id="source-heading">Source</h2>
      <div
        className={dragOver ? 'dropzone drag-over' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p>Drop a Tessera evidence bundle here (<code>.zip</code> or a lone <code>bundle.json</code>)</p>
        <div className="row">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={props.busy !== null}>
            Choose file…
          </button>
          <button
            type="button"
            className="demo-button"
            onClick={props.onOpenDemo}
            disabled={props.busy !== null}
          >
            Load the music-stems demo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            className="visually-hidden"
            aria-label="Choose an evidence bundle file"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f !== undefined) props.onOpenFile(f);
              e.currentTarget.value = '';
            }}
          />
        </div>
        <p className="hint">
          The demo builds a five-contributor stem session in this tab (local simulated mode), exports a
          real evidence bundle, and loads it through the same path as a dropped file.
        </p>
      </div>
      <form onSubmit={onInspect} className="node-lookup" role="search">
        <label htmlFor="node-address">Inspect node by address</label>
        <div className="row">
          <input
            id="node-address"
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="node address within the loaded bundle"
            value={nodeQuery}
            onChange={(e) => setNodeQuery(e.currentTarget.value)}
            disabled={props.busy !== null}
          />
          <button type="submit" disabled={props.busy !== null}>Inspect</button>
        </div>
        {nodeNote !== null && <p className="note warn-text" role="status">{nodeNote}</p>}
      </form>
    </section>
  );
}
