import { beforeAll, describe, expect, it } from 'vitest';
import {
  createLocalTesseraPort,
  type LocalTesseraPort,
} from '@tessera/math';
import type {
  ContributionInput,
  IntentV1,
  NodeRecordV1,
  NodeRef,
  SignedIntent,
} from '@tessera/types';
import { makeSigner, signIntent, type TestSigner } from './helpers.js';
import vectors from '../../../shared/economic-vectors.json';

/**
 * Local TesseraPort conformance: the canonical branch from docs/01 and
 * shared/ACCEPTANCE_SCENARIO.md built end-to-end through prepare → sign →
 * submit, asserting stored node records equal the vector economics, exact
 * payout tables, descendant pinning, sibling isolation, idempotency,
 * signature verification and honest local-mode labeling.
 */

const GENESIS = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'; // well-known devnet-shaped fake; local only
const PROGRAM = '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn';
const TERMS = '05a2186a31e57ae3d5139f4771df03df05dd07034d64584d3e9620ecd4f71733';
const ARTIFACT = 'fd02088635b4bf27a9779a6aac03cd48258cb128d54f41948f052931f4127c1d';

let port: LocalTesseraPort;
let projectAddress: string;
const signers: Record<string, TestSigner> = {};
const nodeRefs: Record<string, NodeRef> = {};
const nodeRecords: Record<string, NodeRecordV1> = {};

async function publish(
  parentId: string | null,
  signerKey: string,
  claimBps: number,
  name: string,
  extra?: Partial<ContributionInput>,
): Promise<{ sub: { ok: boolean }; ref: NodeRef | null; error?: string }> {
  const signer = signers[signerKey]!;
  const input: ContributionInput = {
    project_address: projectAddress,
    economic_parent: parentId === null ? null : nodeRefs[parentId]!,
    contributor: signer.publicKeyBase58,
    name,
    title: `${name} title`,
    artifact_sha256: ARTIFACT,
    terms_sha256: TERMS,
    claim_bps: claimBps,
    custody_mode: 'server_custodied',
    declared_at: '1789166400',
    ...extra,
  };
  const prepared = await port.prepareContribution(input);
  if (!prepared.ok) return { sub: { ok: false }, ref: null, error: prepared.error.code };
  const signature_base64 = await signIntent(prepared.value.intent, signer);
  const signed: SignedIntent = {
    intent: prepared.value.intent,
    signature_base64,
    signer: signer.publicKeyBase58,
  };
  const sub = await port.submitSignedContribution(signed, `idem-${name}-${crypto.randomUUID()}`);
  if (!sub.ok) return { sub: { ok: false }, ref: null, error: sub.error.code };
  return { sub: { ok: true }, ref: sub.value.node_ref };
}

beforeAll(async () => {
  port = createLocalTesseraPort({ genesis_hash: GENESIS, program_id: PROGRAM });
  for (const k of ['creator', 'alice', 'bob', 'carol', 'dave']) {
    signers[k] = await makeSigner();
  }
  const proj = await port.createProject({
    creator: signers['creator']!.publicKeyBase58,
    title: 'The Lantern Room',
    extension_policy: 'OPEN',
    terms_sha256: TERMS,
  });
  expect(proj.ok).toBe(true);
  if (proj.ok) projectAddress = proj.value.project_address;

  // Canonical branch: A(1500) -> {ALICE(5000), B(2000) -> C(1000) -> D(2500)}
  const a = await publish(null, 'creator', 1500, 'A');
  expect(a.ref).not.toBeNull();
  nodeRefs['A'] = a.ref!;
  const gotA = await port.getNode(a.ref!);
  expect(gotA.ok).toBe(true);
  if (gotA.ok) nodeRecords['A'] = gotA.value.node;
  for (const [id, who, claim, parent] of [
    ['ALICE', 'alice', 5000, 'A'],
    ['B', 'bob', 2000, 'A'],
    ['C', 'carol', 1000, 'B'],
    ['D', 'dave', 2500, 'C'],
  ] as const) {
    const r = await publish(parent, who, claim, id);
    expect(r.error).toBeUndefined();
    expect(r.ref).not.toBeNull();
    nodeRefs[id] = r.ref!;
    const got = await port.getNode(r.ref!);
    expect(got.ok).toBe(true);
    if (got.ok) nodeRecords[id] = got.value.node;
  }
});

describe('canonical branch economics match vectors exactly', () => {
  it.each(vectors.nodes.filter((n) => !['ZERO', 'CLOSED', 'CREDIT'].includes(n.id)))(
    'node $id stored fields equal the vector',
    (row) => {
      const rec = nodeRecords[row.id]!;
      const exp = row.expected;
      expect(rec.claim_bps).toBe(exp.claim_bps);
      expect(rec.residual_in_units).toBe(exp.residual_in_units);
      expect(rec.effective_units).toBe(exp.effective_units);
      expect(rec.residual_out_units).toBe(exp.residual_out_units);
      expect(rec.issued_total_units).toBe(exp.issued_total_units);
      expect(rec.own_payout_numerator_units).toBe(exp.own_payout_numerator_units);
      expect(rec.own_payout_denominator_units).toBe(exp.own_payout_denominator_units);
    },
  );

  it('node records carry all required economic fields and refs', () => {
    const c = nodeRecords['C']!;
    expect(c.node_ref.node_address).toBe(nodeRefs['C']!.node_address);
    expect(c.economic_parent?.node_address).toBe(nodeRefs['B']!.node_address);
    expect(c.economic_rule).toBe('residual-v1');
    expect(c.depth).toBe(2);
    expect(c.contributor).toBe(signers['carol']!.publicKeyBase58);
  });
});

describe('exact payout tables', () => {
  it('at C: (150,170,68)/388 — Alice absent', async () => {
    const p = await port.getPayouts(nodeRefs['C']!);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.issued_total_units).toBe('388000000000');
    const ratios = p.value.entries.map((e) => [e.numerator_units, e.denominator_units]);
    expect(ratios).toEqual([
      ['150000000000', '388000000000'],
      ['170000000000', '388000000000'],
      ['68000000000', '388000000000'],
    ]);
    const beneficiaries = p.value.entries.map((e) => e.beneficiary);
    expect(beneficiaries).not.toContain(signers['alice']!.publicKeyBase58);
  });

  it('at D: (150,170,68,153)/541', async () => {
    const p = await port.getPayouts(nodeRefs['D']!);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.entries.map((e) => e.numerator_units)).toEqual([
      '150000000000',
      '170000000000',
      '68000000000',
      '153000000000',
    ]);
    for (const e of p.value.entries) expect(e.denominator_units).toBe('541000000000');
  });
});

describe('descendant pinning and sibling isolation', () => {
  it('C record and payout table are unchanged after D was appended', async () => {
    // nodeRecords.C was fetched AFTER D existed; refetch and compare to a
    // freshly built equivalent branch? The store is immutable — assert the
    // fetched record still equals the vector and its payout denominator is
    // still 388, proving D did not alter it.
    const c = nodeRecords['C']!;
    expect(c.issued_total_units).toBe('388000000000');
    const p = await port.getPayouts(nodeRefs['C']!);
    expect(p.ok && p.value.issued_total_units).toBe('388000000000');
    expect(p.ok && p.value.entries.length).toBe(3);
  });

  it('a new child under B does not alter sibling branch C/D stored fields', async () => {
    const before = JSON.stringify(nodeRecords['C']);
    const beforeD = JSON.stringify(nodeRecords['D']);
    const r = await publish('B', 'alice', 500, 'B2');
    expect(r.ref).not.toBeNull();
    const after = await port.getNode(nodeRefs['C']!);
    const afterD = await port.getNode(nodeRefs['D']!);
    expect(after.ok && JSON.stringify(after.value.node)).toBe(before);
    expect(afterD.ok && JSON.stringify(afterD.value.node)).toBe(beforeD);
  });

  it('settlement at C pays only C-path ancestors — sibling/descendant excluded', async () => {
    const s = await port.previewSettlement(nodeRefs['C']!, 1000);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const byBene = new Map(s.value.allocations.map((a) => [a.beneficiary, a.amount_minor]));
    expect(byBene.get(signers['creator']!.publicKeyBase58)).toBe('387');
    expect(byBene.get(signers['bob']!.publicKeyBase58)).toBe('438');
    expect(byBene.get(signers['carol']!.publicKeyBase58)).toBe('175');
    expect(byBene.has(signers['alice']!.publicKeyBase58)).toBe(false);
    expect(byBene.has(signers['dave']!.publicKeyBase58)).toBe(false);
    let sum = 0n;
    for (const a of s.value.allocations) sum += BigInt(a.amount_minor);
    expect(sum).toBe(1000n);
  });

  it('repeated beneficiary receives ONE aggregated allocation', async () => {
    // dave adds a child under D — same beneficiary key appears twice on path.
    const r = await publish('D', 'dave', 1000, 'E');
    expect(r.ref).not.toBeNull();
    const s = await port.previewSettlement(r.ref!, 1000);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const daveAllocs = s.value.allocations.filter(
      (a) => a.beneficiary === signers['dave']!.publicKeyBase58,
    );
    expect(daveAllocs.length).toBe(1);
  });
});

describe('local-mode honesty and lifecycle', () => {
  it('mode/finality labels are local, never chain claims', async () => {
    const sub = await port.getSubmission(nodeRecords['A']!.intent_digest);
    expect(sub.ok).toBe(true);
    if (sub.ok) {
      expect(sub.value.mode).toBe('local');
      expect(sub.value.finality).toBe('local');
      expect(sub.value.status).toBe('finalized');
    }
    const node = await port.getNode(nodeRefs['A']!);
    expect(node.ok && node.value.verification.mode).toBe('local');
    expect(node.ok && node.value.verification.chain_finality).toBe('none-local-simulation');
    expect(node.ok && node.value.verification.signature).toBe('valid-local');
    expect(node.ok && node.value.verification.economics).toBe('recomputed-match');
  });

  it('idempotent resubmission returns the same node, never a second claim', async () => {
    const signer = signers['creator']!;
    const input: ContributionInput = {
      project_address: projectAddress,
      economic_parent: nodeRefs['D']!,
      contributor: signer.publicKeyBase58,
      name: 'retry',
      title: 'retry',
      artifact_sha256: ARTIFACT,
      terms_sha256: TERMS,
      claim_bps: 0,
      custody_mode: 'server_custodied',
      declared_at: '1789166400',
    };
    const prepared = await port.prepareContribution(input);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const signed: SignedIntent = {
      intent: prepared.value.intent,
      signature_base64: await signIntent(prepared.value.intent, signer),
      signer: signer.publicKeyBase58,
    };
    const s1 = await port.submitSignedContribution(signed, 'key-1');
    const s2 = await port.submitSignedContribution(signed, 'key-2'); // different idem key, same nonce
    const s3 = await port.submitSignedContribution(signed, 'key-1'); // same idem key
    expect(s1.ok && s2.ok && s3.ok).toBe(true);
    if (s1.ok && s2.ok && s3.ok) {
      expect(s2.value.id).toBe(s1.value.id);
      expect(s3.value.id).toBe(s1.value.id);
      expect(s2.value.node_ref?.node_address).toBe(s1.value.node_ref?.node_address);
    }
  });

  it('nonce reuse with a CHANGED intent is rejected', async () => {
    const signer = signers['alice']!;
    const baseInput: ContributionInput = {
      project_address: projectAddress,
      economic_parent: nodeRefs['A']!,
      contributor: signer.publicKeyBase58,
      name: 'n1',
      title: 'n1',
      artifact_sha256: ARTIFACT,
      terms_sha256: TERMS,
      claim_bps: 100,
      custody_mode: 'server_custodied',
      declared_at: '1789166400',
    };
    const p1 = await port.prepareContribution(baseInput);
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    const s1: SignedIntent = {
      intent: p1.value.intent,
      signature_base64: await signIntent(p1.value.intent, signer),
      signer: signer.publicKeyBase58,
    };
    expect((await port.submitSignedContribution(s1, 'n1')).ok).toBe(true);
    // Same nonce, different claim -> semantic mismatch must be rejected.
    // The second intent is still prepared (consent) to isolate the nonce check.
    const p2 = await port.prepareContribution({
      ...baseInput,
      claim_bps: 200,
      nonce: p1.value.intent.nonce,
    });
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    const s2: SignedIntent = {
      intent: p2.value.intent,
      signature_base64: await signIntent(p2.value.intent, signer),
      signer: signer.publicKeyBase58,
    };
    const r = await port.submitSignedContribution(s2, 'n2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NONCE_REUSE_MISMATCH');
  });

  it('rejects a tampered signature and a signer/contributor mismatch', async () => {
    const signer = signers['alice']!;
    const input: ContributionInput = {
      project_address: projectAddress,
      economic_parent: nodeRefs['A']!,
      contributor: signer.publicKeyBase58,
      name: 'tamper',
      title: 'tamper',
      artifact_sha256: ARTIFACT,
      terms_sha256: TERMS,
      claim_bps: 100,
      custody_mode: 'server_custodied',
      declared_at: '1789166400',
    };
    const prepared = await port.prepareContribution(input);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // Sign a different intent -> INVALID_SIGNATURE
    const other: IntentV1 = { ...prepared.value.intent, claim_bps: 999 };
    const badSig: SignedIntent = {
      intent: prepared.value.intent,
      signature_base64: await signIntent(other, signer),
      signer: signer.publicKeyBase58,
    };
    const r1 = await port.submitSignedContribution(badSig, 't1');
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('INVALID_SIGNATURE');

    // Correct signature, wrong declared signer -> SIGNER_MISMATCH
    const goodSig = await signIntent(prepared.value.intent, signer);
    const r2 = await port.submitSignedContribution(
      { intent: prepared.value.intent, signature_base64: goodSig, signer: signers['bob']!.publicKeyBase58 },
      't2',
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('SIGNER_MISMATCH');
  });

  it('rejects submission of an unprepared intent (consent freeze)', async () => {
    const signer = signers['alice']!;
    const intent: IntentV1 = {
      format_version: 1,
      network_genesis: GENESIS,
      program_id: PROGRAM,
      project_address: projectAddress,
      economic_parent: nodeRefs['A']!.node_address,
      references: [],
      nonce: 'ff'.repeat(16),
      contributor: signer.publicKeyBase58,
      name: 'unfrozen',
      title: 'unfrozen',
      artifact_sha256: ARTIFACT,
      metadata_sha256: null,
      terms_sha256: TERMS,
      claim_bps: 100,
      statement_code: 'CONTRIBUTE_AND_ACCEPT_TERMS',
      declared_at: '1789166400',
      custody_mode: 'server_custodied',
    };
    const r = await port.submitSignedContribution(
      { intent, signature_base64: await signIntent(intent, signer), signer: signer.publicKeyBase58 },
      'unfrozen-1',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONSENT_EXPIRED');
  });
});

describe('port-level scope and policy rejections', () => {
  it('wrong-network parent -> PARENT_NETWORK_MISMATCH', async () => {
    const r = await port.previewAppend(
      { ...nodeRefs['A']!, genesis_hash: '9'.repeat(43) },
      100,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PARENT_NETWORK_MISMATCH');
  });

  it('unknown parent -> PARENT_NOT_FOUND', async () => {
    const r = await port.previewAppend(
      { ...nodeRefs['A']!, node_address: '9'.repeat(43) },
      100,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PARENT_NOT_FOUND');
  });

  it('cross-project parent at submit -> PARENT_PROJECT_MISMATCH', async () => {
    const proj2 = await port.createProject({
      creator: signers['creator']!.publicKeyBase58,
      title: 'other',
      extension_policy: 'OPEN',
      terms_sha256: TERMS,
    });
    expect(proj2.ok).toBe(true);
    if (!proj2.ok) return;
    const signer = signers['alice']!;
    const prepared = await port.prepareContribution({
      project_address: proj2.value.project_address,
      economic_parent: nodeRefs['A']!, // belongs to project 1
      contributor: signer.publicKeyBase58,
      name: 'xp',
      title: 'xp',
      artifact_sha256: ARTIFACT,
      terms_sha256: TERMS,
      claim_bps: 0,
      custody_mode: 'server_custodied',
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.error.code).toBe('PARENT_PROJECT_MISMATCH');
  });

  it('terms mismatch -> TERMS_MISMATCH', async () => {
    const prepared = await port.prepareContribution({
      project_address: projectAddress,
      economic_parent: nodeRefs['A']!,
      contributor: signers['alice']!.publicKeyBase58,
      name: 'tm',
      title: 'tm',
      artifact_sha256: ARTIFACT,
      terms_sha256: 'f'.repeat(64),
      claim_bps: 0,
      custody_mode: 'server_custodied',
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.error.code).toBe('TERMS_MISMATCH');
  });

  it('missing referenced node -> REFERENCE_NOT_FOUND', async () => {
    const prepared = await port.prepareContribution({
      project_address: projectAddress,
      economic_parent: nodeRefs['A']!,
      contributor: signers['alice']!.publicKeyBase58,
      name: 'reffail',
      title: 'reffail',
      artifact_sha256: ARTIFACT,
      terms_sha256: TERMS,
      claim_bps: 0,
      references: ['8'.repeat(43)],
      custody_mode: 'server_custodied',
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.error.code).toBe('REFERENCE_NOT_FOUND');
  });

  it('REVIEWED project requires controller co-signature', async () => {
    const proj = await port.createProject({
      creator: signers['creator']!.publicKeyBase58,
      controller: signers['bob']!.publicKeyBase58,
      title: 'gated',
      extension_policy: 'REVIEWED',
      terms_sha256: TERMS,
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    const base = {
      project_address: proj.value.project_address,
      economic_parent: null,
      contributor: signers['alice']!.publicKeyBase58,
      name: 'rev',
      title: 'rev',
      artifact_sha256: ARTIFACT,
      terms_sha256: TERMS,
      claim_bps: 100,
      custody_mode: 'server_custodied' as const,
    };
    const denied = await port.prepareContribution(base);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('CONTROLLER_CONSENT_REQUIRED');
    const granted = await port.prepareContribution({ ...base, controller_cosigned: true });
    expect(granted.ok).toBe(true);
  });

  it('zero-issued version: preview flags it, settlement -> ZERO_ISSUED', async () => {
    const zeroPreview = await port.previewAppend(null, 0);
    expect(zeroPreview.ok).toBe(true);
    if (zeroPreview.ok) expect(zeroPreview.value.issued_total_units).toBe('0');
    // publish a zero-claim root in a fresh project, then settle
    const proj = await port.createProject({
      creator: signers['creator']!.publicKeyBase58,
      title: 'zero',
      extension_policy: 'OPEN',
      terms_sha256: TERMS,
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) return;
    const signer = signers['creator']!;
    const prepared = await port.prepareContribution({
      project_address: proj.value.project_address,
      economic_parent: null,
      contributor: signer.publicKeyBase58,
      name: 'z',
      title: 'z',
      artifact_sha256: ARTIFACT,
      terms_sha256: TERMS,
      claim_bps: 0,
      custody_mode: 'server_custodied',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const sub = await port.submitSignedContribution(
      {
        intent: prepared.value.intent,
        signature_base64: await signIntent(prepared.value.intent, signer),
        signer: signer.publicKeyBase58,
      },
      'z1',
    );
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    const s = await port.previewSettlement(sub.value.node_ref!, 1000);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.code).toBe('ZERO_ISSUED');
    const payouts = await port.getPayouts(sub.value.node_ref!);
    expect(payouts.ok && payouts.value.zero_issued).toBe(true);
  });
});

describe('evidence export and release verification', () => {
  it('exportBranch produces a schema-valid bundle; verifyRelease recomputes', async () => {
    const bundle = await port.exportBranch(nodeRefs['D']!);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(bundle.value.format_version).toBe(1);
    const recordFiles = bundle.value.files.filter((f) => f.kind === 'record');
    expect(recordFiles.length).toBe(4); // A,B,C,D
    const report = await port.verifyRelease(bundle.value);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.mode).toBe('local');
    // record checks pass; chain_finality is honestly 'incomplete'
    const recordChecks = report.value.checks.filter((c) => c.name.startsWith('record:'));
    expect(recordChecks.every((c) => c.result === 'pass')).toBe(true);
    const finality = report.value.checks.find((c) => c.name === 'chain_finality');
    expect(finality?.result).toBe('incomplete');
    expect(report.value.status).toBe('incomplete'); // never a green chain badge in local mode
  });

  it('a tampered bundle hash is reported invalid', async () => {
    const bundle = await port.exportBranch(nodeRefs['C']!);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    const tampered = structuredClone(bundle.value);
    const rec = tampered.files.find((f) => f.kind === 'record')!;
    rec.sha256 = '0'.repeat(64);
    const report = await port.verifyRelease(tampered);
    expect(report.ok && report.value.status).toBe('invalid');
  });
});
