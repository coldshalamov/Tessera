import type { NodeRef } from '@tessera/types';

/**
 * Structured verification report (docs/06: "a verification report, not a
 * magic green tick"). Every check is independently labeled; the overall
 * status is never a bare "verified".
 *
 * Check results:
 *  - pass: check ran and succeeded
 *  - fail: contradictory evidence (hash mismatch, bad signature, broken math)
 *  - warn: checkable limitation that does not disprove anything
 *  - incomplete: evidence claimed-or-needed but absent (missing ancestor,
 *    terms, artifact); never "valid by default"
 *  - skipped: check not runnable in this mode (e.g. RPC not configured)
 *
 * Bundle status roll-up:
 *  - 'invalid'        any fail
 *  - 'unsupported'    manifest is not evidence-bundle v1 (files still
 *                     integrity-checked and exportable)
 *  - 'incomplete'     no fails, but evidence is missing
 *  - 'valid-offline'  every offline-checkable check passed; chain finality
 *                     and legal identity remain explicit non-claims
 */

export type CheckResult = 'pass' | 'fail' | 'warn' | 'incomplete' | 'skipped';

export interface EvidenceCheck {
  readonly name: string;
  readonly result: CheckResult;
  readonly detail: string;
}

export type BundleStatus = 'valid-offline' | 'invalid' | 'incomplete' | 'unsupported' | 'unreadable';

export interface EvidenceVerificationReport {
  readonly verifier: string;
  readonly format: 'tessera-evidence/1' | 'unknown';
  readonly mode: 'offline' | 'online-assisted';
  readonly status: BundleStatus;
  readonly selected_leaf: NodeRef | null;
  readonly project_address: string | null;
  readonly checks: EvidenceCheck[];
  /** Bundle-declared limitations plus verifier-added caveats. */
  readonly limitations: string[];
  readonly counts: Record<CheckResult, number>;
}

export const VERIFIER_ID = '@tessera/evidence 0.1.0 (offline)';

export function summarize(checks: readonly EvidenceCheck[]): Record<CheckResult, number> {
  const counts: Record<CheckResult, number> = { pass: 0, fail: 0, warn: 0, incomplete: 0, skipped: 0 };
  for (const c of checks) counts[c.result]++;
  return counts;
}

export function rollUpStatus(counts: Record<CheckResult, number>, unsupported: boolean): BundleStatus {
  if (counts.fail > 0) return 'invalid';
  if (unsupported) return 'unsupported';
  if (counts.incomplete > 0) return 'incomplete';
  return 'valid-offline';
}

const RESULT_LABEL: Record<CheckResult, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  warn: 'WARN',
  incomplete: 'INCOMPLETE',
  skipped: 'SKIPPED',
};

/** Human-readable rendering for the CLI; JSON remains the machine form. */
export function renderReportText(r: EvidenceVerificationReport): string {
  const lines: string[] = [];
  lines.push(`Tessera evidence verification — status: ${r.status.toUpperCase()}`);
  lines.push(`  verifier: ${r.verifier}`);
  lines.push(`  format:   ${r.format}   mode: ${r.mode}`);
  if (r.selected_leaf) {
    lines.push(`  leaf:     ${r.selected_leaf.node_address}`);
    lines.push(`  project:  ${r.selected_leaf.project_address}`);
  }
  const c = r.counts;
  lines.push(`  checks:   ${c.pass} pass / ${c.fail} fail / ${c.warn} warn / ${c.incomplete} incomplete / ${c.skipped} skipped`);
  lines.push('');
  for (const check of r.checks) {
    lines.push(`  [${RESULT_LABEL[check.result]}] ${check.name}`);
    lines.push(`         ${check.detail}`);
  }
  if (r.limitations.length > 0) {
    lines.push('');
    lines.push('  LIMITATIONS (offline verification is not live chain finality):');
    for (const l of r.limitations) lines.push(`    - ${l}`);
  }
  return lines.join('\n');
}
