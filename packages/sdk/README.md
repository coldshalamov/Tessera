# @tessera/sdk

TesseraPort implementation over real Solana JSON-RPC — packet T04.

- **No `@solana/web3.js` / `@coral-xyz/anchor` client.** The full instruction
  surface is 4 instructions; instruction encoding, transaction compile and
  PDA derivation are hand-rolled over `fetch` + WebCrypto + `@noble/ed25519`,
  so the package stays Workers-safe and dependency-light. Byte layouts are
  asserted against the committed IDL/golden vectors in `tests/sdk`.
- **Modes are honest labels:** `local` (a local validator such as
  `solana-test-validator`), `devnet` (test evidence — never labeled
  permanent), `mainnet` (read-only in this build; every write returns
  `MAINNET_WRITES_DISABLED`).
- **Signing is injected.** A `TransactionSigner` signs the serialized
  transaction *message*; the off-chain detached consent signature over the
  intent digest is verified separately in `submitSignedContribution`. A fee
  payer is never an author (docs/04).

## Quick sketch

```ts
import { createSolanaTesseraPort, LocalTransactionSigner } from '@tessera/sdk';

const sponsor = await LocalTransactionSigner.fromKeypairJson(process.env.SPONSOR_KEYPAIR_JSON!);
const port = createSolanaTesseraPort({
  mode: 'local',
  rpcUrl: 'http://127.0.0.1:8899',
  payer: sponsor,                     // optional sponsor fee payer
  signers: [contributorSigner],       // injected user key
  expectedGenesisHash: '…',           // optional hard pin — wrong cluster hard-fails
});

const info = await port.connect();              // genesis + program + deployment checks
const project = await port.createProject({…});  // payer funds the PDA
const prepared = await port.prepareContribution({…});
// … collect the detached consent signature via @tessera/identity …
const sub = await port.submitSignedContribution(signedIntent, idempotencyKey);
```

Ambiguous outcomes (timeout, expired blockhash, dropped send response) are
resolved by reading the canonical node PDA and comparing the stored intent
digest — never by blind resubmit. A provably-absent PDA is reported as
`TRANSACTION_EXPIRED` and the **same intent** may be rebuilt with a fresh
blockhash (the nonce makes replay idempotent).

`publish_statement` is **not deployed** in program v1: `prepareStatement`
produces correct StatementV1 wire bytes/digest; `submitStatement` returns
`UNSUPPORTED_VERSION` honestly.

See `reports/sdk-conformance.md` for the live localnet run evidence and the
acceptance matrix.
