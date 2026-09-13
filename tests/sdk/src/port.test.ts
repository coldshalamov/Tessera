import { describe, expect, it } from 'vitest';
import {
  LocalTransactionSigner,
  TESSERA_PROGRAM_ID,
  createSolanaTesseraPort,
  findNodePda,
  findProjectPda,
  type SolanaTesseraPort,
} from '@tessera/sdk';
import {
  base58Encode,
  encodeIntentV1,
  intentDigestHex,
  sha256Hex,
  type IntentV1,
} from '@tessera/types';
import { fakeHash32, makeIntent } from './helpers.js';
import {
  encodeContributionNode,
  encodeDeploymentConfig,
  encodeProjectAccount,
  fetchFor,
  installProgram,
  newMockChain,
  type MockChain,
} from './mockrpc.js';

const GENESIS = '5TeWSsjg2gbxCyWVniXeCmwM7UtHTCK7svzJr5xYJzHf';
const TERMS = fakeHash32(0x30);
const PROJECT_NONCE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

interface Live {
  chain: MockChain;
  port: SolanaTesseraPort;
  contributor: LocalTransactionSigner;
  sponsor: LocalTransactionSigner;
  project: string;
  projectPda: string;
}

async function setupLive(opts: { deployConfig?: boolean } = {}): Promise<Live> {
  const chain = newMockChain(GENESIS);
  const contributor = await LocalTransactionSigner.generate();
  const sponsor = await LocalTransactionSigner.generate();
  const authority = await LocalTransactionSigner.generate();
  const { configPda } = await installProgram(chain, {
    deployConfig: opts.deployConfig ?? true,
    authority: authority.publicKey,
  });
  void configPda;
  const projectPda = (
    await findProjectPda(TESSERA_PROGRAM_ID, contributor.publicKey, PROJECT_NONCE)
  ).address;
  chain.accounts.set(projectPda, {
    data: encodeProjectAccount({
      genesis: GENESIS,
      creator: contributor.publicKey,
      projectNonce: PROJECT_NONCE,
      title: 'Unit Test Project',
      termsSha256: TERMS,
      extensionPolicy: 1,
    }),
    owner: TESSERA_PROGRAM_ID,
  });
  const port = createSolanaTesseraPort({
    mode: 'local',
    rpcUrl: 'http://mock.invalid',
    fetchImpl: fetchFor(chain),
    payer: sponsor,
    signers: [sponsor, contributor],
    confirmTimeoutMs: 500,
  });
  return { chain, port, contributor, sponsor, project: projectPda, projectPda };
}

async function signIntent(intent: IntentV1, signer: LocalTransactionSigner) {
  const digest = await intentDigestHex(intent);
  if (!digest.ok) throw new Error('digest failed');
  const sig = await signer.sign(new Uint8Array(Buffer.from(digest.value, 'hex')));
  return { intent, signature_base64: Buffer.from(sig).toString('base64'), signer: signer.publicKey };
}

describe('SolanaTesseraPort (mocked RPC)', () => {
  it('connect() resolves genesis + program + deployment', async () => {
    const { port } = await setupLive();
    const info = await port.connect();
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.value.genesisHash).toBe(GENESIS);
    expect(info.value.programDeployed).toBe(true);
    expect(info.value.deployment?.stateVersion).toBe(1);
    expect(info.value.deployment?.networkGenesis).toBe(GENESIS);
  });

  it('rejects a cluster whose genesis differs from expectedGenesisHash', async () => {
    const chain = newMockChain(GENESIS);
    await installProgram(chain);
    const port = createSolanaTesseraPort({
      mode: 'local',
      rpcUrl: 'http://mock.invalid',
      fetchImpl: fetchFor(chain),
      expectedGenesisHash: base58Encode(new Uint8Array(32).fill(1)),
    });
    const r = await port.connect();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NETWORK_MISMATCH');
  });

  it('rejects a cluster where the program is not deployed', async () => {
    const chain = newMockChain(GENESIS); // no program account
    const port = createSolanaTesseraPort({
      mode: 'local',
      rpcUrl: 'http://mock.invalid',
      fetchImpl: fetchFor(chain),
    });
    const r = await port.connect();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PROGRAM_NOT_DEPLOYED');
  });

  it('rejects a deployment config bound to a different genesis', async () => {
    const chain = newMockChain(GENESIS);
    await installProgram(chain);
    const bad = base58Encode(new Uint8Array(32).fill(4));
    const { findDeploymentConfigPda } = await import('@tessera/sdk');
    const cfg = await findDeploymentConfigPda(TESSERA_PROGRAM_ID);
    chain.accounts.set(cfg.address, {
      data: encodeDeploymentConfig(bad, base58Encode(new Uint8Array(32).fill(2))),
      owner: TESSERA_PROGRAM_ID,
    });
    const port = createSolanaTesseraPort({
      mode: 'local',
      rpcUrl: 'http://mock.invalid',
      fetchImpl: fetchFor(chain),
    });
    const r = await port.connect();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NETWORK_MISMATCH');
  });

  it('mainnet mode refuses writes with MAINNET_WRITES_DISABLED', async () => {
    const chain = newMockChain(GENESIS);
    await installProgram(chain, { deployConfig: true });
    const port = createSolanaTesseraPort({
      mode: 'mainnet',
      rpcUrl: 'http://mock.invalid',
      fetchImpl: fetchFor(chain),
    });
    const p = await port.prepareContribution({
      project_address: 'x',
      economic_parent: null,
      contributor: 'y',
      name: 'n',
      title: 't',
      artifact_sha256: fakeHash32(1),
      terms_sha256: TERMS,
      claim_bps: 100,
      custody_mode: 'user_controlled',
    });
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.error.code).toBe('MAINNET_WRITES_DISABLED');
  });

  it('submitStatement is an honest scaffold: UNSUPPORTED_VERSION, no fake success', async () => {
    const { port } = await setupLive();
    const r = await port.submitStatement({} as never, '', 'author');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNSUPPORTED_VERSION');
    expect(r.error.message).toMatch(/publish_statement is NOT deployed/);
  });

  it('prepareContribution builds a digest-stable intent for a real project', async () => {
    const { port, contributor, project } = await setupLive();
    const r = await port.prepareContribution({
      project_address: project,
      economic_parent: null,
      contributor: contributor.publicKey,
      name: 'alice',
      title: 'Root',
      artifact_sha256: fakeHash32(0xa0),
      terms_sha256: TERMS,
      claim_bps: 0,
      custody_mode: 'user_controlled',
      nonce: '0102030405060708090a0b0c0d0e0f10',
      declared_at: '1750000000',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.intent.network_genesis).toBe(GENESIS);
    expect(r.value.intent.program_id).toBe(TESSERA_PROGRAM_ID);
    expect(r.value.intent_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Digest equals the package/types digest over the same wire bytes.
    const enc = encodeIntentV1(r.value.intent);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const dig = await sha256Hex(enc.value);
    expect(dig.ok && dig.value === r.value.intent_sha256).toBe(true);
    expect(r.value.intent_bytes_base64).toBe(Buffer.from(enc.value).toString('base64'));
  });

  it('full submit path: simulates, sends, polls to confirmed, records submission', async () => {
    const { chain, port, contributor, project } = await setupLive();
    const prep = await port.prepareContribution({
      project_address: project,
      economic_parent: null,
      contributor: contributor.publicKey,
      name: 'alice',
      title: 'Root',
      artifact_sha256: fakeHash32(0xa1),
      terms_sha256: TERMS,
      claim_bps: 0,
      custody_mode: 'user_controlled',
    });
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    const signed = await signIntent(prep.value.intent, contributor);
    const sub = await port.submitSignedContribution(signed, 'k-1');
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    expect(sub.value.status).toBe('confirmed');
    expect(sub.value.finality).toBe('confirmed');
    expect(sub.value.mode).toBe('local');
    expect(sub.value.id).toBe(prep.value.intent_sha256);
    expect(chain.sendCount).toBe(1);
    const got = await port.getSubmission(sub.value.id);
    expect(got.ok && got.value.status === 'confirmed').toBe(true);
  });

  it('same idempotency key + different intent is a conflict, never aliased', async () => {
    const { port, contributor, project } = await setupLive();
    const mk = (nonce: string) =>
      port.prepareContribution({
        project_address: project,
        economic_parent: null,
        contributor: contributor.publicKey,
        name: 'alice',
        title: 'Root',
        artifact_sha256: fakeHash32(0xa1),
        terms_sha256: TERMS,
        claim_bps: 0,
        custody_mode: 'user_controlled',
        nonce,
      });
    const a = await mk('0102030405060708090a0b0c0d0e0f10');
    const b = await mk('0202030405060708090a0b0c0d0e0f10');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const sa = await signIntent(a.value.intent, contributor);
    const sb = await signIntent(b.value.intent, contributor);
    // First submission lands (node PDA would exist on a real chain; the mock
    // chain has none, so simulate landing by inserting the node account).
    const sub = await port.submitSignedContribution(sa, 'shared-key');
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    // Re-submit the SAME intent under the same key → stored submission, no resend.
    const again = await port.submitSignedContribution(sa, 'shared-key');
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.id).toBe(sub.value.id);
    // A DIFFERENT intent under the same key → NONCE_REUSE_MISMATCH.
    const conflict = await port.submitSignedContribution(sb, 'shared-key');
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('NONCE_REUSE_MISMATCH');
  });

  it('existing node PDA with same digest → idempotent replay (no send)', async () => {
    const { chain, port, contributor, project } = await setupLive();
    const intent = makeIntent({
      genesis: GENESIS,
      project,
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
      nonce: '0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a',
    });
    const digest = await intentDigestHex(intent);
    expect(digest.ok).toBe(true);
    if (!digest.ok) return;
    const nodePda = await findNodePda(
      TESSERA_PROGRAM_ID,
      project,
      contributor.publicKey,
      intent.nonce,
    );
    chain.accounts.set(nodePda.address, {
      data: encodeContributionNode({
        project,
        contributor: contributor.publicKey,
        intentDigest: digest.value,
        nonce: intent.nonce,
        name: intent.name,
        title: intent.title,
        artifactSha256: intent.artifact_sha256,
        termsSha256: TERMS,
        claimBps: intent.claim_bps,
        economicParent: null,
        depth: 0,
      }),
      owner: TESSERA_PROGRAM_ID,
    });
    const signed = await signIntent(intent, contributor);
    const sub = await port.submitSignedContribution(signed, 'replay-1');
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    expect(sub.value.status).toBe('finalized'); // observed at finalized read
    expect(sub.value.id).toBe(digest.value);
    expect(chain.sendCount).toBe(0); // no resubmission
  });

  it('existing node PDA with a DIFFERENT digest → NONCE_REUSE_MISMATCH', async () => {
    const { chain, port, contributor, project } = await setupLive();
    const intent = makeIntent({
      genesis: GENESIS,
      project,
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
      nonce: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
    });
    const nodePda = await findNodePda(
      TESSERA_PROGRAM_ID,
      project,
      contributor.publicKey,
      intent.nonce,
    );
    chain.accounts.set(nodePda.address, {
      data: encodeContributionNode({
        project,
        contributor: contributor.publicKey,
        intentDigest: fakeHash32(0xee), // different content under same nonce
        nonce: intent.nonce,
        artifactSha256: intent.artifact_sha256,
        termsSha256: TERMS,
        claimBps: intent.claim_bps,
      }),
      owner: TESSERA_PROGRAM_ID,
    });
    const signed = await signIntent(intent, contributor);
    const sub = await port.submitSignedContribution(signed, 'k-conflict');
    expect(sub.ok).toBe(false);
    if (sub.ok) return;
    expect(sub.error.code).toBe('NONCE_REUSE_MISMATCH');
    expect(chain.sendCount).toBe(0);
  });

  it('wrong detached consent signature → INVALID_SIGNATURE, nothing sent', async () => {
    const { chain, port, contributor, project } = await setupLive();
    const prep = await port.prepareContribution({
      project_address: project,
      economic_parent: null,
      contributor: contributor.publicKey,
      name: 'alice',
      title: 'Root',
      artifact_sha256: fakeHash32(0xa2),
      terms_sha256: TERMS,
      claim_bps: 0,
      custody_mode: 'user_controlled',
    });
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    const evil = await LocalTransactionSigner.generate();
    const digest = await intentDigestHex(prep.value.intent);
    expect(digest.ok).toBe(true);
    if (!digest.ok) return;
    const badSig = await evil.sign(new Uint8Array(Buffer.from(digest.value, 'hex')));
    const sub = await port.submitSignedContribution(
      {
        intent: prep.value.intent,
        signature_base64: Buffer.from(badSig).toString('base64'),
        signer: contributor.publicKey, // claims contributor, signed by evil
      },
      'k-badsig',
    );
    expect(sub.ok).toBe(false);
    if (sub.ok) return;
    expect(sub.error.code).toBe('INVALID_SIGNATURE');
    expect(chain.sendCount).toBe(0);
  });

  it('simulation failure maps to typed contract errors', async () => {
    const { chain, port, contributor, project } = await setupLive();
    chain.simulateError = { InstructionError: [0, { Custom: 6011 }] }; // BranchCapacityExhausted
    const prep = await port.prepareContribution({
      project_address: project,
      economic_parent: null,
      contributor: contributor.publicKey,
      name: 'a',
      title: 't',
      artifact_sha256: fakeHash32(0xa3),
      terms_sha256: TERMS,
      claim_bps: 1,
      custody_mode: 'user_controlled',
    });
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    const signed = await signIntent(prep.value.intent, contributor);
    const sub = await port.submitSignedContribution(signed, 'k-sim');
    expect(sub.ok).toBe(false);
    if (sub.ok) return;
    expect(sub.error.code).toBe('BRANCH_CAPACITY_EXHAUSTED');
    expect(chain.sendCount).toBe(0);
  });

  it('RPC unreachable → RPC_UNREACHABLE (no secret material in the error)', async () => {
    const failingFetch = (() =>
      Promise.reject(new Error('connect ECONNREFUSED'))) as unknown as typeof fetch;
    const port = createSolanaTesseraPort({
      mode: 'local',
      rpcUrl: 'http://unreachable.invalid',
      fetchImpl: failingFetch,
    });
    const r = await port.connect();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('RPC_UNREACHABLE');
    expect(r.error.message).not.toMatch(/keypair|secret|seed/i);
  });

  it('getPayouts walks the stored ancestor chain with exact denominators', async () => {
    const { chain, port, contributor, project } = await setupLive();
    const rootIntent = makeIntent({
      genesis: GENESIS,
      project,
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
      nonce: '11111111111111111111111111111111',
      claim_bps: 2500,
    });
    const rootDigest = await intentDigestHex(rootIntent);
    expect(rootDigest.ok).toBe(true);
    if (!rootDigest.ok) return;
    const rootPda = await findNodePda(TESSERA_PROGRAM_ID, project, contributor.publicKey, rootIntent.nonce);
    // Root: residual_in = U, claim 2500 → effective 250e9, residual_out 750e9, issued 250e9
    chain.accounts.set(rootPda.address, {
      data: encodeContributionNode({
        project,
        contributor: contributor.publicKey,
        intentDigest: rootDigest.value,
        nonce: rootIntent.nonce,
        artifactSha256: rootIntent.artifact_sha256,
        termsSha256: TERMS,
        claimBps: 2500,
        depth: 0,
        residualIn: 1_000_000_000_000n,
        effective: 250_000_000_000n,
        residualOut: 750_000_000_000n,
        issued: 250_000_000_000n,
      }),
      owner: TESSERA_PROGRAM_ID,
    });
    const other = await LocalTransactionSigner.generate();
    const childIntent = makeIntent({
      genesis: GENESIS,
      project,
      contributor: other.publicKey,
      parent: rootPda.address,
      terms_sha256: TERMS,
      nonce: '22222222222222222222222222222222',
      claim_bps: 2000,
    });
    const childDigest = await intentDigestHex(childIntent);
    expect(childDigest.ok).toBe(true);
    if (!childDigest.ok) return;
    const childPda = await findNodePda(TESSERA_PROGRAM_ID, project, other.publicKey, childIntent.nonce);
    chain.accounts.set(childPda.address, {
      data: encodeContributionNode({
        project,
        contributor: other.publicKey,
        intentDigest: childDigest.value,
        nonce: childIntent.nonce,
        artifactSha256: childIntent.artifact_sha256,
        termsSha256: TERMS,
        claimBps: 2000,
        economicParent: rootPda.address,
        depth: 1,
        residualIn: 750_000_000_000n,
        effective: 150_000_000_000n,
        residualOut: 600_000_000_000n,
        issued: 400_000_000_000n, // root 250e9 + child 150e9
      }),
      owner: TESSERA_PROGRAM_ID,
    });
    const ref = {
      genesis_hash: GENESIS,
      program_id: TESSERA_PROGRAM_ID,
      project_address: project,
      node_address: childPda.address,
    };
    const payouts = await port.getPayouts(ref);
    expect(payouts.ok).toBe(true);
    if (!payouts.ok) return;
    expect(payouts.value.issued_total_units).toBe('400000000000');
    expect(payouts.value.entries.length).toBe(2);
    const [rootEntry, childEntry] = payouts.value.entries;
    expect(rootEntry!.node_address).toBe(rootPda.address);
    expect(rootEntry!.numerator_units).toBe('250000000000');
    expect(rootEntry!.denominator_units).toBe('400000000000');
    expect(childEntry!.beneficiary).toBe(other.publicKey);
    expect(childEntry!.numerator_units).toBe('150000000000');
    expect(childEntry!.denominator_units).toBe('400000000000');
  });

  it('getNode recomputes economics + intent digest from stored fields', async () => {
    const { chain, port, contributor, project } = await setupLive();
    const intent = makeIntent({
      genesis: GENESIS,
      project,
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
      nonce: '33333333333333333333333333333333',
      claim_bps: 2500,
    });
    const digest = await intentDigestHex(intent);
    expect(digest.ok).toBe(true);
    if (!digest.ok) return;
    const pda = await findNodePda(TESSERA_PROGRAM_ID, project, contributor.publicKey, intent.nonce);
    chain.accounts.set(pda.address, {
      data: encodeContributionNode({
        project,
        contributor: contributor.publicKey,
        intentDigest: digest.value,
        nonce: intent.nonce,
        name: intent.name,
        title: intent.title,
        artifactSha256: intent.artifact_sha256,
        termsSha256: TERMS,
        claimBps: 2500,
        residualIn: 1_000_000_000_000n,
        effective: 250_000_000_000n,
        residualOut: 750_000_000_000n,
        issued: 250_000_000_000n,
        declaredAt: BigInt(intent.declared_at),
      }),
      owner: TESSERA_PROGRAM_ID,
    });
    const r = await port.getNode({
      genesis_hash: GENESIS,
      program_id: TESSERA_PROGRAM_ID,
      project_address: project,
      node_address: pda.address,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.verification.economics).toBe('recomputed-match');
    expect(r.value.verification.signature).toBe('valid-local');
    expect(r.value.verification.chain_finality).toBe('finalized');
    expect(r.value.node.intent_digest).toBe(digest.value);
  });
});
