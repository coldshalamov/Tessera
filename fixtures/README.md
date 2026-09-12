# Reference fixtures

`economics.json` contains symbolic test paths and exact integer settlement expectations. `shared/economic-vectors.json` is identical in both repos. Symbolic nodes A/B/C are not chain addresses.

`intent-v1.json` and `intent-v1-signature.json` demonstrate actual Ed25519 signature verification over the proposed exact binary intent. Network/program/project values are fictional; no transaction or account exists. The private test-key seed used during generation must never be used for production or funded. Only the public key/signature are distributed here.

`artifact.txt`, `metadata.json` and `terms.txt` are exact fixture bytes whose hashes are committed by that intent. Metadata intentionally uses compact JSON with no trailing newline. Hash exact bytes; do not load/reserialize the JSON before checking. Test terms are not a usable legal agreement.

Reference code verifies economics with the Python standard library. The signing vector was verified locally with the installed cryptography implementation at packet generation. Rust/TypeScript independent verification and actual account/PDA/IDL vectors remain required implementation tasks; they have not been claimed complete by this seed.
