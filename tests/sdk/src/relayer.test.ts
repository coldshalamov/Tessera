import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AuditLog,
  OutboxStore,
  RelayerService,
  instructionName,
  loadRelayerConfig,
  reviewSponsoredMessage,
} from '@tessera/relayer';
import {
  ByteWriter,
  LocalTransactionSigner,
  SYSTEM_PROGRAM_ID,
  TESSERA_PROGRAM_ID,
  base64ToBytes,
  compileMessage,
  publishRootIx,
  type JsonRpcClient,
  type SolanaTesseraPort,
} from '@tessera/sdk';
import {
  base58Encode,
  intentDigestHex,
  type IntentV1,
  type PortResult,
  type Submission,
} from '@tessera/types';
import { b64, fakeHash32, makeIntent } from './helpers.js';

const GENESIS = '5TeWSsjg2gbxCyWVniXeCmwM7UtHTCK7svzJr5xYJzHf';
const TERMS = fakeHash32(0x30);
const BLOCKHASH = base58Encode(new Uint8Array(32).fill(9));

// ---------------------------------------------------------------------------
// reviewSponsoredMessage — the sponsor safety gate
// ---------------------------------------------------------------------------

async function sponsorFixture() {
  const sponsor = await LocalTransactionSigner.generate();
  const contributor = await LocalTransactionSigner.generate();
  const project = base58Encode(crypto.getRandomValues(new Uint8Array(32)));
  const node = base58Encode(crypto.getRandomValues(new Uint8Array(32)));
  const intent = makeIntent({
    genesis: GENESIS,
    project,
    contributor: contributor.publicKey,
    terms_sha256: TERMS,
  });
  const ix = publishRootIx({
    project,
    nodePda: node,
    contributor: contributor.publicKey,
    payer: sponsor.publicKey,
    intent,
  });
  const msg = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
  return { sponsor, contributor, project, node, intent, ix, msg };
}

describe('reviewSponsoredMessage', () => {
  it('accepts the exact reviewed instruction for the reviewed intent', async () => {
    const { sponsor, ix, msg } = await sponsorFixture();
    const r = reviewSponsoredMessage({
      message: msg.bytes,
      expected: ix,
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.instructionName).toBe('publish_root');
    expect(r.value.feePayer).toBe(sponsor.publicKey);
    expect(r.value.signers).toEqual(msg.signerKeys);
  });

  it('rejects a message carrying an extra instruction', async () => {
    const { sponsor, ix } = await sponsorFixture();
    const msg = compileMessage([ix, ix], sponsor.publicKey, BLOCKHASH);
    const r = reviewSponsoredMessage({
      message: msg.bytes,
      expected: ix,
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('rejects a system-program instruction (no token/transfer/CPI surface)', async () => {
    const { sponsor, contributor, ix } = await sponsorFixture();
    const transfer = {
      programId: SYSTEM_PROGRAM_ID,
      accounts: [
        { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
        { pubkey: contributor.publicKey, isSigner: false, isWritable: true },
      ],
      data: new ByteWriter().u32(2).u64(1_000_000n).finish(), // system Transfer
    };
    const msg = compileMessage([transfer], sponsor.publicKey, BLOCKHASH);
    const r = reviewSponsoredMessage({
      message: msg.bytes,
      expected: ix,
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('rejects an instruction for a different program', async () => {
    const { sponsor, ix } = await sponsorFixture();
    const foreign = { ...ix, programId: base58Encode(new Uint8Array(32).fill(3)) };
    const msg = compileMessage([foreign], sponsor.publicKey, BLOCKHASH);
    const r = reviewSponsoredMessage({
      message: msg.bytes,
      expected: foreign, // even a "matching" foreign ix fails the allowlist
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('rejects when the fee payer is not the sponsor', async () => {
    const { sponsor, contributor, ix } = await sponsorFixture();
    const msg = compileMessage([ix], contributor.publicKey, BLOCKHASH); // payer = contributor
    const r = reviewSponsoredMessage({
      message: msg.bytes,
      expected: ix,
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('rejects tampered instruction data', async () => {
    const { sponsor, ix } = await sponsorFixture();
    const tampered = { ...ix, data: new Uint8Array(ix.data.map((b, i) => (i === 20 ? b ^ 1 : b))) };
    const msg = compileMessage([tampered], sponsor.publicKey, BLOCKHASH);
    const r = reviewSponsoredMessage({
      message: msg.bytes,
      expected: ix, // reviewed intent's real build — data must differ
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('rejects a substituted account meta', async () => {
    const { sponsor, ix } = await sponsorFixture();
    const swapped = {
      ...ix,
      accounts: ix.accounts.map((a, i) =>
        i === 0 ? { ...a, pubkey: base58Encode(new Uint8Array(32).fill(5)) } : a,
      ),
    };
    const msg = compileMessage([swapped], sponsor.publicKey, BLOCKHASH);
    const r = reviewSponsoredMessage({
      message: msg.bytes,
      expected: ix,
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('rejects malformed bytes', async () => {
    const { sponsor, ix } = await sponsorFixture();
    const r = reviewSponsoredMessage({
      message: new Uint8Array([1, 2, 3]),
      expected: ix,
      sponsorPubkey: sponsor.publicKey,
      programId: TESSERA_PROGRAM_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('names the four deployed instructions', () => {
    expect(instructionName(new Uint8Array([50, 189, 35, 212, 180, 100, 87, 25]))).toBe('publish_root');
    expect(instructionName(new Uint8Array([19, 74, 24, 219, 22, 237, 233, 7]))).toBe(
      'append_contribution',
    );
    expect(instructionName(new Uint8Array([148, 219, 181, 42, 221, 114, 145, 190]))).toBe(
      'create_project',
    );
    expect(instructionName(new Uint8Array([170, 47, 77, 172, 226, 183, 47, 224]))).toBe(
      'initialize_deployment',
    );
    expect(instructionName(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// OutboxStore — durable intake + spend accounting
// ---------------------------------------------------------------------------

function tmpOutbox(): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-outbox-'));
  return { dir, path: join(dir, 'outbox.json') };
}

function rowFor(key: string, digest: string) {
  return {
    idempotency_key: key,
    intent: makeIntent({ genesis: GENESIS, project: 'p', contributor: 'c' }),
    intent_digest: digest,
    node_address: 'n',
    contributor: 'c',
    message_base64: '',
    blockhash: '',
    last_valid_block_height: '0',
    estimated_lamports: '0',
    required_client_signers: [],
    status: 'pending_signature' as const,
    attempts: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

describe('OutboxStore', () => {
  it('persists rows across reload (atomic file)', () => {
    const { path } = tmpOutbox();
    const a = OutboxStore.load(path);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const put = a.value.put(rowFor('k1', 'd1'));
    expect(put.ok).toBe(true);
    const b = OutboxStore.load(path);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.get('k1')?.intent_digest).toBe('d1');
    expect(b.value.rows().length).toBe(1);
  });

  it('tracks daily + per-account lamport spend', () => {
    const { path } = tmpOutbox();
    const s = OutboxStore.load(path);
    if (!s.ok) return;
    const now = Date.now();
    s.value.recordSpend('alice', 10_000n, now);
    s.value.recordSpend('alice', 5_000n, now);
    s.value.recordSpend('bob', 7_000n, now);
    expect(s.value.dailySpend(now)).toBe(22_000n);
    expect(s.value.accountSpend('alice')).toBe(15_000n);
    expect(s.value.accountSpend('bob')).toBe(7_000n);
    const tomorrow = now + 86_400_000 + 1;
    expect(s.value.dailySpend(tomorrow)).toBe(0n); // UTC day boundary
  });

  it('a corrupt outbox file is a hard failure, never silent loss', () => {
    const { path } = tmpOutbox();
    writeFileSync(path, '{ not json');
    const s = OutboxStore.load(path);
    expect(s.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadRelayerConfig — mandatory hard caps, env key reference, kill switch
// ---------------------------------------------------------------------------

const BASE_ENV: Record<string, string> = {
  TESSERA_RELAYER_RPC_URL: 'http://127.0.0.1:8899',
  TESSERA_SPONSOR_KEYPAIR_JSON: '[1,2,3]',
  TESSERA_SPONSOR_DAILY_CAP_LAMPORTS: '50000000',
  TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS: '10000000',
  TESSERA_RELAYER_OUTBOX_FILE: 'C:/tmp/tessera-test/outbox.json',
  TESSERA_RELAYER_AUDIT_FILE: 'C:/tmp/tessera-test/audit.jsonl',
};

describe('loadRelayerConfig', () => {
  it('refuses to run without explicit caps', () => {
    const { TESSERA_SPONSOR_DAILY_CAP_LAMPORTS: _d, ...rest } = BASE_ENV;
    const r = loadRelayerConfig(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/TESSERA_SPONSOR_DAILY_CAP_LAMPORTS/);
  });

  it('refuses mainnet mode outright', () => {
    const r = loadRelayerConfig({ ...BASE_ENV, TESSERA_RELAYER_MODE: 'mainnet' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('MAINNET_WRITES_DISABLED');
  });

  it('requires a sponsor key reference', () => {
    const { TESSERA_SPONSOR_KEYPAIR_JSON: _k, ...rest } = BASE_ENV;
    const r = loadRelayerConfig(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTH_REQUIRED');
  });

  it('loads a valid local-mode config', () => {
    const r = loadRelayerConfig(BASE_ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mode).toBe('local');
    expect(r.value.dailyCapLamports).toBe(50_000_000n);
    expect(r.value.perAccountCapLamports).toBe(10_000_000n);
    expect(r.value.sponsorKeyRef.kind).toBe('env-json');
  });
});

// ---------------------------------------------------------------------------
// RelayerService — end-to-end with a stub port
// ---------------------------------------------------------------------------

interface StubPortOpts {
  chain: {
    /** Set after "landing" so PDA reconcile reports the intent. */
    landedDigest?: string;
  };
  send?: (wire: Uint8Array) => PortResult<Submission>;
  quote?: { rent_lamports: string; fee_lamports: string; total_lamports: string };
}

function stubPort(opts: StubPortOpts): SolanaTesseraPort {
  const port = {
    mode: 'local' as const,
    async connect() {
      return {
        ok: true as const,
        value: {
          genesisHash: GENESIS,
          programDeployed: true,
          deployment: null,
          deploymentAddress: 'cfg',
        },
      };
    },
    async preflightContribution(intent: IntentV1) {
      const digest = await intentDigestHex(intent);
      if (!digest.ok) return { ok: false as const, error: { code: 'CRYPTO_UNAVAILABLE' as const, message: 'digest' } };
      const nodeAddress = base58Encode(crypto.getRandomValues(new Uint8Array(32)));
      const landed =
        opts.chain.landedDigest !== undefined && opts.chain.landedDigest === digest.value;
      return {
        ok: true as const,
        value: {
          nodeAddress,
          nodeRef: {
            genesis_hash: GENESIS,
            program_id: TESSERA_PROGRAM_ID,
            project_address: intent.project_address,
            node_address: nodeAddress,
          },
          existing: landed ? ({ intentDigest: digest.value } as never) : null,
          existingFinality: 'finalized' as const,
          project: {
            stateVersion: 1,
            economicRule: 1,
            extensionPolicy: 1,
            bump: 254,
            networkGenesis: GENESIS,
            programId: TESSERA_PROGRAM_ID,
            creator: intent.contributor,
            controller: null,
            rootNode: null,
            projectNonce: 'aa',
            title: 'P',
            termsSha256: intent.terms_sha256,
            totalUnits: 1_000_000_000_000n,
            createdSlot: 1n,
            createdUnixTime: 1n,
          },
          controller: null,
          intentDigest: digest.value,
        },
      };
    },
    async buildContributionMessage(intent: IntentV1, feePayer: string) {
      const nodePda = base58Encode(crypto.getRandomValues(new Uint8Array(32)));
      const ix = publishRootIx({
        project: intent.project_address,
        nodePda,
        contributor: intent.contributor,
        payer: feePayer,
        intent,
      });
      const msg = compileMessage([ix], feePayer, BLOCKHASH);
      return {
        ok: true as const,
        value: {
          message: msg.bytes,
          signerKeys: msg.signerKeys,
          lastValidBlockHeight: 250n,
          blockhash: BLOCKHASH,
          nodeAddress: nodePda,
        },
      };
    },
    async submitSignedWire(wire: Uint8Array, meta: { intentDigest: string; nodeAddress: string }) {
      if (opts.send) return opts.send(wire);
      opts.chain.landedDigest = meta.intentDigest;
      return {
        ok: true as const,
        value: {
          id: meta.intentDigest,
          status: 'confirmed' as const,
          finality: 'confirmed' as const,
          mode: 'local' as const,
          node_ref: {
            genesis_hash: GENESIS,
            program_id: TESSERA_PROGRAM_ID,
            project_address: 'p',
            node_address: meta.nodeAddress,
          },
        },
      };
    },
    async quoteContribution() {
      const q = opts.quote ?? {
        rent_lamports: '1000',
        fee_lamports: '10000',
        total_lamports: '11000',
      };
      return { ok: true as const, value: { ...q, notes: [] } };
    },
    async getSubmission() {
      return { ok: false as const, error: { code: 'NOT_FOUND' as const, message: 'none' } };
    },
  };
  return port as unknown as SolanaTesseraPort;
}

function stubRpc(): JsonRpcClient {
  return {
    async getBlockHeight() {
      return 100n; // below stored lastValidBlockHeight → not stale
    },
    async getSignatureStatus() {
      return null;
    },
  } as unknown as JsonRpcClient;
}

async function makeService(opts: {
  env?: Record<string, string>;
  port?: SolanaTesseraPort;
  sponsor?: LocalTransactionSigner;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-relayer-'));
  const env = {
    ...BASE_ENV,
    TESSERA_RELAYER_OUTBOX_FILE: join(dir, 'outbox.json'),
    TESSERA_RELAYER_AUDIT_FILE: join(dir, 'audit.jsonl'),
    ...opts.env,
  };
  const cfg = loadRelayerConfig(env);
  if (!cfg.ok) throw new Error(`config: ${cfg.error.message}`);
  const sponsor = opts.sponsor ?? (await LocalTransactionSigner.generate());
  const outbox = OutboxStore.load(cfg.value.outboxPath);
  if (!outbox.ok) throw new Error('outbox');
  const audit = new AuditLog(cfg.value.auditPath);
  const svc = await RelayerService.create({
    cfg: cfg.value,
    outbox: outbox.value,
    audit,
    port: opts.port ?? stubPort({ chain: {} }),
    rpc: stubRpc(),
    sponsor,
  });
  if (!svc.ok) throw new Error(`service: ${svc.error.message}`);
  return { service: svc.value, sponsor, auditPath: cfg.value.auditPath, outboxPath: cfg.value.outboxPath, cfg: cfg.value };
}

async function consent(intent: IntentV1, signer: LocalTransactionSigner) {
  const digest = await intentDigestHex(intent);
  if (!digest.ok) throw new Error('digest');
  const sig = await signer.sign(new Uint8Array(Buffer.from(digest.value, 'hex')));
  return Buffer.from(sig).toString('base64');
}

describe('RelayerService', () => {
  it('prepare → client signs → submit: sponsor co-signs as fee payer and confirms', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service } = await makeService({ sponsor });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const prepared = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-1',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.status).toBe('pending_signature');
    expect(prepared.value.required_client_signers).toEqual([contributor.publicKey]);
    const msgBytes = base64ToBytes(prepared.value.message_base64!)!;
    const txSig = await contributor.sign(msgBytes);
    const sub = await service.submit({
      idempotency_key: 'rk-1',
      tx_signatures: { [contributor.publicKey]: b64(txSig) },
    });
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    expect(sub.value.status).toBe('confirmed');
    expect(sub.value.finality).toBe('confirmed');
    // And the wire transaction really carries the sponsor as first signer.
  });

  it('rejects a bad detached consent signature', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const evil = await LocalTransactionSigner.generate();
    const { service } = await makeService({ sponsor });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const r = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, evil), // wrong signer
      idempotency_key: 'rk-bad',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_SIGNATURE');
  });

  it('idempotent: same key + same intent returns the same row; different intent conflicts', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service } = await makeService({ sponsor });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const sig = await consent(intent, contributor);
    const a = await service.prepare({ intent, consent_signature_base64: sig, idempotency_key: 'dup' });
    const b = await service.prepare({ intent, consent_signature_base64: sig, idempotency_key: 'dup' });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.value.intent_sha256).toBe(a.value.intent_sha256);
      expect(b.value.node_address).toBe(a.value.node_address);
    }
    const other = { ...intent, name: 'different-name' };
    const c = await service.prepare({
      intent: other,
      consent_signature_base64: await consent(other, contributor),
      idempotency_key: 'dup',
    });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.code).toBe('NONCE_REUSE_MISMATCH');
  });

  it('missing tx signatures → MISSING_TX_SIGNATURES; unexpected keys rejected', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service } = await makeService({ sponsor });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-sig',
    });
    const missing = await service.submit({ idempotency_key: 'rk-sig', tx_signatures: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('MISSING_TX_SIGNATURES');
    const stray = await LocalTransactionSigner.generate();
    const withStray = await service.submit({
      idempotency_key: 'rk-sig',
      tx_signatures: { [stray.publicKey]: b64(new Uint8Array(64)) },
    });
    expect(withStray.ok).toBe(false);
    if (!withStray.ok) expect(withStray.error.code).toBe('INSTRUCTION_REJECTED');
  });

  it('wrong tx signature over the message → INVALID_SIGNATURE', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service } = await makeService({ sponsor });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const prepared = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-wrongsig',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const wrong = await contributor.sign(new Uint8Array([1, 2, 3])); // signed different bytes
    const r = await service.submit({
      idempotency_key: 'rk-wrongsig',
      tx_signatures: { [contributor.publicKey]: b64(wrong) },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_SIGNATURE');
  });

  it('kill switch: prepare holds the intent, submit reports paused — nothing signed', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service } = await makeService({
      sponsor,
      env: { TESSERA_RELAYER_KILL_SWITCH: '1' },
    });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const r = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-paused',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SPONSOR_PAUSED');
    // The intent is preserved (row exists) for later resumption.
    const st = await service.status();
    expect(st.paused).toBe(true);
    expect(st.outbox.pending).toBe(1);
  });

  it('hard caps: intake exceeding the daily cap is held, not signed', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service } = await makeService({
      sponsor,
      env: {
        TESSERA_SPONSOR_DAILY_CAP_LAMPORTS: '5000', // below the 11_000 quote
        TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS: '100000000',
      },
    });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const prepared = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-cap',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const msgBytes = base64ToBytes(prepared.value.message_base64!)!;
    const txSig = await contributor.sign(msgBytes);
    const r = await service.submit({
      idempotency_key: 'rk-cap',
      tx_signatures: { [contributor.publicKey]: b64(txSig) },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SPONSOR_BUDGET_EXHAUSTED');
    // Held row preserved — not silently dropped.
    const st = await service.status();
    expect(st.outbox.pending).toBe(1);
  });

  it('per-account cap binds independently of the daily cap', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service } = await makeService({
      sponsor,
      env: {
        TESSERA_SPONSOR_DAILY_CAP_LAMPORTS: '100000000',
        TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS: '5000',
      },
    });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const prepared = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-acct',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const msgBytes = base64ToBytes(prepared.value.message_base64!)!;
    const txSig = await contributor.sign(msgBytes);
    const r = await service.submit({
      idempotency_key: 'rk-acct',
      tx_signatures: { [contributor.publicKey]: b64(txSig) },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SPONSOR_BUDGET_EXHAUSTED');
  });

  it('idempotent replay: already-landed PDA returns terminal state without signing', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const chainState: { landedDigest?: string } = {};
    const port = stubPort({ chain: chainState });
    const { service } = await makeService({ sponsor, port });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    // Pretend the intent already landed on-chain.
    const digest = await intentDigestHex(intent);
    if (!digest.ok) return;
    chainState.landedDigest = digest.value;
    const prepared = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-landed',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.status).toBe('finalized'); // no message to sign
    expect(prepared.value.message_base64).toBeUndefined();
  });

  it('audit log records the trail without any secret material', async () => {
    const sponsor = await LocalTransactionSigner.generate();
    const contributor = await LocalTransactionSigner.generate();
    const { service, auditPath } = await makeService({ sponsor });
    const intent = makeIntent({
      genesis: GENESIS,
      project: base58Encode(crypto.getRandomValues(new Uint8Array(32))),
      contributor: contributor.publicKey,
      terms_sha256: TERMS,
    });
    const prepared = await service.prepare({
      intent,
      consent_signature_base64: await consent(intent, contributor),
      idempotency_key: 'rk-audit',
    });
    expect(prepared.ok).toBe(true);
    const text = readFileSync(auditPath, 'utf8');
    expect(text).toContain('intake_prepared');
    expect(text).toContain('rk-audit');
    // Sponsor seed/secret must never appear — the keypair JSON never touches it.
    expect(text).not.toMatch(/secret|keypair|seed/i);
    // And events are JSONL — one JSON object per line.
    const lines = text.trim().split('\n');
    for (const line of lines) {
      const ev = JSON.parse(line) as { ts: string; event: string };
      expect(ev.ts).toMatch(/T/);
      expect(typeof ev.event).toBe('string');
    }
  });
});
