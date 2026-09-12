# Research register

Checked 2026-09-11. USD unless stated otherwise. These are public provider/regulatory documents, not private account quotes. Recheck before any purchase, production deployment or legal reliance. A source supports only its stated scope. Design choices, simulated economics and cost scenarios in this packet are our proposals, not vendor promises.

## [S01] Cloudflare Workers pricing

Source: https://developers.cloudflare.com/workers/platform/pricing/

Static-asset requests free; Workers Free and Paid billing. Paid starts at $5/month; limits are account-level, not a separate allowance for every repo.

## [S02] Cloudflare Workers limits

Source: https://developers.cloudflare.com/workers/platform/limits/

Free: 100,000 dynamic requests/day and 10 ms CPU/request. Streaming and I/O do not make expensive CPU work free.

## [S03] R2 pricing

Source: https://developers.cloudflare.com/r2/pricing/

Standard free allowance: 10 GB-month, 1M Class A, 10M Class B operations; internet egress free. Standard overages: $0.015/GB-month, $4.50/M Class A, $0.36/M Class B. Usage rounds up to provider billing units; do not assume sub-million request charges are prorated.

## [S04] Supabase pricing

Source: https://supabase.com/pricing

Free: 500 MB DB, 50K MAU, 1 GB Storage, 5 GB egress plus 5 GB cached egress; two active projects; inactivity pausing. Pro starts $25/month.

## [S05] Vercel commercial-use restriction

Source: https://vercel.com/docs/limits/fair-use-guidelines

Hobby is personal/noncommercial; a startup deployment cannot assume eligibility merely because it has not collected its first dollar.

## [S06] Supabase production email

Source: https://supabase.com/docs/guides/auth/auth-smtp

Built-in email service is restricted and unsuitable as production delivery infrastructure. Configure custom SMTP or start with Google OAuth.

## [S07] Resend pricing

Source: https://resend.com/pricing

Transactional Free: 3,000/month, 100/day; Pro $20/month for 50K. Daily cap matters for invite bursts.

## [S08] Solana transaction fees

Source: https://solana.com/docs/core/fees

Base 5,000 lamports/signature plus priority fee; fee payer needs SOL. Fee estimates must include every signature.

## [S09] Solana accounts

Source: https://solana.com/docs/core/accounts

Persistent state is stored in accounts with rent-exempt balances. An account deposit is distinct from transaction fees.

## [S10] Solana rent quotation RPC

Source: https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption

Use live getMinimumBalanceForRentExemption for actual serialized byte lengths; do not hardcode a historical rent constant.

## [S11] Solana reduced-rent upgrade

Source: https://solana.com/upgrades/reduced-rent

Phased reductions underway in September 2026; future reductions are not a current quote.

## [S12] Solana cluster guidance

Source: https://solana.com/docs/references/clusters

Devnet is for testing, may reset, and is not durable production evidence; public RPC is rate-limited.

## [S13] Solana transaction-size upgrade

Source: https://solana.com/upgrades/larger-transaction-sizes

Larger transactions were listed as pending mainnet activation September 15, 2026. Design for the conservative 1,232-byte envelope until the target cluster is verified.

## [S14] Anchor documentation

Source: https://www.anchor-lang.com/docs

Rust Solana program framework. Pin mutually compatible CLI, toolchain, client and program versions after a build spike.

## [S15] Helius pricing

Source: https://www.helius.dev/pricing

Free: 1M credits/month, 10 requests/sec, 1 sendTransaction/sec; Developer $49/month. Credits do not uniformly equal requests.

## [S16] Privy pricing

Source: https://www.privy.io/pricing

Fetched page lists free 0–499 MAU, then $299/month for 500–2,499; 50K monthly signatures included. Page contained a future copyright footer, so re-confirm the dashboard quote before commitment.

## [S17] Privy wallet export

Source: https://docs.privy.io/wallets/wallets/export

In-app private-key export is supported; export does not prove exclusive historical control or solve recovery for someone who never exported.

## [S18] Privy security FAQ

Source: https://docs.privy.io/security/security-faqs

Solana exports are standard Ed25519 private keys. Custody, recovery and delegation must be examined for the selected configuration.

## [S19] Crossmint pricing

Source: https://www.crossmint.com/pricing

Alternative: 1,000 monthly active wallets included and listed overage starting $0.05; usage definitions, signature charges and export semantics require a prototype/quote.

## [S20] Solana Attestation Service

Source: https://attest.solana.com/

Existing generic attestation infrastructure. Useful comparison, not evidence that Tessera residual economics are already implemented.

## [S21] Solana attestation schemas

Source: https://solana.com/docs/tools/attestations/schemas

Existing credential/schema abstractions; schema storage alone does not enforce residual allocation.

## [S22] W3C PROV overview

Source: https://www.w3.org/TR/prov-overview/

Established provenance vocabulary; consider an export mapping rather than claiming to invent provenance.

## [S23] C2PA specifications

Source: https://spec.c2pa.org/

Established content-provenance/manifest specifications; an optional interoperability target, not a royalty license.

## [S24] Stripe US Payments pricing

Source: https://stripe.com/us/pricing

Standard domestic online card baseline 2.9% + $0.30; additional products, currencies, disputes and international methods add costs.

## [S25] Stripe US Connect pricing

Source: https://stripe.com/us/connect/pricing

Platform-controlled pricing headline: $2/month per payout-active account, 0.25% + $0.25 per payout; funds-routing line also requires quote/configuration review. No-fee platform model is not automatically equivalent to multi-recipient platform charges.

## [S26] Stripe separate charges/transfers

Source: https://docs.stripe.com/connect/separate-charges-and-transfers

One platform charge can fund multiple connected accounts. Refund/reversal and platform-liability behavior must be implemented explicitly.

## [S27] Stripe embedded onboarding

Source: https://docs.stripe.com/connect/embedded-onboarding

Onboarding can be embedded; recipients still must provide required identity/bank/tax information and consent.

## [S28] Stripe Billing US pricing

Source: https://stripe.com/us/billing/pricing

Pay-as-you-go Billing lists 0.7% of Billing volume, separate from payment processing.

## [S29] US Copyright Office: copyright FAQ

Source: https://www.copyright.gov/help/faq/faq-general.html

Copyright arises on fixation of qualifying original work; poor-man’s-copyright methods do not replace registration.

## [S30] US Copyright Act chapter 1

Source: https://www.copyright.gov/title17/92chap1.html

Sections 103 and 106: derivative-work and exclusive-right principles. Economic allocation cannot license rights the signers do not possess.

## [S31] US Copyright Act chapter 2

Source: https://www.copyright.gov/title17/92chap2.html

Section 204 writing/signature requirement for ownership transfers; distinguish licenses and payment agreements from title.

## [S32] US Copyright Act chapter 5

Source: https://www.copyright.gov/title17/92chap5.html

Section 512 safe-harbor conditions and notice/counter-notice process; no blanket permission for unauthorized adaptations.

## [S33] Copyright Office section 512 resources

Source: https://www.copyright.gov/512/

Operational notice-and-takedown guidance; safe harbor is conditional.

## [S34] DMCA designated-agent FAQs

Source: https://www.copyright.gov/dmca-directory/faq.html

An individual can serve; $6 filing/amendment/resubmission; renewal at least every three years; public contact/address requirements.

## [S35] E-SIGN Act, 15 USC 7001

Source: https://www.law.cornell.edu/uscode/text/15/7001

Electronic form alone does not invalidate a signature/agreement. Other contract and evidence requirements remain.

## [S36] Federal Rule of Evidence 901

Source: https://www.law.cornell.edu/rules/fre/rule_901

Authentication asks whether evidence is what its proponent claims; a key is not automatic proof of a person or authorship.

## [S37] Federal Rule of Evidence 902

Source: https://www.law.cornell.edu/rules/fre/rule_902

Specified electronic-record authentication routes require applicable conditions/certification. A blockchain entry is not automatically self-authenticating truth.

## [S38] Copyright Office AI output guidance

Source: https://www.copyright.gov/newsnet/2025/1060.html

Human expressive contribution matters; an all-AI artifact cannot be marketed as having guaranteed US copyright protection.

## [S39] Existing Tessera blockchain software

Source: https://consensys.io/blog/tessera-the-privacy-manager-of-choice-for-consensys-quorum-networks

Name already used for blockchain infrastructure. This is a naming-risk flag, not a current trademark-status opinion.

## [S40] Existing Tessera financial platform

Source: https://docs.tessera.pe/

Another on-chain product uses the exact name; no name/domain/package clearance is asserted by this packet.

## [S41] Cloudflare React/Vite guide

Source: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/

Supported route for a static React application with Worker API; no need to adopt paid SSR by default.

## [S42] R2 Workers API/checksums

Source: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

R2 put accepts SHA-256 integrity checks and streaming input; range handling and object metadata are available.

## [S43] R2 upload methods

Source: https://developers.cloudflare.com/r2/objects/upload-objects/

Single PUT versus multipart limits, presigned uploads, incomplete upload lifecycle; multipart ETag is not an artifact SHA-256.

## [S44] R2 S3 compatibility

Source: https://developers.cloudflare.com/r2/api/s3/api/

Do not assume every S3 checksum, policy or upload feature exists in R2.

## [S45] Supabase Edge Function limits

Source: https://supabase.com/docs/guides/functions/limits

Edge limits make full-length FFmpeg jobs inappropriate for a free-tier request handler.

## [S46] GitHub Actions billing

Source: https://docs.github.com/en/billing/concepts/product-billing/github-actions

Standard hosted runners for public repos are generally free; private allowances and artifact storage are limited.

## [S47] Cloudflare Turnstile plans

Source: https://developers.cloudflare.com/turnstile/plans/

Free abuse-control option; CAPTCHA alone is not a complete quota/fraud system.

## [S48] Google Ad Manager VAST parameters

Source: https://support.google.com/admanager/answer/10678356?hl=en

Audio ad-serving integration exists; ad tags do not guarantee exchange acceptance, fill or revenue.

## [S49] OpenAI TTS model pricing

Source: https://developers.openai.com/api/docs/models/gpt-4o-mini-tts

Listed baseline: $0.60/M input text tokens and $12/M output audio tokens. Not a fixed price for a finished drama; API free tier not supported for this model.

## [S50] ElevenLabs sound-effects offering

Source: https://join.elevenlabs.io/sound-effects

Fetched offering lists Starter $6/month and Creator $22/month ($11 first month); free outputs marked personal use. Verify API resale/embed licensing separately.

## [S51] Solana Foundation funding

Source: https://solana.org/grants-funding

Milestone-based public-goods and convertible grant pathways; applicants need budget and milestones. No incubator/grant approval is assumed.

## Research limits

A public Solana RPC rent probe from the execution environment failed DNS resolution. No live rent estimate, bytecode deployment, mainnet transaction, provider account provisioning or trademark clearance was performed. Solana rent and transaction format were changing during the research date; scripts must quote the actual target cluster. Some provider web pages render inconsistently by region; use US Stripe configuration and confirm amounts in the dashboard. Privy's retrieved pricing page contained a future footer, so its published figures are planning inputs requiring confirmation.

Story's public license-terms material was located, but the royalty documentation URLs tested were unavailable. Treat Story as a prior-art review task, not a completed exact-mechanism comparison. The investigation did establish existing Solana attestation tools and established provenance standards. No patentability or novelty opinion is made.

Neither the specific incubator nor a grant deadline was supplied. No funding eligibility, relationship or commitment has been inferred. This packet deliberately avoids depending on a future award.
