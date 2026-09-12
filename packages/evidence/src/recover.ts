import {
  parseNodeRecordV1,
  parseProjectV1,
  type ExactPayoutTable,
  type NodeRecordV1,
  type NodeRef,
  type PayoutEntry,
  type PortMode,
  type ProjectV1,
} from '@tessera/types';
import { append, U } from '@tessera/math';
import { parseJsonBytes } from './json.js';
import type { BundleContents } from './bundle.js';

export const PAYOUT_TABLE_PATH = 'verification/payout-table.json';

/**
 * Independent state reconstruction from bundle bytes alone (docs/06
 * "Recovery path"). No TesseraPort, index or database participates: node
 * records carry `economic_parent`, so the chain is rebuilt by walking
 * parents with visited-set/cycle/depth guards, and economics are recomputed
 * with the shared residual-v1 math.
 */

export const RECORDS_PREFIX = 'records/';
export const PROJECT_PATH = 'project.json';

export interface RecoveredRecords {
  /** node_address → parsed node record. */
  readonly nodes: ReadonlyMap<string, NodeRecordV1>;
  readonly project: ProjectV1 | null;
  /** path → parse failure detail. */
  readonly failures: readonly { path: string; detail: string }[];
  /** record paths that parsed as neither node nor project. */
  readonly unknownRecords: readonly string[];
}

/** Parse every record-bearing member of a bundle (records/*.json + project.json). */
export function parseBundleRecords(files: ReadonlyMap<string, Uint8Array>): RecoveredRecords {
  const nodes = new Map<string, NodeRecordV1>();
  const failures: { path: string; detail: string }[] = [];
  const unknownRecords: string[] = [];
  let project: ProjectV1 | null = null;

  for (const [path, bytes] of files) {
    const isNodeRecord = path.startsWith(RECORDS_PREFIX) && path.endsWith('.json');
    const isProject = path === PROJECT_PATH;
    if (!isNodeRecord && !isProject) continue;
    const parsed = parseJsonBytes(bytes);
    if (!parsed.ok) {
      failures.push({ path, detail: `${parsed.error.code}: ${parsed.error.message}` });
      continue;
    }
    if (isProject) {
      const p = parseProjectV1(parsed.value, path);
      if (!p.ok) {
        failures.push({ path, detail: `${p.error.code} at ${p.error.path}: ${p.error.message}` });
      } else {
        project = p.value;
      }
      continue;
    }
    const n = parseNodeRecordV1(parsed.value, path);
    if (!n.ok) {
      failures.push({ path, detail: `${n.error.code} at ${n.error.path}: ${n.error.message}` });
      continue;
    }
    const expectedAddr = path.slice(RECORDS_PREFIX.length, -'.json'.length);
    if (n.value.node_ref.node_address !== expectedAddr) {
      failures.push({
        path,
        detail: `record node_address ${n.value.node_ref.node_address} does not match filename ${expectedAddr}`,
      });
      continue;
    }
    nodes.set(n.value.node_ref.node_address, n.value);
  }
  return { nodes, project, failures, unknownRecords };
}

export interface ChainWalk {
  /** Ordered root→leaf when reconstruction succeeded as far as bytes allow. */
  readonly chain: NodeRecordV1[];
  /** Parent address referenced but absent from the bundle, if any. */
  readonly missingAncestor: string | null;
  /** Parent cycle detected. */
  readonly cycle: boolean;
  /** Leaf record itself absent. */
  readonly leafMissing: boolean;
  /** record.depth mismatches along the walked chain. */
  readonly depthMismatch: string[];
}

/** Walk economic_parent links from the leaf to the root. */
export function reconstructChain(
  nodes: ReadonlyMap<string, NodeRecordV1>,
  leafAddress: string,
): ChainWalk {
  const chain: NodeRecordV1[] = [];
  const depthMismatch: string[] = [];
  const seen = new Set<string>();
  let missingAncestor: string | null = null;
  let cycle = false;
  let leafMissing = false;

  let cur = nodes.get(leafAddress);
  if (cur === undefined) {
    return { chain, missingAncestor: leafAddress, cycle: false, leafMissing: true, depthMismatch };
  }
  while (cur !== undefined) {
    if (seen.has(cur.node_ref.node_address)) {
      cycle = true;
      break;
    }
    seen.add(cur.node_ref.node_address);
    chain.unshift(cur);
    const parent = cur.economic_parent;
    if (parent === null) break;
    const next = nodes.get(parent.node_address);
    if (next === undefined) {
      missingAncestor = parent.node_address;
      break;
    }
    cur = next;
  }
  for (let i = 0; i < chain.length; i++) {
    if (chain[i]!.depth !== i) {
      depthMismatch.push(`${chain[i]!.node_ref.node_address}: declared depth ${chain[i]!.depth}, chain position ${i}`);
    }
  }
  return { chain, missingAncestor, cycle, leafMissing, depthMismatch };
}

export interface EconomicsMismatch {
  readonly node_address: string;
  readonly field: string;
  readonly recorded: string;
  readonly recomputed: string;
}

/**
 * Recompute residual-v1 economics along a reconstructed chain.
 * The chain must start at a root (economic_parent === null) and be
 * contiguous; callers check ChainWalk first.
 */
export function recomputeChainEconomics(chain: readonly NodeRecordV1[]): {
  ok: boolean;
  mismatches: EconomicsMismatch[];
  error?: string;
} {
  const mismatches: EconomicsMismatch[] = [];
  if (chain.length === 0) return { ok: false, mismatches, error: 'empty chain' };
  if (chain[0]!.economic_parent !== null) {
    return { ok: false, mismatches, error: 'chain does not start at a root record' };
  }
  let residual = U;
  for (const node of chain) {
    const addr = node.node_ref.node_address;
    const step = append(residual, node.claim_bps);
    if (!step.ok) {
      return { ok: false, mismatches, error: `${addr}: append() rejected claim: ${step.error.code}` };
    }
    const s = step.value;
    const expect = (field: string, recorded: string, recomputed: bigint): void => {
      const r = recomputed.toString(10);
      if (recorded !== r) mismatches.push({ node_address: addr, field, recorded, recomputed: r });
    };
    expect('residual_in_units', node.residual_in_units, residual);
    expect('effective_units', node.effective_units, s.effective);
    expect('residual_out_units', node.residual_out_units, s.residual_out);
    expect('issued_total_units', node.issued_total_units, s.issued);
    expect('own_payout_numerator_units', node.own_payout_numerator_units, s.payout_numerator);
    expect('own_payout_denominator_units', node.own_payout_denominator_units, s.payout_denominator);
    residual = s.residual_out;
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * The leaf's frozen payout table (docs/06: "exact beneficiary weights,
 * issued denominator"). Entries follow chain order root→leaf; nodes with
 * zero effective units carry no claim and are omitted — identical to
 * TesseraPort.getPayouts semantics.
 */
export function payoutTableForLeaf(
  chain: readonly NodeRecordV1[],
  leaf: NodeRecordV1,
  mode: PortMode,
): ExactPayoutTable {
  const issued = BigInt(leaf.issued_total_units);
  const entries: PayoutEntry[] = [];
  for (const n of chain) {
    const eff = BigInt(n.effective_units);
    if (eff === 0n) continue;
    entries.push({
      node_address: n.node_ref.node_address,
      beneficiary: n.contributor,
      effective_units: n.effective_units,
      numerator_units: n.effective_units,
      denominator_units: leaf.issued_total_units,
    });
  }
  return {
    mode,
    node_ref: leaf.node_ref,
    issued_total_units: leaf.issued_total_units,
    zero_issued: issued === 0n,
    entries,
  };
}

/** Best-effort mode label for reconstruction: prefers the bundle's own
 *  frozen payout table claim, falls back to 'local' (the only mode T05 can
 *  produce). The wrapper field on RecoveredProject keeps this honest —
 *  it is the recorded mode, not a chain claim. */
function bundleClaimedMode(contents: BundleContents): PortMode {
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

export interface RecoveredProject {
  readonly project: ProjectV1 | null;
  readonly leaf: NodeRecordV1;
  /** All parseable node records in the bundle (any branch). */
  readonly nodes: readonly NodeRecordV1[];
  /** root→leaf ancestor chain actually walked. */
  readonly chain: readonly NodeRecordV1[];
  /** Recomputed frozen payout table for the leaf. */
  readonly payout_table: ExactPayoutTable;
  readonly walk: ChainWalk;
  readonly economics: { ok: boolean; mismatches: EconomicsMismatch[]; error?: string };
  /** references[] addresses that do not resolve inside the bundle. */
  readonly unresolvedReferences: string[];
  readonly recordFailures: readonly { path: string; detail: string }[];
}

/**
 * Full reconstruction from bundle contents: project record (when present),
 * ancestor chain, recomputed economics and the leaf payout table.
 */
export function recoverBundle(contents: BundleContents): RecoveredProject | { error: string } {
  if (contents.manifestV1 === null) {
    return { error: 'bundle manifest is not evidence-bundle v1; recovery requires a v1 manifest' };
  }
  const leaf = contents.manifestV1.selected_leaf;
  const records = parseBundleRecords(contents.files);
  const walk = reconstructChain(records.nodes, leaf.node_address);
  const leafRecord = records.nodes.get(leaf.node_address);
  if (leafRecord === undefined) {
    return { error: `selected leaf record records/${leaf.node_address}.json is missing or unparseable` };
  }
  const economics = recomputeChainEconomics(walk.chain);

  const unresolved = new Set<string>();
  for (const n of records.nodes.values()) {
    for (const ref of n.references) {
      if (!records.nodes.has(ref)) unresolved.add(ref);
    }
  }

  return {
    project: records.project,
    leaf: leafRecord,
    nodes: [...records.nodes.values()],
    chain: walk.chain,
    payout_table: payoutTableForLeaf(walk.chain, leafRecord, bundleClaimedMode(contents)),
    walk,
    economics,
    unresolvedReferences: [...unresolved],
    recordFailures: records.failures,
  };
}

/** NodeRef of the reconstructed chain root, or null. */
export function chainRoot(chain: readonly NodeRecordV1[]): NodeRef | null {
  return chain.length === 0 ? null : chain[0]!.node_ref;
}
