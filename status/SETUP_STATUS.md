# Setup status

No external resources were provisioned in the specification session. Fill IDs only after actual creation/verification. Never store secret values here.

| Resource | Environment | State | Identifier / evidence | Human gate |
|---|---|---|---|---|
| GitHub repository | source | Founder plans to create | Not supplied | Owner/visibility/remote |
| Cloudflare project | demo | Not created | — | Authorized account/terms |
| Supabase project | demo | Not created | — | Authorized account |
| Google OAuth | demo | Not configured | — | Account/consent configuration |
| Private R2 bucket | demo | Not created | — | Account/billing activation if required |
| SMTP sender | demo | Not configured | — | Domain/account verification |
| Signing identity | test/pilot | Default: platform-provisioned server-custodied Ed25519 with in-settings export; managed embedded provider is an optional upgrade | `reports/identity-spike.md` (Privy/Crossmint export/recovery/pricing facts, T02) | Provider/custody review before any switch — founder picks provider, creates account, supplies credentials, approves pricing |
| Tessera program | local/devnet/mainnet | Not deployed | — | Mainnet budget/authority approval |
| Sponsor key/budget | mainnet | Disabled | — | Funding and cap |
| Stripe/Connect | live | Disabled | — | Business/KYC/fees/terms |
| Brand/domain | public | Not cleared/purchased | — | Naming review and checkout |
| Content/legal contact | public | Not configured | — | Actual permissions/contact/terms |

Keep test and live identifiers separate. A tool returning a local simulation does not change a live resource's state.

## Local toolchain (verified 2026-09-12)

| Tool | State |
|---|---|
| Node / npm / pnpm | Node v24.15.0, npm 11.5.2, pnpm 12.4.1 — installed, working |
| Rust | rustc/cargo 1.94.1 (Windows) — installed |
| Git identity | configured (coldshalamov) |
| WSL2 Ubuntu-24.04 | working — Solana toolchain installed inside: Rust 1.98.1, Agave/Solana 3.1.10, Anchor 1.2.0 (run via `wsl -d Ubuntu-24.04 -- bash -lc ...`); see `ops/wsl-solana-install.sh` |
| Docker Desktop | running — enables `supabase start` local stack and local validators |
| supabase CLI | not installed; install as dev dep (`supabase` npm package) when needed |
| Tessera pnpm workspace | installed on `packet/t01` — `@tessera/types` + `@tessera/math` build/test/typecheck/lint clean (T01) |
| Tessera signing workspace | `@tessera/identity` + `tests/signatures` added on `packet/t02` — build/test/typecheck/lint clean (T02); signing dep `@noble/ed25519@3.2.0` pinned; no provider account provisioned |
