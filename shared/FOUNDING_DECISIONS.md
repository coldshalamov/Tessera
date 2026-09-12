# Founding decisions and thread reconciliation

Status: authoritative design brief from the supplied conversation, consolidated 2026-09-11. This file preserves decisions, not a verbatim transcript. Later explicit founder changes supersede it through a recorded decision. No earlier assistant assurance should overrule the corrections below.

## Product relationship

**Tessera** is the whole name. “protocol” is an ordinary lowercase descriptor, never a compulsory brand suffix. Tessera is general-purpose contribution/economic-lineage infrastructure on Solana. **Morpheus** is the first independent application: collaborative, immersive audio storytelling. The infrastructure must work without Morpheus or any radio-drama vocabulary. Separate repositories, independent release versions, explicit integration contract.

Morpheus starts with profiles, roles, collaboration, projects, browsing/genres, library/bookmarks, audio upload and a good persistent player. It must not be reduced to a podcast feed, crypto dashboard, AI demo, or landing page. Adaptations are an important intended audience use case, but permission to adapt is independent of the technology.

## Non-negotiable mechanics

A creator publishes a seed, names a claim against its remaining economic capacity, and invites descendants. Competing contributions create different branches. A low claim can leave more room to attract collaborators; superior quality may justify a larger one. Every node defines a version whose descendants include inherited claims. Revenue from one version never silently pays a sibling or a later version.

Residual is **unallocated capacity, not an escrow balance**. Claims create integer effective weights; payouts at any version normalize that version's issued weights to 100%. Root-only versions can pay 100% to a root whose effective weight is much smaller. The schema must explicitly expose residual-in, requested claim, effective units, residual-out, issued total and the new node's as-is payout ratio. Ancestor payout ratios are relative to the selected version, not overwritten on historical nodes.

Tessera itself enforces the economic tree and validates these calculations on-chain. It is not just a generic hash log whose meaning is trapped in Morpheus servers. One economic parent is deliberately supported on-chain in v1. A signed, bounded `references` list (at most eight node addresses) in the core record captures additional descriptive ancestry; economic merges still require a future explicit versioned design, not an ambiguous `parents[]` field.

## Identity and UX

A single public `name` field is self-chosen: a name, alias or studio label. No compulsory legal-name taxonomy. Public-key signatures, statement meaning, artifact hashes, terms and chain position add evidentiary context. No statement claims that a name was identity-verified.

Normal website login; no required wallet installation, token purchase, gas funding, external crypto website or seed phrase at onboarding. An embedded signing identity is created automatically; keys/export tools are accessible inside Settings. Default signing is a platform-generated server-custodied keypair provisioned silently at login with in-settings export (founder-confirmed); managed embedded providers are an optional scaling upgrade, and custody mode is always disclosed. The platform sponsors chain costs. Retaining an export is optional for everyday use but necessary for genuinely independent key recovery unless a separate recovery arrangement exists.

## Budget and execution

Founder cash is scarce; engineering effort is not the artificial limiting factor. Build the whole planned system in dependency order, with explicit funding gates only for things that really cost money or require external authorization. Do not substitute indefinite planning for implementation. Agents must save partial work and continue unblocked work if provider setup is unavailable.

No tokens, NFTs, speculative assets, native mobile apps, full DAW, custom foundation-model training or compulsory AI generation in the initial release. Future AI assistance remains planned, not erased.

## Corrections to earlier conversational claims

* DMCA registration is not an adaptation license or automatic legal immunity. Rights holders need not wait for a takedown or accept residual revenue. A distributor's commercial contribution and the source owner's legal permission are different. [S30–S34]
* A stored signature proves a key signed particular data, not that the signer created or owns it. Hosted signing also creates operator trust. Names and timestamps are evidence inputs, not title certification. [S29,S31,S35–S37]
* On-chain records can survive the company; files, private keys, money, contracts and legal rights do not automatically survive bankruptcy or disappearance because a hash exists. Independence requires exports, data availability and controlled upgrade powers.
* Vercel Hobby is not the free commercial-launch default. Cloudflare is. [S05]
* Per-user storage caps do not cap total cost. “Unlimited listening” is not a hard expenditure bound. Account-wide quotas and abuse controls are necessary. [S01–S04]
* Account rent/deployment reserves can dominate tiny Solana transaction fees. Devnet is not permanent evidence. [S08–S13]
* Privy's published free tier has a substantial next-tier jump; ordinary listeners must not incur wallet MAUs needlessly. [S16]
* No claim of invention of provenance, revenue splits or blockchain rights management is justified. Differentiation must be demonstrated against existing work. [S20–S23]
* Tessera and Morpheus are working names, not cleared trademarks. Existing Tessera blockchain uses were found. Do not silently rename them; record the launch clearance task. [S39,S40]
