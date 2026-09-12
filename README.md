# Tessera

Repository seed • specification draft 0.1 • researched 2026-09-11

General-purpose Solana contribution and economic-lineage infrastructure. Morpheus is its first application, not its parent.

This folder is ready to become its own Git repository. It contains the product specification, implementation packets, integration contract, cost/setup research, acceptance criteria and reference artifacts. It does **not** contain a completed application or deployed smart contract. No account, domain, mainnet program, payment system or trademark clearance has been created by this packet.

Start with [START_HERE.md](START_HERE.md), then [AGENTS.md](AGENTS.md) and [REPO_MAP.md](REPO_MAP.md). The implementation queue is [BACKLOG.md](BACKLOG.md). The founder's decisions and corrections to earlier assumptions are in [shared/FOUNDING_DECISIONS.md](shared/FOUNDING_DECISIONS.md).

The name is **Tessera**, without “Protocol” as a brand suffix. The two repositories are independently versioned and join through [shared/INTEGRATION_CONTRACT.md](shared/INTEGRATION_CONTRACT.md). Copies of `shared/` are intentionally identical in both folders; change ownership and synchronization rules are explicit.

## Launch constraints

The first complete hosted demonstration can use bounded free-tier services and test-chain records. Mainnet account/deployment capital, legal/security review, live payment operations and provider overages are not free. [The launch budget](shared/LAUNCH_BUDGET.md) separates those gates and prices every identified service category. [The setup runbook](shared/SETUP_RUNBOOK.md) distinguishes what agents can automate from identity, consent, billing and approval actions the founder must own.

Names are retained as requested, but not legally cleared. Existing Tessera-branded blockchain products were found. Do not silently rename the products or spend heavily on either brand before the naming review gate.

## First agent instruction

Read `AGENTS.md` and the first uncompleted packet in `BACKLOG.md`, then implement its real outputs and acceptance tests. Work from this repository; do not ask the founder to reconstruct the conversation. Preserve code/tests/work log in the current session even if a provider-dependent step is blocked. Use tested local adapters so external setup does not stop independent implementation.

The reference files are tools for specification verification, not representations of production readiness. Their test report describes exactly what was exercised.
