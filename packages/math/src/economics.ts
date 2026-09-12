import type { NodeRef, PortResult } from '@tessera/types';
import {
  MAX_DEPTH,
  TOTAL_CAPACITY_UNITS,
  portErr,
} from '@tessera/types';
import { checkedMulU128, integer } from './guards.js';

/**
 * Exact TypeScript port of tools/reference_economics.py — the authoritative
 * executable spec for residual-v1 economics. U = 10^12 capacity units,
 * claims in basis points of the incoming residual, issued = U - residual_out,
 * own payout = effective / issued (undefined when issued == 0; stored 0/0).
 * All arithmetic is bigint; no floats anywhere.
 */

export const U = TOTAL_CAPACITY_UNITS; // 1_000_000_000_000n
export const BPS = 10_000n;
export const MAX_MONEY = (1n << 63n) - 1n; // i64 max for currency minor units

export interface EconomicStep {
  readonly residual_in: bigint;
  readonly claim_bps: bigint;
  readonly effective: bigint;
  readonly residual_out: bigint;
  readonly issued: bigint;
  readonly payout_numerator: bigint;
  readonly payout_denominator: bigint;
}

/** Portable JSON view: decimal strings for units, integer for claim_bps. */
export interface PortableStep {
  residual_in_units: string;
  claim_bps: number;
  effective_units: string;
  residual_out_units: string;
  issued_total_units: string;
  own_payout_numerator_units: string;
  own_payout_denominator_units: string;
}

export function portableStep(step: EconomicStep): PortableStep {
  return {
    residual_in_units: step.residual_in.toString(10),
    claim_bps: Number(step.claim_bps),
    effective_units: step.effective.toString(10),
    residual_out_units: step.residual_out.toString(10),
    issued_total_units: step.issued.toString(10),
    own_payout_numerator_units: step.payout_numerator.toString(10),
    own_payout_denominator_units: step.payout_denominator.toString(10),
  };
}

/**
 * One append: effective = floor(residual_in * claim_bps / 10_000),
 * residual_out = residual_in - effective, issued = U - residual_out.
 * Multiplication is checked in the u128 domain. Typed errors:
 * RESIDUAL_OUT_OF_RANGE, CLAIM_OUT_OF_RANGE, BRANCH_CAPACITY_EXHAUSTED,
 * CLAIM_ROUNDS_TO_ZERO, ARITHMETIC_OVERFLOW.
 */
export function append(residualIn: unknown, claimBps: unknown): PortResult<EconomicStep> {
  const r = integer(residualIn, 0n, U, 'RESIDUAL_OUT_OF_RANGE');
  if (!r.ok) return r;
  const q = integer(claimBps, 0n, BPS, 'CLAIM_OUT_OF_RANGE');
  if (!q.ok) return q;
  if (q.value > 0n && r.value === 0n) {
    return portErr('BRANCH_CAPACITY_EXHAUSTED', 'positive claim on a fully consumed residual');
  }
  const product = checkedMulU128(r.value, q.value);
  if (!product.ok) return product;
  const effective = product.value / BPS;
  if (q.value > 0n && effective === 0n) {
    return portErr('CLAIM_ROUNDS_TO_ZERO', 'positive claim rounds to zero effective units');
  }
  const residualOut = r.value - effective;
  const issued = U - residualOut;
  return {
    ok: true,
    value: {
      residual_in: r.value,
      claim_bps: q.value,
      effective,
      residual_out: residualOut,
      issued,
      payout_numerator: effective,
      payout_denominator: issued,
    },
  };
}

/** Thread a claim path: each node's residual_in is the parent's residual_out. */
export function path(claims: Iterable<unknown>): PortResult<EconomicStep[]> {
  let residual = U;
  const result: EconomicStep[] = [];
  for (const claim of claims) {
    const node = append(residual, claim);
    if (!node.ok) return node;
    result.push(node.value);
    residual = node.value.residual_out;
  }
  return { ok: true, value: result };
}

// ---------------------------------------------------------------------------
// previewAppend with parent validation
// ---------------------------------------------------------------------------

/**
 * Node lifecycle per docs/02. Only post-publication states can parent a child:
 * 'finalized' (immutable on-ledger version), plus 'restricted'/'disputed'
 * which are application annotations that never rewrite economics.
 * The specs define no ACTIVE/EXTENDABLE enum; extendability here means
 * "finalized record in the same network/program/project scope, under a
 * project whose extension policy permits the append" (policy enforced by
 * the port; REVIEWED requires a controller co-signature).
 */
export type NodeLifecycleState =
  | 'draft'
  | 'ready_for_consent'
  | 'signed'
  | 'submitted'
  | 'confirmed'
  | 'finalized'
  | 'restricted'
  | 'disputed';

const APPENDABLE_STATES: ReadonlySet<NodeLifecycleState> = new Set([
  'finalized',
  'restricted',
  'disputed',
]);

export function isAppendableState(s: NodeLifecycleState): boolean {
  return APPENDABLE_STATES.has(s);
}

/** Minimal stored-parent descriptor required for a validated preview. */
export interface ParentForPreview {
  readonly ref: NodeRef;
  readonly residual_out_units: bigint;
  readonly depth: number;
  readonly status: NodeLifecycleState;
}

export interface AppendScope {
  readonly genesis_hash: string;
  readonly program_id: string;
  readonly project_address: string;
}

export interface AppendPreview {
  readonly step: EconomicStep;
  readonly depth: number;
}

/**
 * Validated preview. parent === null previews a project root (residual U,
 * depth 0). Otherwise the parent must sit inside `scope` — same genesis
 * (PARENT_NETWORK_MISMATCH), program (PARENT_PROGRAM_MISMATCH) and project
 * (PARENT_PROJECT_MISMATCH) — be in an appendable lifecycle state
 * (PARENT_NOT_FINALIZED) and leave depth headroom (DEPTH_OUT_OF_RANGE).
 */
export function previewAppend(
  parent: ParentForPreview | null,
  claimBps: unknown,
  scope: AppendScope,
): PortResult<AppendPreview> {
  if (parent === null) {
    const step = append(U, claimBps);
    if (!step.ok) return step;
    return { ok: true, value: { step: step.value, depth: 0 } };
  }
  if (parent.ref.genesis_hash !== scope.genesis_hash) {
    return portErr('PARENT_NETWORK_MISMATCH', 'parent genesis_hash differs from target network');
  }
  if (parent.ref.program_id !== scope.program_id) {
    return portErr('PARENT_PROGRAM_MISMATCH', 'parent program_id differs from target program');
  }
  if (parent.ref.project_address !== scope.project_address) {
    return portErr('PARENT_PROJECT_MISMATCH', 'parent belongs to a different project');
  }
  if (!isAppendableState(parent.status)) {
    return portErr('PARENT_NOT_FINALIZED', `parent in state '${parent.status}' cannot accept children`);
  }
  const depth = parent.depth + 1;
  if (depth > MAX_DEPTH) {
    return portErr('DEPTH_OUT_OF_RANGE', `depth ${depth} exceeds ${MAX_DEPTH}`);
  }
  const step = append(parent.residual_out_units, claimBps);
  if (!step.ok) return step;
  return { ok: true, value: { step: step.value, depth } };
}
