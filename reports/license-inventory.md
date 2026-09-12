# Software + dependency license inventory — T08

Compiled 2026-09-12 from `package.json` / `pnpm-lock.yaml` / installed
`node_modules` on `main` (T01 state). This report **presents** the decision;
it does not make one — license choice is the founder's approval gate (D12/D16,
[LICENSE_DECISION.md](../LICENSE_DECISION.md), [DECISIONS.md](../DECISIONS.md)).

## 1. Current repo state

| Item | State |
|---|---|
| `LICENSE` / `COPYING` file | **Absent** — correct per LICENSE_DECISION.md ("no license selected"). |
| Root `package.json` | `"private": true`, no `license` field. |
| `packages/types`, `packages/math` | `"private": true`, no `license` field; not published to npm. |
| `tests/math` | `"private": true`, no `license` field. |
| `LICENSE_DECISION.md` | Explicit decision notice: founder chooses visibility + license before publication; agents must not insert an irrevocable public license. |
| Source headers | No per-file license headers currently. |

So: nothing published, nothing licensed, nothing committed — clean slate.

## 2. License options for a spec + SDK + Solana program repo

| Option | What it permits | Key tradeoffs for this repo | Notes |
|---|---|---|---|
| **MIT** | Anything, attribution retained | Maximum adoption; no express patent grant; zero friction for integrators. Most common in the Solana/JS ecosystem (all our deps below are MIT or equivalent). | Weak protection against closed forks — acceptable for a protocol/public-goods play. |
| **Apache-2.0** | Anything, + express patent grant + trademark non-license clause | Slightly heavier text; patent retaliation clause matters if Tessera ever wants defensive patent posture. Standard for "serious" infra (Rust/Anchor ecosystem leans Apache-2.0). | Arguably the better default for a protocol others will implement; protects contributors AND users from patent claims on contributions. |
| **GPL-3.0 / AGPL-3.0** | Use requires derivative openness; AGPL extends to network use | Copyleft would force *Morpheus* (separate commercial-adjacent app) and any integrator to open derivative code — likely fatal to adoption; AGPL also imposes source-offer duties on hosted services. | Wrong tool for an adoption-seeking protocol; would also poison the SDK boundary. Listed for completeness, recommend-against by default. |
| **LGPL / MPL-2.0** | File-level or library-level copyleft | Middle ground; more complex compliance story for marginal benefit; MPL is file-scoped so SDK files stay open while apps stay closed. | Viable but unusual in this ecosystem; adds license-review friction. |
| **BUSL / source-available / proprietary** | Public source, restricted production use | Protects commercial runway; but contradicts the "independently verifiable, portable evidence, anyone can reimplement" posture that *is* the product's credibility. | Also not an OSI license — would undercut the "open protocol" pitch. |
| **Dual: spec/CC + code license** | Docs/specs under CC-BY or CC0, code under MIT/Apache | Lets standards bodies/implementers reuse spec text freely; Creative Commons explicitly advises *against* CC licenses for code. | Common pattern (e.g., IETF/W3C-style spec vs. code split). Worth considering since this repo is spec-first. |

**Decision-ready framing (no choice made):** the plausible serious candidates
are **MIT** (max adoption, simplest) and **Apache-2.0** (patent grant,
trademark clause, ecosystem-standard for protocol infra). Either is compatible
with every current dependency below. Copyleft and source-available options
exist but conflict with the stated public-goods/adoption strategy. Morpheus
may carry a different license (LICENSE_DECISION.md already says so).

## 3. Dependency license inventory (actual, as of 2026-09-12)

Method: parsed every `package.json` under `node_modules/.pnpm/` (pnpm 12.4.1
store) plus `pnpm-lock.yaml` importers. Result: **zero runtime dependencies** —
`@tessera/types` and `@tessera/math` depend only on each other. Every external
package is a dev/build/test tool. No copyleft, no GPL, no proprietary-licensed
dependency anywhere in the tree.

| Package | Version | License | Role |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | compiler (dev) |
| vitest | 3.2.7 | MIT | test runner (dev) |
| vite / vite-node | 7.3.6 / 3.2.4 | MIT | vitest engine |
| rollup | 4.63.1 (+ `@rollup/*` platform bins) | MIT | vite transitive |
| esbuild | 0.28.2 (+ `@esbuild/*` platform bins) | MIT | vite transitive |
| oxlint | 1.81.0 (+ `@oxlint/binding-*` bins) | MIT | linter (dev) |
| @types/node | 24.13.3 | MIT | types (dev) |
| @types/chai, @types/deep-eql, @types/estree | 5.2.3 / 4.0.2 / 1.0.9 | MIT | transitive types |
| chai | 5.3.3 | MIT | vitest assertion transitive |
| @vitest/* (expect, mocker, pretty-format, runner, snapshot, spy, utils) | 3.2.7 | MIT | vitest internals |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | transitive |
| assertion-error, check-error, deep-eql, loupe, pathval | various | MIT | chai transitive |
| cac, debug, ms | 6.7.14 / 4.4.3 / 2.1.3 | MIT | CLI/logging transitive |
| es-module-lexer, estree-walker, magic-string, js-tokens | various | MIT | bundler transitive |
| expect-type | 1.4.0 | Apache-2.0 | vitest transitive |
| fdir, picomatch, picocolors, tinyglobby | various | MIT / MIT / ISC / MIT | glob transitive |
| nanoid, postcss, source-map-js | 3.3.19 / 8.5.28 / 1.2.1 | MIT / MIT / BSD-3-Clause | vite transitive |
| pathe, siginfo, stackback, std-env, strip-literal, tinybench, tinyexec, tinypool, tinyrainbow, tinyspy, why-is-node-running | various | MIT / ISC / BSD | vitest transitive |
| undici-types | 7.18.2 | MIT | @types/node transitive |
| pnpm (configDep) | 12.4.1 | MIT | package manager itself |

`fsevents` (macOS optional, MIT) appears in the lockfile but is not installed
on Windows. Platform-specific binary packages (`@esbuild/*`, `@rollup/*`,
`@oxlint/binding-*`, `@pnpm/exe-*`) are all MIT-licensed platform artifacts;
only the win32 set is installed locally.

**Python tooling** (`tools/`): stdlib-only per `tools/README.md` and
`tools/requirements.txt` — no third-party packages, nothing to inventory.

**Consequence:** a MIT or Apache-2.0 repo license is fully compatible with the
current tree; even GPL would be (all deps permissive), though undesirable for
strategy reasons above. Nothing needs relicensing, replacing, or auditing for
copyleft today.

## 4. Forward watch-items (recheck when code lands)

- **Anchor / Solana crates** (T03): Anchor is Apache-2.0; `solana-program` and
  most Agave-derived crates are Apache-2.0 — compatible, but re-inventory the
  Rust `Cargo.lock` when the program exists.
- **`@solana/web3.js` / `@solana/kit`** (T04 SDK): Apache-2.0 — compatible.
- Any future **npm publish**: `private: true` must be flipped deliberately,
  `license` field added, files whitelist reviewed — all post-D16 actions.
- **Morpheus repo** may choose a different license; shared/ snapshots must
  remain license-compatible across both repos (they are byte-identical files —
  flag for the founder whether shared spec text gets its own grant).
- **Demo content** (voices, music, scripts) needs *asset* permissions, which
  are separate from the *software* license — tracked in the founder queue.

## 5. What this report does not do

- Does not choose a license (founder gate D16).
- Does not assess trademarks (see [naming-collision](naming-collision.md)).
- Does not cover `../Morpheus` dependencies (out of scope; that repo's
  inventory is its own task).
- License texts not vendored into the repo — nothing is added until decided.
