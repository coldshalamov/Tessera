# Reference tools

`python tools/reference_economics.py --self-test` runs deterministic examples and 2,500 randomized economic paths using only the standard library. It is a specification reference, not a production implementation or live money router.

`python tools/inspect_signature_fixture.py` validates the exact binary layout and hashed original files with the standard library; it additionally verifies Ed25519 if the Python cryptography package is installed. Use `--require-signature` to require that optional check. The network/program/project are fictional; this is not a transaction-finality proof.

`python tools/validate_seed.py` checks local Markdown links, JSON syntax and the original delivery file inventory. Once implementation edits the seed, use `--skip-inventory` for ordinary link/JSON checks and rely on Git/history/CI for new source integrity. The original delivery manifest is intentionally a snapshot, not a mutable source-of-truth checksum list for all future commits.
