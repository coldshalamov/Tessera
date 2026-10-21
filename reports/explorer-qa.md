# Explorer QA — `apps/explorer` (T06)

## 2026-10-20 extension

Current extension on `codex/explorer-economic-preview`: interactive economic map,
exact hypothetical-descendant claim comparison, and settlement results bound to
the amount and immutable version used to calculate them. Valid offline evidence
and complete ancestry are required for the new preview. No record is submitted.

Validation: 35 focused tests passed; production build, workspace types and lint
passed; all 9 distinct Chromium cases passed across the full run (8 pass, 1 test
locator failure) and corrected focused rerun (2 pass). Full commands/failure
history are in WORK_LOG Session 10. No relevant page errors or warnings occurred
in the new interaction. The exported ZIP remained byte-for-byte identical after
graph/claim interactions.

Regular Playwright was used because Browser plugin is not available. Environment:
`http://localhost:4817`, production Vite preview, desktop and 320px viewport. Manual
screenshot inspection confirms the map and comparison render coherently; mobile
wide tables/map scroll inside their own regions. Current screenshots are in
`C:/Users/93rob/.codex/visualizations/2026/10/21/01a15c88-0396-7921-9119-8988e3b4d981/`.

Corrections to the historical report below: a visual graph and arithmetic preview
now exist; live RPC/signing do not. The stems example is audio-domain, despite
having no real audio payloads. A separate non-audio example remains required for
cross-repo acceptance. Browser emulation is not physical-device or production QA.

## Historical T06 report

Status date: 2026-09-13. Branch: `packet/t06`. Scope: `apps/explorer/**`,
`tests/explorer/**`, `apps/explorer/e2e/**`. Consumed read-only:
`packages/{types,math,evidence}` source. Shared surfaces
(`docs/`, `schemas/`, `shared/`, `fixtures/`, `Morpheus`) untouched.

## What the explorer is

A compact, read-only Vite+React+TypeScript viewer for Tessera evidence. Two
input paths, both through `packages/evidence` readers: a bundle file
(`.zip`, or a lone `bundle.json` for an honest manifest-only view) and a
node-address lookup scoped to the loaded data. A bundled "music stems"
local-demo button exercises the whole path in-tab.

There is deliberately **no RPC/network input** in T06 — a bare node address
is only resolvable against user-supplied bytes, and every label says so. No
wallet UI, no tickers, no Morpheus concepts, no ownership certification.

## Mode labels (honest states)

| Source | Badge |
|---|---|
| nothing loaded | `NO DATA — local demo or offline bundle only` |
| in-app demo | `LOCAL DEMO — simulated records · nothing was sent to any network` |
| dropped `.zip` | `OFFLINE BUNDLE — <mode> records · no live network query` |
| lone `bundle.json` | `MANIFEST ONLY — payload bytes absent · incomplete by definition` |

`<mode>` is the bundle's own recorded label (read from its frozen payout
table), never upgraded to a chain claim. The `chain.finality` check is a
permanent WARN offline; `identity.rights` is a permanent WARN. Banned
phrasing ("copyright verified", "court-proof", "permanent forever", "paid",
"finalized on") is asserted absent from the rendered DOM in tests.

## Panels

- **Chain context** — genesis hash, program id, project address, project
  title, economic rule, extension policy, claimed mode label, exporter,
  record count, declared selected leaf. Keys/hashes render abbreviated with
  click-to-copy revealing the full value.
- **Project nodes** — the whole bundle as an ARIA `tree` (roving tabindex,
  ↑/↓/→/←/Home/End, Enter/Space selects). Every node is inspectable without
  any canvas/graph interaction. Selected-chain and bundle-leaf tags.
- **Selected version** — name (self-chosen, labeled as such), contributor
  key, parent, claim bps, residual in→out, effective units, issued total,
  as-is exact ratio, depth, custody mode, declared/observed times, digests,
  descriptive references, and the clickable economic-ancestor list.
- **As-is payout** — table of contribution / beneficiary / claim / effective
  units / exact `numerator/denominator` / display-only percentage; the
  denominator is the selected version's issued total and the whole table
  re-denominates on selection change. Nodes recorded in the bundle but
  outside the selected chain are named as earning nothing from this version.
- **Settlement preview** — hypothetical minor-unit split via
  `allocateMinorUnits` (the same largest-remainder allocation the port
  uses), grouped by beneficiary before rounding, with an explicit
  conservation check line. Labeled a calculation, not a payment.
- **Verification** — the real `verifyBundle` report: status roll-up
  (`VALID — OFFLINE CHECKS ONLY` / `INVALID` / `INCOMPLETE` /
  `UNSUPPORTED FORMAT` / `UNREADABLE`), per-check badges with
  plain-language explanations, and the bundle's declared limitations.
- **Export** — re-download of the exact loaded bundle bytes and the
  verification report JSON. Environments without object-URL support get an
  honest "download unavailable" notice rather than a silent no-op.

## Demo dataset — "Night Circuit" stem collaboration (non-audio)

Five signed contributions proving app-agnosticism (stem-session vocabulary,
`tessera.demo.stems/1` metadata schema — nothing Morpheus- or drama-shaped):

```
mira  Composition seed + guide mix      2,000 bps   (root)
ken   Drum stem — 606 groove            3,000 bps   ┐ sibling branches
luz   Bass stem — sub line              2,500 bps   ┘ off the root
aya   Melody stem — lead over drums     1,500 bps   (child of drums)
ren   Mix v2 — stems arrangement        1,000 bps   (child of melody;
                                                   references bass
                                                   cross-branch)
```

Selected leaf (Mix v2) denominates payouts at its 571,600,000,000 issued
total; the sibling bass stem earns nothing from that version and the UI says
so explicitly. Selecting the bass version re-denominates to 400,000,000,000.
Throwaway seed-derived keys, `user_controlled` custody labels, fixture-only
terms/artifacts, local simulated mode, one RELEASE_ANCHOR statement binding
a demo release manifest. Built and exported through the real
`createLocalTesseraPort` + `buildBundle` + `bundleToZip` path each run.

## Bugs found by the tests (pre-existing scaffold, fixed this session)

The component suite was authored to fail on broken behavior; it caught two
real bugs in the inherited scaffold, verified failing before the fix:

1. **Nested treeitem click selected the topmost ancestor.** Treeitems nest
   inside ancestor `<li>` elements; a click on a child bubbled through every
   ancestor's `onClick`, so the outermost handler won — clicking "Bass stem"
   selected the root. Fixed with `stopPropagation`; real-browser regression
   coverage in `e2e/smoke.spec.ts` ("clicking a nested treeitem selects
   THAT version").
2. **Settlement preview always failed.** `allocateMinorUnits`' strict
   `integer()` guard rejects string operands (parity with the Python
   reference); the scaffold passed the decimal string for amount and
   weights. `settlementPreview` now validates the digit string and converts
   to bigint for both. Additionally, the input's `pattern="[0-9]*"` made
   browsers block malformed submission natively before the app's honest
   `INVALID_AMOUNT` message could render — `pattern` removed (inputMode
   hint kept), so the explicit error path is reachable and tested.
3. **Roving-focus state could lag real focus.** `keyDown` now resolves the
   event's actual target treeitem first (keydown always targets the focused
   element), falling back to roving state; `onFocus` keeps the state in sync
   (guarded against focusin bubbling from descendant treeitems).

## Test evidence

`tests/explorer` — **24 Vitest cases** (jsdom, real crypto via Node
webcrypto, zero mocks of the integration under test):

- demo load: 5 treeitems, sibling branch, mode/context labels.
- payout table: exact ratios `x/571600000000`; re-denomination to
  `x/400000000000` on version change incl. URL hash tracking; root → single
  100% row; outside-chain naming.
- settlement: DOM rows equal the library's own `allocateMinorUnits` output
  and conserve the input; malformed amounts rejected honestly; model-level
  coverage of non-digit/empty/negative/exponent input and the
  i64-boundary rejection.
- verification panel: per-check labels, WARN non-claims, banned-phrase
  scan over the whole DOM.
- keyboard: focus/ArrowDown/Enter select path; pasted-address lookup with
  honest "not present" miss.
- file input: real zip load; lone manifest → `MANIFEST ONLY` + INCOMPLETE +
  zero-record honest view; non-bundle rejection; tampered record →
  INVALID + `payload.integrity` FAIL.
- model: loader error paths, tree grouping/flatten order, null for unknown
  address, manifest-only semantics.

`apps/explorer/e2e` — **7 Playwright cases** (`@playwright/test` 1.63.0,
Chromium 153 headless shell, against `vite preview` of the production
bundle — not part of `pnpm -r test` so browserless CI stays green;
`pnpm --filter @tessera/explorer test:e2e` to run):

- demo loads with honest labels + exact denominator in a real browser;
- nested-treeitem click regression (the bug above) in a real browser;
- keyboard-only walk of all five nodes + Enter selection;
- bundle bytes round-tripped through the real file-picker path;
- 320×800 viewport: no horizontal scrolling (`scrollX` stays 0,
  `documentElement.scrollWidth ≤ 320`), payout table still reachable via
  its own scroll region;
- `prefers-reduced-motion: reduce` emulation keeps full function;
- screenshots: `e2e/artifacts/explorer-desktop.png` (1280×900) and
  `e2e/artifacts/explorer-320px.png` (320×800, full page) — committed.

## Commands and verbatim results

- `pnpm install` — clean (11 workspace projects).
- `pnpm -r build` — exit 0; `vite build` → `dist/index.html` 0.61 kB,
  CSS 6.52 kB, JS 344.20 kB (gzip 108.32 kB).
- `pnpm -r test` — exit 0: tests/math 169/169, tests/signatures 110/110,
  tests/evidence 50/50, **tests/explorer 24/24**.
- `pnpm -r typecheck` — exit 0 across 10 projects.
- `pnpm lint` — `Found 0 warnings and 0 errors. ... 82 files`.
- `pnpm exec playwright install chromium` — downloaded
  chromium/headless-shell 1243 (cache had only ≤1234).
- `pnpm --filter @tessera/explorer test:e2e` — `7 passed (12.6s)`.
  (webServer pinned to `http://localhost:4817`; vite preview binds IPv6
  loopback on this Windows host — `127.0.0.1` refuses.)

## Acceptance-criteria mapping (packet T06)

- claim / effective units / as-is payout distinguished per row — ✅ tested.
- selecting another version updates the ancestor denominator — ✅ tested
  (571.6e9 → 400e9 → 200e9) in jsdom and Chromium.
- every node inspectable without graph dragging — ✅ ARIA tree + keyboard +
  address input.
- invalid/incomplete/offline states honest — ✅ tampered → INVALID,
  manifest-only → INCOMPLETE, non-bundle → error, all offline-labeled.
- no ownership-certified/permanent-devnet badge — ✅ banned-phrase DOM scan.
- non-audio demo ≥4 nodes, non-100% claims — ✅ five-node stems dataset,
  2,000–3,000 bps claims, sibling branch.
- export download — ✅ bundle + report; honest unavailable state.

## Known limitations (explicit non-goals)

- No live RPC/network source — node lookup only scopes the loaded bundle;
  a miss says a network source is not built rather than pretending.
- No progressive/rendered-graph layer; imports are bounded by the bundle
  reader's caps (256 MiB/member, 1 GiB total, 10,000 entries).
- No `preview`/`submit` flows — read-only by design.
- `vite preview`/`pnpm -r test` cover the demo path only; live-bundle UX
  against T04 adapters arrives with that packet.
