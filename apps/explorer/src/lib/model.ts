import {
  allocateMinorUnits,
  base58AddressToBytes,
  type ExactPayoutTable,
  type NodeRecordV1,
  type PortMode,
} from '@tessera/math';
import {
  contentsFromFileMap,
  MANIFEST_PATH,
  PAYOUT_TABLE_PATH,
  parseBundleRecords,
  parseJsonBytes,
  payoutTableForLeaf,
  readBundleZip,
  reconstructChain,
  verifyBundle,
  type BundleContents,
  type EvidenceVerificationReport,
  type RecoveredRecords,
} from '@tessera/evidence';

/**
 * Explorer view-model. Everything here derives from bundle bytes through the
 * shared readers/verifier — the explorer never reimplements economics and
 * never invents state the bytes do not carry.
 */

export type BundleOrigin = 'demo' | 'file' | 'manifest';

export interface LoadedBundle {
  /** Display name of the source (file name or demo label). */
  readonly name: string;
  readonly origin: BundleOrigin;
  /** Original container bytes when a whole zip was loaded (needed for export). */
  readonly zipBytes: Uint8Array | null;
  readonly contents: BundleContents;
  /** All parseable records in the bundle (any branch). */
  readonly records: RecoveredRecords;
  readonly report: EvidenceVerificationReport;
  /** Manifest-declared selected leaf address, when the manifest parses as v1. */
  readonly leafAddress: string | null;
  /** Bundle's own claimed mode label (from its frozen payout table), 'local' default. */
  readonly claimedMode: PortMode;
}

export type LoadResult =
  | { readonly ok: true; readonly value: LoadedBundle }
  | { readonly ok: false; readonly error: string };

/** The mode a bundle claims for itself — a recorded label, not a chain claim. */
function claimedModeOf(contents: BundleContents): PortMode {
  const frozen = contents.files.get(PAYOUT_TABLE_PATH);
  if (frozen !== undefined) {
    const parsed = parseJsonBytes(frozen);
    if (parsed.ok) {
      const m = (parsed.value as { mode?: unknown }).mode;
      if (m === 'local' || m === 'devnet' || m === 'mainnet') return m;
    }
  }
  return 'local';
}

async function finishLoad(
  contents: BundleContents,
  name: string,
  origin: BundleOrigin,
  zipBytes: Uint8Array | null,
): Promise<LoadResult> {
  const records = parseBundleRecords(contents.files);
  const report = await verifyBundle(contents);
  return {
    ok: true,
    value: {
      name,
      origin,
      zipBytes,
      contents,
      records,
      report,
      leafAddress: contents.manifestV1?.selected_leaf.node_address ?? null,
      claimedMode: claimedModeOf(contents),
    },
  };
}

/** Load a .zip evidence bundle produced by the T05 writer. */
export async function loadBundleZipBytes(
  zipBytes: Uint8Array,
  name: string,
  origin: BundleOrigin,
): Promise<LoadResult> {
  const contents = readBundleZip(zipBytes);
  if (!contents.ok) {
    return {
      ok: false,
      error: `cannot read ${name} as a Tessera evidence bundle: ${contents.error.code}: ${contents.error.message}`,
    };
  }
  return finishLoad(contents.value, name, origin, zipBytes);
}

/** Load a lone bundle.json (manifest without payloads) — honest incomplete view. */
export async function loadManifestJsonBytes(
  manifestBytes: Uint8Array,
  name: string,
): Promise<LoadResult> {
  const members = new Map<string, Uint8Array>([[MANIFEST_PATH, manifestBytes]]);
  const contents = contentsFromFileMap(members);
  if (!contents.ok) {
    return {
      ok: false,
      error: `cannot read ${name}: ${contents.error.code}: ${contents.error.message}`,
    };
  }
  return finishLoad(contents.value, name, 'manifest', null);
}

// ---------------------------------------------------------------------------
// Tree model — the whole project, keyboard-navigable without a canvas
// ---------------------------------------------------------------------------

export interface NodeTree {
  /** Nodes whose economic_parent is absent or outside this bundle. */
  readonly roots: readonly NodeRecordV1[];
  /** parent node_address → children, stable display order. */
  readonly children: ReadonlyMap<string, readonly NodeRecordV1[]>;
  /** node_address → depth for rendering (falls back to record.depth). */
  readonly total: number;
}

function byDisplayOrder(a: NodeRecordV1, b: NodeRecordV1): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.node_ref.node_address.localeCompare(b.node_ref.node_address);
}

/** Build the project forest from every parseable record in the bundle. */
export function buildNodeTree(nodes: ReadonlyMap<string, NodeRecordV1>): NodeTree {
  const children = new Map<string, NodeRecordV1[]>();
  const roots: NodeRecordV1[] = [];
  for (const n of nodes.values()) {
    const parentAddr = n.economic_parent?.node_address ?? null;
    if (parentAddr === null || !nodes.has(parentAddr)) {
      roots.push(n);
    } else {
      const list = children.get(parentAddr) ?? [];
      list.push(n);
      children.set(parentAddr, list);
    }
  }
  roots.sort(byDisplayOrder);
  for (const list of children.values()) list.sort(byDisplayOrder);
  return { roots, children, total: nodes.size };
}

export interface FlatTreeItem {
  readonly node: NodeRecordV1;
  readonly depth: number;
  readonly hasChildren: boolean;
}

/** Depth-first flatten of the tree honoring the expansion set — the exact
 *  order arrow-key navigation follows. */
export function flattenTree(
  tree: NodeTree,
  expanded: ReadonlySet<string>,
): FlatTreeItem[] {
  const out: FlatTreeItem[] = [];
  const visit = (n: NodeRecordV1, depth: number): void => {
    const kids = tree.children.get(n.node_ref.node_address) ?? [];
    out.push({ node: n, depth, hasChildren: kids.length > 0 });
    if (expanded.has(n.node_ref.node_address)) {
      for (const k of kids) visit(k, depth + 1);
    }
  };
  for (const r of tree.roots) visit(r, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Per-version economics — recomputed from records for ANY selected node
// ---------------------------------------------------------------------------

export interface SelectedView {
  readonly node: NodeRecordV1;
  /** root→selected ancestor chain (includes the selected node). */
  readonly chain: readonly NodeRecordV1[];
  readonly payout: ExactPayoutTable;
  /** Ancestor addresses only (selected excluded) — the "inherits from" list. */
  readonly ancestors: readonly NodeRecordV1[];
  readonly walkProblem: string | null;
}

/** Chain + exact payout table for an arbitrary selected node. Selecting a
 *  different version re-walks ancestors and re-denominates the table. */
export function selectVersion(
  nodes: ReadonlyMap<string, NodeRecordV1>,
  address: string,
  mode: PortMode,
): SelectedView | null {
  const node = nodes.get(address);
  if (node === undefined) return null;
  const walk = reconstructChain(nodes, address);
  const payout = payoutTableForLeaf(walk.chain, node, mode);
  let walkProblem: string | null = null;
  if (walk.cycle) walkProblem = 'economic_parent cycle detected — ancestry untrustworthy';
  else if (walk.leafMissing) walkProblem = 'selected node record is absent from the bundle';
  else if (walk.missingAncestor !== null) {
    walkProblem = `ancestor ${walk.missingAncestor} is not in the bundle — partial ancestry`;
  }
  return {
    node,
    chain: walk.chain,
    payout,
    ancestors: walk.chain.slice(0, -1),
    walkProblem,
  };
}

export interface SettlementRow {
  readonly beneficiary: string;
  readonly amount_minor: string;
  /** Display names seen on this beneficiary's nodes. */
  readonly names: readonly string[];
}

export type SettlementResult =
  | { readonly ok: true; readonly rows: readonly SettlementRow[]; readonly total: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Largest-remainder settlement preview at the selected version — the same
 * `allocateMinorUnits` the port uses; beneficiary grouping before rounding.
 *
 * The math layer's `integer()` guard deliberately rejects string operands
 * (parity with the Python reference), so the UI's decimal text is validated
 * here and converted to bigint — both for the amount and the per-node
 * effective-unit weights.
 */
export function settlementPreview(
  chain: readonly NodeRecordV1[],
  amountMinor: string,
): SettlementResult {
  const trimmed = amountMinor.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return {
      ok: false,
      code: 'INVALID_AMOUNT',
      message: 'enter a non-negative integer minor-unit amount (digits only)',
    };
  }
  const contributions = chain.map(
    (n) => [n.contributor, BigInt(n.effective_units)] as const,
  );
  const allocated = allocateMinorUnits(BigInt(trimmed), contributions, base58AddressToBytes);
  if (!allocated.ok) {
    return { ok: false, code: allocated.error.code, message: allocated.error.message };
  }
  const namesByKey = new Map<string, Set<string>>();
  for (const n of chain) {
    const set = namesByKey.get(n.contributor) ?? new Set<string>();
    set.add(n.name);
    namesByKey.set(n.contributor, set);
  }
  const rows: SettlementRow[] = [...allocated.value.entries()]
    .sort((a, b) => compareBytesSafe(a[0], b[0]))
    .map(([beneficiary, amount]) => ({
      beneficiary,
      amount_minor: amount.toString(10),
      names: [...(namesByKey.get(beneficiary) ?? [])],
    }));
  let total = 0n;
  for (const r of rows) total += BigInt(r.amount_minor);
  return { ok: true, rows, total: total.toString(10) };
}

function compareBytesSafe(a: string, b: string): number {
  const ab = base58AddressToBytes(a);
  const bb = base58AddressToBytes(b);
  if (ab === null || bb === null) return a.localeCompare(b);
  const n = Math.min(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ab[i] !== bb[i]) return ab[i]! - bb[i]!;
  }
  return ab.length - bb.length;
}

/** Distinct beneficiary keys across the whole bundle (for context display). */
export function allBeneficiaries(nodes: ReadonlyMap<string, NodeRecordV1>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const n of nodes.values()) {
    const set = out.get(n.contributor) ?? new Set<string>();
    set.add(n.name);
    out.set(n.contributor, set);
  }
  return out;
}
