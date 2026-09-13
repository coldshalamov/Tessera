# @tessera/relayer — bounded sponsor service

A local/devnet sponsor relayer for Tessera contribution writes. It co-signs
only transactions it **built and reviewed itself** from a frozen semantic
intent — it never signs client-supplied wire bytes, never forwards arbitrary
transactions, and holds no custody of contributor or controller keys.

## What it does (and does not do)

- **Does**: parse + verify the client's detached Ed25519 consent signature
  over the intent digest; run the SDK's on-chain `preflightContribution`
  policy; compile the transaction server-side (`buildContributionMessage`)
  with the sponsor as fee payer; verify every required client signature over
  the stored message; hard-cap daily + per-account lamport outlay; persist a
  durable JSON outbox with retry/backoff; reconcile ambiguous sends by PDA
  lookup (never blind-resubmit); append a secret-free JSONL audit log.
- **Does not**: accept wire transactions for signing, sponsor more than one
  reviewed instruction per tx, sponsor any program other than the pinned
  Tessera program id, sponsor anything but `publish_root` /
  `append_contribution`, run on mainnet (`TESSERA_RELAYER_MODE=mainnet` is a
  config error), or store secrets.

## The sponsor safety rule

Before the sponsor signs, `reviewSponsoredMessage` decodes the message and
requires an **exact match** against the relayer's own build for the reviewed
intent: single instruction, allowlisted program + discriminator, identical
account metas (order + signer/writable flags), fee payer = sponsor, and no
signer outside the expected set. A token transfer, an account close, a CPI
bundle or a substituted account all fail this check structurally.

## Configuration (env only; the sponsor key is referenced, never committed)

| Env | Meaning |
| --- | --- |
| `TESSERA_RELAYER_MODE` | `local` (default) or `devnet`; `mainnet` refused |
| `TESSERA_RELAYER_RPC_URL` | JSON-RPC endpoint (required) |
| `TESSERA_SPONSOR_KEYPAIR_FILE` | Path to a Solana-CLI JSON keypair outside the repo |
| `TESSERA_SPONSOR_KEYPAIR_JSON` | Alternative: the keypair JSON inline (tests/containers) |
| `TESSERA_SPONSOR_DAILY_CAP_LAMPORTS` | **Required.** Hard UTC-day lamport cap |
| `TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS` | **Required.** Hard per-contributor cap |
| `TESSERA_RELAYER_OUTBOX_FILE` | Durable outbox path (atomic JSON) |
| `TESSERA_RELAYER_AUDIT_FILE` | Append-only JSONL audit path |
| `TESSERA_RELAYER_KILL_SWITCH` | `1` pauses the service (intents preserved) |
| `TESSERA_RELAYER_KILL_FILE` | Presence of this file also pauses |
| `TESSERA_RELAYER_EXPECTED_GENESIS` | Optional genesis pin — wrong cluster hard-fails |
| `TESSERA_RELAYER_MAX_ATTEMPTS` / `_BASE_RETRY_MS` / `_MAX_RETRY_MS` | Send retry policy |
| `TESSERA_RELAYER_CONFIRM_TARGET` / `_CONFIRM_TIMEOUT_MS` | `confirmed`/`finalized` + poll bound |
| `TESSERA_RELAYER_LISTEN` | `host:port` for the HTTP adapter (default `127.0.0.1:8787`) |

## HTTP surface

```
GET  /healthz                       liveness (+ paused flag)
GET  /v1/relayer/status             caps, spend, outbox counts
POST /v1/contributions/prepare      {intent, consent_signature_base64, idempotency_key}
                                    → {message_base64, required_client_signers, ...}
POST /v1/contributions/submit       {idempotency_key, tx_signatures: {pubkey: sig_b64}}
GET  /v1/submissions/:key           idempotency key or intent digest
```

Every response is a contract `PortResult`: `{ok, value}` or
`{ok:false, error:{code,message}}` — typed codes, never 500 soup, never
secrets in error strings.

## Run

```sh
pnpm --filter @tessera/relayer build
TESSERA_SPONSOR_KEYPAIR_FILE=/path/outside/repo/sponsor.json \
TESSERA_RELAYER_RPC_URL=http://127.0.0.1:8899 \
TESSERA_SPONSOR_DAILY_CAP_LAMPORTS=500000000 \
TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS=100000000 \
TESSERA_RELAYER_OUTBOX_FILE=/var/tessera/outbox.json \
TESSERA_RELAYER_AUDIT_FILE=/var/tessera/audit.jsonl \
node services/relayer/dist/cli.js serve
```

Devnet usage is identical except `TESSERA_RELAYER_MODE=devnet` and a devnet
RPC URL; evidence produced is labeled test evidence, never a mainnet record.
