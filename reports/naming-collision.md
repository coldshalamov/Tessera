# Name-collision report: "Tessera" and "Morpheus" — T08

Compiled 2026-09-12. Sources were fetched live where marked; anything else is
flagged **unverified**. This is a knockout-search-style risk flag for a founder
decision (approval gate **D16**, [DECISIONS.md](../DECISIONS.md)) — **not** a
trademark opinion, not a clearance, and not a rename. The founder has chosen
both names (D02); nothing here changes that without their call.

## "Tessera" — collisions

| Use | What it is | Status (2026-09-12) | Collision severity |
|---|---|---|---|
| **ConsenSys Tessera** [S39] | Java privacy manager for ConsenSys Quorum / enterprise Ethereum networks — a real, well-known piece of blockchain infrastructure. | GitHub repo `Consensys-Incorporated/tessera` **archived read-only Jun 1, 2026** (https://github.com/ConsenSys/tessera, fetched 2026-09-12). 195★, 107 forks, 7,377 commits. | **High for namespace, medium for trademark.** Same industry (blockchain infra). Archived ≠ abandoned trademark — ConsenSys still publishes the "Tessera" product name. A Solana protocol called "Tessera" will be permanently confused in search/GitHub/docs results. |
| **tessera.pe "Tessera"** [S40] | Decentralized private-markets platform issuing "T-Tokens" (tokenized private-equity exposure) — **on Solana**, trading on Meteora/Jupiter, Chainlink PoR + Fireblocks custody per docs. | Docs site live 2026-09-12 (https://docs.tessera.pe/). Activity level unverified. | **Highest.** Same chain, same crypto-adjacent audience, same exact name. Any "Tessera on Solana" search collides directly; their ToS/financial product also creates regulatory-adjacency risk (loan-participation tokens vs. our tokenless design — easy to conflate). |
| **Tessera (ex-Fractional.art)** | NFT collective-ownership protocol; Fractional.art rebranded to Tessera, Aug 2022, $20M Paradigm round. | Rebrand announced Aug 2022 (https://medium.com/tessera-nft/announcing-tessera-6cc66d92a6a6; CoinDesk/Decrypt/Fortune coverage same date). Current status unverified — the front-end was being wound down as of the rebrand posts. | **Medium.** Another crypto "Tessera" in the ownership-token space; dormant brands still occupy the namespace and Medium/Twitter handles. |
| **npm `tessera`** | Tilelive-based map-tile server (mojodna), BSD-2-Clause, latest 0.15.5. | npm registry fetched 2026-09-12 (https://registry.npmjs.org/tessera). | **Low-medium.** The bare name `tessera` is taken on npm; we'd need a scope (`@tessera-*` — our packages already use `@tessera/types`, `@tessera/math` privately) or a different registry name at publish time. |
| **Tessera Technologies** | Semiconductor IP licensing company; renamed **Xperi** in 2017. | Not re-fetched this session — **unverified**, historical. | **Low.** Renamed away years ago, different field. |
| Dictionary meaning | Latin/Greek: a mosaic tile; also a token/ticket. | — | Neutral-positive connotation; the reason the name is crowded. |

**Tessera bottom line:** at least **three distinct blockchain products** have
used or use the name, two of them currently visible and one on the *same chain*.
This does not make the name unusable, but bare "Tessera" alone will never be
searchably unique in crypto contexts.

## "Morpheus" — collisions

| Use | What it is | Status (2026-09-12) | Collision severity |
|---|---|---|---|
| **HPE Morpheus (Morpheus Data)** | Hybrid-cloud management/orchestration platform ("HPE Morpheus Enterprise Software", "Morpheus VM Essentials"). | morpheusdata.com live and actively marketed under HPE branding (fetched 2026-09-12, https://www.morpheusdata.com/). | **High.** A large enterprise software product with an active trademark owner (HPE) — and it is *software*, our product category. |
| **Morpheus (MOR token)** | Decentralized AI network, "Smart Agents," MOR token on Arbitrum; anonymous-authored whitepaper Sep 2023, token live May 2024. | mor.org + github.com/MorpheusAIs/Morpheus active (fetched 2026-09-12). | **High.** An *active* crypto project named Morpheus with a token — exactly the namespace where Morpheus-app users would encounter it. |
| **Morpheus.Network (MNW)** | Supply-chain middleware blockchain platform, MNW token. | Not re-fetched this session — **unverified** (widely documented historically). | **Medium.** Third crypto "Morpheus." |
| **npm `morpheus`** | "A Brilliant Animator" — JS animation library (ded), latest 0.7.2. | npm registry fetched 2026-09-12 (https://registry.npmjs.org/morpheus). | **Low.** Bare npm name taken. |
| **MorpheuS (academic)** | ML music-generation system, Herremans/Chew, IEEE publications 2016–2017. | Fetched 2026-09-12 (https://dorienherremans.com/morpheus/index.html). | **Medium** — small project, but it's literally *music generation*, adjacent to an audio-drama product. |
| **Cultural** | Neil Gaiman's *Sandman* protagonist (ongoing Netflix adaptation); *The Matrix* character; Morpheus P2P file-sharing app (2000s, StreamCast); Morpheus photo-morphing software. | Common knowledge; entertainment marks are Warner/Netflix properties. | **Low-medium.** Cultural references don't bar use, but "Morpheus" is far from a clean slate — and a Sandman association for a *fiction audio* app is a double-edged sword. |

**Morpheus bottom line:** an active HPE enterprise product, an active crypto
token network, and an academic music-AI system. Arguably a *denser* namespace
than Tessera in absolute terms, though none of the big collisions sits directly
in "collaborative audio drama."

## Options for the founder (decision, not made here)

1. **Keep both names, always qualified.** Cheapest path. Convention: public
   material says "Tessera Protocol" / "the Tessera network" and "Morpheus, a
   collaborative audio-drama app built on Tessera" — never bare "Tessera" alone
   in headings, package names or domains. Package registries already need
   scoped names anyway (`@tessera/*` is what we use internally; public publish
   names TBD at D16).
2. **Prefix/house-name approach.** E.g., a foundation/entity name carrying the
   brand ("Tessera Protocol Foundation"-style qualifier) with product marks
   underneath. Keeps the chosen names while creating a registrable distinct
   mark.
3. **Rename one or both.** Highest cost now (docs, code, schemas, shared
   contract snapshots, Morpheus cross-repo references), lowest long-term
   collision risk. Reasonable *only* before public brand spend — after launch
   it becomes much more expensive.

## Recommended safest low-cost path

- **Do not buy or register anything yet** (no domains, no trademark filings) —
  that is a spending/founder gate, and per AGENTS.md nothing may be purchased.
- **Adopt option 1 conventions immediately** in all T08+ writing: qualified
  names only. Cost: zero; reduces confusion even if names are kept forever.
- **Commission a real trademark knockout search** (USPTO TESS + counsel) before
  any domain/logo/incubator-material brand spend. Estimated effort is small;
  it is the correct sequencing — this report is the flag, not the search.
- **Do not silently rename** in any repo: the name is founder-chosen (D02) and
  renaming is itself a D16 decision. If renamed later, do it once, before
  public artifacts exist.

## Claim hygiene (applies everywhere)

- Never write "the Tessera" (reads as the ConsenSys or .pe product); use
  "Tessera Protocol" or "this protocol."
- Do not claim either name is "available," "cleared," or "unique" — this
  report documents the opposite.
- Search-facing docs should disambiguate on first mention ("not affiliated
  with ConsenSys Tessera / tessera.pe / HPE Morpheus" is premature *until* the
  founder confirms positioning, but the collision list above is the evidence
  base for that decision).
