import type { NodeRecordV1, ProjectV1 } from '@tessera/types';
import type { BundleContents } from './bundle.js';
import { parseBundleRecords } from './recover.js';

/**
 * Storage/rent quotation for a bundle's records (docs/08 `quote`, docs/10
 * "quote devnet/mainnet account sizes").
 *
 * There is no deployed account layout yet — T03 owns the measured IDL —
 * so byte counts here are a documented field-sum ESTIMATE over the docs/14
 * state-account field list, not a measured account size. Rent figures come
 * in two clearly labeled flavors:
 *
 *  - illustrative: the shared/LAUNCH_BUDGET legacy-parameter scenario
 *    `lamports(B) = (B + 128) * 6960`, which is explicitly NOT a current
 *    rent quote;
 *  - live: `getMinimumBalanceForRentExemption(estimatedBytes)` over --rpc
 *    (see rpc.ts) — a real rent query for ESTIMATED sizes, still not a
 *    guarantee because the on-chain layout is unfixed.
 *
 * Integer math only; SOL rendering is a decimal string, never float.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000n;
/** shared/LAUNCH_BUDGET legacy-parameter model constants. */
const LEGACY_OVERHEAD = 128n;
const LEGACY_LAMPORTS_PER_BYTE = 6960n;

const te = new TextEncoder();

function utf8Len(s: string): number {
  return te.encode(s).length;
}

/**
 * Estimated ContributionAccount bytes for one node record, per the docs/14
 * field list: 8B discriminator, 1B state version, 32B project, 1B+32B
 * optional parent, 32B contributor, u32+name, u32+title, 32B intent digest,
 * 32B artifact, 1B+32B optional metadata digest, 32B terms, u32+32B×refs,
 * 16B nonce, u16 claim, 7×u64 economics, u8 custody, i64 declared, u64
 * observed slot, i64 observed time, u32 depth, u8 bump. Fixed overhead
 * 287B + variable fields; worst case 767B.
 */
export function estimateNodeAccountBytes(node: NodeRecordV1): number {
  return (
    287 +
    utf8Len(node.name) +
    utf8Len(node.title) +
    (node.economic_parent === null ? 0 : 32) +
    (node.metadata_sha256 === null ? 0 : 32) +
    32 * node.references.length
  );
}

/**
 * Estimated ProjectAccount bytes: 8B discriminator, 1B state version,
 * 32B creator, 1B+32B optional controller, 1B+32B optional root pointer,
 * 16B project nonce, u32+title, 1B rule tag, u64 total units, 1B extension
 * policy, 32B terms digest. Fixed overhead 105B + title + optionals.
 */
export function estimateProjectAccountBytes(project: ProjectV1): number {
  return (
    105 +
    utf8Len(project.title) +
    (project.controller === null ? 0 : 32) +
    (project.root_node === null ? 0 : 32)
  );
}

/** Legacy-parameter illustrative rent model: (B + 128) × 6960 lamports. */
export function illustrativeRentLamports(bytes: number): bigint {
  return (BigInt(bytes) + LEGACY_OVERHEAD) * LEGACY_LAMPORTS_PER_BYTE;
}

/** Exact decimal SOL string for a lamport amount (no floating point). */
export function lamportsToSol(lamports: bigint): string {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const whole = v / LAMPORTS_PER_SOL;
  const frac = (v % LAMPORTS_PER_SOL).toString(10).padStart(9, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export interface StorageQuote {
  /** Per-record estimated account bytes (node_address → bytes). */
  readonly node_estimates: readonly { node_address: string; bytes: number }[];
  readonly project_estimate_bytes: number | null;
  readonly total_estimated_bytes: number;
  /** Illustrative legacy-model rent — NOT a live quote. */
  readonly illustrative_rent_lamports: string;
  readonly illustrative_rent_sol: string;
  readonly assumptions: readonly string[];
  /** Live getMinimumBalanceForRentExemption result, only when --rpc used. */
  readonly live_rent_lamports?: string;
  readonly live_rent_sol?: string;
  readonly live_rent_source?: string;
}

export function quoteBundleRecords(contents: BundleContents): StorageQuote | { error: string } {
  if (contents.manifestV1 === null) {
    return { error: 'bundle manifest is not evidence-bundle v1; quote requires parseable records' };
  }
  const records = parseBundleRecords(contents.files);
  const nodeEstimates = [...records.nodes.values()].map((n) => ({
    node_address: n.node_ref.node_address,
    bytes: estimateNodeAccountBytes(n),
  }));
  const projectBytes = records.project === null ? null : estimateProjectAccountBytes(records.project);
  const total = nodeEstimates.reduce((a, e) => a + e.bytes, 0) + (projectBytes ?? 0);
  const lamports = illustrativeRentLamports(total);
  return {
    node_estimates: nodeEstimates,
    project_estimate_bytes: projectBytes,
    total_estimated_bytes: total,
    illustrative_rent_lamports: lamports.toString(10),
    illustrative_rent_sol: lamportsToSol(lamports),
    assumptions: [
      'account byte sizes are field-sum estimates over the docs/14 field list — T03 measures the real Anchor/Borsh layout and IDL',
      'illustrative rent uses the shared/LAUNCH_BUDGET legacy-parameter model (B+128)*6960 lamports — explicitly NOT a current rent quote',
      'rent-exemption deposit is recoverable capital, distinct from consumed transaction fees',
      'one account per node record; packing/pages are a future cost optimization (docs/04)',
    ],
  };
}
