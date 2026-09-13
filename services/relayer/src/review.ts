import { portErr, type PortResult } from '@tessera/types';
import {
  IX_APPEND_CONTRIBUTION,
  IX_CREATE_PROJECT,
  IX_INITIALIZE_DEPLOYMENT,
  IX_PUBLISH_ROOT,
  MAX_TX_BYTES,
  SYSTEM_PROGRAM_ID,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  parseCompiledMessage,
  type BuiltInstruction,
  type ParsedMessage,
} from '@tessera/sdk';

/**
 * Sponsored-message review — the hard gate between a client request and the
 * sponsor's signature (docs/04: "allowlists program IDs, instruction types
 * and fee/rent limits; verifies every account and signer").
 *
 * The relayer never signs client-supplied transaction bytes. The message it
 * co-signs is either compiled by the relayer itself (normal flow) or, in
 * tests/forensics, a client message must decode to EXACTLY the reviewed
 * instruction: single instruction, allowlisted program + discriminator,
 * account metas identical (order + signer/writable flags) to what the SDK
 * builder produces from the reviewed intent, fee payer = sponsor, and no
 * signer outside the expected set. A token transfer, an account close, an
 * extra CPI or a different fee payer all fail this exact-match review —
 * structurally, before any signature.
 */

const DISC_NAMES: ReadonlyArray<{ name: string; disc: Uint8Array }> = [
  { name: 'initialize_deployment', disc: IX_INITIALIZE_DEPLOYMENT },
  { name: 'create_project', disc: IX_CREATE_PROJECT },
  { name: 'publish_root', disc: IX_PUBLISH_ROOT },
  { name: 'append_contribution', disc: IX_APPEND_CONTRIBUTION },
];

/** Instructions this relayer sponsors (v1): contribution writes only. */
const SPONSORED_DISCS: readonly Uint8Array[] = [IX_PUBLISH_ROOT, IX_APPEND_CONTRIBUTION];

export function instructionName(disc: Uint8Array): string {
  for (const d of DISC_NAMES) if (bytesEqual(disc, d.disc)) return d.name;
  return 'unknown';
}

export interface ReviewedMessage {
  readonly parsed: ParsedMessage;
  readonly instructionName: string;
  readonly programId: string;
  readonly feePayer: string;
  /** Ordered signer pubkeys (account-table order; index < numSigners). */
  readonly signers: readonly string[];
}

function metasEqual(
  a: readonly { pubkey: string; isSigner: boolean; isWritable: boolean }[],
  b: readonly { pubkey: string; isSigner: boolean; isWritable: boolean }[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.pubkey !== y.pubkey || x.isSigner !== y.isSigner || x.isWritable !== y.isWritable) {
      return false;
    }
  }
  return true;
}

/**
 * Review a compiled (unsigned or partially signed) message against the
 * instruction the relayer itself built from the reviewed intent.
 * `expected` is the SDK-built instruction; `sponsorPubkey` the fee payer.
 */
export function reviewSponsoredMessage(args: {
  message: Uint8Array;
  expected: BuiltInstruction;
  sponsorPubkey: string;
  programId: string;
}): PortResult<ReviewedMessage> {
  const { message, expected, sponsorPubkey, programId } = args;

  if (message.length === 0 || message.length > MAX_TX_BYTES) {
    return portErr('TRANSACTION_TOO_LARGE', `message is ${message.length} bytes (limit ${MAX_TX_BYTES})`);
  }

  let parsed: ParsedMessage;
  try {
    parsed = parseCompiledMessage(message);
  } catch (e) {
    return portErr('INSTRUCTION_REJECTED', `message does not decode: ${e instanceof Error ? e.message : 'malformed'}`);
  }

  // Exactly one instruction — anything more is outside the sponsor policy.
  if (parsed.instructions.length !== 1) {
    return portErr(
      'INSTRUCTION_REJECTED',
      `sponsored transactions carry exactly one reviewed instruction (got ${parsed.instructions.length}); bundled or extra instructions are refused`,
    );
  }
  const ix = parsed.instructions[0]!;

  // Program allowlist: the Tessera program only. (The system program appears
  // in these instructions as a read-only account meta, never as a called
  // program — a system transfer/CPI target would show up here and fail.)
  if (ix.programId !== programId) {
    return portErr(
      'INSTRUCTION_REJECTED',
      `instruction targets program ${ix.programId}, not the allowlisted Tessera program — token transfers, account closes and arbitrary CPI are never sponsored`,
    );
  }
  if (ix.programId === SYSTEM_PROGRAM_ID) {
    return portErr('INSTRUCTION_REJECTED', 'system-program instructions are never sponsored');
  }

  // Instruction-type allowlist: v1 sponsors publish_root/append_contribution.
  const disc = ix.data.subarray(0, 8);
  if (!SPONSORED_DISCS.some((d) => bytesEqual(disc, d))) {
    return portErr(
      'INSTRUCTION_REJECTED',
      `instruction discriminator ${bytesToBase64(disc)} is not a sponsored Tessera write`,
    );
  }

  // Exact-shape check: account metas and instruction data must equal the
  // relayer's own build for the reviewed intent — no substituted account,
  // no widened writability, no extra signer.
  if (ix.programId !== expected.programId) {
    return portErr('INSTRUCTION_REJECTED', 'instruction program differs from the reviewed intent');
  }
  if (!metasEqual(ix.accounts, expected.accounts)) {
    return portErr(
      'INSTRUCTION_REJECTED',
      'instruction account metas differ from the reviewed intent (a substituted/extra account or altered signer/writable flag)',
    );
  }
  if (!bytesEqual(ix.data, expected.data)) {
    return portErr('INSTRUCTION_REJECTED', 'instruction data differs from the reviewed intent bytes');
  }

  // Header sanity: fee payer is the sponsor and first signer; the complete
  // signer set is exactly what the reviewed instruction requires.
  const feePayer = parsed.accountKeys[0];
  if (feePayer !== sponsorPubkey) {
    return portErr('INSTRUCTION_REJECTED', `fee payer ${feePayer ?? 'none'} is not the sponsor`);
  }
  const signers = parsed.accountKeys.slice(0, parsed.numSigners);
  const expectedSignerSet = new Set(
    expected.accounts.filter((a) => a.isSigner).map((a) => a.pubkey),
  );
  if (signers.length !== expectedSignerSet.size || !signers.every((s) => expectedSignerSet.has(s))) {
    return portErr(
      'INSTRUCTION_REJECTED',
      `signer set ${JSON.stringify(signers)} differs from the reviewed requirement ${JSON.stringify([...expectedSignerSet])}`,
    );
  }
  // Every account the compiled message references must appear in the
  // instruction metas or the program id — parseCompiledMessage guarantees
  // table membership; the exact-match above already bounds the set.

  return {
    ok: true,
    value: {
      parsed,
      instructionName: instructionName(disc),
      programId: ix.programId,
      feePayer: sponsorPubkey,
      signers,
    },
  };
}

/** Decode a base64 wire transaction field with a bounded error. */
export function decodeFieldBase64(s: unknown, what: string): PortResult<Uint8Array> {
  if (typeof s !== 'string') return portErr('INVALID_INTENT', `${what} must be a base64 string`);
  const b = base64ToBytes(s);
  if (b === null) return portErr('INVALID_INTENT', `${what} is not valid base64`);
  return { ok: true, value: b };
}
