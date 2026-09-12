# Tessera product specification

Version 0.1 draft. Read [founding decisions](../shared/FOUNDING_DECISIONS.md) first. Normative words MUST/SHOULD/MAY describe proposed implementation requirements, not a legal promise or a claim of finished software.

## Product and users

Tessera records how a creative project grows through signed contributions, how each accepted version inherits economic claims, and how a specified distributable receipt would be divided. It is a general-purpose economic lineage system. It must work for an audio drama, song, illustrated book, game asset collaboration, or another digital work without adding domain-specific fields to the program.

The users are contributors, application operators, independent verifiers and investigators. A contributor should understand the economic offer without understanding a blockchain. An operator can use Tessera without outsourcing its entire product to Morpheus. An independent verifier can reconstruct a version and check recorded assertions even when the original application is unavailable.

The initial deliverables are a small Solana program, deterministic arithmetic library, TypeScript SDK, JSON/binary specifications, portable evidence bundles, command-line verifier and minimal public record explorer. There is no native token, speculative marketplace, tradable royalty NFT, wallet balance screen or on-chain money escrow in v1.

## What is authoritative

On-chain core state establishes the accepted economic-parent relationship, the contributor signing key, the name the signer chose, artifact/metadata/terms digests, the claim, the validated derived units, and chain context. Off-chain signed manifests preserve full statements, human-readable terms and application metadata. Signatures show what a key signed; the application must disclose whether the key was user-controlled, embedded/delegated, or server-custodied.

Tessera does not determine whether somebody authored an artifact, possessed copyright, supplied useful labor, told the truth about their name, or received all money due. A public false assertion remains a false assertion. The protocol should make it easier to preserve and contest claims, not turn a first-to-upload contest into a copyright registry.

## Experiences to prove

A seed creator publishes an artifact and claims 15% of capacity. Two collaborators independently branch from it with different asking percentages. A third party selects and builds on one branch without rewriting the other. The resulting version displays every contributor's exact as-is payout, and exporting it produces an independently verifiable record. A second application demonstrates the same flow using an illustration or music stem rather than audio-drama terminology.

The first explorer can be deliberately narrow: paste a node address or open an evidence bundle; show source network, program version, ancestry, name/key, contribution hash, claim preview, payout table and verification limitations. Do not build a social network inside Tessera. Morpheus owns discovery, profiles, conversation and the player.

## Scope and gates

L0 proves math, serialization, signatures, replay protection, export and a local-validator append. L1 adds hosted documentation/explorer and devnet. L2 is a capped mainnet pilot with approved budget and reviewed program/key handling. L3 is adoption by a commercial application whose off-chain receipt system calls the SDK. Reaching L1 does not require accepting customer funds or deploying an immutable unaudited contract.

The program MUST enforce residual math and ancestry, even if the first implementation effort is larger than a generic memo transaction. It SHOULD remain small by excluding payout custody, arbitrary merge negotiation and application roles. Do not replace the core with an NFT royalty field or a general attestation service merely to finish faster.

## Success and non-goals

Success means deterministic agreement between Rust, TypeScript and independent fixtures; zero unexplained cent loss in simulated payouts; no duplicate claims after retries; a trustworthy distinction between verified bytes and unverified ownership; and an export that works without Morpheus. Measure real setup cost, actual account/transaction sizes, append success rate, RPC cost and independent recovery success. Do not invent adoption numbers or claim unique invention without a prior-art review.

No requirements here assume a court's future acceptance, a funding award, unlimited network persistence or guaranteed creator income. Operational and legal limits are first-class product behavior rather than footnotes.
