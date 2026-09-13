import {
  encodeStatementV1,
  sha256Hex,
  type ContributionInput,
  type NodeRecordV1,
  type NodeRef,
  type SignedIntent,
  type StatementV1,
} from '@tessera/types';
import { createLocalTesseraPort } from '@tessera/math';
import {
  base64ToBytes,
  buildBundle,
  bundleToZip,
  demoSign,
  demoSigner,
  stableStringify,
  utf8Bytes,
  type ContributionEvidence,
  type PayloadFile,
  type StatementEvidence,
} from '@tessera/evidence';

function mustB64(s: string): Uint8Array {
  const b = base64ToBytes(s);
  if (b === null) throw new Error('internal: invalid base64 from port');
  return b;
}

/**
 * "Night Circuit" — a music-stem collaboration demo dataset (packet T06).
 *
 * Proves Tessera is app-agnostic: the same records/intents/signatures carry
 * a stem-tree instead of Morpheus's audio drama. Five signed contributions:
 *
 *   mira  Composition seed + guide mix        2,000 bps  (root)
 *   ken   Drum stem — 606 groove              3,000 bps  ┐ branch off root
 *   luz   Bass stem — sub line                2,500 bps  ┘ (sibling branch)
 *   aya   Melody stem — lead over drums       1,500 bps  (child of drums)
 *   ren   Mix v2 — stems arrangement          1,000 bps  (child of melody,
 *                                                        references bass
 *                                                        cross-branch)
 *
 * The selected leaf (Mix v2) denominates payouts at its issued total:
 * mira 200e9/571.6e9, ken 240e9/571.6e9, aya 84e9/571.6e9, ren 47.6e9/571.6e9
 * — the bass stem earns nothing from THIS version (a sibling branch), which
 * the explorer's table makes visible. Selecting the bass version re-
 * denominates to its own 400e9 issued total.
 *
 * Everything is fixture-grade: throwaway seed-derived keys, local simulated
 * mode, no network writes. The bundle carries a RELEASE_ANCHOR statement
 * binding a demo release manifest so the verifier's anchor check runs.
 */

const DEMO_GENESIS = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'; // devnet-shaped fake; local only
const DEMO_PROGRAM = '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn';
const DEMO_DECLARED_AT = '1789185600';
const DEMO_PROJECT_NONCE = '0000000000000000000000000000ab00';

const DEMO_TERMS = [
  'DEMO STEM-SESSION TERMS — NOT A LEGAL AGREEMENT.',
  'Fixture text for the Tessera explorer demo (Night Circuit stems).',
  'Each contributor asserts they may submit the referenced stem under these',
  'test terms and accepts the stated residual-v1 claim. Nothing here is',
  'a real work, a real license, or a real payment obligation.',
].join('\n');

export interface StemsDemo {
  /** Deterministic-in-structure zip bytes of the evidence bundle. */
  readonly zipBytes: Uint8Array;
  readonly fileName: string;
  readonly leafAddress: string;
  readonly leafRef: NodeRef;
  readonly projectTitle: string;
  readonly nodeCount: number;
  readonly exporter: string;
}

function seedFromLabel(label: string): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = utf8Bytes(label);
  for (let i = 0; i < 32; i++) out[i] = bytes[i % bytes.length]! ^ ((i * 17 + 5) & 0xff);
  return out;
}

interface StemSpec {
  readonly key: string;
  readonly signer: string;
  readonly parent: string | null;
  readonly claimBps: number;
  readonly title: string;
  readonly nonce: string;
  readonly stemKind: string;
  readonly artifactText: string;
  readonly references?: readonly string[];
}

const STEMS: readonly StemSpec[] = [
  {
    key: 'seed', signer: 'mira', parent: null, claimBps: 2000,
    title: 'Composition seed — chords + guide mix', nonce: '00000000000000000000000000001001',
    stemKind: 'composition',
    artifactText: 'DEMO composition seed: chord chart + rough guide mix description. Fixture only — not audio.',
  },
  {
    key: 'drums', signer: 'ken', parent: 'seed', claimBps: 3000,
    title: 'Drum stem — 606 groove', nonce: '00000000000000000000000000001002',
    stemKind: 'drums',
    artifactText: 'DEMO drum stem: 4-bar 606 groove description (kick/snare/hat pattern). Fixture only.',
    references: ['seed'],
  },
  {
    key: 'bass', signer: 'luz', parent: 'seed', claimBps: 2500,
    title: 'Bass stem — sub line', nonce: '00000000000000000000000000001003',
    stemKind: 'bass',
    artifactText: 'DEMO bass stem: sub-bass line over the chord chart. Fixture only.',
    references: ['seed'],
  },
  {
    key: 'melody', signer: 'aya', parent: 'drums', claimBps: 1500,
    title: 'Melody stem — lead synth over drums', nonce: '00000000000000000000000000001004',
    stemKind: 'melody',
    artifactText: 'DEMO melody stem: lead synth phrase arranged against the drum branch. Fixture only.',
    references: ['seed', 'drums'],
  },
  {
    key: 'mixv2', signer: 'ren', parent: 'melody', claimBps: 1000,
    title: 'Mix v2 — drums/bass/melody arrangement', nonce: '00000000000000000000000000001005',
    stemKind: 'mix',
    artifactText: 'DEMO mix v2: arrangement notes combining the stem branches. Fixture only.',
    // Cross-branch descriptive reference: mix credits the bass stem even
    // though its economic parent chain runs through the drum branch.
    references: ['drums', 'melody', 'bass'],
  },
];

/** Build the demo session and export it as an evidence-bundle zip. */
export async function buildStemsDemo(): Promise<StemsDemo> {
  const exporter = 'tessera-explorer demo/0.1.0 (local stems)';
  const port = createLocalTesseraPort({
    genesis_hash: DEMO_GENESIS,
    program_id: DEMO_PROGRAM,
    exporter,
  });

  const signerNames = ['mira', 'ken', 'luz', 'aya', 'ren'];
  const signers: Record<string, Awaited<ReturnType<typeof demoSigner>>> = {};
  for (const name of signerNames) {
    signers[name] = await demoSigner(seedFromLabel(`tessera-stems-${name}`));
  }

  const termsBytes = utf8Bytes(DEMO_TERMS);
  const termsHash = await sha256Hex(termsBytes);
  if (!termsHash.ok) throw new Error('sha256 unavailable');
  const payloads: PayloadFile[] = [{ kind: 'terms', data: termsBytes }];

  const project = await port.createProject({
    creator: signers['mira']!.publicKeyBase58,
    title: 'Night Circuit — stem collaboration (DEMO)',
    extension_policy: 'OPEN',
    terms_sha256: termsHash.value,
    project_nonce: DEMO_PROJECT_NONCE,
  });
  if (!project.ok) throw new Error(`demo createProject failed: ${project.error.code}`);

  const nodeRefs: Record<string, NodeRef> = {};
  const contributions: ContributionEvidence[] = [];
  const recordsByKey: Record<string, NodeRecordV1> = {};

  for (const spec of STEMS) {
    const artifactBytes = utf8Bytes(spec.artifactText);
    const artifactHash = await sha256Hex(artifactBytes);
    if (!artifactHash.ok) throw new Error('sha256 unavailable');
    payloads.push({ kind: 'artifact', data: artifactBytes });

    const metadataBytes = utf8Bytes(
      stableStringify({
        schema: 'tessera.demo.stems/1',
        stem_kind: spec.stemKind,
        title: spec.title,
        fixture_only: true,
      }),
    );
    const metadataHash = await sha256Hex(metadataBytes);
    if (!metadataHash.ok) throw new Error('sha256 unavailable');
    payloads.push({ kind: 'metadata', data: metadataBytes });

    const input: ContributionInput = {
      project_address: project.value.project_address,
      economic_parent: spec.parent === null ? null : nodeRefs[spec.parent]!,
      contributor: signers[spec.signer]!.publicKeyBase58,
      name: spec.signer,
      title: spec.title,
      artifact_sha256: artifactHash.value,
      metadata_sha256: metadataHash.value,
      terms_sha256: termsHash.value,
      claim_bps: spec.claimBps,
      custody_mode: 'user_controlled',
      declared_at: DEMO_DECLARED_AT,
      nonce: spec.nonce,
      references: (spec.references ?? []).map((k) => nodeRefs[k]!.node_address),
      metadata_schema: 'tessera.demo.stems/1',
    };
    const prepared = await port.prepareContribution(input);
    if (!prepared.ok) throw new Error(`prepare ${spec.key}: ${prepared.error.code} ${prepared.error.message}`);
    const signature_base64 = await demoSign(
      signers[spec.signer]!.privateKey,
      prepared.value.intent_sha256,
    );
    const signed: SignedIntent = {
      intent: prepared.value.intent,
      signature_base64,
      signer: signers[spec.signer]!.publicKeyBase58,
    };
    const sub = await port.submitSignedContribution(signed, `stems-${spec.key}`);
    if (!sub.ok) throw new Error(`submit ${spec.key}: ${sub.error.code} ${sub.error.message}`);
    nodeRefs[spec.key] = sub.value.node_ref!;
    const verified = await port.getNode(sub.value.node_ref!);
    if (!verified.ok) throw new Error(`getNode ${spec.key}`);
    recordsByKey[spec.key] = verified.value.node;
    contributions.push({
      record: verified.value.node,
      intent: prepared.value.intent,
      intent_wire: mustB64(prepared.value.intent_bytes_base64),
      signature: mustB64(signature_base64),
    });
  }

  // Release manifest + RELEASE_ANCHOR statement signed by the project creator.
  const leafRef = nodeRefs['mixv2']!;
  const payouts = await port.getPayouts(leafRef);
  if (!payouts.ok) throw new Error('getPayouts leaf');
  const manifestBytes = utf8Bytes(
    stableStringify({
      release_id: 'nightcircuit-demo-v1',
      network: 'local-simulated',
      node_ref: leafRef,
      stems_sha256: STEMS.map((s) => recordsByKey[s.key]!.artifact_sha256),
      terms_sha256: termsHash.value,
      payout_table: payouts.value,
      revenue_policy_version: 'demo-split/1',
      notice: 'DEMO release manifest; local simulated economics; not a sale record.',
    }),
  );
  payloads.push({ kind: 'manifest', data: manifestBytes, name: 'nightcircuit-demo-v1' });
  const manifestHash = await sha256Hex(manifestBytes);
  if (!manifestHash.ok) throw new Error('sha256 unavailable');

  const statement: StatementV1 = {
    format_version: 1,
    network_genesis: DEMO_GENESIS,
    program_id: DEMO_PROGRAM,
    project_address: project.value.project_address,
    statement_type: 'RELEASE_ANCHOR',
    subject_ref: leafRef.node_address,
    aux_key: null,
    payload_sha256: manifestHash.value,
    declared_at: DEMO_DECLARED_AT,
    custody_mode: 'user_controlled',
  };
  const wire = encodeStatementV1(statement);
  if (!wire.ok) throw new Error('statement encode failed');
  const wireHash = await sha256Hex(wire.value);
  if (!wireHash.ok) throw new Error('sha256 unavailable');
  const statements: StatementEvidence[] = [
    {
      record: statement,
      wire: wire.value,
      signer: signers['mira']!.publicKeyBase58,
      signature: mustB64(await demoSign(signers['mira']!.privateKey, wireHash.value)),
    },
  ];

  const built = await buildBundle({
    selected_leaf: leafRef,
    project: { ...project.value, root_node: nodeRefs['seed']!.node_address },
    contributions,
    payloads,
    statements,
    payout_table: payouts.value,
    exporter,
    limitations: [
      'LOCAL DEMO MODE: generated in-browser by a simulated local TesseraPort; no Solana network, account or finality exists.',
      'Keys are deterministic throwaway fixtures; names are self-chosen labels, not verified identities.',
      'Stem artifacts are placeholder text — no real audio or artwork is referenced.',
    ],
  });
  if (!built.ok) throw new Error(`demo buildBundle: ${built.error.code} ${built.error.message}`);

  return {
    zipBytes: bundleToZip(built.value),
    fileName: 'night-circuit-stems.tessera-bundle.zip',
    leafAddress: leafRef.node_address,
    leafRef,
    projectTitle: project.value.title,
    nodeCount: STEMS.length,
    exporter,
  };
}
