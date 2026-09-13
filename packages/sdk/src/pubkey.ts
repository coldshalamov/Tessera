import { Point } from '@noble/ed25519';
import { base58AddressToBytes, base58Encode, bytesToHex } from '@tessera/types';
import { SEED_CONFIG, SEED_NODE, SEED_PROJECT } from './contract.js';

/**
 * Solana public-key / PDA plumbing without @solana/web3.js.
 *
 * createProgramAddress: SHA-256 over seeds ‖ program_id ‖
 * "ProgramDerivedAddress"; the digest must NOT decompress to an ed25519
 * curve point (otherwise the address could have a private key). The
 * on-curve check uses noble's Point.fromHex in ZIP-215-lenient mode, which
 * matches curve25519-dalek's `decompress` acceptance used by the runtime.
 * A mismatch would be caught loudly on-chain (the program recomputes the
 * seeds and rejects with InvalidPda) — never silently accepted.
 */

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
export const MAX_SEEDS = 16;
export const MAX_SEED_BYTES = 32;

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SHA-256 unavailable in this runtime');
  return new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  try {
    Point.fromHex(bytesToHex(bytes), true);
    return true;
  } catch {
    return false;
  }
}

/** Lower-level PDA address: seeds + program id, off-curve required. */
export async function createProgramAddress(
  seeds: readonly Uint8Array[],
  programId: Uint8Array,
): Promise<Uint8Array | null> {
  if (seeds.length > MAX_SEEDS) return null;
  if (programId.length !== 32) return null;
  let total = programId.length + PDA_MARKER.length;
  for (const s of seeds) {
    if (s.length > MAX_SEED_BYTES) return null;
    total += s.length;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const s of seeds) {
    buf.set(s, off);
    off += s.length;
  }
  buf.set(programId, off);
  off += programId.length;
  buf.set(PDA_MARKER, off);
  const hash = await sha256(buf);
  return isOnCurve(hash) ? null : hash;
}

/** Canonical (address, bump): bump descends 255..0 until off-curve. */
export async function findProgramAddress(
  seeds: readonly Uint8Array[],
  programId: Uint8Array,
): Promise<{ address: Uint8Array; bump: number } | null> {
  for (let bump = 255; bump >= 0; bump--) {
    const addr = await createProgramAddress([...seeds, Uint8Array.of(bump)], programId);
    if (addr !== null) return { address: addr, bump };
  }
  return null;
}

function programIdBytes(programId: string): Uint8Array | null {
  return base58AddressToBytes(programId);
}

export async function findDeploymentConfigPda(
  programId: string,
): Promise<{ address: string; bump: number }> {
  const pid = programIdBytes(programId);
  if (!pid) throw new Error('program id is not a base58 32-byte key');
  const r = await findProgramAddress([new TextEncoder().encode(SEED_CONFIG)], pid);
  if (!r) throw new Error('no off-curve PDA for deployment config seeds');
  return { address: base58Encode(r.address), bump: r.bump };
}

export async function findProjectPda(
  programId: string,
  creator: string,
  projectNonceHex16: string,
): Promise<{ address: string; bump: number }> {
  const pid = programIdBytes(programId);
  const creatorB = base58AddressToBytes(creator);
  const nonce = hex16(projectNonceHex16);
  if (!pid || !creatorB || !nonce) {
    throw new Error('invalid programId/creator/project_nonce for project PDA');
  }
  const r = await findProgramAddress(
    [new TextEncoder().encode(SEED_PROJECT), creatorB, nonce],
    pid,
  );
  if (!r) throw new Error('no off-curve PDA for project seeds');
  return { address: base58Encode(r.address), bump: r.bump };
}

export async function findNodePda(
  programId: string,
  projectAddress: string,
  contributor: string,
  nonceHex16: string,
): Promise<{ address: string; bump: number }> {
  const pid = programIdBytes(programId);
  const projectB = base58AddressToBytes(projectAddress);
  const contributorB = base58AddressToBytes(contributor);
  const nonce = hex16(nonceHex16);
  if (!pid || !projectB || !contributorB || !nonce) {
    throw new Error('invalid programId/project/contributor/nonce for node PDA');
  }
  const r = await findProgramAddress(
    [new TextEncoder().encode(SEED_NODE), projectB, contributorB, nonce],
    pid,
  );
  if (!r) throw new Error('no off-curve PDA for node seeds');
  return { address: base58Encode(r.address), bump: r.bump };
}

export function hex16(s: string): Uint8Array | null {
  if (!/^[0-9a-f]{32}$/.test(s)) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
