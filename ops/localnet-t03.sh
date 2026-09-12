#!/bin/bash
# T03 localnet deploy + measurement script. Run INSIDE WSL2:
#   wsl -d Ubuntu-24.04 -- bash -lc 'export PATH=/root/.local/share/solana/install/active_release/bin:/root/.avm/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin; cd /mnt/c/Users/93rob/Documents/GitHub/Tessera && bash ops/localnet-t03.sh'
#
# What it does:
#   1. Builds the program (respects CARGO_TARGET_DIR; default /root/tessera-target).
#   2. Starts a fresh solana-test-validator on 127.0.0.1:8899.
#   3. Deploys tessera.so under the program keypair in <target>/deploy/.
#   4. Prints live rent-exemption quotes for every account type and the
#      program account, the validator genesis hash, and fee parameters.
#   5. Runs the live e2e test (tests/program/tests/localnet_e2e.rs).
#
# Everything is localnet-only; no mainnet actions.
set -euo pipefail

export PATH=/root/.local/share/solana/install/active_release/bin:/root/.avm/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/root/tessera-target}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "=== build ==="
anchor build
SO="$CARGO_TARGET_DIR/deploy/tessera.so"
[ -f "$SO" ] || SO="target/deploy/tessera.so"
[ -f "$SO" ] || { echo "tessera.so not found"; exit 1; }
PROGRAM_SIZE=$(wc -c < "$SO")
echo "tessera.so bytes: $PROGRAM_SIZE"
echo "tessera.so sha256: $(sha256sum "$SO" | cut -d' ' -f1)"

echo "=== validator ==="
pkill -f solana-test-validator || true
sleep 1
solana-test-validator --reset --quiet --ledger /tmp/tessera-test-ledger &
VALIDATOR_PID=$!
trap 'kill $VALIDATOR_PID 2>/dev/null || true' EXIT
sleep 10
solana config set --url http://127.0.0.1:8899 >/dev/null
GENESIS=$(solana genesis-hash)
echo "localnet genesis: $GENESIS"

echo "=== deploy ==="
solana airdrop 20 "$(solana address)" >/dev/null || true
solana program deploy "$SO" --program-id "$CARGO_TARGET_DIR/deploy/tessera-keypair.json" \
    || solana program deploy "$SO" --program-id target/deploy/tessera-keypair.json
solana program show "$(solana address -k "$CARGO_TARGET_DIR/deploy/tessera-keypair.json" 2>/dev/null || echo 3fkMf7oJhVkiJF3Q7N6TzbRs16gsDFrJWXHNZcSFvytX)"

echo "=== rent quotes (getMinimumBalanceForRentExemption) ==="
for bytes in 106 346 759 295 "$PROGRAM_SIZE"; do
  lamports=$(curl -s http://127.0.0.1:8899 -X POST -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getMinimumBalanceForRentExemption\",\"params\":[$bytes]}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"])')
  echo "  $bytes bytes -> $lamports lamports"
done

echo "=== live e2e test ==="
TESSERA_LOCALNET_RPC=http://127.0.0.1:8899 cargo test -p tessera-program-tests --test localnet_e2e -- --nocapture

echo "=== done (validator stopped on exit) ==="
