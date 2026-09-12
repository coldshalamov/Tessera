# UI / doc claim wording — T08

Approved-vocabulary copy for Morpheus UI, Tessera explorer and public docs.
Compiled 2026-09-12; every line is consistent with
[docs/11_LEGAL_EVIDENCE.md](../docs/11_LEGAL_EVIDENCE.md),
[docs/05_IDENTITY_AND_KEYS.md](../docs/05_IDENTITY_AND_KEYS.md),
[docs/02](../docs/02_STATE_AND_CONSENT.md) and [docs/06](../docs/06_PERSISTENCE_AND_EXPORT.md).
Copy blocks are ready to paste; adjust punctuation, never the meaning. Where a
string names a legal concept, it was written to be *true*, not impressive.

## Signatures

**Say (consent screen, tooltip):**
> "Your signature records that this key approved this exact contribution —
> this file hash, this parent version, this claim — at this time."

**Say (evidence/explorer):**
> "A signature proves key control at a moment in time. It does not by itself
> prove legal authorship, copyright ownership, or that the named person
> physically signed."

**Say (custody disclosure, first sign + settings):**
> "Your signing key is held by this app's servers on your behalf (server-custodied).
> You can export it in Settings. Because the service can sign for you, a
> signature alone does not prove only you could have made it."
> — use this exact custody sentence for the current `server_custodied` mode;
> swap only when the custody mode actually changes (docs/05 gate).

**Don't say:** "cryptographic proof of authorship," "legally binding signature
guaranteeing ownership," "non-repudiable identity," "verified creator" (unless
an external verification product actually ran — SAS/third-party attestations
are a separate feature, not our signature).

## Name field

**Say:**
> "The name you publish with. It is a claim, not a verified identity. You can
> supply account history, drafts and correspondence later if a contribution is
> disputed."

**Don't say:** "your verified identity," "your legal name," any wording
implying we check it. Keep the single name field — no identity taxonomy
(docs/11, D05).

## Terms / consent

**Say (pre-sign summary — must show all of these, docs/02):**
> "You are publishing a new version of **{title}** based on **{parent}**.
> You claim **{claim_bps/100}%** of the remaining allocation. If accepted,
> your version keeps **{own payout}** of each receipt; versions built on yours
> may reduce the remainder available to future contributors. You confirm you
> have the rights needed to contribute this and agree to the project terms
> (**{terms link}**)."

**Say (fine print):**
> "Signing accepts the project terms shown. It does not transfer copyright,
> clear third-party rights, or guarantee payment — it records your claim and
> agreement."

**Don't say:** "license your work to us" (nothing is assigned by default),
"irrevocably agree to all future terms," a bare signup checkbox standing in
for this specific approval.

## Payouts / economics

**Say:**
> "Exact share of each receipt this version would produce under the recorded
> terms" / "as-is payout ratio."

**Say (on variability):**
> "Percentages describe how a receipt would be divided. Actual payment depends
> on the app's sales and accounting — the chain records the ratio, not the
> money."

**Don't say:** "royalties," "earnings guaranteed," "you will receive X," or
any token/investment framing. We have no token, custody, or escrow (D08).

## Evidence / verification / export

**Say (export button + explorer):**
> "Portable signed contribution history and economic allocation records"
> (docs/11 mandated phrasing).

**Say (verification report labels — mirror docs/06 statuses):**
> "Signature: valid · Integrity: file matches recorded hash · Chain record:
> confirmed on {network} · Rights/identity: not established by this record."

**Say (offline mode):**
> "Verified against the exported bundle only. Chain finality was not
> re-checked; connect to a Solana RPC to confirm current state."

**Don't say:** "rights verified," "ownership confirmed," green-check UI on
identity/rights dimensions — ever. "Invalid" ≠ "unverifiable": an
unreachable URI is *incomplete evidence*, not forged evidence (docs/06).

## Persistence

**Say:**
> "Records are preserved on a public network and in your export. Keep a copy —
> hosting, this app, or this company may not last forever."

**Don't say:** "permanent," "can never be removed," "protected forever even
after bankruptcy" (docs/11 explicitly bans this framing). On-chain records
can't be erased by us — that is a *disclosure obligation*, not a feature
promise: "Published records are public and cannot be deleted" (docs/06).

## Disputes / restrictions

**Say:**
> "Flagged/disputed: an app-level annotation. The underlying record is
> unchanged; a dispute statement is itself a signed record, not a deletion."

**Don't say:** "removed," "rejected by the blockchain," "copyright strike
resolved" — nothing erases or adjudicates on-chain (docs/02).

## One-line honest limits (footer/about page)

> "Tessera records who signed what, when, and under which terms. It cannot
> determine who really authored a file, whether they owned it, or whether
> anyone was paid. Those questions use this evidence, not just this protocol."

## Machine-checkable claim rules (for a future lint/test)

Any UI string asserting `proves`, `guarantees`, `verified`, `permanent`,
`ownership` must appear only in the scoped true senses above. A T10 acceptance
check can grep rendered copy against the banned list:
`proof of authorship`, `verified creator`, `guaranteed`,
`permanent`, `rights verified`, `ownership confirmed`, `legally binding`,
`non-repudiable`, `copyright registered/protected`.
