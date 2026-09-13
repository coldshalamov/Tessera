# Repository map — Tessera

This is a map of the **actual specification seed**, followed by the future source layout agents should build. Existing Markdown links below all point inside this independent repo. `shared/` is intentionally copied into both repos so either agent has the full integration/launch context.

## Specification and helper-document map

| File | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Execution, authority and completion rules |
| [BACKLOG.md](BACKLOG.md) | Dependency-aware task queue |
| [DECISIONS.md](DECISIONS.md) | Confirmed/default/approval-gate register |
| [LICENSE_DECISION.md](LICENSE_DECISION.md) | Software license/visibility decision not silently made |
| [README.md](README.md) | Project purpose and entrypoint |
| [START_HERE.md](START_HERE.md) | Initialization and reading order |
| [docs/00_PRODUCT.md](docs/00_PRODUCT.md) | Tessera product specification |
| [docs/01_ECONOMIC_MODEL.md](docs/01_ECONOMIC_MODEL.md) | Economic model: exact, version-specific residual claims |
| [docs/02_STATE_AND_CONSENT.md](docs/02_STATE_AND_CONSENT.md) | State, consent, branches and authority |
| [docs/03_SERIALIZATION_AND_SCHEMA.md](docs/03_SERIALIZATION_AND_SCHEMA.md) | Core record, serialization and signatures |
| [docs/04_SOLANA_PROGRAM.md](docs/04_SOLANA_PROGRAM.md) | Solana program design and implementation plan |
| [docs/05_IDENTITY_AND_KEYS.md](docs/05_IDENTITY_AND_KEYS.md) | Embedded signing identity and key safety |
| [docs/06_PERSISTENCE_AND_EXPORT.md](docs/06_PERSISTENCE_AND_EXPORT.md) | Persistence, evidence bundles and independent recovery |
| [docs/07_SECURITY_AND_ABUSE.md](docs/07_SECURITY_AND_ABUSE.md) | Threat model and abuse controls |
| [docs/08_SDK_AND_EXPLORER.md](docs/08_SDK_AND_EXPLORER.md) | SDK, CLI, indexer and independent explorer |
| [docs/09_TEST_AND_ACCEPTANCE.md](docs/09_TEST_AND_ACCEPTANCE.md) | Test strategy and release acceptance |
| [docs/10_DEPLOYMENT_AND_OPERATIONS.md](docs/10_DEPLOYMENT_AND_OPERATIONS.md) | Deployment and operations |
| [docs/11_LEGAL_EVIDENCE.md](docs/11_LEGAL_EVIDENCE.md) | Legal meaning, evidence and permission boundaries |
| [docs/12_PRIOR_ART_AND_POSITIONING.md](docs/12_PRIOR_ART_AND_POSITIONING.md) | Prior art, research tasks and positioning |
| [docs/13_FUNDING_AND_ROADMAP.md](docs/13_FUNDING_AND_ROADMAP.md) | Funding demonstration and staged roadmap |
| [docs/14_BINARY_LAYOUT_V1.md](docs/14_BINARY_LAYOUT_V1.md) | Proposed binary layout v1 and semantic constraints |
| [fixtures/README.md](fixtures/README.md) | Reference fixtures |
| [packets/T01.md](packets/T01.md) | T01 — Deterministic economics and portable types |
| [packets/T02.md](packets/T02.md) | T02 — Identity, intent signing and exportable consent |
| [packets/T03.md](packets/T03.md) | T03 — Solana program, constraints and measured footprint |
| [packets/T04.md](packets/T04.md) | T04 — SDK, sponsor relayer and finality reconciliation |
| [packets/T05.md](packets/T05.md) | T05 — Independent evidence export, verifier and recovery |
| [packets/T06.md](packets/T06.md) | T06 — Generic explorer and non-audio demonstration |
| [packets/T07.md](packets/T07.md) | T07 — Program/key/sponsor security hardening |
| [packets/T08.md](packets/T08.md) | T08 — Prior art, licensing and legal-evidence documentation |
| [packets/T09.md](packets/T09.md) | T09 — Deployment, cost quotation and bounded mainnet readiness |
| [packets/T10.md](packets/T10.md) | T10 — Cross-repo acceptance and incubator demonstration |
| [reports/math-conformance.md](reports/math-conformance.md) | T01 economics/type conformance evidence (commands + pass counts) |
| [reports/sdk-conformance.md](reports/sdk-conformance.md) | T04 SDK/relayer conformance + live localnet evidence |
| [reports/evidence-verifier.md](reports/evidence-verifier.md) | T05 verifier checks, semantics and explicit non-claims |
| [reports/recovery-rehearsal.md](reports/recovery-rehearsal.md) | T05 bundle-only shutdown/restore exercise evidence |
| [reports/SEED_VALIDATION.md](reports/SEED_VALIDATION.md) | Actual reference validation, with unperformed tasks separated |
| [shared/ACCEPTANCE_SCENARIO.md](shared/ACCEPTANCE_SCENARIO.md) | Complete two-branch/two-release acceptance test |
| [shared/FOUNDING_DECISIONS.md](shared/FOUNDING_DECISIONS.md) | Conversation-derived source of intent |
| [shared/INTEGRATION_CONTRACT.md](shared/INTEGRATION_CONTRACT.md) | Versioned cross-repo SDK/data agreement |
| [shared/LAUNCH_BUDGET.md](shared/LAUNCH_BUDGET.md) | Free-tier limits, priced components and mainnet/payment scenarios |
| [shared/RESEARCH_SOURCES.md](shared/RESEARCH_SOURCES.md) | 51 public primary sources and research limitations |
| [shared/SETUP_RUNBOOK.md](shared/SETUP_RUNBOOK.md) | Provider setup and agent/human boundaries |
| [status/SETUP_STATUS.md](status/SETUP_STATUS.md) | Actual external-resource status, initially unprovisioned |
| [status/WORK_LOG.md](status/WORK_LOG.md) | Per-session implementation evidence |
| [tools/README.md](tools/README.md) | Reference tools |

## Existing non-map file inventory

```text
.env.example
.gitignore
.oxlintrc.json
AGENTS.md
BACKLOG.md
DECISIONS.md
LICENSE_DECISION.md
README.md
START_HERE.md
docs/00_PRODUCT.md
docs/01_ECONOMIC_MODEL.md
docs/02_STATE_AND_CONSENT.md
docs/03_SERIALIZATION_AND_SCHEMA.md
docs/04_SOLANA_PROGRAM.md
docs/05_IDENTITY_AND_KEYS.md
docs/06_PERSISTENCE_AND_EXPORT.md
docs/07_SECURITY_AND_ABUSE.md
docs/08_SDK_AND_EXPLORER.md
docs/09_TEST_AND_ACCEPTANCE.md
docs/10_DEPLOYMENT_AND_OPERATIONS.md
docs/11_LEGAL_EVIDENCE.md
docs/12_PRIOR_ART_AND_POSITIONING.md
docs/13_FUNDING_AND_ROADMAP.md
docs/14_BINARY_LAYOUT_V1.md
fixtures/README.md
fixtures/artifact.txt
fixtures/economics.json
fixtures/intent-v1-signature.json
fixtures/intent-v1.json
fixtures/metadata.json
fixtures/terms.txt
packets/T01.md
packets/T02.md
packets/T03.md
packets/T04.md
packets/T05.md
packets/T06.md
packets/T07.md
packets/T08.md
packets/T09.md
packets/T10.md
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
reports/math-conformance.md
reports/SEED_VALIDATION.md
schemas/contribution-intent.schema.json
schemas/evidence-bundle.schema.json
schemas/node.schema.json
schemas/project.schema.json
schemas/statement.schema.json
shared/ACCEPTANCE_SCENARIO.md
shared/FOUNDING_DECISIONS.md
shared/INTEGRATION_CONTRACT.md
shared/LAUNCH_BUDGET.md
shared/RESEARCH_SOURCES.md
shared/SETUP_RUNBOOK.md
shared/economic-vectors.json
status/SETUP_STATUS.md
status/WORK_LOG.md
tools/README.md
tools/inspect_signature_fixture.py
tools/reference_economics.py
tools/regen_intent_fixture.py
tools/validate_seed.py
tsconfig.base.json
```

Implementation paths added by T01/T02/T03/T04/T05 (see "Implementation tree" below for the
full future layout — the marked rows are the ones that exist today):

```text
packages/types/     Portable record types, semantic validators, wire codecs+decoders (T01/T02/T04)
packages/math/      Exact bigint economics + LocalTesseraPort simulator (T01)
packages/identity/  IdentityPort, LocalTestSigner, provider boundary, continuity (T02)
packages/evidence/  Bundle writer/reader, verifier, recovery, local export (T05)
packages/sdk/       Workers-safe Solana TesseraPort: PDAs, instructions, tx, reconcile (T04)
services/relayer/   Bounded sponsor relayer: review, caps, outbox, kill switch, audit (T04)
programs/tessera/   Anchor program: deployment config, projects, root+child nodes (T03)
apps/cli/           tessera-evidence CLI: inspect/verify/export/quote/recover (T05)
tests/math/         Vitest conformance/property/rejection/local-port suite (T01)
tests/signatures/   Golden/mutation/replay/boundary/consent/continuity suite (T02)
tests/evidence/     Bundle tamper/traversal/restore/CLI/RPC suite (T05)
tests/sdk/          SDK/relayer conformance + env-gated live localnet proof (T04)
tests/program/      LiteSVM + solana-test-validator program suite (T03)
generated/          Committed IDL + golden account-layout vectors (T03)
```

`REPO_MAP.md` and `DELIVERY_MANIFEST.json` are generated last and are additional root files. The manifest contains hashes of all files except itself. Specification files, reference tools and fixtures are not a completed production app.

## Implementation tree

```text
programs/tessera/       Rust/Anchor economic state transitions        (T03 DONE)
packages/math/          Pure integer economics + local TesseraPort    (T01 DONE)
packages/types/         Record types, validators, binary codecs/decoders (T01/T02 DONE)
packages/identity/      IdentityPort signing/consent/export adapters  (T02 DONE)
packages/sdk/           Network/submit/read/verify API                (T04 DONE)
packages/evidence/      Portable evidence and recovery                (T05 DONE)
services/relayer/       Bounded sponsor submission                    (T04 DONE)
apps/cli/               Independent verification/export tools         (T05 DONE)
apps/explorer/          Generic read-only explorer                    (target)
ops/                    Deployment, quotes and recovery               (T03 started: localnet-t03.sh)
tests/math/             Economics/types conformance suite             (T01 DONE)
tests/signatures/       Signing/consent/continuity adversarial suite  (T02 DONE)
tests/program/          Rust LiteSVM + live-localnet program tests    (T03 DONE)
tests/evidence/         Evidence tamper/traversal/restore suite       (T05 DONE)
tests/sdk/              SDK/relayer conformance + live localnet proof (T04 DONE)
generated/idl/          Committed Anchor IDL for the program          (T03 DONE)
generated/vectors/      Golden account-layout vectors                 (T03 DONE)
reports/math-conformance.md  T01 evidence                             (T01 DONE)
reports/identity-spike.md    T02 provider research + signer evidence  (T02 DONE)
reports/program-footprint.md T03 measured footprint + test evidence   (T03 DONE)
reports/evidence-verifier.md   T05 verifier spec + evidence           (T05 DONE)
reports/recovery-rehearsal.md  T05 shutdown/restore exercise          (T05 DONE)
reports/sdk-conformance.md   T04 SDK/relayer + localnet evidence      (T04 DONE)
```

Rows marked `(target)` are future code destinations in the work packets, not
code claimed to exist now. Rows marked `(T01 DONE)` exist on `packet/t01` with
the evidence in `reports/math-conformance.md`. Local development can use a sibling repo artifact, but production integration must pin an SDK package/tarball and contract version. Never move Morpheus-specific production roles/player tables into Tessera's core merely because the repos are adjacent.

## Agent handoff

Begin at `START_HERE.md` and the first ready `BACKLOG.md` packet. Read linked inputs, implement target paths, run acceptance tests and save evidence. Preserve this map by regenerating/updating it when specs change; update implementation path references separately from historical seed inventory.
