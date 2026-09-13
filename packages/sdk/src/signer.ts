import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import {
  base58AddressToBytes,
  base58Encode,
  hexToBytes,
  isLowerHex,
} from '@tessera/types';

/**
 * TransactionSigner — the chain-authorization boundary. A signer signs the
 * serialized transaction *message* (Ed25519). This is deliberately distinct
 * from IdentityPort's frozen-consent detached signatures: the off-chain
 * detached signature over the intent digest is the consent/evidence record;
 * the transaction signature is the on-chain authorization. docs/04 keeps
 * the roles separate — a fee payer is never an author, and a contributor
 * signature must be a native tx signature.
 *
 * Signing is INJECTED (docs/08): the SDK never holds a global key.
 * `LocalTransactionSigner` is the local/test/relayer custody
 * implementation; production deployments inject wallet/provider adapters
 * implementing the same 2-member surface.
 */

export interface TransactionSigner {
  /** Base58 Ed25519 public key. */
  readonly publicKey: string;
  /** Sign arbitrary message bytes (the serialized tx message); 64-byte sig. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** Accepts a 32-byte seed or a 64-byte (seed‖pubkey) secret key. */
function normalizeSecret(secret: Uint8Array): Uint8Array | null {
  if (secret.length === 32) return secret;
  if (secret.length === 64) return secret.subarray(0, 32);
  return null;
}

/**
 * Raw-ed25519 signer from a 32-byte seed or 64-byte secret. Suitable for
 * localnet/test and for the relayer's sponsor key (loaded from a keystore
 * path/env at process start — never from the repo).
 */
export class LocalTransactionSigner implements TransactionSigner {
  readonly publicKey: string;
  private readonly secret: Uint8Array;

  private constructor(secret: Uint8Array, publicKey: Uint8Array) {
    this.secret = secret;
    this.publicKey = base58Encode(publicKey);
  }

  static async fromSecretKey(secret: Uint8Array): Promise<LocalTransactionSigner | null> {
    const seed = normalizeSecret(secret);
    if (seed === null) return null;
    const pub = await getPublicKeyAsync(seed);
    return new LocalTransactionSigner(seed, pub);
  }

  /** From 64/128 lowercase hex (32- or 64-byte secret). */
  static async fromHex(hex: string): Promise<LocalTransactionSigner | null> {
    if (!isLowerHex(hex, 64) && !isLowerHex(hex, 128)) return null;
    const b = hexToBytes(hex);
    if (b === null) return null;
    return LocalTransactionSigner.fromSecretKey(b);
  }

  /**
   * From a Solana CLI keypair file's JSON body: a byte array of length 64
   * (seed‖pubkey) — e.g. the content of ~/.config/solana/id.json.
   */
  static async fromKeypairJson(json: string): Promise<LocalTransactionSigner | null> {
    try {
      const arr: unknown = JSON.parse(json);
      if (!Array.isArray(arr)) return null;
      const bytes = Uint8Array.from(arr as number[]);
      if (bytes.length !== 64 && bytes.length !== 32) return null;
      return LocalTransactionSigner.fromSecretKey(bytes);
    } catch {
      return null;
    }
  }

  static async generate(): Promise<LocalTransactionSigner> {
    const seed = new Uint8Array(32);
    globalThis.crypto.getRandomValues(seed);
    return (await LocalTransactionSigner.fromSecretKey(seed))!;
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await signAsync(message, this.secret));
  }
}

/** Resolve a signer for `pubkey` from a registry/callback. */
export function resolveSigner(
  pubkey: string,
  signers: readonly TransactionSigner[] | undefined,
  resolve?: (pubkey: string) => TransactionSigner | undefined,
): TransactionSigner | undefined {
  const fromList = signers?.find((s) => s.publicKey === pubkey);
  if (fromList) return fromList;
  return resolve?.(pubkey);
}

export function pubkeyBytes(pubkey: string): Uint8Array | null {
  return base58AddressToBytes(pubkey);
}
