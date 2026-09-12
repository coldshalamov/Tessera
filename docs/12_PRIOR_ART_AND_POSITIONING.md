# Prior art, research tasks and positioning

## Defensible claim

The engineering hypothesis is useful composition of signed provenance, single-parent residual allocation, explicit as-is payout ratios and portable evidence, with a first application in Morpheus. Do not claim the first blockchain provenance tool, the first revenue split contract, patentable invention or unique automatic pricing without research. The math alone is elementary; adoption depends on contracts, coordination and a useful creator workflow.

## Known comparators and remaining work

Solana Attestation Service already provides generic attestations and schemas [S20,S21]. It may help with auxiliary attestations or identity assurance, but simply anchoring a schema there does not enforce this residual tree. Evaluate whether it can host a minimal custom economic constraint safely; if not, the dedicated small program is justified.

W3C PROV and C2PA establish provenance/content-manifest vocabulary [S22,S23]. Plan export mappings, not re-invention or false equivalence to ownership verification. Existing fixed split/royalty tools and content-licensing systems must be compared on branch identity, denominator semantics, consent, on-chain enforcement, platform-independent verification and fee/deposit cost. Story documentation was only partially reachable during research; exact comparisons remain a task, not a completed finding.

Investigate music collaboration/rights metadata efforts including Creative Passport/Mycelia using their own primary material before making historical claims. Also examine Solana asset-royalty tools for why a sale royalty divided among a fixed list differs from normalized claims along an economic path. Use actual code/docs/tests, not vendor summaries.

**2026-09-12 update (T08, see [reports/prior-art-matrix.md](../reports/prior-art-matrix.md)):** Story Protocol has rebranded to "The DATA Foundation" ($IP → $DATA, docs at docs.datafdn.org) and repositioned around AI-training-data provenance; its PIL license and Licensing Module remain documented. KOR Protocol/Korus (Base, stablecoin splits, ERC-6551 IP accounts) is now the closest shipping "remix economics" comparator. ConsenSys Tessera's repo was archived 2026-06-01; tessera.pe operates an unrelated Solana private-markets platform under the same name — see [reports/naming-collision.md](../reports/naming-collision.md).

## Comparison deliverable

Create `reports/prior-art-matrix.md` with exact source/date, supported features, mismatch, reuse opportunity and licensing. Include at least: generic attestation; NFT creator royalty list; programmable IP/derivative license platform; off-chain split-contract service; W3C PROV/C2PA; Tessera proposed mechanism. Mark unknowns. A feature table is not a patent search or legal clearance.

The reuse decision should reduce risk: use battle-tested Ed25519/Solana/Anchor tooling, JSON schema validators and auth/payment providers; build only the residual state transition, signing/consent glue, portable evidence and app-specific collaboration that are missing. Do not build a cryptographic algorithm, identity verification bureau, card processor or generalized DAW merely to appear vertically integrated.

## Pitch vocabulary

“Tessera lets contributors publish a seed, negotiate claims against remaining capacity, and preserve the exact economic ancestry of each resulting version. Morpheus makes that visible in collaborative audio drama.”

Demonstrate why a public ledger matters: a separate verifier can reconstruct allocations without asking Morpheus. Acknowledge that off-chain revenue reporting, asset availability, custody and legal permissions remain external. That candor is more credible than pretending blockchain solves copyright.
