import type { CheckResult, EvidenceVerificationReport } from '@tessera/evidence';

/**
 * Verification panel — every check individually labeled; the roll-up is
 * never a bare "verified". Banned claims ("copyright verified",
 * "court-proof", "permanent", "paid") are never emitted here; finality and
 * identity surface as their own explicit non-claims.
 */
const RESULT_LABEL: Record<CheckResult, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  warn: 'WARN',
  incomplete: 'INCOMPLETE',
  skipped: 'SKIPPED',
};

const STATUS_LABEL: Record<EvidenceVerificationReport['status'], { title: string; blurb: string }> = {
  'valid-offline': {
    title: 'VALID — OFFLINE CHECKS ONLY',
    blurb: 'Bytes, signatures and residual-v1 math recompute cleanly. This does NOT prove live chain anchoring or legal ownership.',
  },
  invalid: {
    title: 'INVALID — contradictory evidence',
    blurb: 'At least one check found a contradiction (hash, signature or math mismatch). Do not rely on this bundle.',
  },
  incomplete: {
    title: 'INCOMPLETE — evidence missing',
    blurb: 'Nothing contradictory, but claimed-or-needed evidence is absent (ancestors, terms, artifacts, signatures).',
  },
  unsupported: {
    title: 'UNSUPPORTED FORMAT',
    blurb: 'Not an evidence-bundle v1 manifest. Files remain integrity-checked and exportable; semantic checks were skipped.',
  },
  unreadable: {
    title: 'UNREADABLE',
    blurb: 'The container or manifest could not be read at all.',
  },
};

const CHECK_HELP: Record<string, string> = {
  'manifest.schema': 'Does bundle.json conform to evidence-bundle v1?',
  'paths.safety': 'No absolute paths, traversal, backslashes or self-listing.',
  'container.inventory': 'Every archive member is manifest-listed and present.',
  'payload.integrity': 'Each file is byte-identical to its recorded sha256/size.',
  'records.schema': 'Node/project records parse against the strict v1 schema.',
  'records.scope': 'All records share the leaf\'s genesis/program/project scope.',
  'ancestry.reconstruct': 'The leaf\'s economic_parent chain rebuilds to a root.',
  'economics.recompute': 'Residual-v1 fields recompute exactly, unit for unit.',
  'project.consistency': 'Project record agrees with the leaf scope and chain root.',
  'payout_table.frozen': 'The frozen table equals the recomputed table.',
  'intents.digest': 'Signed intent bytes hash to each record\'s intent_digest.',
  'signatures.intent': 'Ed25519 detached signatures verify — key approval, not anchoring.',
  'statements.verify': 'Statement records re-encode and verify.',
  'manifests.anchored': 'Each release manifest is bound by a RELEASE_ANCHOR statement.',
  'metadata.coverage': 'Metadata bytes resolve by digest.',
  'terms.coverage': 'Terms text is present for every referenced digest.',
  'artifacts.coverage': 'Artifact bytes resolve by digest (may be excluded by license).',
  'references.resolve': 'Signed descriptive references point at records in the bundle.',
  'chain.finality': 'Chain anchoring cannot be established offline — always a non-claim here.',
  'chain.rpc': 'A configured RPC endpoint answered (a labeled trust assumption).',
  'identity.rights': 'Keys signed digests; identity/ownership remain unverified.',
  'limitations.recorded': 'Bundle-declared limitations surfaced verbatim.',
};

export function VerifyPanel(props: { report: EvidenceVerificationReport }): React.JSX.Element {
  const r = props.report;
  const status = STATUS_LABEL[r.status];
  return (
    <section aria-labelledby="verify-heading" className="panel">
      <h2 id="verify-heading">Verification</h2>
      <p className={`status-badge status-${r.status}`} role="status">
        <strong>{status.title}</strong>
        <br />
        <span>{status.blurb}</span>
      </p>
      <p className="hint">
        verifier: {r.verifier} · mode: {r.mode} · checks: {r.counts.pass} pass / {r.counts.fail} fail / {r.counts.warn} warn / {r.counts.incomplete} incomplete / {r.counts.skipped} skipped
      </p>
      <ul className="checks">
        {r.checks.map((c, i) => (
          <li key={`${c.name}-${i}`} className={`check check-${c.result}`}>
            <span className={`check-badge badge-${c.result}`}>{RESULT_LABEL[c.result]}</span>
            <span className="check-body">
              <span className="check-name">{c.name}</span>
              {CHECK_HELP[c.name] !== undefined && <span className="check-help">{CHECK_HELP[c.name]}</span>}
              <span className="check-detail">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {r.limitations.length > 0 && (
        <details className="limitations-block" open={r.status !== 'valid-offline'}>
          <summary>Limitations and non-claims ({r.limitations.length})</summary>
          <ul>
            {r.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
