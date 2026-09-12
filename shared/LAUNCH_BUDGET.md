# Minimum-funding launchpad and cost register

Research date: 2026-09-11. Prices are USD, before tax. A **budget scenario** is not a purchased quote. Free allowances are finite and often shared by an account/organization. Founder labor, internet, computer and any existing coding-agent subscription are not magically free; this plan assumes those already exist and separately tracks marginal cash.

## The four launch levels

| Level | What is actually live | Cash requirement | Required limits |
|---|---|---|---|
| L0 local proof | Both local apps, math tests, export verifier, local validator | $0 incremental infrastructure | No public hosting or durable chain claim |
| L1 hosted demo | Cloudflare static UI/API, Supabase Free, bounded R2, test identities/devnet | $0 provider base within allowances; optional domain and public-UGC compliance below | Invite-only; 20 creators; test chain; no customer funds |
| L2 limited mainnet provenance beta | Real Tessera accounts; the same Morpheus collaboration/player | Above, **plus actual SOL deployment/record deposits and review** | Sponsor treasury cap; key/security/export review; precise experimental status |
| L3 commercial receipts | Producer tools and/or licensed paid releases with fiat payout ledger | Infrastructure overages, processor fees, working-capital reserve, tax/legal obligations | Live approval and reconciliation gates; not “free because Connect exists” |

You can prove the product and seek seed funding at L1. The permanent on-chain version cannot honestly be budgeted as zero. Public content launch also needs actual operational/legal ownership, even at zero revenue.

## Shared service register

| Component | Starting choice | Free/base cash | Upgrade/variable cost | Decision |
|---|---|---:|---|---|
| Web hosting | Cloudflare Workers static assets | $0 | Workers Paid starts $5/month | Avoid commercial Vercel Hobby [S01,S02,S05] |
| Dynamic API | One Worker, bounded requests | $0 below 100K/day & CPU limits | Included Paid allowance then usage | CPU/storage/ad abuse guarded separately [S01,S02] |
| Auth + DB | One Supabase Free project | $0 | Pro from $25/month; additional compute/overages possible | Local staging first; free projects pause after ~7 days without activity and must be restored before use — keepalive or pre-demo wake check [S04] |
| Audio + covers + public manifests | R2 Standard | $0 to 10 GB-month and operation allowances | $0.015/GB-month; $4.50/M writes; $0.36/M reads | No unlimited-upload promise [S03] |
| Production email | Google OAuth first; Resend SMTP/API when domain exists | $0 to 3K/month and 100/day | Pro $20/month | Delivery queue, retries and rate cap [S06,S07] |
| CAPTCHA | Turnstile | Free plan | Enterprise optional | Supplement, not substitute for quotas [S47] |
| RPC | Helius Free / target-network public endpoint for tests | $0 to plan limits | Developer $49/month | Backoff, cache and bounded indexing [S12,S15] |
| Embedded signing | Prototype self-contained devnet; managed-wallet adapter for public | Privy published free below 500 active users | Published next tier $299/month; verify exact quote | Do not enroll passive listeners in wallet auth [S16–S19] |
| CI | Local checks + GitHub Actions | Public standard runners generally free | Private minutes/storage metered | Short artifact retention; no media in git [S46] |
| Monitoring | Structured logs + health route + operator inbox | $0 within existing plans | Optional paid error service later | No sensitive session replay |
| Domains | Provider subdomains at demo | $0 | **Allowance** $10–25/year per ordinary domain, actual checkout quote required | Exact names not availability-checked |
| Payments | Stripe test mode first | No live fees in test | Card baseline 2.9% + $0.30; Billing extra 0.7% when used | Live eligibility is external [S24,S28] |
| Contributor bank payouts | Connect configuration | No assumptions of $0 | $2/payout-active account/month; 0.25% + $0.25/payout headline, other routing lines/configurations to confirm | Model fixed fee burden [S25–S27] |
| DMCA designation | Founder may be own agent | $6 filing | $6 when amended/resubmitted; renewal at least each 3 years | Public address/contact and response duty [S34] |
| Entity/bank/tax | Existing suitable entity if verified | Not automatically $0 | State filing, annual fees, agent/address, bookkeeping, tax preparation: jurisdiction/quote dependent | Two repos do not require two LLCs |
| Legal/security | Founder prep + external targeted review | No universal free option | **Unquoted**, obtain scope-based quotes or funded clinic/reviewer | Not represented as included in hosting |
| AI generation | Disabled at first | $0 consumed | Per-call/model or subscription + commercial/embed license | Credit caps before first API call [S49,S50] |
| Ads | Disabled at first | $0 expected revenue in budget | Provider approval, rev share, fill and consent vary | VAST integration is not demand [S48] |

Check account creation screens for card-on-file requirements. “Free allowance” does not guarantee that a provider accepts signup without billing details. Do not enter a card or enable usage billing without founder approval.

## Hard cash controls

L1 policy: 20 approved creator accounts; 8 GB aggregate R2 ceiling including unpublished files, covers, stems, incomplete uploads and retained versions; 250 MB per creator initial allowance; 64 MiB/file; 2 concurrent uploads/user; 200 chain records total on devnet for the demo. 8 GB is an application safety budget below a 10 GB-month allowance, not an exact billing conversion. Transactionally reserve storage before upload, expire reservations, reconcile actual stored bytes daily, and freeze writes before exhaustion. Serving can still consume Worker/R2 operations, so daily request budgets are independent.

Separate switches: `ALLOW_SIGNUPS`, `ALLOW_UPLOADS`, `ALLOW_ANCHORS`, `ALLOW_GENERATION`, `ALLOW_CHECKOUT`, `ALLOW_PAYOUTS`. Default all paid writes off. Alert at 50%, 75%, 90%; enforce configured stop at 95% or lower. A provider billing alert is not a hard spend cap. Unexpected bot traffic can exceed estimates even with these protections; the initial beta remains invite-only.

## Audio sizing, calculated assumptions

At 128 kbps, one hour is 57.6 MB in decimal units. Ten GB holds approximately 173.6 hours of only that final compressed audio. Four additional equally-sized retained stems make that effectively about 34.7 hours of five-file production material. Real WAV stems can be much larger. At 1,000 finished hours, 57.6 GB gives a linear storage-overage estimate of $0.714/month before billing-unit rounding. R2 rounds storage up to whole GB-month units, so this constant-storage example is about $0.72 after the 10 GB allowance; reads, writes, derivatives, backups, RPC, API and database are additional. Operations also round up in million-request billing units: barely crossing a free allowance can incur the next full billed unit. These are storage arithmetic examples, not an all-in operating-cost quote. [S03]

## SOL: fees versus deposits versus deployment

Use `getMinimumBalanceForRentExemption(serialized_bytes)` on the target cluster. Mainnet rent was changing; we did not retrieve a live RPC quote. [S08–S13] Let `r(B)` be the live deposit for B bytes and `P` the SOL/USD budgeting price. Then:

```
record_capital_SOL = n_nodes*r(node_bytes) + n_projects*r(project_bytes)
per_tx_fee_SOL = 0.000005*signature_count + priority_fee_SOL
peak_deploy_SOL = final_program_deposit + temporary_buffer_deposit + fees
cash_reserve_USD = P*(record_capital_SOL + peak_deploy_SOL + fee_reserve_SOL)
```

Ordinary sponsored publish normally has creator and sponsor signatures; controller-approved mode can add another. A plain public key is not itself a new rent-funded data account. Do not create token accounts/NFTs per user. Permanent node accounts deliberately cannot be closed to reclaim deposits, so that capital is committed rather than practically recoverable.

**Conservative legacy-parameter scenario, NOT a current rent quote:** `r(B)=(B+128)*6960/1e9 SOL`. At 640-byte node budget: 0.00534528 SOL/node. A node carrying the maximum eight `references` entries adds roughly 260 bytes (about 0.0018 SOL more per node under the same illustrative model); the signed references list is stored on-chain, so account sizing must plan for it. At 100 nodes: 0.534528 SOL; at 1,000 nodes: 5.34528 SOL. A 200,000-byte program account is about 1.39289 SOL under the same illustrative model; temporary buffers can roughly double peak deployment capital. At a hypothetical $100/SOL, 100 records plus the two-account deployment approximation is roughly $332 before projects, retries, review or any reserve. At $50/SOL halve it; at $200 double it. Larger compiled programs need materially more. These are deployment-planning sensitivities, not actual quotes or a recommended SOL purchase.

An extra 16 bytes for an exact payout numerator/denominator is about 0.00011136 SOL under that old model: roughly $0.0111 at the hypothetical $100/SOL. Useful per-node clarity is affordable, but per-node account layout and record counts dominate. T03 must measure the actual wire size, program binary, transaction envelope and live rent before a mainnet budget can be approved.

## Example commercial economics, explicitly provisional

$10 subscription; 2.9%+$0.30 card processing → $9.41. Add 0.7% Billing on $10 → $9.34. Taxes, refunds and chargebacks are not yet deducted. A proposed 15% platform fee on that $9.34 yields $1.401 before rounding and before the platform's payout overhead. The creator allocation is $7.939 before rounding and reserves. These percentages are a product hypothesis, not a founder-approved commercial contract.

Twenty payout-active recipients, each paid once/month, produce a headline fixed Connect burden of $45 ($40 accounts + $5 payouts) plus percentage charges. One hundred small recipients produce $225 fixed. This is why thousands of $1 recipients do not fit the budget. Aggregate transparently, use compliant thresholds/cadence, disclose how payout costs are borne, and verify fund-retention rules. No forfeiture of creator balances and no unauthorized redistribution of a blocked recipient's share.

## Funding gates rather than pretend precision

Do not budget “$0 audit” or promise a fixed legal quote. L1 can be $0 in hosting with provider subdomains and no new paid tools. A public UGC deployment adds the filing/contact/compliance decisions. L2 requires a measured SOL reserve plus reviewed signing/program/export design. L3 needs a rolling cash reserve for refunds/disputes and confirmation of tax/payment responsibilities. A lean early paid-service baseline could be $5 Worker + $25 Supabase = $30/month before email, wallet tier changes, chain deposits, processing and every non-software cost. That is a scenario, not a requirement to upgrade on day one.
