# Recovery rehearsal — bundle-only project reconstruction (T05)

Date: 2026-09-13. Branch: `packet/t05`.
Requirement (docs/06 "Recovery path", packet T05): reconstruct project state
and the leaf's exact payout table from **only** an exported evidence bundle,
with the original application/index disabled — no `TesseraPort`, no database,
no repo source imports beyond the built package.

## Rehearsal setup

1. `tessera-evidence demo --out <tmp>/session` — deterministic local-mode
   session, 5 nodes over a 4-node ancestor chain:
   `root(1500 bps) → performer2000(2000) → sound(1000) → composer(2500 leaf)`,
   plus competing branch `performer5000(5000)` cited by the composer as a
   descriptive (non-economic) cross-branch reference. Throwaway Ed25519
   keys; scripted nonces; `mode: 'local'`.
2. `tessera-evidence export --from-port <tmp>/session --out <tmp>/bundle.zip`
   — bundle embeds records, intent payloads + exact signed wire bytes,
   detached signatures, RELEASE_ANCHOR statement + release manifest,
   metadata/terms/artifact payloads, the frozen payout table and the
   project record (42 members; `files[]` fully hash-listed).
3. **Application "disabled":** a fresh `node` process in a new temp
   directory whose only Tessera import is the built
   `packages/evidence/dist/index.js`. Inputs: the zip bytes alone. It runs
   `readBundleZip` → `verifyBundle` → `recoverBundle` and prints the
   reconstructed chain + payout table.

This is the permanent form of the exercise — it is test
`restore exercise — bundle-only reconstruction` in
`tests/evidence/src/restore.test.ts`, so the rehearsal reruns on every
`pnpm -r test`.

## Result (exact)

- Verifier status: `valid-offline` — 19 pass / 0 fail / 2 warn / 0 incomplete.
  Warnings are the standing non-claims: no live-chain finality offline;
  signatures prove key approval, not legal identity/ownership.
- Reconstructed chain: 4 nodes root→leaf; `project.json` root pointer
  matches the reconstructed root; title `The Lantern Room`.
- Recomputed economics: exact match on every recorded field
  (`residual_in`, `effective`, `residual_out`, `issued_total`, own
  numerator/denominator) under residual-v1.
- Frozen payout table byte-equal to reconstruction; issued denominator
  `541000000000`; entries
  `150000000000/541000000000`, `170000000000/541000000000`,
  `68000000000/541000000000`, `153000000000/541000000000`
  (the shared/ACCEPTANCE_SCENARIO residual-v1 values).
- Equality asserted against the live local port's own `getPayouts(leaf)`
  taken before "shutdown" — recovered table is identical, entry-for-entry.
- Cross-branch reference to `performer5000` resolves inside the bundle;
  ancestor chain correctly excludes the competing branch (economic
  parentage, not reference order, defines the chain).

## Adversarial rehearsal — honest degradation

Also exercised and asserted:

- mid-chain ancestor record removed (manifest retargeted so integrity
  stays clean): `ancestry.reconstruct` → `incomplete`,
  `economics.recompute` → `incomplete`, bundle status `incomplete`,
  `recover-known-project` exit code 3. Missing evidence is reported as
  missing — it is never silently "reconstructed" and never mislabeled
  forgery.
- tampered payload/signature/economic field → `invalid`, exit 2.
- non-v1 manifest → `unsupported`, exit 4, members still exportable.

## Real limitations of this rehearsal (not hidden)

- The recovered state is **local-mode simulated evidence**: keys are
  throwaway, slots/timestamps are synthetic, and `mode: 'local'` is carried
  in the bundle and the report. Nothing here proves a mainnet/devnet
  transaction existed or finalized.
- "Application disabled" is demonstrated as process+dependency isolation
  (fresh temp-dir process, built dist only). A physically separate machine
  rehearsal is the same code path — no additional coupling exists to remove.
- The payout table proves *exact recorded economics*, not a cash claim:
  beneficiary = contributor key, and real payment routing stays in
  Morpheus/processor land (docs/14).
- Recovery covers what the bundle contains. An export taken before some
  nodes existed reconstructs only those nodes — `incomplete`, honestly.

## Reproduce

```bash
pnpm -r build
node apps/cli/dist/cli.js demo --out /tmp/t05/session
node apps/cli/dist/cli.js export --from-port /tmp/t05/session --out /tmp/t05/bundle.zip
node apps/cli/dist/cli.js verify /tmp/t05/bundle.zip          # → VALID-OFFLINE, exit 0
node apps/cli/dist/cli.js recover-known-project /tmp/t05/bundle.zip
pnpm --filter @tessera-tests/evidence test                     # 50 tests incl. the rehearsal
```
