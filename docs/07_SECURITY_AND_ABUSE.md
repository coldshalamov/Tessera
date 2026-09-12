# Threat model and abuse controls

Assets: signature authority, truthful consent records, economic weights, source/terms integrity, fee-payer SOL, public users' privacy, deploy authority and independent verifiability. Adversaries include malicious contributors, compromised browsers/operators, dependency maintainers, spam bots, dishonest revenue reporters and legitimate collaborators in disagreement.

| Threat | Required defense | Residual limit |
|---|---|---|
| Changed percentage after approval | Domain-bound frozen intent, preview from SDK, signed terms/hash, on-chain recompute | Custodial operator may still forge new approvals; disclose mode |
| Fake/foreign parent account | Program owner/discriminator/project/genesis validation | A valid parent may contain false authorship claims |
| Duplicate publish/retry | PDA nonce + semantic digest comparison, outbox idempotency | New deliberate nonce is a separate proposal; app detects accidental duplicate |
| Replay across apps/networks | Program/genesis/project/domain in signed bytes | Same original can intentionally have multiple licensed uses |
| Decimal/overflow attack | u64 units, checked u128 products, strict parsers and shared vectors | Finite precision eventually exhausts useful residual |
| Sponsor wallet drain | Server-built allowlisted tx, simulation, instruction/rent/fee limits, per-user/global cap | Valid spam still costs money; invite-only pilot |
| Fake ownership/name | Label unverified claims, dispute path, maintain evidence | Blockchain cannot adjudicate authorship |
| Path padding/Sybil claims | Consent/curation, immutable version pinning, aggregate beneficiary rounding | Creative value and identity cannot be cheaply proved by code |
| Metadata link rot | Original bytes in exports and backups; digest verification | A digest cannot restore a missing file |
| Program admin rug | Minimal no-custody core, disclosed upgrade authority, audited immutable release | Chain/network and legal risks remain |
| Recovery theft | Step-up auth, separated recovery, provider security review | A copied key has no intrinsic “rightful owner” detector |
| Evidence ZIP exploit | Bounded sizes, safe paths, no execution, hash/encoding checks | Unsafe media decoders remain separate browser/OS concern |
| App omits revenue | Receipt ledger, release pinning, reports and audit rights | Chain cannot observe unreported fiat sales |

## Priority engineering rules

No mainnet funds or key custody until the relevant test/review gate passes. No arbitrary signing endpoint. No private keys in screenshots or source fixtures. No service-role API keys in a browser bundle. No external URL fetch without SSRF allowlisting and size/time limits. No recursive unbounded ancestry traversal inside a transaction. No writes to immutable economic state through an “admin repair” shortcut.

Use reproducible builds and dependency lockfiles. Audit dependency permissions and npm lifecycle scripts; pin release artifacts rather than loading remote code in an evidence viewer. Run secret scanning, static checks, Rust tests, unit/property tests and adversarial integration tests in CI. Error reports must avoid sensitive fields while retaining correlation IDs and intent hashes.

## Review gates

Before L2: independently review account constraints, arithmetic, nonce/idempotency, signer authority, program upgrades, worst-case transaction size, sponsor restrictions, export integrity and deployment keys. A limited beta is not a substitute for a security review; reduce scope and funding exposure while seeking appropriate independent scrutiny. Do not call an agent's self-review an audit.

Before token/fund custody ever exists: new threat model, legal/payment review, settlement/reentrancy/CPI/authority analysis and external audit scope. No token contract is required for the user's current design, so do not create this risk for an incubator demo.

## Incident handling

Kill sponsor writes without deleting drafts or chain evidence. Rotate fee-payer/application credentials where possible. Preserve logs and affected version/digest lists. Publish whether signatures or only availability were affected. A privacy incident cannot be cured by hiding an on-chain name. Restore read-only service/export first; repair publication via a disclosed versioned migration if the program is compromised. Document recovery and exercise it on devnet.
