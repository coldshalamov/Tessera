# Deployment and operations

Use [shared setup](../shared/SETUP_RUNBOOK.md) and [cost register](../shared/LAUNCH_BUDGET.md). This is a plan; no provider resource has been created by this seed.

## Environments

Local: local validator, deterministic fixture signer, filesystem evidence, localhost explorer. No production secrets.

Demo: Cloudflare static explorer and bounded read API, devnet program, free RPC, approved test identities. Persistent banner says test chain/resettable. A single Morpheus demo API can host the relayer adapter initially, but Tessera package/core must not require its database.

Pilot: distinct mainnet program ID, approved sponsor account, managed-key adapter, production terms, provider-controlled access, explicit SOL budget and external review. Keep its deploy authority separate. Read-only inspection can be public while subsidized creation is allowlisted.

## Resource setup order

Pin toolchain → run local suite → compile/measure binary → quote devnet/mainnet account sizes → deploy devnet → publish SDK artifact → connect explorer and Morpheus adapter → restore/export test → review → obtain exact approved mainnet funding → deploy capped pilot. An agent must not purchase SOL, enable recurring billing or revoke upgrade authority without the founder's explicit authorization.

Cloudflare static hosting is sufficient for explorer/docs; dynamic RPC proxy requests consume Worker quota. Protect RPC keys from browser exposure if provider policy requires secrecy, and prevent a public proxy becoming arbitrary RPC abuse. Allowlist read methods and cap result sizes. Local client users may supply their own endpoint without logging its credential.

## Observability

Track publish attempts/success/finalization latency, duplicate recovery, rejected sponsor requests, remaining SOL, account/byte counts, RPC credit estimates, index lag, failed exports and version mismatches. Structured logs contain correlation ID, project/node/intent hash, error code and duration, not metadata bodies or keys by default.

Alert before balances/quotas exhaust; impose hard application sponsorship limits. When insufficient SOL, keep drafts and signed intents, return `SPONSOR_BUDGET_EXHAUSTED`, and stop accepting immediate-finality promises. Do not auto-buy crypto or silently switch to another network. Read and export should remain available if writes pause.

## Backup, restore and shutdown

Daily logical backup of operator configuration, node index and public metadata/terms inventory; encrypted operational secrets handled separately. Save reproducible code/IDL/decoder artifacts. Perform a documented monthly demo restore and before each major schema/program release. A failed restore is a release blocker for durability claims.

If the service shuts down, disable new signatures/payments, export affected records and terms, publish program/SDK addresses and hashes, preserve a static verifier and explain what is no longer hosted. Users' names and public signed history cannot be scrubbed from an immutable chain by closing the company. Contracts, assets and any owed money follow applicable law; this software has no special bankruptcy privilege.
