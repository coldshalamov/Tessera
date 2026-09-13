import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalTransactionSigner } from '@tessera/sdk';
import { base58Encode, hexToBytes, type IntentV1 } from '@tessera/types';

export function tmpdirPath(): string {
  return mkdtempSync(join(tmpdir(), 'tessera-sdk-test-'));
}

export function hexBytes(hex: string): Uint8Array {
  const b = hexToBytes(hex);
  if (b === null) throw new Error(`bad hex in test: ${hex.slice(0, 40)}`);
  return b;
}

export function b64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}

export function unb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** Deterministic 32-byte hex digest for tests (not a real sha256 input). */
export function fakeHash32(seed: number): string {
  return Array.from({ length: 32 }, (_, i) => ((seed + i) & 0xff).toString(16).padStart(2, '0')).join('');
}

/** A valid IntentV1 for a given contributor/project (root when parent null). */
export function makeIntent(args: {
  genesis: string;
  project: string;
  contributor: string;
  parent?: string | null;
  nonce?: string;
  claim_bps?: number;
  terms_sha256?: string;
}): IntentV1 {
  return {
    format_version: 1,
    network_genesis: args.genesis,
    program_id: '3fkMf7oJhVkiJF3Q7N6TzbRs16gsDFrJWXHNZcSFvytX',
    project_address: args.project,
    economic_parent: args.parent ?? null,
    references: [],
    nonce: args.nonce ?? '000102030405060708090a0b0c0d0e0f',
    contributor: args.contributor,
    name: 'tester',
    title: 'Test Contribution',
    artifact_sha256: fakeHash32(0xa0),
    metadata_sha256: null,
    terms_sha256: args.terms_sha256 ?? fakeHash32(0x30),
    claim_bps: args.claim_bps ?? 2500,
    statement_code: 'CONTRIBUTE_AND_ACCEPT_TERMS',
    declared_at: '1750000000',
    custody_mode: 'user_controlled',
  };
}

export async function newSigner(): Promise<LocalTransactionSigner> {
  return LocalTransactionSigner.generate();
}

export function randomPubkey(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return base58Encode(b);
}
