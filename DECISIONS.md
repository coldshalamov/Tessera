# Decision register

Status is either **founder-confirmed**, **proposed default**, or **approval gate**. Agents must not present all three as equivalent.

| ID | Status | Decision | Rationale / where to read |
|---|---|---|---|
| D01 | founder-confirmed | Tessera and Morpheus are separate repos; Tessera is broader | shared founding decisions |
| D02 | founder-confirmed | Tessera is the name; protocol is not part of it | shared founding decisions |
| D03 | founder-confirmed | Residual/claim/effective plus explicit as-is payout semantics | Tessera economic specification / shared contract |
| D04 | founder-confirmed | Normal in-app login/signing, optional key export | identity specs |
| D05 | founder-confirmed | One self-chosen plaintext name; extensible metadata | record/schema specs |
| D06 | proposed default | U=10^12; bps claims; exact ratios; largest-remainder settlement | deterministic fixtures; no floats |
| D07 | proposed default | One economic parent v1; no undefined merges | avoid double counting/conflicting promises |
| D08 | proposed default | Tokenless/no-custody Solana core; fiat money outside | reduce risk/cost; retain economic state on-chain |
| D09 | proposed default | Cloudflare React/Vite + Worker; Supabase; private R2 | commercial Vercel Hobby restriction, finite free tiers |
| D10 | proposed default | Local/devnet complete loop before capped mainnet | actual deposits/review cost; no permanent devnet claims |
| D11 | proposed default | Finished audio first; AI/ads/payments staged | complete collaboration/listening before expensive extensions |
| D12 | approval gate | Licenses, terms, privacy/DMCA, source permissions | no checkbox grants missing third-party rights |
| D13 | approval gate | Production signer/provider and recovery model | cost/export/custody review |
| D14 | approval gate | Mainnet budget, upgrade authority and release | actual measurements and independent review |
| D15 | approval gate | Live fees/subscription allocation/payout policies | financial eligibility, working capital and law |
| D16 | approval gate | Brand/domain/package/software license | names chosen, not cleared; no automatic public license |

Record changes with date, author, affected spec/schema/tests, alternatives, evidence and migration consequences. Historic deployed economic rules never change merely because this register is edited.
