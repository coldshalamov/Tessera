import { base58AddressToBytes, base58Encode } from '@tessera/types';
import { ByteReader, ByteWriter } from './bytes.js';
import { MAX_TX_BYTES } from './contract.js';
import type { BuiltInstruction } from './instructions.js';

/**
 * Legacy Solana transaction message compile/sign/serialize — hand-rolled so
 * the SDK stays dependency-light and Workers-safe. Wire format (bincode):
 *
 *   tx = shortvec(sigCount) ‖ sigs(64B each) ‖ message
 *   message = header(3B) ‖ shortvec(accountCount) ‖ accounts(32B each)
 *             ‖ blockhash(32B) ‖ shortvec(ixCount) ‖ ixs
 *   ix = programIdx u8 ‖ shortvec(acctCount) ‖ acctIdx u8s
 *        ‖ shortvec(dataLen) ‖ data
 *
 * Account ordering: fee payer first (always signer+writable), then writable
 * signers, read-only signers, writable non-signers, read-only non-signers.
 * Signatures sign the serialized message bytes (Ed25519) and are stored in
 * signer-account order.
 */

export interface CompiledMessage {
  readonly bytes: Uint8Array;
  readonly signerKeys: readonly string[];
  readonly accountKeys: readonly string[];
  readonly numReadonlySigned: number;
  readonly numReadonlyUnsigned: number;
}

export class TxBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TxBuildError';
  }
}

interface MergedMeta {
  pubkey: string;
  bytes: Uint8Array;
  isSigner: boolean;
  isWritable: boolean;
}

export function compileMessage(
  instructions: readonly BuiltInstruction[],
  feePayer: string,
  recentBlockhash: string,
): CompiledMessage {
  const payerBytes = base58AddressToBytes(feePayer);
  const blockhashBytes = base58AddressToBytes(recentBlockhash);
  if (!payerBytes) throw new TxBuildError('fee payer is not a base58 32-byte key');
  if (!blockhashBytes) throw new TxBuildError('recent blockhash is not base58/32B');

  const merged = new Map<string, MergedMeta>();
  const merge = (pubkey: string, isSigner: boolean, isWritable: boolean): Uint8Array => {
    const b = base58AddressToBytes(pubkey);
    if (!b) throw new TxBuildError(`account ${pubkey} is not a base58 32-byte key`);
    const existing = merged.get(pubkey);
    if (existing) {
      if (isSigner && !existing.isSigner) existing.isSigner = true;
      if (isWritable && !existing.isWritable) existing.isWritable = true;
    } else {
      merged.set(pubkey, { pubkey, bytes: b, isSigner, isWritable });
    }
    return b;
  };

  merge(feePayer, true, true);
  for (const ix of instructions) {
    if (!base58AddressToBytes(ix.programId)) {
      throw new TxBuildError(`instruction program ${ix.programId} is not a base58 32-byte key`);
    }
    for (const a of ix.accounts) merge(a.pubkey, a.isSigner, a.isWritable);
  }

  const signerWritable: MergedMeta[] = [];
  const signerReadonly: MergedMeta[] = [];
  const nonSignerWritable: MergedMeta[] = [];
  const nonSignerReadonly: MergedMeta[] = [];
  for (const m of merged.values()) {
    if (m.pubkey === feePayer) continue; // payer is prepended explicitly
    if (m.isSigner && m.isWritable) signerWritable.push(m);
    else if (m.isSigner) signerReadonly.push(m);
    else if (m.isWritable) nonSignerWritable.push(m);
    else nonSignerReadonly.push(m);
  }
  // Programs invoked land in read-only non-signers at the end.
  for (const ix of instructions) {
    if (!merged.has(ix.programId)) {
      merged.set(ix.programId, {
        pubkey: ix.programId,
        bytes: base58AddressToBytes(ix.programId)!,
        isSigner: false,
        isWritable: false,
      });
      nonSignerReadonly.push(merged.get(ix.programId)!);
    }
  }

  const ordered = [
    merged.get(feePayer)!,
    ...signerWritable,
    ...signerReadonly,
    ...nonSignerWritable,
    ...nonSignerReadonly,
  ];
  const indexOf = new Map<string, number>();
  ordered.forEach((m, i) => indexOf.set(m.pubkey, i));

  const numSigners = 1 + signerWritable.length + signerReadonly.length;
  const w = new ByteWriter();
  w.u8(numSigners).u8(signerReadonly.length).u8(nonSignerReadonly.length);
  w.shortvec(ordered.length);
  for (const m of ordered) w.push(m.bytes);
  w.push(blockhashBytes);
  w.shortvec(instructions.length);
  for (const ix of instructions) {
    const programIdx = indexOf.get(ix.programId);
    if (programIdx === undefined || programIdx > 255) {
      throw new TxBuildError('program id missing from account table (internal invariant)');
    }
    w.u8(programIdx);
    w.shortvec(ix.accounts.length);
    for (const a of ix.accounts) {
      const idx = indexOf.get(a.pubkey);
      if (idx === undefined || idx > 255) {
        throw new TxBuildError(`account ${a.pubkey} missing from account table`);
      }
      w.u8(idx);
    }
    w.shortvec(ix.data.length);
    w.push(ix.data);
  }
  const bytes = w.finish();
  if (bytes.length + 64 * numSigners + 1 > MAX_TX_BYTES) {
    throw new TxBuildError(
      `serialized transaction would be ${bytes.length + 64 * numSigners + 1} bytes; exceeds ${MAX_TX_BYTES}`,
    );
  }
  return {
    bytes,
    signerKeys: ordered.slice(0, numSigners).map((m) => m.pubkey),
    accountKeys: ordered.map((m) => m.pubkey),
    numReadonlySigned: signerReadonly.length,
    numReadonlyUnsigned: nonSignerReadonly.length,
  };
}

export interface MessageSigner {
  /** Sign the serialized message bytes; returns a 64-byte Ed25519 signature. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Produce the fully-signed wire transaction. `signatures` is a map from
 * signer public key → 64-byte Ed25519 signature over `message.bytes`.
 * Order is enforced from the compiled message; a missing or extra signer is
 * a build error, not a partial transaction.
 */
export function serializeTransaction(
  message: CompiledMessage,
  signatures: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const w = new ByteWriter();
  w.shortvec(message.signerKeys.length);
  for (const key of message.signerKeys) {
    const sig = signatures.get(key);
    if (!sig) throw new TxBuildError(`missing signature for required signer ${key}`);
    if (sig.length !== 64) throw new TxBuildError(`signature for ${key} is not 64 bytes`);
    w.push(sig);
  }
  w.push(message.bytes);
  const out = w.finish();
  if (out.length > MAX_TX_BYTES) {
    throw new TxBuildError(`serialized transaction ${out.length} bytes exceeds ${MAX_TX_BYTES}`);
  }
  return out;
}

/**
 * Parse a compiled message back into header/accounts/instructions — used by
 * the sponsor relayer's safety check (a message is only sponsor-signed when
 * it decodes to exactly the reviewed shape) and by tests.
 */
export interface ParsedMessage {
  readonly numSigners: number;
  readonly numReadonlySigned: number;
  readonly numReadonlyUnsigned: number;
  readonly accountKeys: string[];
  readonly recentBlockhash: string;
  readonly instructions: {
    programId: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: Uint8Array;
  }[];
}

export function parseCompiledMessage(bytes: Uint8Array): ParsedMessage {
  const r = new ByteReader(bytes);
  const numSigners = r.u8();
  const numRoSigned = r.u8();
  const numRoUnsigned = r.u8();
  if (numSigners === null || numRoSigned === null || numRoUnsigned === null) {
    throw new TxBuildError('message: truncated header');
  }
  const accountCount = r.shortvec();
  if (accountCount === null) throw new TxBuildError('message: truncated account count');
  const accountKeys: string[] = [];
  for (let i = 0; i < accountCount; i++) {
    const k = r.take(32);
    if (k === null) throw new TxBuildError('message: truncated account key');
    accountKeys.push(base58Encode(k));
  }
  const bh = r.take(32);
  if (bh === null) throw new TxBuildError('message: truncated blockhash');
  const ixCount = r.shortvec();
  if (ixCount === null) throw new TxBuildError('message: truncated ix count');
  const instructions: ParsedMessage['instructions'] = [];
  for (let i = 0; i < ixCount; i++) {
    const progIdx = r.u8();
    if (progIdx === null) throw new TxBuildError('message: truncated program index');
    const programId = accountKeys[progIdx];
    if (programId === undefined) throw new TxBuildError('message: bad program index');
    const acctCount = r.shortvec();
    if (acctCount === null) throw new TxBuildError('message: truncated ix accounts');
    const accounts: ParsedMessage['instructions'][number]['accounts'] = [];
    for (let j = 0; j < acctCount; j++) {
      const idx = r.u8();
      if (idx === null) throw new TxBuildError('message: truncated account index');
      const pubkey = accountKeys[idx];
      if (pubkey === undefined) throw new TxBuildError('message: bad account index');
      accounts.push({
        pubkey,
        isSigner: idx < numSigners,
        isWritable: idx < numSigners - numRoSigned || (idx >= numSigners && idx < accountCount - numRoUnsigned),
      });
    }
    const dataLen = r.shortvec();
    if (dataLen === null) throw new TxBuildError('message: truncated ix data length');
    const data = r.take(dataLen);
    if (data === null) throw new TxBuildError('message: truncated ix data');
    instructions.push({ programId, accounts, data });
  }
  if (r.remaining !== 0) throw new TxBuildError('message: trailing bytes');
  return {
    numSigners,
    numReadonlySigned: numRoSigned,
    numReadonlyUnsigned: numRoUnsigned,
    accountKeys,
    recentBlockhash: base58Encode(bh),
    instructions,
  };
}

/** Signature list at the head of a wire transaction (for audit/replay). */
export function transactionSignatureCount(wire: Uint8Array): number {
  const r = new ByteReader(wire);
  const n = r.shortvec();
  if (n === null || r.remaining < 64 * n) return -1;
  return n;
}

export function transactionSignatures(wire: Uint8Array): Uint8Array[] {
  const r = new ByteReader(wire);
  const n = r.shortvec();
  if (n === null || n > 32) return [];
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const sig = r.take(64);
    if (sig === null) return [];
    out.push(sig);
  }
  return out;
}

export function transactionMessageBytes(wire: Uint8Array): Uint8Array | null {
  const r = new ByteReader(wire);
  const n = r.shortvec();
  if (n === null || n > 32) return null;
  if (r.take(64 * n) === null) return null;
  return wire.subarray(r.offset);
}
