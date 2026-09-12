# Start here

Put this folder in a local directory named `Tessera` and initialize the separate repository there. The sibling `Morpheus` folder is the other repo, not a subdirectory to vendor wholesale. GitHub repository names, owner and visibility are founder choices; no remote is assumed.

## Reading order

1. [Founding decisions](shared/FOUNDING_DECISIONS.md): purpose, names, non-negotiable behavior and corrected risks.
2. [Product](docs/00_PRODUCT.md): what must actually work.
3. [Integration contract](shared/INTEGRATION_CONTRACT.md) and [acceptance scenario](shared/ACCEPTANCE_SCENARIO.md): the handshake between agents/repos.
4. [Repo map](REPO_MAP.md) and [backlog](BACKLOG.md): exact specification paths and executable work packets.
5. [Launch budget](shared/LAUNCH_BUDGET.md), [setup runbook](shared/SETUP_RUNBOOK.md) and [sources](shared/RESEARCH_SOURCES.md): costs, human gates and evidence.

## Local initialization, examples only

```sh
cd Tessera
git init
git add .
git commit -m "Initialize Tessera specification and agent packets"
```

Do not invent a GitHub remote URL or upload source publicly without founder authorization. Once the founder creates the corresponding remote, connect that exact URL. Development agents must use branch/worktree isolation and commit complete current work rather than claiming an unsaved implementation exists.

## Ready-to-run references

Run `python tools/reference_economics.py --self-test` and `python tools/validate_seed.py`. These use only the Python standard library. They validate economic examples and seed integrity, not an unbuilt Solana program.

## Start the engineering

T01 implements the pure math/schema package and golden fixtures. T02–T04 then establish signing, on-chain state and SDK. Explorer/export can be developed against fixtures while the program is built.

Providers and money do not need to be live to finish local engineering. Where a founder step is truly required, record it in `status/SETUP_STATUS.md`, preserve a working local path and continue other unblocked tasks. Never call simulated payments or resettable devnet records live/permanent.
