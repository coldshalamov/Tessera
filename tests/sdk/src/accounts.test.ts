import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AccountDecodeError,
  TESSERA_PROGRAM_ID,
  decodeContributionNode,
  decodeDeploymentConfig,
  decodeProjectAccount,
  decodeStatementRecord,
} from '@tessera/sdk';
import { hexBytes } from './helpers.js';

/**
 * Byte-level conformance: the SDK's hand-rolled decoders MUST decode the
 * committed golden vectors emitted from the deployed program's Rust state
 * (generated/vectors/account-layout-v1.json). A field-order or width drift
 * fails here before any validator is needed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface VectorEntry {
  account: string;
  allocated_bytes: number;
  bytes_hex: string;
  discriminator_hex: string;
  field_order: string[];
  serialized_len: number;
}

const vectors = JSON.parse(
  readFileSync(join(HERE, '../../../generated/vectors/account-layout-v1.json'), 'utf8'),
) as { accounts: VectorEntry[]; program_id: string };

const byName = new Map(vectors.accounts.map((a) => [a.account, a]));

describe('account-layout-v1 golden vectors', () => {
  it('pins the deployed program id', () => {
    expect(vectors.program_id).toBe(TESSERA_PROGRAM_ID);
  });

  it('decodes DeploymentConfig (106 B)', () => {
    const v = byName.get('DeploymentConfig')!;
    const data = hexBytes(v.bytes_hex);
    expect(data.length).toBe(v.serialized_len);
    expect(v.serialized_len).toBeLessThanOrEqual(v.allocated_bytes);
    expect(v.allocated_bytes).toBe(106);
    const cfg = decodeDeploymentConfig(data);
    expect(cfg.stateVersion).toBe(1);
    expect(cfg.programId).toBe(TESSERA_PROGRAM_ID);
    expect(cfg.bump).toBe(255);
    expect(cfg.networkGenesis).toBe('5TeWSsjg2gbxCyWVniXeCmwM7UtHTCK7svzJr5xYJzHf');
    expect(cfg.authority).toBe('Bswb3UyeD1pUTaGiE6WvqwFpJZsQSEY1xhJePCDTHdvp');
  });

  it('decodes ProjectAccount (346 B allocated, 266 B serialized)', () => {
    const v = byName.get('ProjectAccount')!;
    const data = hexBytes(v.bytes_hex);
    expect(data.length).toBe(v.serialized_len);
    expect(v.allocated_bytes).toBe(346);
    const p = decodeProjectAccount(data);
    expect(p.stateVersion).toBe(1);
    expect(p.economicRule).toBe(1); // residual-v1
    expect(p.extensionPolicy).toBe(2); // REVIEWED in this vector
    expect(p.programId).toBe(TESSERA_PROGRAM_ID);
    expect(p.controller).toBe('DyRkUpQxYG2VnP2SkMdQs5BTsVPeKCpSHLxzByc2Sxvj');
    expect(p.rootNode).toBe('5BXQSBCPDShWC5DoEKUyoFoKgaVC978Um3WiHmid718S');
    expect(p.title).toBe('The Lantern Room');
    expect(p.projectNonce).toBe('0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a');
    expect(p.termsSha256).toBe('0707070707070707070707070707070707070707070707070707070707070707');
    expect(p.totalUnits).toBe(1_000_000_000_000n);
    expect(p.createdSlot).toBe(42n);
    expect(p.createdUnixTime).toBe(1789166400n);
  });

  it('decodes ContributionNode (759 B allocated, 405 B serialized)', () => {
    const v = byName.get('ContributionNode')!;
    const data = hexBytes(v.bytes_hex);
    expect(v.allocated_bytes).toBe(759);
    const n = decodeContributionNode(data);
    expect(n.stateVersion).toBe(1);
    expect(n.economicRule).toBe(1);
    expect(n.nodeState).toBe(1); // FINALIZED
    expect(n.bump).toBe(253);
    expect(n.depth).toBe(1); // a child node in this vector
    expect(n.claimBps).toBe(1500);
    expect(n.custodyMode).toBe(3); // server_custodied
    expect(n.project).toBe('2K8CfN8zTE59rgTjqZxeTWxTPXFUgKGoC2uVBzYa2XSq');
    expect(n.economicParent).toBe('5BXQSBCPDShWC5DoEKUyoFoKgaVC978Um3WiHmid718S');
    expect(n.contributor).toBe('4MPEkX67Yf1CApYj9PSzN6RCENYS2aFcrvHjZmpFW7Au');
    expect(n.references).toEqual(['4Ss5JMkXAD9Z7cktFEdrqeMuT6jGMF1pVozTyPHZ6zT4']);
    expect(n.nonce).toBe('000102030405060708090a0b0c0d0e0f');
    expect(n.name).toBe('Alex');
    expect(n.title).toBe('The Lantern Room test seed');
    expect(n.intentDigest).toBe(
      '7de807a322acfdd7f57d493465d7c69e6f087a8a3c318454637577a9b8114f15',
    );
    expect(n.metadataSha256).toBe(
      '12cc1c1f597a4173d43b0f4b553cf588785f15d0ad0e5df3d327cd9064dc0a04',
    );
    expect(n.termsSha256).toBe(
      '0707070707070707070707070707070707070707070707070707070707070707',
    );
    expect(n.residualInUnits).toBe(850_000_000_000n);
    expect(n.effectiveUnits).toBe(127_500_000_000n);
    expect(n.residualOutUnits).toBe(722_500_000_000n);
    expect(n.issuedTotalUnits).toBe(277_500_000_000n);
    expect(n.ownPayoutNumeratorUnits).toBe(127_500_000_000n);
    expect(n.ownPayoutDenominatorUnits).toBe(277_500_000_000n);
    // Economics internal consistency: effective + residual_out == residual_in.
    expect(n.effectiveUnits + n.residualOutUnits).toBe(n.residualInUnits);
  });

  it('decodes StatementRecord (295 B) — layout committed, instruction deferred', () => {
    const v = byName.get('StatementRecord')!;
    const data = hexBytes(v.bytes_hex);
    expect(v.allocated_bytes).toBe(295);
    const s = decodeStatementRecord(data);
    expect(s.stateVersion).toBe(1);
    expect(s.statementType).toBe(3);
    expect(s.custodyMode).toBe(1);
    expect(s.project).toBe('2K8CfN8zTE59rgTjqZxeTWxTPXFUgKGoC2uVBzYa2XSq');
    expect(s.subjectRef).toBe('5BXQSBCPDShWC5DoEKUyoFoKgaVC978Um3WiHmid718S');
    expect(s.auxKey).toBeNull();
    expect(s.payloadSha256).toBe(
      '7777777777777777777777777777777777777777777777777777777777777777',
    );
    expect(s.statementDigest).toBe(
      '8888888888888888888888888888888888888888888888888888888888888888',
    );
    expect(s.observedSlot).toBe(4300n);
  });

  it('rejects a wrong discriminator', () => {
    const v = byName.get('ContributionNode')!;
    const data = hexBytes(v.bytes_hex);
    data[0] = data[0]! ^ 0xff;
    expect(() => decodeContributionNode(data)).toThrow(AccountDecodeError);
  });

  it('rejects a truncated buffer', () => {
    const v = byName.get('ContributionNode')!;
    const data = hexBytes(v.bytes_hex).subarray(0, 100);
    expect(() => decodeContributionNode(data)).toThrow(AccountDecodeError);
  });

  it('rejects an out-of-range option tag', () => {
    const v = byName.get('ContributionNode')!;
    const data = hexBytes(v.bytes_hex);
    // economic_parent option tag: 8 disc + 1+1+1+1 + 2 + 2 + 1 + 32 = 49
    const tagOffset = 8 + 1 + 1 + 1 + 1 + 2 + 2 + 1 + 32;
    expect(data[tagOffset]).toBe(1); // Some in this vector
    data[tagOffset] = 7;
    expect(() => decodeContributionNode(data)).toThrow(AccountDecodeError);
  });

  it('rejects a references count beyond the wire maximum', () => {
    const v = byName.get('ContributionNode')!;
    const data = hexBytes(v.bytes_hex);
    // references u32 count: option tag at 49, parent payload 32, contributor
    // 32 → count at 114 (order: project, economic_parent, contributor, refs).
    const countOffset = 114;
    data[countOffset] = 9; // MAX_REFERENCES is 8
    data[countOffset + 1] = 0;
    data[countOffset + 2] = 0;
    data[countOffset + 3] = 0;
    expect(() => decodeContributionNode(data)).toThrow(AccountDecodeError);
  });

  it('tolerates trailing allocated bytes (Anchor-style allocation)', () => {
    const v = byName.get('DeploymentConfig')!;
    const padded = new Uint8Array(v.allocated_bytes + 64);
    padded.set(hexBytes(v.bytes_hex));
    const cfg = decodeDeploymentConfig(padded);
    expect(cfg.stateVersion).toBe(1);
  });
});
