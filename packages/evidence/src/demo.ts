import {
  base58Encode,
  encodeStatementV1,
  sha256Hex,
  type ContributionInput,
  type NodeRecordV1,
  type NodeRef,
  type SignedIntent,
  type StatementV1,
} from '@tessera/types';
import { createLocalTesseraPort, type LocalTesseraPort } from '@tessera/math';
import { base64ToBytes, bytesToBase64, utf8Bytes } from './bytes.js';
import { stableStringify } from './json.js';
import type { PortSessionV1, SessionFileEntry } from './session.js';
import { SESSION_FORMAT } from './session.js';

/**
 * Deterministic demo-session builder driving `createLocalTesseraPort`
 * (mode 'local'). Implements the shared/ACCEPTANCE_SCENARIO.md economics:
 * root 1500 bps; competing children 5000/2000 bps; sound-design 1000 bps and
 * composer 2500 bps on the smaller-claim branch; two release manifests each
 * bound by a RELEASE_ANCHOR statement.
 *
 * Keys are throwaway demo keys derived from PUBLIC seeds via PKCS8 import —
 * they are fixture-grade, never funded, never a real identity. Everything
 * produced is labeled local/simulated; nothing here is a chain claim.
 */

/** `CryptoKey` exists as a global *value* via WebCrypto typings; the type
 *  position needs InstanceType so no DOM lib or node:* import is required. */
export type DemoCryptoKey = InstanceType<typeof CryptoKey>;

export interface DemoSigner {
  readonly publicKeyBase58: string;
  readonly privateKey: DemoCryptoKey;
}

/** PKCS8 v1 DER prefix for an Ed25519 private key (RFC 8410). */
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const out = base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  if (out === null) throw new Error('bad base64url');
  return out;
}

/** Deterministic throwaway key from a 32-byte seed. Fixture-grade only. */
export async function demoSigner(seed: Uint8Array): Promise<DemoSigner> {
  if (seed.length !== 32) throw new Error('demo seed must be 32 bytes');
  const der = new Uint8Array(PKCS8_PREFIX.length + 32);
  der.set(PKCS8_PREFIX, 0);
  der.set(seed, PKCS8_PREFIX.length);
  const privateKey = await crypto.subtle.importKey('pkcs8', der as Uint8Array<ArrayBuffer>, 'Ed25519', true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const pub = b64urlToBytes(jwk.x!);
  return { publicKeyBase58: base58Encode(pub), privateKey };
}

export async function demoSign(privateKey: DemoCryptoKey, digestHex: string): Promise<string> {
  const digest = new Uint8Array(32);
  for (let i = 0; i < 32; i++) digest[i] = parseInt(digestHex.slice(i * 2, i * 2 + 2), 16);
  const sig = new Uint8Array(
    await crypto.subtle.sign('Ed25519', privateKey, digest as Uint8Array<ArrayBuffer>),
  );
  return bytesToBase64(sig);
}

const DEMO_GENESIS = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'; // devnet-shaped fake; local only
const DEMO_PROGRAM = '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn';
const DEMO_DECLARED_AT = '1789166400';

const DEMO_TERMS = [
  'DEMO CONTRIBUTOR TERMS — NOT A LEGAL AGREEMENT.',
  'Fixture text for the Tessera local-mode demo (The Lantern Room).',
  'By signing, a contributor asserts they may submit the referenced artifact',
  'under these test terms and accept the stated residual-v1 claim.',
].join('\n');

export interface DemoSession {
  readonly session: PortSessionV1;
  /** session-dir relative path → bytes for every session.files entry. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly port: LocalTesseraPort;
  readonly signers: Record<string, DemoSigner>;
  readonly nodeRefs: Record<string, NodeRef>;
}

function seedFromLabel(label: string): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = utf8Bytes(label);
  for (let i = 0; i < 32; i++) out[i] = bytes[i % bytes.length]! ^ (i * 31 + 7) & 0xff;
  return out;
}

interface DemoContributionSpec {
  readonly key: string;
  readonly signer: string;
  readonly parent: string | null;
  readonly claimBps: number;
  readonly title: string;
  readonly nonce: string;
  readonly artifactText: string;
  /** Descriptive (non-economic) ancestry references by contribution key. */
  readonly references?: readonly string[];
}

const DEMO_CONTRIBUTIONS: readonly DemoContributionSpec[] = [
  { key: 'root', signer: 'creator', parent: null, claimBps: 1500, title: 'The Lantern Room — script/root', nonce: '0000000000000000000000000000000a', artifactText: 'The Lantern Room. Original demo script. Fixture only.' },
  { key: 'performer5000', signer: 'alice', parent: 'root', claimBps: 5000, title: 'Performance A (5000 bps)', nonce: '0000000000000000000000000000000b', artifactText: 'Demo performance take A. Fixture only.', references: ['root'] },
  { key: 'performer2000', signer: 'bob', parent: 'root', claimBps: 2000, title: 'Performance B (2000 bps)', nonce: '0000000000000000000000000000000c', artifactText: 'Demo performance take B. Fixture only.', references: ['root'] },
  { key: 'sound', signer: 'carol', parent: 'performer2000', claimBps: 1000, title: 'Sound design (1000 bps)', nonce: '0000000000000000000000000000000d', artifactText: 'Demo sound-design pass. Fixture only.', references: ['root', 'performer2000'] },
  // The composer cites the competing performance branch — a cross-branch
  // descriptive reference, which exercises unresolved-reference detection.
  { key: 'composer', signer: 'dave', parent: 'sound', claimBps: 2500, title: 'Score (2500 bps)', nonce: '0000000000000000000000000000000e', artifactText: 'Demo score cue. Fixture only.', references: ['sound', 'performer5000'] },
];

export async function buildDemoSession(
  opts: { exporter?: string } = {},
): Promise<DemoSession> {
  const port = createLocalTesseraPort({
    genesis_hash: DEMO_GENESIS,
    program_id: DEMO_PROGRAM,
    exporter: opts.exporter ?? 'tessera-evidence demo/0.1.0 (local)',
  });

  const signers: Record<string, DemoSigner> = {};
  for (const name of ['creator', 'alice', 'bob', 'carol', 'dave']) {
    signers[name] = await demoSigner(seedFromLabel(`tessera-demo-${name}`));
  }

  const files = new Map<string, Uint8Array>();
  const sessionFiles: SessionFileEntry[] = [];
  const addPayload = async (path: string, data: Uint8Array, role: SessionFileEntry['role'], name?: string): Promise<string> => {
    const hash = await sha256Hex(data);
    if (!hash.ok) throw new Error('sha256 unavailable');
    files.set(path, data);
    const entry: SessionFileEntry = { path, sha256: hash.value, role };
    sessionFiles.push(name === undefined ? entry : { ...entry, name });
    return hash.value;
  };

  const termsBytes = utf8Bytes(DEMO_TERMS);
  const termsSha = await addPayload('payloads/terms.txt', termsBytes, 'terms');

  const project = await port.createProject({
    creator: signers['creator']!.publicKeyBase58,
    title: 'The Lantern Room',
    extension_policy: 'OPEN',
    terms_sha256: termsSha,
    project_nonce: '000000000000000000000000000000ff',
  });
  if (!project.ok) throw new Error(`demo createProject failed: ${project.error.code}`);

  const nodeRefs: Record<string, NodeRef> = {};
  const contributions: PortSessionV1['contributions'][number][] = [];
  const recordsByKey: Record<string, NodeRecordV1> = {};

  for (const spec of DEMO_CONTRIBUTIONS) {
    const artifactPath = `payloads/artifact-${spec.key}.txt`;
    const artifactSha = await addPayload(artifactPath, utf8Bytes(spec.artifactText), 'artifact');
    const metadataBytes = utf8Bytes(
      stableStringify({
        schema: 'tessera.demo.metadata/1',
        contribution: spec.key,
        title: spec.title,
        fixture_only: true,
      }),
    );
    const metadataSha = await addPayload(`payloads/metadata-${spec.key}.json`, metadataBytes, 'metadata');

    const input: ContributionInput = {
      project_address: project.value.project_address,
      economic_parent: spec.parent === null ? null : nodeRefs[spec.parent]!,
      contributor: signers[spec.signer]!.publicKeyBase58,
      name: spec.signer,
      title: spec.title,
      artifact_sha256: artifactSha,
      metadata_sha256: metadataSha,
      terms_sha256: termsSha,
      claim_bps: spec.claimBps,
      custody_mode: 'server_custodied',
      declared_at: DEMO_DECLARED_AT,
      nonce: spec.nonce,
      references: (spec.references ?? []).map((k) => nodeRefs[k]!.node_address),
    };
    const prepared = await port.prepareContribution(input);
    if (!prepared.ok) throw new Error(`prepare ${spec.key}: ${prepared.error.code} ${prepared.error.message}`);
    const signature_base64 = await demoSign(signers[spec.signer]!.privateKey, prepared.value.intent_sha256);
    const signed: SignedIntent = {
      intent: prepared.value.intent,
      signature_base64,
      signer: signers[spec.signer]!.publicKeyBase58,
    };
    const sub = await port.submitSignedContribution(signed, `demo-${spec.key}`);
    if (!sub.ok) throw new Error(`submit ${spec.key}: ${sub.error.code} ${sub.error.message}`);
    const ref = sub.value.node_ref!;
    nodeRefs[spec.key] = ref;
    const verified = await port.getNode(ref);
    if (!verified.ok) throw new Error(`getNode ${spec.key}`);
    recordsByKey[spec.key] = verified.value.node;
    contributions.push({
      record: verified.value.node,
      intent: prepared.value.intent,
      intent_wire_base64: prepared.value.intent_bytes_base64,
      signature_base64,
    });
  }

  // Two releases: lantern-v1 anchors the sound-design leaf, lantern-v2 the
  // composer leaf. RELEASE_ANCHOR statements are signed by the creator.
  const statements: PortSessionV1['statements'][number][] = [];
  const releases: { key: string; releaseId: string }[] = [
    { key: 'sound', releaseId: 'lantern-v1' },
    { key: 'composer', releaseId: 'lantern-v2' },
  ];
  for (const rel of releases) {
    const leafRef = nodeRefs[rel.key]!;
    const payouts = await port.getPayouts(leafRef);
    if (!payouts.ok) throw new Error(`getPayouts ${rel.key}`);
    const manifestJson = stableStringify({
      release_id: rel.releaseId,
      network: 'local-simulated',
      node_ref: leafRef,
      audio_sha256: recordsByKey[rel.key]!.artifact_sha256,
      terms_sha256: termsSha,
      payout_table: payouts.value,
      revenue_policy_version: 'demo-revenue/1',
      notice: 'DEMO release manifest; local simulated economics; not a sale record.',
    });
    const manifestBytes = utf8Bytes(manifestJson);
    const manifestSha = await addPayload(`payloads/manifest-${rel.releaseId}.json`, manifestBytes, 'manifest', rel.releaseId);

    const statement: StatementV1 = {
      format_version: 1,
      network_genesis: DEMO_GENESIS,
      program_id: DEMO_PROGRAM,
      project_address: project.value.project_address,
      statement_type: 'RELEASE_ANCHOR',
      subject_ref: leafRef.node_address,
      aux_key: null,
      payload_sha256: manifestSha,
      declared_at: DEMO_DECLARED_AT,
      custody_mode: 'server_custodied',
    };
    const wire = encodeStatementV1(statement);
    if (!wire.ok) throw new Error(`statement encode ${rel.key}`);
    const wireHash = await sha256Hex(wire.value);
    if (!wireHash.ok) throw new Error('sha256 unavailable');
    const sig = await demoSign(signers['creator']!.privateKey, wireHash.value);
    statements.push({
      record: statement,
      wire_base64: bytesToBase64(wire.value),
      signer: signers['creator']!.publicKeyBase58,
      signature_base64: sig,
    });
  }

  const leafRef = nodeRefs['composer']!;
  const payoutTable = await port.getPayouts(leafRef);
  if (!payoutTable.ok) throw new Error('getPayouts leaf');

  // The project record reflects post-publication account state: the root
  // attach that the on-chain program performs is modelled by setting
  // root_node to the accepted root contribution (local port keeps the
  // create-time record immutable otherwise).
  const projectRecord = { ...project.value, root_node: nodeRefs['root']!.node_address };

  const session: PortSessionV1 = {
    format_version: SESSION_FORMAT,
    mode: 'local',
    genesis_hash: DEMO_GENESIS,
    program_id: DEMO_PROGRAM,
    project: projectRecord,
    files: sessionFiles,
    contributions,
    statements,
    selected_leaf: leafRef,
    payout_table: payoutTable.value,
  };
  return { session, files, port, signers, nodeRefs };
}
