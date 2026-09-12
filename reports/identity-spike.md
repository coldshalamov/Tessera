# Identity spike report — T02

**Scope.** `packages/identity` implements the `IdentityPort` signer boundary:
a `LocalTestSigner` (in-memory CSPRNG Ed25519 keys, honest custody labels),
the consent-freeze → sign → audit flow, cancellation-without-record,
reauthentication-gated raw-key export, KEY_CONTINUITY identity-link
build/verify helpers, and scope-checked detached-signature verification.
`UnconfiguredProviderSigner` is the standing boundary for a managed embedded
provider: every call returns `PROVIDER_NOT_CONFIGURED`.

**No live provider was tested.** No Privy/Crossmint account exists; no API
credentials were created; no production signing path is enabled. Everything
below about providers comes from public documentation fetched on the recorded
access date — it is *what an integration would require*, not verified
behavior.

## What a managed embedded-provider integration would require

### Privy (candidate)

Sources (accessed 2026-09-12):

- Pricing: <https://www.privy.io/pricing>
- Export: <https://docs.privy.io/wallets/wallets/export>
- Security/key architecture: <https://docs.privy.io/security/wallet-infrastructure/architecture> and <https://docs.privy.io/security/wallet-infrastructure/advanced/user-device>
- Recovery/new-device provisioning: <https://docs.privy.io/wallets/advanced-topics/new-devices/provision-new-devices>

Facts from those docs:

- **Key custody model.** Distributed key sharding (Shamir): an enclave/TEE
  share plus an auth share (2-of-2); keys are reconstituted only inside a TEE
  at signing time, or optionally on-device (device + auth + recovery shares).
  Published claim: neither Privy nor the app ever holds a complete key.
- **Export semantics.** Client-created wallets: `exportWallet` React-SDK modal
  only (browser-only; mobile via a hosted WebView page); the key is assembled
  on a different origin so the app/provider "can never access" it. Server-created
  wallets: server SDK `wallets().exportPrivateKey()` or REST
  `POST /v1/wallets/{wallet_id}/export` over HPKE, owner-restricted, can be
  blocked by a `DENY` policy. Important default: users can unilaterally export
  with their access token unless the app sets a 2-of-2 key quorum (user +
  app authorization key).
- **Recovery model.** `recovery_method` of `'privy'` recovers automatically;
  otherwise `user-passcode`, `google-drive`, `icloud`, or
  `recovery-encryption-key` via `useRecoverEmbeddedWallet`; new devices are
  provisioned by transferring key material after auth-factor checks.
- **Pricing (the MAU cliff).** Developer free for 0–499 MAU (50K signatures
  and $1M tx volume free/month); Core $299/mo at 500–2,499 MAU; Scale $499/mo
  at 2,500–9,999 MAU; Enterprise custom beyond. MAU = *any*
  Privy-authenticated user with an active session in 30 days — so if Privy
  also provides login auth, **every listener counts**, not just contributors;
  signatures are metered separately ($0.01/signature over 50K under PAYG, plus
  a $2,000 PAYG base fee above 10K MAU). Cancelling paid tiers drops feature
  access beyond 500 MAU and blocks new sign-ups.

What integration would require: Privy account + app registration, App
ID/secret in env (never in repo), a consent UI wired to `signMessage`/
`raw_sign`-class calls on the 32-byte intent digest (or the transaction
signing path for T03+), an explicit decision on user-vs-quorum export
control, recovery-method selection, and budget sign-off for the 500-MAU
cliff.

### Crossmint (alternative)

Sources (accessed 2026-09-12):

- Pricing: <https://www.crossmint.com/pricing>
- Export (Wallets SDK v1): <https://docs.crossmint.com/wallets/guides/export-private-key>
- Webhooks incl. `wallets.signer.exported`: <https://docs.crossmint.com/wallets/guides/webhooks>
- Embedded wallets overview: <https://docs.crossmint.com/wallets/concepts/embedded-wallets>

Facts from those docs:

- **Key custody model.** Non-custodial smart wallets / key management on the
  free developer tier; custodial treasury wallets exist but are a Custom-tier
  product. Master secret is split into device share + auth share; the private
  key is derived inside Crossmint's TEE via HKDF.
- **Export semantics.** `ExportPrivateKeyButton` works **only for email/phone
  signer types** — passkey, external-wallet and API-key signers do not expose
  private keys *by design*. Requires a client-side API key with the
  `wallets.export` scope (Console). Inside a TEE iframe the key is derived
  (ed25519 for Solana/Stellar) and copied to the user's clipboard as
  base58/hex/strkey — never exposed to the host app. A
  `wallets.signer.exported` webhook fires once per wallet (no key material),
  which gives the app an export audit signal.
- **Recovery model.** Published claim: users can recover access after losing
  their main signer; "advanced account recovery (call center)" is a Custom
  feature. Exact recovery quorum details would need console access to verify.
- **Pricing.** 1,000 free Monthly Active Wallets; overage from $0.05/MAW,
  volume discounts. MAW = a wallet included in *any* API request (creation,
  address fetch, signing, transfer) — cheaper entry than Privy's 500-MAU
  cliff but metered per wallet touched rather than per authenticated user.

What integration would require: Crossmint Console project + scoped API key,
choosing an exportable signer type (email/phone — passkey signers can't
export at all, which directly conflicts with docs/05's export requirement),
TEE iframe embedding for the export flow, webhook endpoint for export audit.

## The exact missing founder action (approval gate)

Production embedded-provider signing is **disabled by construction**
(`UnconfiguredProviderSigner` → `PROVIDER_NOT_CONFIGURED`). To unblock it, the
founder must:

1. Pick a provider (Privy vs Crossmint — their export/recovery semantics
   differ materially, above) and create the account/application.
2. Supply credentials via environment — never committed to the repo.
3. Approve the pricing model against the launch budget (Privy: free ≤499
   MAU then $299/mo; Crossmint: 1,000 free MAW then ~$0.05/MAW) and the
   custody/recovery disclosure language.
4. Confirm the signer type supports raw-key export (Crossmint passkey/API-key
   signers cannot export — that would violate the docs/05 export contract).

## Implemented instead (test/local path)

- `LocalTestSigner`: per-instance CSPRNG keys or injected `secret_key_hex`,
  `custody_mode` configurable (`server_custodied` default per docs/05, or
  `user_controlled`), disclosure string always attached.
- Consent: `freezeConsent` snapshots {kind, digest, shown fields, session};
  `signIntent`/`signStatement`/`signIdentityLink` recompute the digest and
  refuse mismatch (`CONSENT_MISMATCH`), reuse (`CONSENT_STATE`), missing
  (`CONSENT_NOT_FOUND`) or foreign contributor (`SIGNER_MISMATCH`); single-use
  consent; `cancelConsent` produces no signature record.
- Reauth/export: `reauthenticate` issues a 300-second session-bound ticket;
  `exportSecretKey` returns the raw 32-byte seed as `bytes`/`hex`/`base58`
  and never logs material (test-verified against an injected logger).
- Independent verification: noble-produced signatures verify under WebCrypto
  and vice versa (PKCS8-wrapped seed imports into WebCrypto Ed25519).

## Test evidence

`tests/signatures` — 110 Vitest cases, all passing at commit time
(`pnpm -r test` exit 0; see `status/WORK_LOG.md` session for T02 for exact
output). Includes: 348-byte golden fixture decode→re-encode byte-identity,
13 generated golden vectors (9 intent + 4 statement, all four statement
types), per-field mutation digest/signature invalidation, cross-scope replay
rejection, consent/cancel/reauth/export semantics, KEY_CONTINUITY round-trip
with countersignature verification and the fraudulent-rotation surfacing
path, and RELEASE_ANCHOR manifest-digest binding.

## Known limitations (honest)

- `LocalTestSigner` holds raw seed bytes in process memory — correct for a
  test/local adapter, **not** a production custody claim. docs/05's minimum
  server-custody engineering (authenticated encryption, nonces, associated
  data, separate encryption root, scoped signer service) is a T04+/services
  concern when a real persistence layer exists.
- `reauthenticate` is a simulated step-up (random ticket + TTL), not a real
  auth-provider challenge; it exists to prove the export gating semantics.
- No provider SDK was exercised; every provider fact above is doc-cited and
  unverified against a live account.
