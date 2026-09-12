# Tessera ↔ Morpheus integration contract

Contract: `tessera-morpheus/0.1.0-draft`. Owner: Tessera repository. Identical checked-in copies are supplied to both repos. Tessera economic/wire changes require a contract revision, fixture changes and a Morpheus compatibility test. No agent independently “simplifies” the denominator or reimplements floating-point shares.

## Ownership boundary

Tessera owns immutable project/node accounts, arithmetic, signing format, deterministic record IDs, chain verification, SDK, standalone explorer/verifier, portable evidence/export format and generic metadata extension points. Morpheus owns login, private contact details, profiles, casting, social state, draft workflow, content permissions review, object storage, catalog, player, subscriptions, fiat ledger, tax/payment-provider integration and moderation.

Tessera does not collect the website's subscription cash, guarantee that receipts were reported, adjudicate copyright or grant licenses. Morpheus must honor its published allocation agreements, but can restrict access to unlawful content without erasing historical Tessera data.

## IDs and relationships

`user_id`, `production_id`, `episode_id`, `release_id`, `upload_id`: opaque UUIDs owned by Morpheus. `signer`: a standard Ed25519 public key; linked privately to a user after proof of control. `project_address` and `node_address`: actual Solana account addresses, scoped by `genesis_hash + program_id`. They are never interchangeable with database UUIDs or artifact digests.

One production normally references one Tessera project. Each episode release pins an exact economic leaf. Episodes may branch from a shared script/root. A production page's “featured release” pointer is mutable discovery state; a sold release's economic reference is immutable. The released audio hash is part of a release manifest. Re-rendering an audio file creates a new release, even when economic weights are unchanged.

## SDK port required by Morpheus

```ts
interface TesseraPort {
  mode: 'local' | 'devnet' | 'mainnet';
  previewAppend(parent: NodeRef | null, claimBps: number): Promise<EconomicPreview>;
  prepareContribution(input: ContributionInput): Promise<SigningIntent>;
  submitSignedContribution(intent: SignedIntent, idempotencyKey: string): Promise<Submission>;
  getSubmission(id: string): Promise<Submission>;
  getNode(ref: NodeRef): Promise<VerifiedNode>;
  getPayouts(ref: NodeRef): Promise<ExactPayoutTable>;
  verifyRelease(bundle: EvidenceBundle): Promise<VerificationReport>;
  exportBranch(ref: NodeRef): Promise<EvidenceBundle>;
}
```

All rights and money integers cross JSON boundaries as base-10 strings. `claim_bps` is an integer 0–10,000. `U = 1,000,000,000,000`; BPS denominator = 10,000. Exact payout is a rational `(effective_units, issued_total_units)` with an optional decimal display. `issued_total = 0` means no monetizable payout, not a divide-by-zero fallback to the founder.

## Write lifecycle and failure contract

Morpheus saves a draft and performs file/terms checks first. It calculates the preview via the SDK, shows the selected parent, exact claim, as-is payout and descendant dilution warning, and obtains explicit consent. Save the signed intent plus outbox row in one DB transaction. Submit asynchronously; show `awaiting_signature`, `queued`, `submitted`, `confirmed`, `finalized` or a specific failure. “Recorded on Solana” is reserved for a finalized mainnet transaction. Devnet is always labeled test evidence.

The node PDA/nonce makes retries idempotent. An expired blockhash is retried with a newly signed transaction but the same intent nonce; a changed parent, terms, claim or artifact requires new user consent. A server must never quietly move an offer to the newest branch head. Finalized-chain reconciliation creates/updates the derived DB projection without generating a second economic claim.

Readable error codes: `AUTH_REQUIRED`, `CONSENT_EXPIRED`, `PARENT_NOT_FOUND`, `PARENT_NETWORK_MISMATCH`, `TERMS_UNAVAILABLE`, `SIGNER_MISMATCH`, `CLAIM_OUT_OF_RANGE`, `CLAIM_ROUNDS_TO_ZERO`, `BRANCH_CAPACITY_EXHAUSTED`, `ZERO_ISSUED`, `METADATA_HASH_MISMATCH`, `RPC_RATE_LIMITED`, `SPONSOR_BUDGET_EXHAUSTED`, `TRANSACTION_TOO_LARGE`, `ANCHOR_FAILED`, `CONTENT_RESTRICTED`, `UNSUPPORTED_VERSION`.

## Release and revenue contract

A release manifest binds `release_id`, `node_ref`, exact audio hash, artifact/storage version, complete ancestry IDs, all beneficiaries' effective units, issued denominator, terms hash, `revenue_policy_version`, currency scope, provenance verification report and rights-review state. Its byte hash is retained with every related ledger entry. Revenue must not resolve against the production's current head later.

The revenue base is funds actually attributable to that release after explicitly agreed deductions; it is not all money the creator ever earns. Morpheus's fee is a versioned distribution agreement outside the residual math. Tessera's output distributes 100% of whatever **distributable amount** is passed to it; it does not certify that the amount is truthful.

## Independent development

Morpheus starts with the local adapter and shared fixtures while Tessera implements its SDK/program. The local adapter is a tested simulator, not a mainnet claim. SDK delivery: pinned npm scope if available; otherwise a versioned `pnpm pack` tarball with SHA-256 and source commit. Never depend on an unpinned Git branch or an absolute sibling-folder path in production.

Test matrix: local→local, devnet→devnet, mainnet read-only→real exported proof. Mainnet writes and live Stripe are disabled by default. Both teams run the common acceptance scenario. Tessera must additionally demonstrate a second generic, non-audio fixture/application so that Morpheus-specific semantics cannot quietly leak into the core.
