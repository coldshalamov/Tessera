#!/bin/bash
# Installs the Solana/Anchor toolchain inside WSL2 Ubuntu (Solana CLIs do not
# run natively on Windows). Idempotent-ish; safe to re-run.
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y build-essential pkg-config libssl-dev libudev-dev curl git
echo "=== rustup ==="
if ! command -v rustc >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
fi
. "$HOME/.cargo/env"
echo "=== agave/solana ==="
if ! command -v solana >/dev/null; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version
echo "=== avm/anchor ==="
if ! command -v avm >/dev/null; then
  cargo install --git https://github.com/coral-xyz/anchor avm --locked
fi
avm install latest
avm use latest
anchor --version
echo "=== DONE ==="
