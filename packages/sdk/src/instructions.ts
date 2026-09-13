import {
  base58AddressToBytes,
  hexToBytes,
  parseI64Decimal,
  type IntentV1,
} from '@tessera/types';
import { ByteWriter } from './bytes.js';
import {
  EXTENSION_POLICY_OPEN,
  EXTENSION_POLICY_REVIEWED,
  IX_APPEND_CONTRIBUTION,
  IX_CREATE_PROJECT,
  IX_INITIALIZE_DEPLOYMENT,
  IX_PUBLISH_ROOT,
  SYSTEM_PROGRAM_ID,
  TESSERA_PROGRAM_ID,
} from './contract.js';
import { hex16 } from './pubkey.js';

/**
 * Instruction construction for the Tessera v1 program — hand-rolled
 * Anchor/Borsh argument encoding over the 4 deployed instructions.
 *
 * Deliberately no @coral-xyz/anchor client: the entire instruction surface
 * is 4 instructions / ~40 lines of field order, and the Anchor TS client
 * would add ~1MB of dependencies plus a BN.js-based numeric model the
 * economic contract forbids (all units are decimal strings/bigint). The
 * layout encoded here is asserted against the committed IDL discriminators
 * in tests/sdk and proven end-to-end on the live validator (a field-order
 * or width mistake cannot produce a confirmed transaction).
 *
 * NOTE: Borsh `Vec`/`String` use u32 length prefixes — unlike the IntentV1
 * SIGNING wire (u8 reference count) in packages/types/wire.ts. The two
 * encodings are different contracts; do not mix them.
 */

export interface AccountMetaLike {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface BuiltInstruction {
  readonly programId: string;
  readonly accounts: readonly AccountMetaLike[];
  readonly data: Uint8Array;
}

const CUSTODY_TO_U8: Record<IntentV1['custody_mode'], number> = {
  user_controlled: 1,
  embedded_provider: 2,
  server_custodied: 3,
};

function key(b58: string, what: string): Uint8Array {
  const b = base58AddressToBytes(b58);
  if (b === null) throw new InstructionBuildError(`${what}: not a base58 32-byte key`);
  return b;
}

function digestHex32(hex: string, what: string): Uint8Array {
  const b = hexToBytes(hex);
  if (b === null || b.length !== 32) {
    throw new InstructionBuildError(`${what}: expected 64 lowercase hex chars (32 bytes)`);
  }
  return b;
}

function optKey(w: ByteWriter, value: string | null, what: string): void {
  if (value === null) {
    w.u8(0);
  } else {
    w.u8(1).push(key(value, what));
  }
}

export class InstructionBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstructionBuildError';
  }
}

/**
 * Borsh-serialize IntentV1Fields (IDL order; format_version/statement_code/
 * domain are fixed program-side constants, not args):
 *   genesis32, program32, project32, option<parent32>, vec<ref32> (u32 len),
 *   nonce16, contributor32, str name, str title, artifact32,
 *   option<metadata32>, terms32, u16 claim_bps, i64 declared_at, u8 custody.
 */
export function encodeIntentV1Fields(intent: IntentV1): Uint8Array {
  const w = new ByteWriter();
  w.push(key(intent.network_genesis, 'intent.network_genesis'));
  w.push(key(intent.program_id, 'intent.program_id'));
  w.push(key(intent.project_address, 'intent.project_address'));
  optKey(w, intent.economic_parent, 'intent.economic_parent');

  if (intent.references.length > 8) {
    throw new InstructionBuildError('intent.references: at most 8 entries');
  }
  w.u32(intent.references.length);
  for (const r of intent.references) w.push(key(r, 'intent.references[]'));

  const nonce = hex16(intent.nonce);
  if (!nonce) throw new InstructionBuildError('intent.nonce: expected 16 bytes (32 hex chars)');
  w.push(nonce);
  w.push(key(intent.contributor, 'intent.contributor'));
  w.str(intent.name);
  w.str(intent.title);
  w.push(digestHex32(intent.artifact_sha256, 'intent.artifact_sha256'));
  if (intent.metadata_sha256 === null) {
    w.u8(0);
  } else {
    w.u8(1).push(digestHex32(intent.metadata_sha256, 'intent.metadata_sha256'));
  }
  w.push(digestHex32(intent.terms_sha256, 'intent.terms_sha256'));
  w.u16(intent.claim_bps);

  const declared = parseI64Decimal(intent.declared_at, 'intent.declared_at');
  if (!declared.ok) throw new InstructionBuildError('intent.declared_at: not a valid i64 decimal');
  w.i64(declared.value);
  w.u8(CUSTODY_TO_U8[intent.custody_mode]);
  return w.finish();
}

export interface CreateProjectInput {
  /** 16-byte hex nonce (32 lowercase hex chars). */
  readonly project_nonce: string;
  readonly title: string;
  readonly terms_sha256: string;
  readonly extension_policy: 'OPEN' | 'REVIEWED';
  /** Required when REVIEWED. */
  readonly controller?: string | null;
}

/** Borsh CreateProjectArgs: nonce16, str title, terms32, u8 policy, option<controller32>. */
export function encodeCreateProjectArgs(input: CreateProjectInput): Uint8Array {
  const nonce = hex16(input.project_nonce);
  if (!nonce) throw new InstructionBuildError('project_nonce: expected 16 bytes (32 hex chars)');
  const policy =
    input.extension_policy === 'OPEN'
      ? EXTENSION_POLICY_OPEN
      : input.extension_policy === 'REVIEWED'
        ? EXTENSION_POLICY_REVIEWED
        : null;
  if (policy === null) throw new InstructionBuildError('extension_policy must be OPEN or REVIEWED');
  const w = new ByteWriter();
  w.push(nonce);
  w.str(input.title);
  w.push(digestHex32(input.terms_sha256, 'terms_sha256'));
  w.u8(policy);
  optKey(w, input.controller ?? null, 'controller');
  return w.finish();
}

// ---------------------------------------------------------------------------
// Account metas per IDL order (the program's Accounts structs are positional)
// ---------------------------------------------------------------------------

export function initializeDeploymentIx(input: {
  programId?: string;
  configPda: string;
  authority: string;
  payer: string;
  networkGenesis: string;
}): BuiltInstruction {
  const programId = input.programId ?? TESSERA_PROGRAM_ID;
  const w = new ByteWriter();
  w.push(IX_INITIALIZE_DEPLOYMENT).push(key(input.networkGenesis, 'network_genesis'));
  return {
    programId,
    accounts: [
      { pubkey: input.configPda, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: false },
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: w.finish(),
  };
}

export function createProjectIx(input: {
  programId?: string;
  configPda: string;
  projectPda: string;
  creator: string;
  payer: string;
  args: CreateProjectInput;
}): BuiltInstruction {
  const programId = input.programId ?? TESSERA_PROGRAM_ID;
  return {
    programId,
    accounts: [
      { pubkey: input.configPda, isSigner: false, isWritable: false },
      { pubkey: input.projectPda, isSigner: false, isWritable: true },
      { pubkey: input.creator, isSigner: true, isWritable: false },
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: new ByteWriter().push(IX_CREATE_PROJECT).push(encodeCreateProjectArgs(input.args)).finish(),
  };
}

export function publishRootIx(input: {
  programId?: string;
  project: string;
  nodePda: string;
  contributor: string;
  payer: string;
  intent: IntentV1;
}): BuiltInstruction {
  const programId = input.programId ?? TESSERA_PROGRAM_ID;
  return {
    programId,
    accounts: [
      { pubkey: input.project, isSigner: false, isWritable: true },
      { pubkey: input.nodePda, isSigner: false, isWritable: true },
      { pubkey: input.contributor, isSigner: true, isWritable: false },
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: new ByteWriter().push(IX_PUBLISH_ROOT).push(encodeIntentV1Fields(input.intent)).finish(),
  };
}

export function appendContributionIx(input: {
  programId?: string;
  project: string;
  parent: string;
  nodePda: string;
  contributor: string;
  /** REVIEWED: the recorded controller signer. OPEN: pass null → program id (None). */
  controller: string | null;
  payer: string;
  intent: IntentV1;
}): BuiltInstruction {
  const programId = input.programId ?? TESSERA_PROGRAM_ID;
  return {
    programId,
    accounts: [
      { pubkey: input.project, isSigner: false, isWritable: false },
      { pubkey: input.parent, isSigner: false, isWritable: false },
      { pubkey: input.nodePda, isSigner: false, isWritable: true },
      { pubkey: input.contributor, isSigner: true, isWritable: false },
      {
        pubkey: input.controller ?? programId, // Option<Signer>: program id == None
        isSigner: input.controller !== null,
        isWritable: false,
      },
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: new ByteWriter()
      .push(IX_APPEND_CONTRIBUTION)
      .push(encodeIntentV1Fields(input.intent))
      .finish(),
  };
}
