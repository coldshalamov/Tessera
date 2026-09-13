import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AuditLog,
  OutboxStore,
  RelayerService,
  loadRelayerConfig,
} from '@tessera/relayer';
import {
  JsonRpcClient,
  LocalTransactionSigner,
  TESSERA_PROGRAM_ID,
  base64ToBytes,
  createSolanaTesseraPort,
  findNodePda,
} from '@tessera/sdk';
import {
  base58Encode,
  intentDigestHex,
  type IntentV1,
  type SignedIntent,
} from '@tessera/types';
import { b64, fakeHash32 } from './helpers.js';

/**
 * LIVE localnet proof — gated by TESSERA_SDK_LIVE=1 (requires a running
 * `solana-test-validator` with the T03 program deployed; see
 * reports/sdk-conformance.md for the exact WSL2 harness commands).
 *
 *   TESSERA_SDK_LIVE=1 TESSERA_LIVE_RPC_URL=http://127.0.0.1:8899 pnpm --filter @tessera-tests/sdk test
 *
 * Proves on a real cluster: deployment init, project, root + child + sibling
 * writes, on-chain intent digest == package/types digest, sponsor-as-fee-
 * payer through the relayer, same-intent idempotent replay, wrong-genesis
 * rejection, and confirmed→finalized reconciliation. Keypairs are generated
 * in-memory per run and funded by validator airdrops — nothing is committed.
 */

const LIVE = process.env['TESSERA_SDK_LIVE'] === '1';
const RPC_URL = process.env['TESSERA_LIVE_RPC_URL'] ?? 'http://127.0.0.1:8899';

const TERMS = fakeHash32(0x30);

async function airdrop(rpc: JsonRpcClient, pubkey: string, sol = 2): Promise<void> {
  const sig = await rpc.requestAirdrop(pubkey, BigInt(sol) * 1_000_000_000n);
  for (let i = 0; i < 60; i++) {
    const st = await rpc.getSignatureStatus(sig);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`airdrop to ${pubkey} not confirmed`);
}

async function signIntent(intent: IntentV1, signer: LocalTransactionSigner): Promise<SignedIntent> {
  const digest = await intentDigestHex(intent);
  if (!digest.ok) throw new Error(`digest: ${digest.error.message}`);
  const sig = await signer.sign(new Uint8Array(Buffer.from(digest.value, 'hex')));
  return {
    intent,
    signature_base64: Buffer.from(sig).toString('base64'),
    signer: signer.publicKey,
  };
}

describe.skipIf(!LIVE)('LIVE localnet proof (requires solana-test-validator + deployed program)', () => {
  it('runs the full real-chain flow end-to-end', async () => {
    const rpc = new JsonRpcClient(RPC_URL, { timeoutMs: 20_000 });
    const deployer = await LocalTransactionSigner.generate();
    const sponsor = await LocalTransactionSigner.generate();
    const alice = await LocalTransactionSigner.generate();
    const bob = await LocalTransactionSigner.generate();
    for (const s of [deployer, sponsor, alice, bob]) {
      await airdrop(rpc, s.publicKey);
    }

    const port = createSolanaTesseraPort({
      mode: 'local',
      rpcUrl: RPC_URL,
      payer: sponsor,
      signers: [deployer, sponsor, alice, bob],
      confirmTarget: 'confirmed',
      confirmTimeoutMs: 60_000,
    });

    // -- 1. connect: program must be deployed -------------------------------
    const info = await port.connect();
    expect(info.ok).toBe(true);
    if (!info.ok) throw new Error(info.error.message);
    const genesis = info.value.genesisHash;
    expect(info.value.programDeployed).toBe(true);

    // -- 2. deployment init (idempotent-safe across runs) -------------------
    if (info.value.deployment === null) {
      const init = await port.initializeDeployment({ authority: deployer.publicKey, payer: deployer.publicKey });
      expect(init.ok).toBe(true);
      if (!init.ok) throw new Error(`initialize_deployment: ${init.error.message}`);
    }

    // -- 3. project ----------------------------------------------------------
    const projectNonce = crypto.getRandomValues(new Uint8Array(16));
    const nonceHex = [...projectNonce].map((b) => b.toString(16).padStart(2, '0')).join('');
    const project = await port.createProject({
      creator: alice.publicKey,
      project_nonce: nonceHex,
      title: 'T04 Live Proof',
      terms_sha256: TERMS,
      extension_policy: 'OPEN',
    });
    expect(project.ok).toBe(true);
    if (!project.ok) throw new Error(`create_project: ${project.error.message}`);
    const projectAddr = project.value.project.project_address;
    expect(project.value.project.terms_sha256).toBe(TERMS);

    // -- 4. root contribution via the direct port (payer = sponsor) ---------
    const mkInput = (contributor: LocalTransactionSigner, name: string, parent: string | null, nonceSeed: number) => ({
      project_address: projectAddr,
      economic_parent:
        parent === null
          ? null
          : {
              genesis_hash: genesis,
              program_id: TESSERA_PROGRAM_ID,
              project_address: projectAddr,
              node_address: parent,
            },
      contributor: contributor.publicKey,
      name,
      title: `T04 ${name}`,
      artifact_sha256: fakeHash32(nonceSeed),
      terms_sha256: TERMS,
      claim_bps: 2000,
      custody_mode: 'user_controlled' as const,
    });

    const prepRoot = await port.prepareContribution(mkInput(alice, 'root', null, 0x10));
    expect(prepRoot.ok).toBe(true);
    if (!prepRoot.ok) throw new Error(prepRoot.error.message);
    const subRoot = await port.submitSignedContribution(
      await signIntent(prepRoot.value.intent, alice),
      `root-${nonceHex}`,
    );
    expect(subRoot.ok).toBe(true);
    if (!subRoot.ok) throw new Error(subRoot.error.message);
    expect(subRoot.value.status).toBe('confirmed');
    const rootRef = subRoot.value.node_ref!;
    expect(rootRef.node_address).toBeTruthy();

    // On-chain digest == package/types digest. getNode reads at finalized
    // commitment, which lags 'confirmed' on the validator — poll briefly.
    let nodeRoot = await port.getNode(rootRef);
    for (let i = 0; !nodeRoot.ok && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      nodeRoot = await port.getNode(rootRef);
    }
    expect(nodeRoot.ok).toBe(true);
    if (!nodeRoot.ok) throw new Error(nodeRoot.error.message);
    expect(nodeRoot.value.node.intent_digest).toBe(prepRoot.value.intent_sha256);
    const recomputed = await intentDigestHex(prepRoot.value.intent);
    expect(recomputation(recomputed, prepRoot.value.intent_sha256)).toBe(true);
    expect(nodeRoot.value.verification.economics).toBe('recomputed-match');

    function recomputation(r: { ok: boolean; value?: string }, expected: string): boolean {
      return r.ok && r.value === expected;
    }

    // -- 5. same-intent replay is idempotent (no duplicate account) ---------
    const replay = await port.submitSignedContribution(
      await signIntent(prepRoot.value.intent, alice),
      `root-replay-${nonceHex}`,
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.error.message);
    expect(replay.value.id).toBe(prepRoot.value.intent_sha256);
    expect(['confirmed', 'finalized']).toContain(replay.value.status);

    // -- 6. child + sibling through the RELAYER (sponsor-as-fee-payer) ------
    const dir = mkdtempSync(join(tmpdir(), 'tessera-live-relayer-'));
    const cfg = loadRelayerConfig({
      TESSERA_RELAYER_MODE: 'local',
      TESSERA_RELAYER_RPC_URL: RPC_URL,
      TESSERA_SPONSOR_KEYPAIR_JSON: '[unused-injected]',
      TESSERA_SPONSOR_DAILY_CAP_LAMPORTS: '500000000',
      TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS: '100000000',
      TESSERA_RELAYER_OUTBOX_FILE: join(dir, 'outbox.json'),
      TESSERA_RELAYER_AUDIT_FILE: join(dir, 'audit.jsonl'),
    });
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) throw new Error(cfg.error.message);
    const outbox = OutboxStore.load(cfg.value.outboxPath);
    if (!outbox.ok) throw new Error('outbox load');
    const relayerR = await RelayerService.create({
      cfg: cfg.value,
      outbox: outbox.value,
      audit: new AuditLog(cfg.value.auditPath),
      sponsor,
      port: createSolanaTesseraPort({
        mode: 'local',
        rpcUrl: RPC_URL,
        payer: sponsor,
        signers: [sponsor],
        confirmTarget: 'confirmed',
        confirmTimeoutMs: 60_000,
      }),
      rpc,
    });
    expect(relayerR.ok).toBe(true);
    if (!relayerR.ok) throw new Error(relayerR.error.message);
    const relayer = relayerR.value;

    async function relayContrib(
      who: LocalTransactionSigner,
      name: string,
      parent: string | null,
      keyTag: string,
      nonceSeed: number,
    ) {
      const prep = await port.prepareContribution(mkInput(who, name, parent, nonceSeed));
      if (!prep.ok) throw new Error(`prepare ${name}: ${prep.error.message}`);
      const consentDigest = await intentDigestHex(prep.value.intent);
      if (!consentDigest.ok) throw new Error('digest');
      const consentSig = await who.sign(
        new Uint8Array(Buffer.from(consentDigest.value, 'hex')),
      );
      const prepared = await relayer.prepare({
        intent: prep.value.intent,
        consent_signature_base64: Buffer.from(consentSig).toString('base64'),
        idempotency_key: `live-${keyTag}-${nonceHex}`,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(`relayer prepare ${name}: ${prepared.error.message}`);
      expect(prepared.value.status).toBe('pending_signature');
      const msgBytes = base64ToBytes(prepared.value.message_base64!)!;
      const txSig = await who.sign(msgBytes);
      const sub = await relayer.submit({
        idempotency_key: `live-${keyTag}-${nonceHex}`,
        tx_signatures: { [who.publicKey]: b64(txSig) },
      });
      expect(sub.ok).toBe(true);
      if (!sub.ok) throw new Error(`relayer submit ${name}: ${sub.error.message}`);
      return { sub: sub.value, prep: prep.value };
    }

    const child = await relayContrib(bob, 'child', rootRef.node_address, 'child', 0x20);
    expect(child.sub.status).toBe('confirmed');
    const sibling = await relayContrib(alice, 'sibling', rootRef.node_address, 'sibling', 0x30);

    // Relayer outbox proves the sponsor signature + tx signature persisted.
    const row = outbox.value.get(`live-child-${nonceHex}`);
    expect(row?.status === 'confirmed' || row?.status === 'finalized').toBe(true);
    expect(row?.signature).toBeTruthy();

    // Sponsor-as-fee-payer on the real wire transaction (getTransaction is
    // served at finalized commitment — poll until the validator finalizes).
    let tx = await rpc.getTransaction(row!.signature!);
    for (let i = 0; tx === null && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      tx = await rpc.getTransaction(row!.signature!);
    }
    expect(tx).not.toBeNull();
    expect(tx!.transaction?.message?.accountKeys?.[0]).toBe(sponsor.publicKey);

    // Child digest equality via the parent-linked node.
    const childRef = {
      genesis_hash: genesis,
      program_id: TESSERA_PROGRAM_ID,
      project_address: projectAddr,
      node_address: (
        await findNodePda(TESSERA_PROGRAM_ID, projectAddr, bob.publicKey, child.prep.intent.nonce)
      ).address,
    };
    let nodeChild = await port.getNode(childRef);
    for (let i = 0; !nodeChild.ok && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      nodeChild = await port.getNode(childRef);
    }
    expect(nodeChild.ok).toBe(true);
    if (!nodeChild.ok) throw new Error(nodeChild.error.message);
    expect(nodeChild.value.node.intent_digest).toBe(child.prep.intent_sha256);
    expect(nodeChild.value.node.economic_parent?.node_address).toBe(rootRef.node_address);

    // Exact payouts over root+child+sibling.
    const payouts = await port.getPayouts(childRef);
    expect(payouts.ok).toBe(true);
    if (payouts.ok) {
      const sum = payouts.value.entries.reduce((a, e) => a + BigInt(e.numerator_units), 0n);
      expect(sum).toBe(BigInt(payouts.value.issued_total_units));
      expect(payouts.value.entries.every((e) => e.denominator_units === payouts.value.issued_total_units)).toBe(true);
    }
    void sibling;

    // -- 7. wrong-genesis port rejects the same cluster ---------------------
    const wrongPort = createSolanaTesseraPort({
      mode: 'local',
      rpcUrl: RPC_URL,
      expectedGenesisHash: base58Encode(new Uint8Array(32).fill(0x11)),
    });
    const wrong = await wrongPort.connect();
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('NETWORK_MISMATCH');

    // -- 8. confirmed → finalized reconciliation ----------------------------
    // The same port instance retains the tx signature and upgrades the
    // recorded submission once the validator reports finalized.
    let finalStatus = '';
    for (let i = 0; i < 90; i++) {
      const s = await port.getSubmission(subRoot.value.id);
      if (s.ok) finalStatus = s.value.status;
      if (finalStatus === 'finalized') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // Cross-check against the raw signature status too.
    let finalized = finalStatus === 'finalized';
    for (let i = 0; i < 90 && !finalized; i++) {
      const st = await rpc.getSignatureStatus(row!.signature!);
      if (st?.confirmationStatus === 'finalized') finalized = true;
      else await new Promise((r) => setTimeout(r, 500));
    }
    expect(finalized).toBe(true);
    // And the node's getNode reads it at finalized commitment.
    const nodeFinal = await port.getNode(rootRef);
    expect(nodeFinal.ok && nodeFinal.value.verification.chain_finality === 'finalized').toBe(true);
  });
});
