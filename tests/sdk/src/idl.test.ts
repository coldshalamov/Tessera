import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DISC_CONTRIBUTION_NODE,
  DISC_DEPLOYMENT_CONFIG,
  DISC_PROJECT_ACCOUNT,
  DISC_STATEMENT_RECORD,
  IX_APPEND_CONTRIBUTION,
  IX_CREATE_PROJECT,
  IX_INITIALIZE_DEPLOYMENT,
  IX_PUBLISH_ROOT,
  TESSERA_PROGRAM_ID,
} from '@tessera/sdk';

/**
 * Discriminator pinning: the hand-rolled SDK discriminators MUST equal the
 * committed generated IDL byte-for-byte — these are sha256(name)[..8]
 * values the deployed program enforces.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const idl = JSON.parse(readFileSync(join(HERE, '../../../generated/idl/tessera.json'), 'utf8')) as {
  instructions: { name: string; discriminator: number[] }[];
  accounts?: { name: string; discriminator: number[] }[];
  address?: string;
};

function disc(name: string): Uint8Array {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL lacks instruction ${name}`);
  return new Uint8Array(ix.discriminator);
}

function accountDisc(name: string): Uint8Array {
  const a = (idl.accounts ?? []).find((x) => x.name === name);
  if (!a) throw new Error(`IDL lacks account ${name}`);
  return new Uint8Array(a.discriminator);
}

describe('generated IDL conformance', () => {
  it('program address matches the pinned constant', () => {
    expect(idl.address).toBe(TESSERA_PROGRAM_ID);
  });

  it('instruction discriminators match the IDL', () => {
    expect(IX_INITIALIZE_DEPLOYMENT).toEqual(disc('initialize_deployment'));
    expect(IX_CREATE_PROJECT).toEqual(disc('create_project'));
    expect(IX_PUBLISH_ROOT).toEqual(disc('publish_root'));
    expect(IX_APPEND_CONTRIBUTION).toEqual(disc('append_contribution'));
  });

  it('account discriminators match the IDL', () => {
    expect(DISC_DEPLOYMENT_CONFIG).toEqual(accountDisc('DeploymentConfig'));
    expect(DISC_PROJECT_ACCOUNT).toEqual(accountDisc('ProjectAccount'));
    expect(DISC_CONTRIBUTION_NODE).toEqual(accountDisc('ContributionNode'));
    // StatementRecord layout is committed on-chain; the instruction is
    // deliberately NOT deployed in v1 (scaffold only).
    if ((idl.accounts ?? []).some((a) => a.name === 'StatementRecord')) {
      expect(DISC_STATEMENT_RECORD).toEqual(accountDisc('StatementRecord'));
    }
  });

  it('the IDL exposes exactly the four deployed instructions', () => {
    expect(idl.instructions.map((i) => i.name).sort()).toEqual([
      'append_contribution',
      'create_project',
      'initialize_deployment',
      'publish_root',
    ]);
  });
});
