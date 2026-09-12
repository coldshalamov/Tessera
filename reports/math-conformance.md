# Math conformance report — T01

**Scope.** `packages/types` + `packages/math` are a TypeScript reference
implementation of the Tessera economic model (`residual-v1`) and portable
record/wire types. This is **not** a deployed Solana program, not a live money
router, and the bundled `LocalTesseraPort` simulator does not produce chain
finality or chain evidence — it reports `mode: 'local'` and
`finality: 'local'` on every record it emits.

## Commands and exact results

Run at the repository root on Windows (Node v24.15.0, pnpm 12.4.1), branch
`packet/t01`:

| Command | Result |
|---|---|
| `pnpm -r build` | exit 0 — `tsc` emitted `dist/` for `@tessera/types` and `@tessera/math` |
| `pnpm -r test` | exit 0 — Vitest 3.2.7: **5 files, 169 tests, 169 passed, 0 failed** (~3 s) |
| `pnpm typecheck` | exit 0 — `tsc --noEmit` for all three workspace projects (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| `pnpm lint` | exit 0 — oxlint: 0 warnings, 0 errors, 21 files, 100 rules |

Reference implementation cross-check (unchanged seed file):

- `python tools/reference_economics.py --self-test` → passed
  (8 fixed nodes, 6 fixed settlements, 5 invalid-append cases,
  2500 random paths / 80971 steps / 2488 allocations).

## Test inventory (tests/math, 169 tests)

| File | Tests | Covers |
|---|---|---|
| `src/vectors.test.ts` | 54 | Every node/settlement/invalid-append case in **both** `shared/economic-vectors.json` and `fixtures/economics.json` (byte-identical, SHA-256 `c40f789a…f85ee2`; the test asserts the copies match). Exact field equality, no tolerances. |
| `src/properties.test.ts` | 5 | Seeded PRNG runs: seed `20260911` × 2500 paths, seeds `1`, `42`, `3735928559` × 500 paths each; plus 500 random `path()` claim lists. Residual conservation (`Σ effective + residual == U`), money conservation, per-beneficiary near-exactness, split-weight aggregation, input-order independence. |
| `src/rejections.test.ts` | 41 | Claim bounds (0, 10000 valid; 10001/negative/huge rejected), residual bounds, `CLAIM_ROUNDS_TO_ZERO`, `BRANCH_CAPACITY_EXHAUSTED`, u64/u128/overflow guards, `ZERO_ISSUED` settlement rejection, malformed keys, cross-network/program/project parents, depth > 1024, non-integer input hygiene. |
| `src/types.test.ts` | 43 | IntentV1 golden fixture: encodes to the exact published 348 bytes (`fixtures/intent-v1.json`, digest `17ec8005…5cc93d`); shipped Ed25519 signature verifies and a tampered signature is rejected; UTF-8 byte bounds, control/bidi rejection, reference count 0–8, custody/statement enums, NodeRecordV1 and evidence-bundle validators. |
| `src/local-port.test.ts` | 26 | `LocalTesseraPort`: `mode: 'local'`, in-memory projects/nodes, prepare→sign→submit flow, idempotency by intent hash, settlement preview, node/payout lookup, evidence export+verify round-trip, sibling isolation, descendant pinning (earlier payouts unchanged by later children). |

## Determinism rules verified

- `bigint` only; no `number`/float anywhere in rights or money paths.
- `effective = floor(residual_in × claim_bps / 10_000)`;
  `residual_out = residual_in − effective`; `issued = U − residual_out`.
- Largest-remainder allocation: weights aggregated per beneficiary **before**
  rounding; remainder dust assigned by descending remainder, ties by ascending
  raw beneficiary-key bytes (`hexTestKeyToBytes` for 64-hex test keys,
  `base58` decoding for production public keys).
- Zero-issued branches store `0/0` payouts and reject settlement previews with
  `ZERO_ISSUED` — never a founder fallback.
- Payouts of already-issued nodes are pinned: appending a descendant can only
  reduce the parent's *unallocated residual*, never mutate stored
  `payout_numerator`/`payout_denominator` of existing nodes (sibling-isolation
  and descendant-pinning tests prove this).

## Deviations / notes

- The task text referenced `tools/economic-vectors.json`; that file does not
  exist in the seed. The authoritative identical copies
  `shared/economic-vectors.json` and `fixtures/economics.json` were used and
  both are executed.
- `docs/` did not define an explicit metadata-size bound; none was invented.
  Implemented bounds come only from the schemas/specs (name 1–64 UTF-8 bytes,
  title 0–96, references ≤ 8, schema id ≤ 256 chars, bundle path ≤ 512 chars,
  bundle files ≤ 10 000).
