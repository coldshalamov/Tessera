import {
  base58Encode,
  bytesToHex,
  MAX_NAME_UTF8_BYTES,
  MAX_REFERENCES,
  MAX_TITLE_UTF8_BYTES,
  type CustodyMode,
  type IntentV1,
  type NodeRecordV1,
  type NodeRef,
  type ProjectV1,
} from '@tessera/types';
import { ByteReader, bytesEqual } from './bytes.js';
import {
  DISC_CONTRIBUTION_NODE,
  DISC_DEPLOYMENT_CONFIG,
  DISC_PROJECT_ACCOUNT,
  DISC_STATEMENT_RECORD,
} from './contract.js';

/**
 * Strict decoders for the three deployed account layouts plus the committed
 * StatementRecord layout. Field order/widths follow state.rs and are proven
 * against generated/vectors/account-layout-v1.json golden bytes in
 * tests/sdk (byte-level conformance, no Anchor dependency).
 *
 * The account buffer is allocated at the fixed SPACE but only the Borsh
 * prefix is populated; trailing allocated bytes are tolerated (never read),
 * matching Anchor's try_deserialize semantics. Structural violations
 * (discriminator, option tags >1, length prefixes beyond bounds, truncated
 * fields, u64 beyond u64) are hard decode failures — never silently coerced.
 */

export class AccountDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountDecodeError';
  }
}

function expectDisc(data: Uint8Array, disc: Uint8Array, what: string): void {
  const head = data.subarray(0, 8);
  if (data.length < 8 || !bytesEqual(head, disc)) {
    throw new AccountDecodeError(`${what}: discriminator mismatch (not a ${what} account)`);
  }
}

function optKey(r: ByteReader, what: string): string | null {
  const tag = r.u8();
  if (tag === null) throw new AccountDecodeError(`${what}: truncated at option tag`);
  if (tag === 0) return null;
  if (tag !== 1) throw new AccountDecodeError(`${what}: option tag must be 0 or 1, got ${tag}`);
  const b = r.take(32);
  if (b === null) throw new AccountDecodeError(`${what}: truncated option payload`);
  return base58Encode(b);
}

function take32(r: ByteReader, what: string): Uint8Array {
  const b = r.take(32);
  if (b === null) throw new AccountDecodeError(`${what}: truncated 32-byte field`);
  return b;
}

function key32(r: ByteReader, what: string): string {
  return base58Encode(take32(r, what));
}

function hex32(r: ByteReader, what: string): string {
  return bytesToHex(take32(r, what));
}

function optHex32(r: ByteReader, what: string): string | null {
  const tag = r.u8();
  if (tag === null) throw new AccountDecodeError(`${what}: truncated at option tag`);
  if (tag === 0) return null;
  if (tag !== 1) throw new AccountDecodeError(`${what}: option tag must be 0 or 1, got ${tag}`);
  return hex32(r, what);
}

function u8f(r: ByteReader, what: string): number {
  const v = r.u8();
  if (v === null) throw new AccountDecodeError(`${what}: truncated u8`);
  return v;
}

function u16f(r: ByteReader, what: string): number {
  const v = r.u16();
  if (v === null) throw new AccountDecodeError(`${what}: truncated u16`);
  return v;
}

function u64f(r: ByteReader, what: string): bigint {
  const v = r.u64();
  if (v === null) throw new AccountDecodeError(`${what}: truncated u64`);
  return v;
}

function i64f(r: ByteReader, what: string): bigint {
  const v = r.i64();
  if (v === null) throw new AccountDecodeError(`${what}: truncated i64`);
  return v;
}

function strf(r: ByteReader, max: number, what: string): string {
  const s = r.str(max);
  if (s === null) throw new AccountDecodeError(`${what}: string field invalid/truncated`);
  return s;
}

function bytes16(r: ByteReader, what: string): string {
  const b = r.take(16);
  if (b === null) throw new AccountDecodeError(`${what}: truncated 16-byte field`);
  return bytesToHex(b);
}

// ---------------------------------------------------------------------------
// DeploymentConfig (106 B)
// ---------------------------------------------------------------------------

export interface DeploymentConfigAccount {
  readonly stateVersion: number;
  readonly networkGenesis: string;
  readonly programId: string;
  readonly authority: string;
  readonly bump: number;
}

export function decodeDeploymentConfig(data: Uint8Array): DeploymentConfigAccount {
  expectDisc(data, DISC_DEPLOYMENT_CONFIG, 'DeploymentConfig');
  const r = new ByteReader(data.subarray(8));
  const stateVersion = u8f(r, 'config.state_version');
  const networkGenesis = key32(r, 'config.network_genesis');
  const programId = key32(r, 'config.program_id');
  const authority = key32(r, 'config.authority');
  const bump = u8f(r, 'config.bump');
  return { stateVersion, networkGenesis, programId, authority, bump };
}

// ---------------------------------------------------------------------------
// ProjectAccount (346 B)
// ---------------------------------------------------------------------------

export interface ProjectAccountData {
  readonly stateVersion: number;
  readonly economicRule: number;
  readonly extensionPolicy: number;
  readonly bump: number;
  readonly networkGenesis: string;
  readonly programId: string;
  readonly creator: string;
  readonly controller: string | null;
  readonly rootNode: string | null;
  readonly projectNonce: string;
  readonly title: string;
  readonly termsSha256: string;
  readonly totalUnits: bigint;
  readonly createdSlot: bigint;
  readonly createdUnixTime: bigint;
}

export function decodeProjectAccount(data: Uint8Array): ProjectAccountData {
  expectDisc(data, DISC_PROJECT_ACCOUNT, 'ProjectAccount');
  const r = new ByteReader(data.subarray(8));
  const stateVersion = u8f(r, 'project.state_version');
  const economicRule = u8f(r, 'project.economic_rule');
  const extensionPolicy = u8f(r, 'project.extension_policy');
  const bump = u8f(r, 'project.bump');
  const networkGenesis = key32(r, 'project.network_genesis');
  const programId = key32(r, 'project.program_id');
  const creator = key32(r, 'project.creator');
  const controller = optKey(r, 'project.controller');
  const rootNode = optKey(r, 'project.root_node');
  const projectNonce = bytes16(r, 'project.project_nonce');
  const title = strf(r, MAX_TITLE_UTF8_BYTES, 'project.title');
  const termsSha256 = hex32(r, 'project.terms_sha256');
  const totalUnits = u64f(r, 'project.total_units');
  const createdSlot = u64f(r, 'project.created_slot');
  const createdUnixTime = i64f(r, 'project.created_unix_time');
  return {
    stateVersion,
    economicRule,
    extensionPolicy,
    bump,
    networkGenesis,
    programId,
    creator,
    controller,
    rootNode,
    projectNonce,
    title,
    termsSha256,
    totalUnits,
    createdSlot,
    createdUnixTime,
  };
}

export function projectToV1(p: ProjectAccountData, projectAddress: string): ProjectV1 {
  return {
    format_version: 1,
    genesis_hash: p.networkGenesis,
    program_id: p.programId,
    project_address: projectAddress,
    creator: p.creator,
    controller: p.controller,
    root_node: p.rootNode,
    project_nonce: p.projectNonce,
    title: p.title,
    economic_rule: 'residual-v1',
    total_units: '1000000000000',
    extension_policy: p.extensionPolicy === 1 ? 'OPEN' : 'REVIEWED',
    terms_sha256: p.termsSha256,
  };
}

// ---------------------------------------------------------------------------
// ContributionNode (759 B)
// ---------------------------------------------------------------------------

const CUSTODY_FROM_U8: Record<number, CustodyMode> = {
  1: 'user_controlled',
  2: 'embedded_provider',
  3: 'server_custodied',
};

export interface ContributionNodeData {
  readonly stateVersion: number;
  readonly economicRule: number;
  readonly nodeState: number;
  readonly bump: number;
  readonly depth: number;
  readonly claimBps: number;
  readonly custodyMode: number;
  readonly project: string;
  readonly economicParent: string | null;
  readonly contributor: string;
  readonly references: readonly string[];
  readonly nonce: string;
  readonly name: string;
  readonly title: string;
  readonly intentDigest: string;
  readonly artifactSha256: string;
  readonly metadataSha256: string | null;
  readonly termsSha256: string;
  readonly declaredAt: bigint;
  readonly observedSlot: bigint;
  readonly observedUnixTime: bigint;
  readonly residualInUnits: bigint;
  readonly effectiveUnits: bigint;
  readonly residualOutUnits: bigint;
  readonly issuedTotalUnits: bigint;
  readonly ownPayoutNumeratorUnits: bigint;
  readonly ownPayoutDenominatorUnits: bigint;
}

export function decodeContributionNode(data: Uint8Array): ContributionNodeData {
  expectDisc(data, DISC_CONTRIBUTION_NODE, 'ContributionNode');
  const r = new ByteReader(data.subarray(8));
  const stateVersion = u8f(r, 'node.state_version');
  const economicRule = u8f(r, 'node.economic_rule');
  const nodeState = u8f(r, 'node.node_state');
  const bump = u8f(r, 'node.bump');
  const depth = u16f(r, 'node.depth');
  const claimBps = u16f(r, 'node.claim_bps');
  const custodyMode = u8f(r, 'node.custody_mode');
  const project = key32(r, 'node.project');
  const economicParent = optKey(r, 'node.economic_parent');
  const contributor = key32(r, 'node.contributor');

  const refCount = r.u32();
  if (refCount === null) throw new AccountDecodeError('node.references: truncated count');
  if (refCount > MAX_REFERENCES) {
    throw new AccountDecodeError(`node.references: count ${refCount} exceeds ${MAX_REFERENCES}`);
  }
  const references: string[] = [];
  for (let i = 0; i < refCount; i++) references.push(key32(r, `node.references[${i}]`));

  const nonce = bytes16(r, 'node.nonce');
  const name = strf(r, MAX_NAME_UTF8_BYTES, 'node.name');
  const title = strf(r, MAX_TITLE_UTF8_BYTES, 'node.title');
  const intentDigest = hex32(r, 'node.intent_digest');
  const artifactSha256 = hex32(r, 'node.artifact_sha256');
  const metadataSha256 = optHex32(r, 'node.metadata_sha256');
  const termsSha256 = hex32(r, 'node.terms_sha256');
  const declaredAt = i64f(r, 'node.declared_at');
  const observedSlot = u64f(r, 'node.observed_slot');
  const observedUnixTime = i64f(r, 'node.observed_unix_time');
  const residualInUnits = u64f(r, 'node.residual_in_units');
  const effectiveUnits = u64f(r, 'node.effective_units');
  const residualOutUnits = u64f(r, 'node.residual_out_units');
  const issuedTotalUnits = u64f(r, 'node.issued_total_units');
  const ownPayoutNumeratorUnits = u64f(r, 'node.own_payout_numerator_units');
  const ownPayoutDenominatorUnits = u64f(r, 'node.own_payout_denominator_units');
  return {
    stateVersion,
    economicRule,
    nodeState,
    bump,
    depth,
    claimBps,
    custodyMode,
    project,
    economicParent,
    contributor,
    references,
    nonce,
    name,
    title,
    intentDigest,
    artifactSha256,
    metadataSha256,
    termsSha256,
    declaredAt,
    observedSlot,
    observedUnixTime,
    residualInUnits,
    effectiveUnits,
    residualOutUnits,
    issuedTotalUnits,
    ownPayoutNumeratorUnits,
    ownPayoutDenominatorUnits,
  };
}

/** The intent semantic fields are fully recoverable from the stored node. */
export function intentFromNode(
  n: ContributionNodeData,
  scope: { genesis_hash: string; program_id: string },
): IntentV1 {
  const custody = CUSTODY_FROM_U8[n.custodyMode];
  if (!custody) throw new AccountDecodeError(`node.custody_mode ${n.custodyMode} not in 1..3`);
  return {
    format_version: 1,
    network_genesis: scope.genesis_hash,
    program_id: scope.program_id,
    project_address: n.project,
    economic_parent: n.economicParent,
    references: [...n.references],
    nonce: n.nonce,
    contributor: n.contributor,
    name: n.name,
    title: n.title,
    artifact_sha256: n.artifactSha256,
    metadata_sha256: n.metadataSha256,
    terms_sha256: n.termsSha256,
    claim_bps: n.claimBps,
    statement_code: 'CONTRIBUTE_AND_ACCEPT_TERMS',
    declared_at: n.declaredAt.toString(10),
    custody_mode: custody,
  };
}

export function nodeToRecordV1(
  n: ContributionNodeData,
  nodeAddress: string,
  scope: { genesis_hash: string; program_id: string },
): NodeRecordV1 {
  const custody = CUSTODY_FROM_U8[n.custodyMode];
  if (!custody) throw new AccountDecodeError(`node.custody_mode ${n.custodyMode} not in 1..3`);
  const nodeRef: NodeRef = {
    genesis_hash: scope.genesis_hash,
    program_id: scope.program_id,
    project_address: n.project,
    node_address: nodeAddress,
  };
  return {
    format_version: 1,
    economic_rule: 'residual-v1',
    node_ref: nodeRef,
    economic_parent:
      n.economicParent === null
        ? null
        : {
            genesis_hash: scope.genesis_hash,
            program_id: scope.program_id,
            project_address: n.project,
            node_address: n.economicParent,
          },
    references: [...n.references],
    contributor: n.contributor,
    name: n.name,
    title: n.title,
    nonce: n.nonce,
    intent_digest: n.intentDigest,
    artifact_sha256: n.artifactSha256,
    metadata_sha256: n.metadataSha256,
    metadata_schema: null,
    terms_sha256: n.termsSha256,
    claim_bps: n.claimBps,
    residual_in_units: n.residualInUnits.toString(10),
    effective_units: n.effectiveUnits.toString(10),
    residual_out_units: n.residualOutUnits.toString(10),
    issued_total_units: n.issuedTotalUnits.toString(10),
    own_payout_numerator_units: n.ownPayoutNumeratorUnits.toString(10),
    own_payout_denominator_units: n.ownPayoutDenominatorUnits.toString(10),
    observed_slot: n.observedSlot.toString(10),
    declared_at: n.declaredAt.toString(10),
    observed_unix_time: n.observedUnixTime.toString(10),
    depth: n.depth,
    custody_mode: custody,
  };
}

// ---------------------------------------------------------------------------
// StatementRecord (295 B) — layout committed on-chain, instruction deferred.
// ---------------------------------------------------------------------------

export interface StatementRecordData {
  readonly stateVersion: number;
  readonly statementType: number;
  readonly custodyMode: number;
  readonly bump: number;
  readonly networkGenesis: string;
  readonly programId: string;
  readonly project: string | null;
  readonly author: string;
  readonly subjectRef: string | null;
  readonly auxKey: string | null;
  readonly payloadSha256: string;
  readonly statementDigest: string;
  readonly declaredAt: bigint;
  readonly observedSlot: bigint;
  readonly observedUnixTime: bigint;
}

export function decodeStatementRecord(data: Uint8Array): StatementRecordData {
  expectDisc(data, DISC_STATEMENT_RECORD, 'StatementRecord');
  const r = new ByteReader(data.subarray(8));
  const stateVersion = u8f(r, 'statement.state_version');
  const statementType = u8f(r, 'statement.statement_type');
  const custodyMode = u8f(r, 'statement.custody_mode');
  const bump = u8f(r, 'statement.bump');
  const networkGenesis = key32(r, 'statement.network_genesis');
  const programId = key32(r, 'statement.program_id');
  const project = optKey(r, 'statement.project');
  const author = key32(r, 'statement.author');
  const subjectRef = optKey(r, 'statement.subject_ref');
  const auxKey = optKey(r, 'statement.aux_key');
  const payloadSha256 = hex32(r, 'statement.payload_sha256');
  const statementDigest = hex32(r, 'statement.statement_digest');
  const declaredAt = i64f(r, 'statement.declared_at');
  const observedSlot = u64f(r, 'statement.observed_slot');
  const observedUnixTime = i64f(r, 'statement.observed_unix_time');
  return {
    stateVersion,
    statementType,
    custodyMode,
    bump,
    networkGenesis,
    programId,
    project,
    author,
    subjectRef,
    auxKey,
    payloadSha256,
    statementDigest,
    declaredAt,
    observedSlot,
    observedUnixTime,
  };
}
