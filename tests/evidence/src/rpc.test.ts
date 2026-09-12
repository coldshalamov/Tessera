import { describe, expect, it } from 'vitest';
import { rpcAccountChecks, verifyBundle, readBundleZip } from '@tessera/evidence';
import type { NodeRef } from '@tessera/types';
import { makeDemo } from './helpers.js';

/**
 * The minimal --rpc probe: a labeled trust assumption, never a finality
 * proof. Unreachable → incomplete; absent account / wrong owner → fail;
 * matching owner → pass on existence but warn on finality.
 */

const LEAF: NodeRef = {
  genesis_hash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
  program_id: '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn',
  project_address: '4VWyksddHwMSkGm21Kn3Hdwff74TPhc3TVan2puVBmy8',
  node_address: 'JAYDjk9sfMxdTseVWEvaq9N5ZAyUvwf3jRrfNS2dsxqq',
};

function mockFetch(body: unknown, init?: { status?: number; throws?: boolean }): typeof fetch {
  return (async () => {
    if (init?.throws) throw new Error('connection refused');
    return new Response(JSON.stringify(body), { status: init?.status ?? 200 });
  }) as typeof fetch;
}

describe('rpcAccountChecks', () => {
  it('unreachable endpoint → incomplete, never a fabricated pass', async () => {
    const checks = await rpcAccountChecks('http://rpc.invalid/', LEAF, {
      timeoutMs: 1000,
      fetchImpl: mockFetch(null, { throws: true }),
    });
    expect(checks[0]!.name).toBe('chain.rpc');
    expect(checks[0]!.result).toBe('incomplete');
  });

  it('absent account → fail (contradictory chain state)', async () => {
    const checks = await rpcAccountChecks('http://rpc.test/', LEAF, {
      timeoutMs: 1000,
      fetchImpl: mockFetch({ result: { value: null } }),
    });
    expect(checks[0]!.result).toBe('fail');
  });

  it('wrong owner → fail', async () => {
    const checks = await rpcAccountChecks('http://rpc.test/', LEAF, {
      timeoutMs: 1000,
      fetchImpl: mockFetch({ result: { value: { owner: 'SomeOtherProgram11111111111111111111111111', executable: false } } }),
    });
    expect(checks[0]!.result).toBe('fail');
    expect(checks[0]!.detail).toContain('owner');
  });

  it('matching owner → pass on existence + explicit finality warn', async () => {
    const checks = await rpcAccountChecks('http://rpc.test/', LEAF, {
      timeoutMs: 1000,
      fetchImpl: mockFetch({ result: { value: { owner: LEAF.program_id, executable: false } } }),
    });
    expect(checks[0]!.result).toBe('pass');
    expect(checks[1]!.name).toBe('chain.finality');
    expect(checks[1]!.result).toBe('warn');
    expect(checks[1]!.detail).toContain('not independent finality');
  });

  it('verify --rpc path: mode online-assisted, limitation recorded', async () => {
    const { zip } = await makeDemo();
    const c = readBundleZip(zip);
    if (!c.ok) throw new Error('bundle unreadable');
    const leaf = c.value.manifestV1!.selected_leaf;
    const report = await verifyBundle(c.value, {
      rpcUrl: 'http://rpc.test/',
      fetchImpl: mockFetch({ result: { value: { owner: leaf.program_id, executable: false } } }),
    });
    expect(report.mode).toBe('online-assisted');
    expect(report.checks.find((x) => x.name === 'chain.rpc')?.result).toBe('pass');
    expect(report.limitations.join(' ')).toContain('trust assumption');
    // Even with a healthy RPC answer the status stays honest.
    expect(report.status).toBe('valid-offline');
  });
});
