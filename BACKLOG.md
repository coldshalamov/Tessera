# Implementation backlog

All tasks start PLANNED. These packets are execution briefs, not evidence that application code has already been built. Task order reflects dependencies; independent lanes may proceed in parallel with stable contracts. Track real tests/commits in `status/WORK_LOG.md`.

| Packet | Outcome | State | Dependencies |
|---|---|---|---|
| [T01](packets/T01.md) | Deterministic economics and portable types | DONE | Evidence: `reports/math-conformance.md`, WORK_LOG Session 3, `packet/t01` commit. TypeScript reference implementation only — no deployed program or live money router. |
| [T02](packets/T02.md) | Identity, intent signing and exportable consent | DONE | Evidence: `reports/identity-spike.md`, `tests/signatures` (110 tests), `tests/signatures/vectors/` golden vectors, WORK_LOG Session 4, `packet/t02` commit. `packages/identity` + wire decoders; provider integration remains an approval gate (untested, unconfigured). |
| [T03](packets/T03.md) | Solana program, constraints and measured footprint | DONE | Evidence: `reports/program-footprint.md`, `programs/tessera` Anchor program (initialize_deployment, create_project, publish_root, append_contribution; OPEN + REVIEWED policies), 18/18 LiteSVM instruction tests + live solana-test-validator e2e, `generated/idl/tessera.json`, `generated/vectors/account-layout-v1.json`, WORK_LOG Session 6, `packet/t03` commit. Localnet only — no devnet/mainnet deployment. publish_statement deferred (layout committed). |
| [T04](packets/T04.md) | SDK, sponsor relayer and finality reconciliation | PLANNED | T01–T03 interfaces and local program available; IdentityPort consent/sign/export flow is the SDK's signing boundary (T02 DONE). |
| [T05](packets/T05.md) | Independent evidence export, verifier and recovery | DONE | Evidence: `reports/evidence-verifier.md`, `reports/recovery-rehearsal.md`, WORK_LOG Session 7, `packet/t05` commit. Bundle writer/reader, strict ZIP safety, 21-check structured verifier, local-port export, CLI (`inspect/verify/export/quote/recover-known-project/demo`), bundle-only restore test. Local mode only; live-network export arrives with T04. |
| [T06](packets/T06.md) | Generic explorer and non-audio demonstration | PLANNED | T01 fixtures; T04/T05 live reads/verification progressively integrated. |
| [T07](packets/T07.md) | Program/key/sponsor security hardening | PLANNED | T03–T05 integrated enough to attack. |
| [T08](packets/T08.md) | Prior art, licensing and legal-evidence documentation | DONE | Evidence: `reports/prior-art-matrix.md`, `reports/naming-collision.md`, `reports/license-inventory.md`, `reports/claim-wording.md`, `reports/founder-legal-queue.md`; WORK_LOG Session 4; `packet/t08` commit. Live primary sources verified 2026-09-12. Naming/license decisions remain founder gates (D16) — nothing renamed or licensed. |
| [T09](packets/T09.md) | Deployment, cost quotation and bounded mainnet readiness | PLANNED | T03 footprint, T04 SDK, T05 recovery, T07 review; founder approval for live actions. |
| [T10](packets/T10.md) | Cross-repo acceptance and incubator demonstration | PLANNED | T01–T06 functional; coordinate with M11/M12; T07–T09 determine launch level. |

## Parallel development and critical path

Pure economics/types and prior-art/legal review can start immediately. Signing/codecs and the program converge on one wire contract. SDK and export unblock Morpheus publication and portability. Explorer can develop against vectors. Security/cost/deployment gates precede mainnet, but are not prerequisites for local/devnet product learning.

## Future backlog, not hidden MVP dependencies

Economic merges and transfers; organizational recovery/multisig; optional payout contracts; independent mirrors/compressed records; standards mappings; additional SDK languages. Each requires a new specification/threat model and compatibility plan before code.

## Status vocabulary

PLANNED → IN_PROGRESS → REVIEW → DONE. BLOCKED records a specific missing external dependency, not “task too hard.” A partially implemented packet remains IN_PROGRESS with saved useful work. Mainnet/live-payment readiness is recorded separately from code completion. No task can infer founder consent from a checkbox.
