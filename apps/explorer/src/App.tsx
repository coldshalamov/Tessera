import { useCallback, useEffect, useMemo, useState } from 'react';
import { stableJsonBytes } from '@tessera/evidence';
import { buildStemsDemo } from './demo/stems.js';
import { saveBlob } from './lib/download.js';
import {
  allBeneficiaries,
  buildNodeTree,
  loadBundleZipBytes,
  loadManifestJsonBytes,
  selectVersion,
  type LoadedBundle,
} from './lib/model.js';
import { abbreviate } from './lib/format.js';
import { SourcePanel } from './components/SourcePanel.js';
import { ContextPanel } from './components/ContextPanel.js';
import { NodeTree } from './components/NodeTree.js';
import { NodeDetail } from './components/NodeDetail.js';
import { PayoutPanel } from './components/PayoutPanel.js';
import { VerifyPanel } from './components/VerifyPanel.js';
import { EconomicGraph } from './components/EconomicGraph.js';
import { DescendantPanel } from './components/DescendantPanel.js';

/**
 * Tessera Explorer — a compact, read-only protocol explorer (docs/08, T06).
 *
 * Scope honesty: this build has NO network adapter. Everything shown derives
 * from bytes the user supplies (evidence bundle file) or generates locally
 * (the demo). Mode badges say so; verification never claims chain finality.
 */
export default function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<LoadedBundle | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('No data loaded.');
  const [loadError, setLoadError] = useState<string | null>(null);

  const select = useCallback((address: string): void => {
    setSelected(address);
    if (typeof window !== 'undefined') {
      window.location.hash = `node=${address}`;
    }
  }, []);

  // Back/forward + pasted-hash navigation.
  useEffect(() => {
    const onHash = (): void => {
      const m = /^#node=(.+)$/.exec(window.location.hash);
      if (m !== null && loaded !== null && loaded.records.nodes.has(m[1]!)) {
        setSelected(m[1]!);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loaded]);

  const finishLoad = useCallback(
    (result: Awaited<ReturnType<typeof loadBundleZipBytes>>, sourceLabel: string): void => {
      if (!result.ok) {
        setLoadError(result.error);
        setNotice(`Could not load ${sourceLabel}.`);
        return;
      }
      const b = result.value;
      setLoaded(b);
      setLoadError(null);
      const leaf = b.leafAddress ?? b.records.nodes.keys().next().value ?? null;
      setSelected(leaf);
      if (leaf !== null) window.location.hash = `node=${leaf}`;
      setNotice(
        `Loaded ${b.name}: ${b.records.nodes.size} node record(s); verification status ${b.report.status}.`,
      );
    },
    [],
  );

  const openDemo = useCallback((): void => {
    setBusy('Building the local demo session and exporting a bundle…');
    void buildStemsDemo()
      .then((demo) => loadBundleZipBytes(demo.zipBytes, demo.fileName, 'demo'))
      .then((r) => finishLoad(r, 'the demo'))
      .catch((e: unknown) => {
        setLoadError(`demo build failed: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => setBusy(null));
  }, [finishLoad]);

  const openFile = useCallback(
    (file: File): void => {
      setBusy(`Reading ${file.name}…`);
      void file
        .arrayBuffer()
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          if (/\.json$/i.test(file.name)) {
            return loadManifestJsonBytes(bytes, file.name);
          }
          return loadBundleZipBytes(bytes, file.name, 'file');
        })
        .then((r) => finishLoad(r, file.name))
        .catch((e: unknown) => {
          setLoadError(`could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => setBusy(null));
    },
    [finishLoad],
  );

  const inspectNode = useCallback(
    (address: string): boolean => {
      if (loaded === null) return false;
      const hit = loaded.records.nodes.get(address);
      if (hit === undefined) return false;
      select(hit.node_ref.node_address);
      return true;
    },
    [loaded, select],
  );

  const tree = useMemo(
    () => (loaded === null ? null : buildNodeTree(loaded.records.nodes)),
    [loaded],
  );
  const view = useMemo(
    () =>
      loaded !== null && selected !== null
        ? selectVersion(loaded.records.nodes, selected, loaded.claimedMode)
        : null,
    [loaded, selected],
  );
  const inPayoutChain = useMemo(
    () => new Set((view?.chain ?? []).map((n) => n.node_ref.node_address)),
    [view],
  );
  const notInChain = useMemo(() => {
    if (loaded === null || view === null) return [];
    const names = allBeneficiaries(loaded.records.nodes);
    return [...loaded.records.nodes.values()]
      .filter((n) => !inPayoutChain.has(n.node_ref.node_address))
      .map((n) => ({
        beneficiary: n.contributor,
        names: [...(names.get(n.contributor) ?? [])],
        node: n,
      }));
  }, [loaded, view, inPayoutChain]);

  const modeBadge =
    loaded === null
      ? 'NO DATA — local demo or offline bundle only'
      : loaded.origin === 'demo'
        ? 'LOCAL DEMO — simulated records · nothing was sent to any network'
        : loaded.origin === 'manifest'
          ? 'MANIFEST ONLY — payload bytes absent · incomplete by definition'
          : `OFFLINE BUNDLE — ${loaded.claimedMode} records · no live network query`;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Tessera Explorer</h1>
          <p className="tagline">
            Read-only protocol explorer — economic lineage, exact payout ratios and evidence checks.
            No wallet, no trading, no ownership certification.
          </p>
        </div>
        <p className="mode-badge" data-origin={loaded?.origin ?? 'none'}>{modeBadge}</p>
      </header>

      <div className="live-region visually-hidden" aria-live="polite">{notice}</div>
      <main>
        <SourcePanel
          loaded={loaded !== null}
          busy={busy}
          onOpenDemo={openDemo}
          onOpenFile={openFile}
          onInspectNode={inspectNode}
        />
        {busy !== null && <p className="note" role="status">{busy}</p>}
        {loadError !== null && (
          <p className="note error-text" role="alert">{loadError}</p>
        )}

        {loaded !== null && (
          <>
            <div className="row export-row">
              <button
                type="button"
                onClick={() => {
                  if (loaded.zipBytes === null) return;
                  const okc = saveBlob(loaded.zipBytes, loaded.name.endsWith('.zip') ? loaded.name : `${loaded.name}.zip`, 'application/zip');
                  if (!okc) setNotice('Download unavailable in this environment (no object-URL support) — the bytes were verified but cannot be saved here.');
                }}
                disabled={loaded.zipBytes === null}
                title={loaded.zipBytes === null ? 'No container bytes to re-download (manifest-only load)' : 'Download the exact bundle bytes that were loaded'}
              >
                Download evidence bundle (.zip)
              </button>
              <button
                type="button"
                onClick={() => {
                  const okc = saveBlob(stableJsonBytes(loaded.report), 'verification-report.json', 'application/json');
                  if (!okc) setNotice('Download unavailable in this environment (no object-URL support) — the report cannot be saved here.');
                }}
              >
                Download verification report (.json)
              </button>
            </div>

            <ContextPanel loaded={loaded} />

            {tree !== null && <EconomicGraph tree={tree} selected={selected} inPayoutChain={inPayoutChain} onSelect={select} />}

            <div className="columns">
              {tree !== null && (
                <NodeTree
                  tree={tree}
                  selected={selected}
                  inPayoutChain={inPayoutChain}
                  leafAddress={loaded.leafAddress}
                  onSelect={select}
                />
              )}
              {view !== null ? (
                <NodeDetail view={view} onSelect={select} />
              ) : (
                <section className="panel" aria-label="Selected version">
                  <h2>Selected version</h2>
                  <p className="note">
                    {loaded.records.nodes.size === 0
                      ? 'No node records are present — nothing to select.'
                      : 'Select a node in the tree to inspect a version.'}
                  </p>
                </section>
              )}
            </div>

            {view !== null && <PayoutPanel view={view} notInChain={notInChain} />}

            {view !== null && <DescendantPanel view={view} verified={loaded.report.status === 'valid-offline'} />}

            <VerifyPanel report={loaded.report} />
          </>
        )}
      </main>
      <footer className="app-footer">
        <p>
          Tessera records signed claims and exact residual economics; it does not prove authorship,
          ownership, or that any payout happened. Selected leaf:{' '}
          <span className="mono">{selected === null ? 'none' : abbreviate(selected, 12, 8)}</span>.
        </p>
      </footer>
    </div>
  );
}
