# Tessera | project context and maturation directive (2026-10-20)

This note is a snapshot of a GitHub inspection, not an assertion of deployed readiness. Read AGENTS.md, shared/FOUNDING_DECISIONS.md, shared/INTEGRATION_CONTRACT.md, BACKLOG.md, and status/WORK_LOG.md before engineering changes.

## North star
Tessera is reusable Solana infrastructure for economic lineage, signed contributions and independently verifiable evidence. Morpheus is its first adopter, not its governing design. Preserve exact integer residual economics, a single economic parent, version-specific payouts, explicit consent, and test-vs-mainnet boundaries.

## Observed on main
- Real code exists for deterministic math/types, signing identity, an Anchor Solana program, evidence export/verification, local CLI, and extensive automated tests.
- No apps/explorer or apps/web frontend appears in the inspected repository tree. Tessera currently lacks an approachable visual product.
- T04 SDK/RPC integration and sponsored submission is planned; T06 explorer/demo, T07 security, T09 deployment and T10 integration remain planned. README/SETUP_STATUS contain historical seed-era wording and must be updated only against new verification.
- Program was reportedly tested against LiteSVM and a local validator (see backlog/log), not shown deployed on devnet/mainnet.

## Highest-value next vertical slices
1. **Explorer and interactive economic tree (T06)**: build a standalone responsive React web app with local fixture mode. Display project, version selection, ancestors, branching graph plus accessible table, claim vs effective ownership vs residual vs as-is payout, exact-rational allocations and verification badges. Support changing a claim and previewing a hypothetical descendant without mutating immutable history. Use actual math package/fixtures.
2. **SDK integration (T04)**: create a versioned portable SDK and implement TesseraPort with real RPC reads, submission-state reconciliation, signing boundary and idempotency tests. Keep sponsor budget controls and chain labels explicit.
3. **Non-audio demo and evidence workflow**: show Tessera independent of Morpheus using e.g. collaborative writing or software provenance; export an evidence bundle and verify without a hosted backend.
4. **Threat-model and adversarial verification**: property tests for ancestry, rounding, zero issuance, tampering, replay, key continuity, network confusion, failed RPC, cache inconsistency and locked terms.

## Agent execution policy
First inspect code and current branches/PRs. Build one working end-to-end vertical slice with test coverage and screenshots, not just cards or mock charts. Keep the UI intelligible to people with zero crypto background while retaining exact mathematical evidence. Record measured runtime behavior and limitations. Do not imply signature proves legal title or that a devnet/local result is a mainnet fact. Submit draft PRs; do not merge without founder review.
