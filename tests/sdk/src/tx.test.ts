import { describe, expect, it } from 'vitest';
import {
  TxBuildError,
  appendContributionIx,
  bytesEqual,
  compileMessage,
  parseCompiledMessage,
  publishRootIx,
  serializeTransaction,
  transactionMessageBytes,
  transactionSignatures,
} from '@tessera/sdk';
import { base58Encode } from '@tessera/types';
import { makeIntent, newSigner, randomPubkey } from './helpers.js';

const GENESIS = '5TeWSsjg2gbxCyWVniXeCmwM7UtHTCK7svzJr5xYJzHf';
const BLOCKHASH = base58Encode(new Uint8Array(32).fill(7));

async function rootIxFixture() {
  const contributor = await newSigner();
  const sponsor = await newSigner();
  const project = randomPubkey();
  const node = randomPubkey();
  const intent = makeIntent({
    genesis: GENESIS,
    project,
    contributor: contributor.publicKey,
  });
  const ix = publishRootIx({
    project,
    nodePda: node,
    contributor: contributor.publicKey,
    payer: sponsor.publicKey,
    intent,
  });
  return { ix, contributor, sponsor, project, node, intent };
}

describe('transaction compiler', () => {
  it('compiles and re-parses a publish_root message exactly', async () => {
    const { ix, contributor, sponsor, project, node } = await rootIxFixture();
    const msg = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    expect(msg.signerKeys).toEqual([sponsor.publicKey, contributor.publicKey]);
    const parsed = parseCompiledMessage(msg.bytes);
    expect(parsed.numSigners).toBe(2);
    expect(parsed.accountKeys[0]).toBe(sponsor.publicKey);
    expect(parsed.recentBlockhash).toBe(BLOCKHASH);
    expect(parsed.instructions.length).toBe(1);
    const parsedIx = parsed.instructions[0]!;
    expect(parsedIx.programId).toBe(ix.programId);
    expect(parsedIx.accounts.map((a) => a.pubkey)).toEqual(
      ix.accounts.map((a) => a.pubkey),
    );
    expect(parsedIx.accounts[0]).toMatchObject({ pubkey: project, isWritable: true });
    expect(parsedIx.accounts[1]).toMatchObject({ pubkey: node, isWritable: true });
    expect(parsedIx.accounts[2]).toMatchObject({
      pubkey: contributor.publicKey,
      isSigner: true,
    });
    expect(parsedIx.accounts[3]).toMatchObject({ pubkey: sponsor.publicKey, isSigner: true });
    expect(bytesEqual(parsedIx.data, ix.data)).toBe(true);
  });

  it('serializes a fully-signed transaction and extracts signatures', async () => {
    const { ix, contributor, sponsor } = await rootIxFixture();
    const msg = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    const sigs = new Map<string, Uint8Array>();
    sigs.set(sponsor.publicKey, await sponsor.sign(msg.bytes));
    sigs.set(contributor.publicKey, await contributor.sign(msg.bytes));
    const wire = serializeTransaction(msg, sigs);
    const txSigs = transactionSignatures(wire);
    expect(txSigs.length).toBe(2);
    // Signature order follows signer order: payer first.
    expect(bytesEqual(txSigs[0]!, sigs.get(sponsor.publicKey)!)).toBe(true);
    expect(bytesEqual(txSigs[1]!, sigs.get(contributor.publicKey)!)).toBe(true);
    const embedded = transactionMessageBytes(wire)!;
    expect(bytesEqual(embedded, msg.bytes)).toBe(true);
  });

  it('refuses to serialize with a missing signer', async () => {
    const { ix, sponsor } = await rootIxFixture();
    const msg = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    const sigs = new Map<string, Uint8Array>();
    sigs.set(sponsor.publicKey, await sponsor.sign(msg.bytes)); // contributor missing
    expect(() => serializeTransaction(msg, sigs)).toThrow(TxBuildError);
  });

  it('dedupes the fee payer out of the metas and puts it first', async () => {
    const { intent, contributor, project, node } = await rootIxFixture();
    // contributor as its own payer → single signer
    const ix = publishRootIx({
      project,
      nodePda: node,
      contributor: contributor.publicKey,
      payer: contributor.publicKey,
      intent,
    });
    const msg = compileMessage([ix], contributor.publicKey, BLOCKHASH);
    expect(msg.signerKeys).toEqual([contributor.publicKey]);
    expect(msg.numReadonlySigned).toBe(0);
  });

  it('compile is deterministic for identical inputs', async () => {
    const { ix, sponsor } = await rootIxFixture();
    const a = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    const b = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    expect(bytesEqual(a.bytes, b.bytes)).toBe(true);
  });

  it('rejects trailing garbage in parseCompiledMessage', async () => {
    const { ix, sponsor } = await rootIxFixture();
    const msg = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    const grown = new Uint8Array(msg.bytes.length + 1);
    grown.set(msg.bytes);
    expect(() => parseCompiledMessage(grown)).toThrow(TxBuildError);
  });

  it('builds append_contribution with controller meta for REVIEWED', async () => {
    const contributor = await newSigner();
    const controller = await newSigner();
    const sponsor = await newSigner();
    const project = randomPubkey();
    const parent = randomPubkey();
    const node = randomPubkey();
    const intent = makeIntent({
      genesis: GENESIS,
      project,
      contributor: contributor.publicKey,
      parent,
    });
    const ix = appendContributionIx({
      project,
      parent,
      nodePda: node,
      contributor: contributor.publicKey,
      controller: controller.publicKey,
      payer: sponsor.publicKey,
      intent,
    });
    const msg = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    expect(msg.signerKeys).toContain(controller.publicKey);
    expect(msg.signerKeys.length).toBe(3);
  });

  it('OPEN append uses the program id as the controller placeholder (Option<Signer> None)', async () => {
    const contributor = await newSigner();
    const sponsor = await newSigner();
    const project = randomPubkey();
    const parent = randomPubkey();
    const node = randomPubkey();
    const intent = makeIntent({
      genesis: GENESIS,
      project,
      contributor: contributor.publicKey,
      parent,
    });
    const ix = appendContributionIx({
      project,
      parent,
      nodePda: node,
      contributor: contributor.publicKey,
      controller: null,
      payer: sponsor.publicKey,
      intent,
    });
    // The Option<Signer> None convention: the program id occupies the slot,
    // marked non-signer.
    const ctrlMeta = ix.accounts[4]!;
    expect(ctrlMeta.pubkey).toBe(ix.programId);
    expect(ctrlMeta.isSigner).toBe(false);
    const msg = compileMessage([ix], sponsor.publicKey, BLOCKHASH);
    expect(msg.signerKeys).toEqual([sponsor.publicKey, contributor.publicKey]);
  });

  it('rejects a non-base58 blockhash', async () => {
    const { ix, sponsor } = await rootIxFixture();
    expect(() => compileMessage([ix], sponsor.publicKey, 'not-base58!!')).toThrow(TxBuildError);
  });
});
