# Embedded signing identity and key safety

## UX contract

An ordinary application login must be sufficient to create and sign a contribution. No required wallet extension, crypto exchange, external site or manual SOL purchase. Apps may automatically create an Ed25519 identity after signup or on first creator action; the latter is a cost optimization, not a visible crypto hurdle. A listener-only profile should not automatically consume a costly active-wallet session when no signature is needed.

The account has a public address, historical signed records and an optional export control. Settings use plain labels such as “Contribution identity,” “Download evidence” and “Export signing key.” Public identity and private recovery are different downloads. Exporting public history must never include private keys.

## Trust models: do not hide the distinction

`user_controlled`: a key is held on a device/external wallet under the user's control. A session still can be compromised.

`embedded_provider`: ordinary login unlocks a provider-managed key under explicitly configured recovery/delegation. Verify actual signing and export semantics. Published product claims are not a substitute for a prototype.

`server_custodied`: the application can decrypt/sign using a server-held key. Encrypting it does not change the fact that the server may impersonate the contributor. It can provide a practical low-cost test, but must not claim exclusive personal authorship or non-repudiation. A compromised server could forge new signed assertions.

Record the custody/signing mode as contextual evidence. Attribution to a real person relies on account linkage, consent records and other evidence; a self-chosen name is merely a claim. [S17,S18,S29–S37]

## Initial implementation choice and gates

Local/devnet reference mode uses independently randomly generated test keys and no real-value custody. The default mode for demo **and** public pilot is `server_custodied`: a platform-generated per-user Ed25519 key provisioned silently at login, encrypted at rest per the minimum engineering below, and exportable from Settings. This is an honestly disclosed custody choice — `custody_mode` and exported evidence always show it, and the server-impersonation warning in the trust-model section stands unchanged. It is not a claim of exclusive personal authorship or non-repudiation.

A managed `embedded_provider` adapter is an optional upgrade path, not the launch requirement; adopting it in production needs a cost/security/recovery review first. Privy is a candidate, not a compulsory vendor; its published 500-MAU price cliff must be budgeted. Crossmint is an alternative whose smart-account identity/export behavior may differ [S16–S19]. Keep `IdentityPort` replaceable and use an ordinary Ed25519 signer as the core protocol identity.

Do not delay the whole product pending a vendor. Build against the server-custodied adapter, keep mainnet-signing off until approved, and finish the player/collaboration/proofs. Changing custody modes or promoting a convenient test custody backend into production with valuable contracts requires the documented disclosure/review gate — never a silent settings change.

## Minimum server-custody engineering for tests

Use a CSPRNG per-user key; never derive all users from one predictable database ID or a shared public seed. Encrypt private material with authenticated encryption and fresh nonces, binding user ID, key ID and format as associated data. Encryption root lives outside the database in restricted secret storage. Limit decrypt/sign operations to a narrowly scoped signer service, with consent-intent digest allowlists and rate limits. Do not log private material, export tokens, cookies or signed-in browser storage.

DB backup plus ciphertext is not a recoverable system unless the encryption root is backed up separately and restore is tested. Conversely, one database and one master secret compromise exposes every custodial identity. Document this blast radius instead of claiming encryption eliminates it.

## Consent and signing

Show exact parent/artifact/claim/terms before approval. Bind the user's authenticated session and consent event to the frozen intent hash. The signing service only signs that intent; it must refuse altered claims, requests from another user or arbitrary transactions. Step-up authentication for economically consequential signature, recovery change and export is strongly preferred; do not re-prompt for every harmless player action.

Detached signing and native transaction signing may be two SDK calls behind one explicit consent. Provider throttling, cancellation and token expiry must produce retryable states without publishing a different claim. A malicious or compromised backend remains a threat when it controls the signing path; document what security an embedded provider actually adds.

## Export, continuity and loss

Key export requires recent authentication, an explicit warning and a safe in-app provider/export flow. Prefer client-side delivery/download without logging. A copied key can have multiple holders; export does not prove exclusive control or cause the server/provider to forget existing authority. The founder must not receive user private keys through support requests.

V1 identifies each contribution by its signing key. The key-continuity record format is specified in v1: a `KEY_CONTINUITY` `StatementV1` ([binary layout](14_BINARY_LAYOUT_V1.md)) is signed by the old key and names the new public key in `aux_key`; its committed payload is a canonical identity-link JSON that should embed the new key's countersignature so both sides attest. Chained records form an A→B→C lineage verifiable from exports after the application disappears. The `publish_statement` instruction may still land in a later packet, but the record format already exists. Continuity helps link identities but does not itself transfer copyright or redirect every past payment. If the old key is lost, a unilateral new-key claim does not prove continuity. Application account recovery may restore access through a provider's recovery policy, whose trust assumptions must be disclosed.

A compromised old key can sign a fraudulent rotation. Do not promise simple A→B rotation solves compromise. A future recovery/controller or delay/challenge design needs a separate threat model. For v1, preserve records, annotate disputes, require strong payment-account verification and avoid pretending there is trustless lost-key recovery.

## Acceptance tests

Normal Google login → contribution sign without wallet setup; cancellation → no node; session theft simulation → risk documented/step-up applied; user A cannot sign B's artifact; key export round-trips in an independent Ed25519 verifier; records remain verifiable after login account deletion; provider outage queues publication without losing drafts; no private bytes in client bundles/logs/artifacts; exported evidence cannot spend or sign; custody mode is visible in evidence.
