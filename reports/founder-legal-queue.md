# Founder / legal-reviewer decision queue — T08

Compiled 2026-09-12. This is the complete explicit queue of decisions that
**only** the founder (or a retained reviewer/attorney) can make. Agents must
not infer answers from defaults, checkboxes, or silence. Ordered roughly by
when the answer is needed. Status column reflects
[DECISIONS.md](../DECISIONS.md) gate IDs where one exists.

## Gate D16 — Brand, package names, software license

- [ ] **Trademark knockout search** for "Tessera" and "Morpheus" (USPTO TESS +
  counsel). Triggered by: [naming-collision](naming-collision.md) — 3 known
  blockchain "Tessera" uses (ConsenSys archived product; tessera.pe Solana
  RWA platform; ex-Fractional NFT protocol) + HPE Morpheus + MOR-token network.
  Needed **before** any domain/logo/incubator brand spend.
- [ ] **Naming convention decision:** keep-qualified ("Tessera Protocol") /
  prefix-entity / rename. Recommendation in naming-collision.md is keep +
  qualify; decision is founder's.
- [ ] **Repository visibility** (public vs private) — decides when the
  license question becomes live.
- [ ] **Software license** — decision-ready comparison in
  [license-inventory](license-inventory.md): MIT vs Apache-2.0 are the
  plausible candidates; no license added until chosen. Include whether
  spec/docs text gets a separate grant (e.g., CC-BY) and what
  `shared/`'s cross-repo licensing is.
- [ ] **Morpheus license** — may differ from Tessera's (LICENSE_DECISION.md);
  needs its own answer before Morpheus publication.
- [ ] **npm publish names** — `tessera` and `morpheus` bare names are both
  taken; scoped names (e.g., `@tessera/*`) or alternates needed at publish
  time.

## Gate D12 — Terms, agreements, content rights

- [ ] **Contributor agreement text** — the actual legal terms behind
  `terms_digest` (permitted use, derivative rights, scope/territory/duration,
  economic-base definition, withdrawal/amendment, attribution, disputes,
  liability reps). docs/02+docs/11 define required coverage; drafting is
  counsel work. **Blocks any real public pilot.**
- [ ] **Platform terms of service + privacy policy** for Morpheus/Tessera
  services (consent records, exported evidence, retention).
- [ ] **Demo content permissions** — scripts, voices, music for the incubator
  demo must be original or licensed; no third-party material assumed cleared
  (docs/13).
- [ ] **DMCA designated-agent decision** — if Morpheus hosts user content:
  agent designation ($6 filing, 3-year renewal, public contact) is a founder
  action [S33,S34].
- [ ] **Underlying-license posture** — policy for projects incorporating
  third-party material (what proof, if any, Morpheus requires before
  publication).

## Gate D13 — Signing custody / provider

- [ ] **Production custody model** — current default `server_custodied` is
  approved for demo/pilot (D20) with disclosure; switching to an
  `embedded_provider` (Privy candidate, Crossmint alternative) requires the
  cost/security/recovery review in docs/05 [S16–S19]. Confirm the public
  pilot stays on server-custodied or fund the provider tier.
- [ ] **Step-up authentication policy** for economically consequential
  signatures, key export, recovery changes (docs/05 "strongly preferred").

## Gate D14 — Program deployment / mainnet

- [ ] **Program upgrade authority policy** — immutable-vs-upgradeable pilot
  disclosure; who holds authority, what it can change (docs/02).
- [ ] **Mainnet budget approval** — measured deploy + rent + sponsor costs
  (T09 produces the numbers; founder funds them).
- [ ] **Independent security review** scope/budget before L2 (docs/13: obtain
  quotes, don't zero it).

## Gate D15 — Money / payouts

- [ ] **Stripe/Connect (or alternative) business onboarding** — KYC, entity,
  fees, payout policies [S24–S28]. Also the *policy* of which receipts the
  recorded ratios apply to (economic-base definition belongs in the
  contributor agreement above).
- [ ] **Revenue-flow legal review** — confirm the tokenless ratio-record model
  plus fiat receipts stays clear of money-transmission/securities issues in
  target jurisdictions. No speculative-finance features assumed exempt
  (docs/11).

## Smaller but explicit

- [ ] **Jurisdiction scope** for legal-evidence framing — docs/11 is
  US-oriented; other jurisdictions' contributors need a stated assumption.
- [ ] **Minor contributors policy** — age/consent handling for contributors
  under 18 (docs/11 flags it).
- [ ] **GitHub org/repo home** — account, org name, remote creation (SETUP_STATUS
  still "founder plans to create").
- [ ] **Incubator application** — named program's actual rules were never
  supplied; any application needs founder's entity/team facts (docs/13).
- [ ] **Solana Foundation / grant applications** [S51] — milestone budget,
  whether to apply at all.
- [ ] **Data-retention/consent-export policy** — how long consent records and
  evidence exports are kept; who can request deletion (docs/06: finalized
  public records aren't erasable — the *policy* on private metadata is a
  decision).

## How to drain the queue

D16 items unblock public naming/licensing; D12 items unblock any real-user
pilot; D13/D14 unblock mainnet; D15 unblocks real money. Until each box is
checked, code proceeds only in the modes the specs already mark safe
(local/devnet, simulated payments, disclosed custody). Nothing in T08's
reports presumes any answer.
