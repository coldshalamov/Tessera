# Prior-art comparison matrix — T08

Compiled 2026-09-12 (packet T08). Every external claim below cites a primary
source fetched on that date; where a page could not be fetched this session it
is marked **unverified**. This is a feature/mismatch comparison for engineering
and positioning — it is **not** a patent search, trademark clearance, novelty
opinion, or legal advice. Sources already registered in
[shared/RESEARCH_SOURCES.md](../shared/RESEARCH_SOURCES.md) are cited as `[Snn]`.

Tessera's actual claim being compared: a single-parent **residual version tree**
— each published contribution is a signed record that consumes `claim_bps` of
its parent's *remaining* capacity (`effective = floor(residual_in × claim_bps /
10_000)`), leaving `residual_out` for the subtree, with normalized as-is payout
ratios derivable along an economic path by any independent verifier. No token,
no custody of funds, no license registry. See
[docs/01](../docs/01_ECONOMIC_MODEL.md), [docs/02](../docs/02_STATE_AND_CONSENT.md).

## Comparator inventory

### 1. Generic timestamping / attestation

| | What it does | What it does not do | Tessera difference | What they do better |
|---|---|---|---|---|
| **OpenTimestamps** | Standard `.ots` proof format binding a data digest to a Bitcoin block via calendar servers; free, no registration; open-source clients in Python/JS/Java/Rust. Verified 2026-09-12: https://opentimestamps.org/ | No identity, consent, economics, licensing, or version structure. A timestamp proves data existed before a time — nothing else (their own FAQ framing). | Tessera records are *economic*: parent link, signed claim, derived payout units and terms digest, not just existence. | Mature, chain-agnostic proof format; near-zero marginal cost; 8+ years of deployed use. Tessera could embed OTS-style receipts as auxiliary evidence rather than competing. |
| **OriginStamp → OriginVault** | Commercial timestamping has pivoted: the public site (fetched 2026-09-12, https://originstamp.com/) now sells **OriginVault**, an AI-indexed e-archive with blockchain seals, GoBD/GeBüV compliance positioning, SCION networking — aimed at ERP/healthcare/public-sector archiving. | No open protocol surface for contribution trees; product is a closed enterprise archive. Timestamp API still referenced as a feature, not a creator-economics primitive. | Tessera is an open record format + small Solana program, not an enterprise archive. | Regulatory archiving depth (GoBD, retention/delete policies, audit trails) far beyond anything Tessera should build. Relevant mainly as proof that "timestamp product" alone is a commodity. |
| **Solana Attestation Service (SAS)** | Generic on-chain attestations on Solana: issuer creates schemas, issues attestations to holders, verifiers check them [S20,S21]. Fetched 2026-09-12 (https://attest.solana.com/): positioned as "decentralized credential system" — KYC, professional badges, compliance; used by Civic, SumSub, Range, etc. | Schema storage does not enforce residual allocation, parent economics or normalized payout math — confirmed in docs/12. It attests *that* an issuer said something. | Tessera's program validates a state transition (claim consumes residual capacity), not just stores an attestation. | Same chain, already audited-adjacent, cheap PDAs, SDK examples. Genuine reuse candidate for auxiliary attestations (e.g., KYC-issuer signals, dispute flags) — not for the economic core. |

### 2. Programmable IP / derivative licensing

| | What it does | What it does not do | Tessera difference | What they do better |
|---|---|---|---|---|
| **Story Protocol → The DATA Foundation** | **Major change found 2026-09-12:** Story has rebranded to "The DATA Foundation"; $IP → $DATA; docs moved to https://docs.datafdn.org/. Now positioned as an AI-training-data network (Kled/Trace/Poseidon apps). Still ships: own EVM-compatible L1; IP Assets; Licensing Module; **PIL** — a real off-chain legal license text whose parameters (`commercialUse`, `mintingFee`, `derivativesAttribution`, …) map on-chain (https://docs.datafdn.org/concepts/programmable-ip-license, fetched 2026-09-12). | The pivot to AI data licensing means the "general creative-IP graph" product Story originally marketed is no longer the center of gravity. PIL is a license-granting framework *from an IP owner*, not a contributor revenue-residual tree; on-chain terms assume a licensor who already holds rights. | Tessera has no license templates, no token, no L1 — it records negotiated per-version claims against remaining capacity and portable evidence. Smaller claim, smaller attack surface. | They wrote an actual legal document reviewed by counsel; they have funding, a live mainnet, trademarked ecosystem. If the project ever needs on-chain *licensing* (not just economics), PIL is the prior art to study, not re-invent. |
| **KOR Protocol / Korus** | On-chain clearinghouse for creative assets on Base (EVM L2), stablecoin-native: Verify Engine (origin/ownership attestation graph), Route Engine (agents matching IP to demand), settlement with programmatic splits; IP Assets hold ERC-6551 token-bound wallets; Korus music-remix product (Pixelynx/mau5trap lineage). Sources fetched 2026-09-12: https://korprotocol.io/, https://techdocs.korprotocol.io/; funding coverage https://www.theblock.co/news/deals/2026-07-07-1kx-blockchain-capital-7-5-million-kor-protocol-series-a-100-million-valuation-407465 | Clearinghouse model presumes registered assets and platform-mediated demand; splits are per-asset payment routing, not a residual version tree where each descendant's claim bounds the whole subtree's remainder. Nearest functional neighbor to "remix economics" but still token/$KOR-coupled. | Tessera's denominator semantics: every child claim is carved from the *parent's residual*, so the entire ancestry is needed to compute a payout — KOR splits don't encode that capacity constraint. | Vertical music-industry integration (licensed stems, Beatport/mau5trap catalogs), an actual shipping consumer remix product, agent routing — the adoption layer Tessera explicitly declines to build. |

### 3. Fixed-split / royalty systems

| | What it does | What it does not do | Tessera difference | What they do better |
|---|---|---|---|---|
| **Splits (0xSplits)** | Non-custodial EVM contracts distributing incoming funds to recipients "by fixed ownership shares"; plus Waterfall (priority tranches), Swapper; now a broader treasury product ($400m+ volume claimed on site). Fetched 2026-09-12: https://splits.org/ | Splits a *payment stream* among a fixed recipient list. No version ancestry: a Split has no concept of "this work derives from that contribution," no consent record, no artifact digest. | Tessera doesn't move money at all — it records how a *future* receipt would divide across an economic path. Splits could even be the downstream rail executing a Tessera-derived table. | Battle-tested money movement, multi-chain deployment, real volume. Actually handling funds is a feature Tessera deliberately excludes — they are strictly better at it. |
| **Metaplex Token Metadata creators/shares** | Solana NFT metadata: creator list with `verified` flag and `share` field "used by marketplaces to distribute royalties"; pNFTs enforce transfer rules. Fetched 2026-09-12: https://developers.metaplex.com/token-metadata (notably now labeled a legacy program; Core is recommended for new projects). | A per-asset sale-royalty list. No derivation tree: a remixed NFT's creator list is flat metadata, not claims against a parent's residual. Royalty enforcement historically depended on marketplace cooperation. | Tessera's claim is scoped to *one economic parent* and bounded by remaining capacity — a different denominator semantic than "creator X gets Y% of sale price." | Massive installed base, tooling (umi/kit), marketplace integration, editions/printing primitives. For "NFT of the finished release," Metaplex is the obvious rail; Tessera is the lineage ledger underneath it. |

### 4. Provenance standards (interoperability targets, not competitors)

| | What it does | What it does not do | Tessera difference | What they do better |
|---|---|---|---|---|
| **W3C PROV** | Formal provenance data model family (PROV-DM/O/N/CONSTRAINTS, 2013 Recommendations) — entities, activities, agents, derivation relations [S22]. Fetched 2026-09-12: https://www.w3.org/TR/prov-overview/ | Vocabulary only — no economics, signatures, enforcement or persistence guarantees. | Tessera records map naturally onto PROV (`wasDerivedFrom` for parent links, `wasAttributedTo` for contributor keys) — an **export mapping**, not a re-invention. | International consensus vocabulary; tooling and validators exist. Mapping to PROV is cheap credibility with archival/library worlds. |
| **C2PA / Content Credentials** | Signed content-manifest spec (claims, assertions, ingredients; hard bindings to asset bytes) — current spec tree 2.4; industry adoption via Content Authenticity Initiative. Fetched 2026-09-12: https://spec.c2pa.org/ (redirects to specifications/2.4/) and https://contentcredentials.org/ | Describes *how content was made/edited* (capture, edits, AI involvement). No economic claims, no version-tree capacity, no payout semantics — and no ownership adjudication, by design. | Complementary: a Tessera artifact digest can sit inside a C2PA manifest's ingredient list; a Tessera export can carry C2PA manifests as meaning-layer evidence. | Camera/OS/vendor signing ecosystem (hardware attestation) that Tessera will never have; the standard for "was this file manipulated" — a question Tessera doesn't answer. |

### 5. Music-domain rights metadata

| | What it does | What it does not do | Tessera difference | What they do better |
|---|---|---|---|---|
| **Mycelia Creative Passport** | Imogen Heap–founded initiative: verified "digital container" for music makers — profile, IDs, acknowledgements, works, business partners, payment mechanisms; data-access business model. Fetched 2026-09-12: http://myceliaformusic.org/creative-passport/ (site live, 2018-era material — currency of the program itself unverified; treat as historical reference, not a live product) | Identity/verified-metadata layer; not an on-chain residual-economics protocol. | Tessera's "one self-chosen name" field is deliberately the *opposite* of a verified-identity registry; linkage to real persons is off-chain evidence, not a registry claim. | Domain correctness: the music industry genuinely runs on verified contributor metadata (IPI/ISWC-style identifiers). If Morpheus ever interoperates with PROs/labels, Creative Passport-style verified metadata — not Tessera's name field — is the integration surface. |

## Condensed feature table

| System | Timestamp/digest | Signed contributor intent | Derivative/version ancestry | Economic claim semantics | Payout math on-chain | License text | Live chain | Verified |
|---|---|---|---|---|---|---|---|---|
| OpenTimestamps | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Bitcoin | 2026-09-12 |
| OriginStamp/OriginVault | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ (closed product) | multi (private) | 2026-09-12 |
| Solana Attestation Service | ✓ | partial (issuer-signed) | ✗ | ✗ | ✗ | ✗ | Solana | 2026-09-12 |
| DATA Foundation (ex-Story) | ✓ | ✓ | ✓ (IP graph/derivatives) | license terms, minting fees | royalty via licensing module | ✓ (PIL legal text) | own L1 | 2026-09-12 |
| KOR Protocol | ✓ | ✓ | attestation graph | per-asset splits, stablecoin | ✓ (EVM) | licensing terms on-chain | Base | 2026-09-12 |
| Splits | ✗ | ✗ | ✗ | fixed % shares | ✓ (moves funds) | ✗ | EVM chains | 2026-09-12 |
| Metaplex Token Metadata | ✓ | creator `verified` flag | editions only | sale royalty % list | marketplace-dependent | ✗ | Solana | 2026-09-12 |
| W3C PROV | ✗ | ✗ | ✓ (model) | ✗ | ✗ | ✗ | n/a (standard) | 2026-09-12 |
| C2PA | ✓ | ✓ (manifest sigs) | ingredients | ✗ | ✗ | assertions only | n/a (standard) | 2026-09-12 |
| Mycelia Creative Passport | partial | verified identity | works links | payment metadata | ✗ | ✗ | unclear/legacy | 2026-09-12 |
| **Tessera residual-v1 (proposed)** | ✓ | ✓ | ✓ (single-parent tree) | claim vs parent residual | deterministic math, no fund custody | terms digest + retained text | Solana (planned) | — |

## What nobody else does — stated honestly

The residual version-tree semantic — *each signed contribution consumes a
bounded fraction of its parent's remaining capacity, and every descendant's
normalized payout is derivable by replaying the chain* — was not found in any
fetched comparator. The closest ancestors: Story/DATA's derivative IP graph
(licensing-focused, now AI-data-pivoted) and KOR's attestation graph
(clearinghouse-focused). Neither encodes capacity-conserving residual math.
This is a **scope-of-search statement**, not a novelty or patentability claim;
a real patent attorney's search is a separate gate.

## What they do better — stated honestly

- **Legal text:** DATA/Story shipped an actual license (PIL) drafted with
  counsel. Tessera has a `terms_digest` and the *requirement* for a contributor
  agreement, but no drafted legal text — that is open founder work (see
  [founder-legal-queue](founder-legal-queue.md)).
- **Money movement:** Splits and KOR move real funds; Metaplex royalties were
  enforced by a whole marketplace ecosystem. Tessera deliberately records
  ratios only; every payout claim depends on an off-chain receipt system.
- **Trust/identity depth:** SAS and Creative Passport do verified-identity
  work; C2PA does hardware-backed capture provenance. Tessera's name field is
  self-asserted by design.
- **Persistence:** OTS proofs are verifiable forever against Bitcoin; an
  OriginVault archive is a compliance product. Tessera's evidence bundles are
  only as durable as the copies people keep (docs/06).

## Reuse opportunities (reduces build scope)

1. **SAS** for auxiliary attestations (dispute flags, issuer signals) — if a
   minimal custom economic constraint can't live safely there, the dedicated
   small program stays justified (docs/12 position, unchanged).
2. **PROV-O / C2PA export mappings** for interoperability claims instead of
   inventing provenance vocabulary.
3. **Splits-style contracts** (or fiat equivalents) as a *downstream* execution
   rail for a computed payout table — future scope, not v1.
4. **Metaplex** if a finished release is ever minted as a collectible — the
   royalty list would be *generated from* a Tessera payout table, keeping one
   source of truth.

## Explicit unknowns / not fetched this session

- Story/DATA royalty-module mechanics (LAP/LRP revenue flow): the old docs
  URLs 404'd post-rebrand; current docs cover PIL/licensing but the royalty
  vault detail was not re-verified. **Mark unverified** before any public
  "Story does X" claim.
- Whether tessera.pe's "Tessera" platform is active post-launch (docs site
  live; token status unverified).
- Creative Passport program status (site live but material is 2017–2019 era).
- Patent landscape: no patent search performed. None of this is freedom-to-
  operate analysis.
