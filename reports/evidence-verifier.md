# Evidence verifier — `@tessera/evidence` + `tessera-evidence` CLI (T05)

Status date: 2026-09-13. Branch: `packet/t05`. Scope: `packages/evidence/**`,
`apps/cli/**`, `tests/evidence/**`. Evidence format: `evidence-bundle` v1
(`schemas/evidence-bundle.schema.json`, unchanged this packet).

This report describes what the verifier checks, what each outcome means, and
exactly what it does **not** prove.

## What a bundle is

A bundle is a `bundle.json` manifest plus payload members (ZIP archive or
extracted directory). The manifest lists every member as
`{ path, sha256, bytes, kind }`; kinds are
`record | intent | signature | statement | manifest | metadata | terms | artifact | report`.
Payload members are stored and exported as **exact original bytes** — the
writer never parses and reserializes metadata, terms, artifacts or signed wire
bytes, so recorded SHA-256 digests bind the same bytes a signer approved.

## Container safety

Reader and writer enforce, on both entry directions:

- path policy — relative only; no `..`, `.` or empty segments, no backslashes,
  no drive/UNC/absolute paths, no NULs, no Windows device names (`CON`, `nul`,
  `AUX`, `PRN`, `COM1–9`, `LPT1–9`), no trailing-dot/space segments; max 512
  chars; duplicate paths rejected case-sensitively and case-folded;
- archive policy — stored/deflate only; encrypted entries, unknown methods,
  zip64, symlink/device/unix-nonregular entries and data descriptors rejected;
  central-directory name must match the local header name; declared vs actual
  uncompressed sizes cross-checked; per-entry, total-uncompressed and
  compression-ratio caps reject zip bombs including streams that lie about
  their uncompressed size.

`inspect --extract` re-validates every member path and refuses to write
outside the target directory (zip-slip defense in depth).

## Verification checks (v1 bundles)

`verifyBundle` produces a structured `EvidenceVerificationReport` — never a
bare "verified". Check results: `pass | fail | warn | incomplete | skipped`.
Bundle status rolls up to `valid-offline | invalid | incomplete |
unsupported | unreadable` (see `report.ts` for exact semantics).

| Check | Meaning |
|---|---|
| `manifest.schema` | `bundle.json` parses as evidence-bundle v1 |
| `paths.safety` | every listed path passes the path policy |
| `container.inventory` | listed ⇄ present members match exactly; nothing unlisted, nothing missing |
| `payload.integrity` | every member's SHA-256 and byte count match the manifest |
| `records.schema` | `records/*.json` + `project.json` parse as NodeRecordV1/ProjectV1; filename ⇄ node_address binding |
| `records.scope` | all records share the leaf's genesis/program/project scope |
| `ancestry.reconstruct` | `economic_parent` walk leaf→root; cycle/depth checks; missing ancestor → `incomplete`, never `fail` (absent evidence is not forgery) |
| `economics.recompute` | residual-v1 recomputed over the chain with `@tessera/math` bigint ops; any recorded-field disagreement → `fail` |
| `project.consistency` | project record scope + `root_node` matches reconstructed root |
| `payout_table.frozen` | `verification/payout-table.json` equals the table rebuilt from records |
| `intents.digest` | `intent_digest` in each record recomputes from retained wire bytes via `encodeIntentV1` + `sha256Hex` |
| `signatures.intent` | Ed25519 detached signature verifies over each 32-byte intent digest |
| `statements.verify` | StatementV1 payloads verify; signature sidecars checked |
| `manifests.anchored` | every `RELEASE_ANCHOR` statement's `payload_sha256` matches an included `manifests/*.json` |
| `metadata/terms/artifacts.coverage` | declared digest members are present and match (missing → `incomplete`) |
| `references.resolve` | descriptive `references[]` addresses resolve to bundle members (cross-branch refs included when exported) |
| `chain.finality` | always `warn`/`skipped` offline — see below |
| `identity.rights` | always `warn` — signatures prove key approval, not legal identity/ownership/authorship |
| `limitations.recorded` | bundle declares its limitations; verifier adds its own |

`--rpc <url>` performs a **minimal read-only `getAccountInfo` probe** on the
leaf at `finalized` commitment: account exists and is owned by the claimed
program → `chain.rpc` pass; absent account or wrong owner → `fail`;
unreachable → `incomplete` and CLI exit 6. The report mode becomes
`online-assisted` and a limitation records the single-RPC trust assumption.
Program-binary/upgrade state and independent finality are **not**
implemented in T05.

## CLI

`apps/cli` (binary `tessera-evidence`):

```
inspect <bundle.zip|dir> [--json] [--extract <dir>]
verify  <bundle.zip|dir> [--json] [--rpc <url>]
export  --from-port <session-dir> [--out <path>] [--dir]
quote   <bundle.zip|dir> [--json] [--rpc <url>]
recover-known-project <bundle.zip|dir> [--json] [--out <dir>]
demo    --out <session-dir>
```

Exit codes: `0` ok · `1` usage · `2` invalid · `3` incomplete ·
`4` unsupported · `5` unreadable · `6` network failure.

`quote` reports estimated on-chain account bytes (documented docs/14
field-sum, pending T03's measured layout) plus the LAUNCH_BUDGET
legacy-parameter illustrative rent — explicitly **not** a live quote; with
`--rpc` it runs `getMinimumBalanceForRentExemption` for those estimated sizes.

`export --from-port` consumes a serialized local `TesseraPort` session
(`mode: 'local'` only — the only adapter that exists). Export embeds a
self-verification report and stamps the bundle's `limitations` with the local
port's own disclaimers.

`demo` writes a deterministic 5-node local session (throwaway keys, scripted
nonces) exercising root/branch/cross-branch-reference/release-anchor paths.

## Forward compatibility and honesty rules

- Unsupported `format_version` → `unsupported`, but members are still
  path-checked, integrity-checked and byte-exact exportable — unknown kinds
  and unknown-schema files are preserved, never silently dropped or "validated".
- A manifest claiming v1 with malformed structure is `invalid`, not
  `unsupported` — the distinction is tested.
- Missing ancestor/terms/artifact → `incomplete`; contradictory hashes,
  signatures or economics → `invalid`. Absence never upgrades to "valid" and
  never downgrades to "forged".
- Local-mode output never claims chain finality; the report prints it in the
  status line and the limitations block.

## Security posture

No secrets: exports contain no private keys (tested — PKCS8 blobs and demo
key material absent), no passwords, identity documents or private messages.
Public-export members are exactly the signed/public artifacts plus records
and manifests. Verifier and container code are Workers-safe (WebCrypto +
fflate, zero `node:*` imports in `packages/evidence/src`); `node:fs` exists
only in `apps/cli`.

## Test evidence (tests/evidence, 50 cases)

- happy path: valid-offline; local-port `verifyRelease` interop.
- tamper classes — payload bytes, manifest hash entry, manifest path,
  signature bytes (retargeted manifest), economic field, wrong intent
  digest, tampered release manifest → `invalid`/`fail` as appropriate.
- missing ancestor/terms → `incomplete`; unlisted member → inventory `fail`.
- unsupported version vs malformed-v1 distinguished.
- forward compat: unknown-format bundle members extractable byte-exact.
- ZIP attacks: `../`, absolute, drive-letter, backslash, NUL, reserved names,
  trailing dot/space, case-fold duplicates, symlink/device entries,
  encrypted/unknown methods, zip64, truncation, declared-vs-actual size lies,
  compression-ratio and size caps, 512-char path boundary.
- restore exercise: bundle-only reconstruction in a fresh process in a temp
  dir (built dist only) reproduces the exact payout table — see
  `reports/recovery-rehearsal.md`.
- CLI e2e incl. `quote` labels and `--rpc` network-failure exit; RPC mock
  suite covers absent-account/wrong-owner/matching-owner/unreachable.

## Non-goals (explicit)

No chain finality; no program-binary/upgrade verification; no legal
identity/ownership/authorship determination; no Morpheus coupling; no
`preview`/`recover-index`/`submit` commands from docs/08 (future packets).
