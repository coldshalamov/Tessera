# Tessera | project context and maturation directive

Updated 2026-10-20 from the working repository. Incorporates the directive in
draft documentation PR #1; that PR's original remote-main snapshot predates the
local T04/T06 commits. Read AGENTS.md, shared/FOUNDING_DECISIONS.md,
shared/INTEGRATION_CONTRACT.md, BACKLOG.md and status/WORK_LOG.md before changes.

## North star

Tessera is reusable Solana infrastructure for economic lineage, signed
contributions and independently verifiable evidence. Morpheus is its first
adopter, not its governing design. Preserve integer residual economics, one
economic parent, immutable version-specific contributions, explicit consent and
test/mainnet distinctions. Provenance and payout arithmetic do not establish
legal ownership.

## Implemented capabilities and evidence boundaries

- Deterministic math/types, signing identity, Anchor program, evidence bundle
  export/verifier, CLI, portable SDK and bounded sponsor relayer exist. Historical
  local-validator evidence is recorded in `reports/sdk-conformance.md` and the
  work log; it is not a current running deployment or devnet/mainnet acceptance.
- `apps/explorer` loads real offline evidence ZIPs and manifest-only files. Its
  five-node stems fixture exercises local signing, sibling branches, exact payout
  ratios, verification and export. It has no live RPC source or signing UI.
- The interactive lineage map selects the same immutable versions as the complete
  keyboard tree. A hypothetical descendant preview calls `@tessera/math`, compares
  exact current/new payout denominators, and leaves bundle bytes unchanged.
  Invalid/incomplete evidence cannot enable the preview. This is arithmetic,
  not a submitted contribution or a proof of network eligibility.
- No devnet/mainnet deployment, real custody provider, live payouts, external
  security audit, cleared trademark or approved publication license is established
  by these implementations. T07/T09/T10 remain open.

## Next useful vertical slices

1. Connect the explorer to bounded SDK reads with explicit network context,
   cancellation and recoverable RPC failures; retain independent offline use.
2. Add an independent non-audio demonstration, such as software provenance or
   collaborative writing. The existing music-stems fixture is generic infrastructure
   but does not satisfy the cross-repo contract's non-audio demonstration.
3. Build generic contribution creation/consent with injected signing and exact
   parent/terms binding, after selecting the custody and deployment mode.
4. Execute T07's scoped threat model and adversarial program/relayer verification,
   then the approved T09 deployment level and T10 cross-repo scenario.

## Execution policy

Inspect actual code, branches and open PRs first. Deliver useful complete slices
with direct tests and rendered evidence; document real limitations. Keep the
interface intelligible without crypto knowledge while retaining exact mathematical
evidence. Submit draft PRs. Do not merge, deploy, activate live money or infer
legal title without founder authority. Stop once the slice works and its required
checks pass; broader audits are separate work.
