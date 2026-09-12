# Agent-assisted setup runbook

This is an execution plan for agents with an authorized local checkout and, when necessary, an authenticated browser. This packet itself has not provisioned anything. Prefer documented APIs/CLIs over coordinate-clicking; use current browser snapshots for dashboard-only steps. Do not assume a connector, account role or credential exists.

## Authority and human handoffs

An authorized agent may scaffold code, create local configuration, run tests, prepare provider resources within an approved account/budget, inspect deployment output and draft legal forms. The founder must personally supply/approve identity details, accept binding account terms and license grants, complete CAPTCHA/MFA/KYC when required, authorize card entry/purchases, own recovery secrets, and approve production money movement/mainnet upgrade changes. Agents may prepare those screens, not impersonate the founder or bypass security checks. Never put a private key, OAuth secret, authenticated browser state or card details into git, PR text, screenshots or chat logs.

## Setup sequence and proof of completion

| Step | Agent work | Human/external dependency | Proof |
|---|---|---|---|
| Local repos | Initialize each folder, install pinned toolchains, run packet checks | Founder chooses actual repo owner/visibility | Git status, lockfiles, passing fixture tests |
| GitHub | Connect approved remotes, least-privilege CI, branch rules | Repo creation/access approval; user is creating repos | URLs/commit SHAs; no fabricated PR |
| Cloudflare | Worker/static app configs, dev/prod resources, routes | Account login/terms; approve billing if requested | Preview URL plus real smoke test |
| Supabase | Local migrations then remote project/RLS | Account login; actual project choice | Policy test with two users; schema version |
| Google OAuth | Prepare web OAuth client, exact redirect URI, minimal scopes | Cloud project ownership, consent/branding verification if requested | Login returns to correct site; no server-side token leak |
| Email | Configure SMTP/API and DNS DKIM/SPF/DMARC | Domain ownership; deliverability review | Real approved test recipient receives message |
| R2 | Private bucket, binding, lifecycle, upload limits, checksummed streaming path | Activate R2; billing/card confirmation if required | File hash verified; byte-range playback; no public bucket |
| Signing | Provider abstraction, in-app embedded signer; local/devnet adapter | Selected provider setup/terms; confirmation of free tier | In-app signing/export/import rehearsal |
| RPC | Backoff/cache; create scoped API token if chosen | Provider signup and token approval | Finalized reads, controlled throttle test |
| Tessera chain | Local tests, devnet deploy, record byte/rent measurements | Faucet availability; mainnet review/SOL authorization later | Program ID, binary hash, upgrade authority record |
| Moderation | Report UI, restricted release state, takedown mailbox workflow | Legal operator/contact address and policy approval | Test notice removes access without erasing evidence |
| Payments | Test-mode Checkout, webhook signatures, Connect sandbox, ledger | Actual Stripe approval/bank/tax onboarding later | Duplicate/refund/chargeback sandbox tests |
| Domain | Prepare DNS and OAuth route migration | Buy/authorize exact name; naming clearance | TLS, redirects, email, origin policies retested |
| Production release | Run gates and stage changes | Explicit go-live approval | Signed deployment checklist and rollback rehearsal |

## CLI contract agents should implement

Both repos must eventually expose `pnpm doctor`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm verify:packet`, `pnpm deploy:preview`. Tessera additionally `pnpm test:program`, `pnpm quote:mainnet`, `pnpm verify:bundle`. Morpheus additionally `pnpm db:reset`, `pnpm test:rls`, `pnpm test:payments`, `pnpm backup:export`. These commands are required future interfaces, not scripts claimed to exist in this seed. The supplied Python packet checks run now.

`doctor` reports capabilities/versions without printing secret values. Missing external credentials create a clear configuration status; local development, fixture adapters and unrelated work continue. No mock is labeled production-connected.

## Browser-agent procedure

Navigate → snapshot current interactive elements → act on current references → re-snapshot after navigation. Check domain before login or secret entry; reject lookalike pages. A displayed price upgrade, card form, policy acceptance or money movement is a human approval boundary, not an obstacle to click through automatically. Store any necessary session-state file outside the repo, treat it as a credential, and delete it when no longer needed.

Verify deployed UI through actual browser interactions and inspect screenshots: signup, casting, upload, consent, player, export and failure states. Automated Chromium/WebKit tests supplement, not replace, one real iOS Safari/background-audio check. Keep an evidence log of URL, environment, commit, test outcome and nonsecret screenshot path. Never state “works” based only on a build.

## Local-first escape hatches

No provider access: use Supabase local plus object-storage fixture server; complete all UI/domain tests. No devnet faucet: local validator proves program behavior; mark hosted demo's chain adapter simulated. No wallet-provider budget: remain invite-limited or local/devnet, evaluate another adapter; do not quietly bill or ship plaintext key storage. No paid mainnet review: keep developing the full product while mainnet writes remain off. No audio-generation credits: use rights-cleared human audio, never fake a provider generation.

## Credentials and environments

Separate local, preview and production secrets and buckets. Frontend variables contain only publishable keys/URLs. R2/Supabase privileged keys, RPC write secrets, provider API credentials, sponsor key and Stripe secrets remain server-only. Scope deployment tokens by account/project and CI environment; require approval for production. Use short-lived credentials/OIDC when supported. Credential rotation must not rewrite historic contribution records.

No agent commits to main or merges unreviewed security-sensitive code merely to make a checklist green. Save a feature branch, useful tests, migration notes and exact remaining gate. Ordinary implementation should continue autonomously; real legal/financial authorization should not.
