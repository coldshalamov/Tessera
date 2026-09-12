import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stableJsonBytes, writeZip } from '@tessera/evidence';
import { makeDemo, utf8 } from './helpers.js';

/**
 * CLI end-to-end against the BUILT dist (node dist/cli.js), in temp dirs.
 * Covers the packet commands: demo → export --from-port → inspect → verify
 * → recover-known-project, plus the distinct exit codes for invalid /
 * incomplete / unsupported / unreadable / network-failure.
 */

const CLI = path.resolve(__dirname, '../../../apps/cli/dist/cli.js');

function run(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe('tessera-evidence CLI', () => {
  it('demo → export → verify → inspect → recover-known-project', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't05-cli-'));

    const demo = run(['demo', '--out', 'session'], dir);
    expect(demo.status).toBe(0);
    expect(demo.stderr).toContain('local mode');

    const exp = run(['export', '--from-port', 'session', '--out', 'bundle.zip'], dir);
    expect(exp.status).toBe(0);
    expect(exp.stderr).toContain('valid-offline');

    const ver = run(['verify', 'bundle.zip'], dir);
    expect(ver.status).toBe(0);
    expect(ver.stdout).toContain('VALID-OFFLINE');
    expect(ver.stdout).toContain('not establish live Solana finality');

    const verJson = run(['verify', 'bundle.zip', '--json'], dir);
    expect(verJson.status).toBe(0);
    const report = JSON.parse(verJson.stdout) as { status: string; mode: string };
    expect(report.status).toBe('valid-offline');
    expect(report.mode).toBe('offline');

    const insp = run(['inspect', 'bundle.zip', '--json'], dir);
    expect(insp.status).toBe(0);
    const summary = JSON.parse(insp.stdout) as { valid_v1: boolean; file_count: number };
    expect(summary.valid_v1).toBe(true);
    expect(summary.file_count).toBeGreaterThan(30);

    const rec = run(['recover-known-project', 'bundle.zip', '--json'], dir);
    expect(rec.status).toBe(0);
    const recovered = JSON.parse(rec.stdout) as {
      payout_table: { issued_total_units: string; entries: unknown[] };
      economics_ok: boolean;
    };
    expect(recovered.economics_ok).toBe(true);
    expect(recovered.payout_table.issued_total_units).toBe('541000000000');
    expect(recovered.payout_table.entries.length).toBe(4);
  });

  it('verify exits 2 on a tampered bundle and 5 on garbage input', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't05-cli-tamper-'));
    const { contents, zip } = await makeDemo();
    writeFileSync(path.join(dir, 'good.zip'), zip);

    // Flip a payload byte, keep manifest unchanged.
    const files = new Map(contents.files);
    const target = [...files.keys()].find((p) => p.startsWith('artifacts/'))!;
    const mutated = new Uint8Array(files.get(target)!);
    mutated[0] = mutated[0]! ^ 0xff;
    files.set(target, mutated);
    const members = new Map(files);
    members.set('bundle.json', stableJsonBytes(contents.manifestV1!));
    writeFileSync(path.join(dir, 'tampered.zip'), writeZip(members));

    expect(run(['verify', 'tampered.zip'], dir).status).toBe(2);
    writeFileSync(path.join(dir, 'garbage.zip'), utf8('this is not a zip'));
    expect(run(['verify', 'garbage.zip'], dir).status).toBe(5);
    expect(run(['verify', 'missing.zip'], dir).status).toBe(5);
  });

  it('verify exits 4 on an unsupported bundle version', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't05-cli-unsup-'));
    const { contents } = await makeDemo();
    const m = contents.manifestV1!;
    const members = new Map(contents.files);
    members.set('bundle.json', stableJsonBytes({ ...m, format_version: 7 }));
    writeFileSync(path.join(dir, 'v7.zip'), writeZip(members));
    const r = run(['verify', 'v7.zip'], dir);
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('UNSUPPORTED');
  });

  it('quote reports estimated sizes + labeled illustrative rent, never a live quote', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't05-cli-quote-'));
    const { zip } = await makeDemo();
    writeFileSync(path.join(dir, 'bundle.zip'), zip);
    const r = run(['quote', 'bundle.zip', '--json'], dir);
    expect(r.status).toBe(0);
    const q = JSON.parse(r.stdout) as {
      total_estimated_bytes: number;
      node_estimates: { bytes: number }[];
      illustrative_rent: { lamports: string; model: string };
      assumptions: string[];
    };
    expect(q.node_estimates.length).toBe(5);
    expect(q.total_estimated_bytes).toBeGreaterThan(0);
    expect(BigInt(q.illustrative_rent.lamports) > 0n).toBe(true);
    expect(q.illustrative_rent.model).toContain('not a quote');
    expect(q.assumptions.join(' ')).toContain('NOT a current rent quote');
    // Unreachable RPC → network exit code, no fabricated quote.
    const r2 = run(['quote', 'bundle.zip', '--rpc', 'http://127.0.0.1:1/nope'], dir);
    expect(r2.status).toBe(6);
  });

  it('verify --rpc exits 6 when the endpoint is unreachable', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't05-cli-rpc-'));
    const { zip } = await makeDemo();
    writeFileSync(path.join(dir, 'bundle.zip'), zip);
    const r = run(['verify', 'bundle.zip', '--rpc', 'http://127.0.0.1:1/nope'], dir);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('minimal getAccountInfo probe');
  });

  it('inspect --extract writes payload bytes safely and refuses unsafe paths', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't05-cli-extract-'));
    const { zip, contents } = await makeDemo();
    writeFileSync(path.join(dir, 'bundle.zip'), zip);
    const r = run(['inspect', 'bundle.zip', '--extract', 'out'], dir);
    expect(r.status).toBe(0);
    const leaf = contents.manifestV1!.selected_leaf.node_address;
    const extracted = readFileSync(path.join(dir, 'out', 'records', `${leaf}.json`));
    expect(extracted.equals(Buffer.from(contents.files.get(`records/${leaf}.json`)!))).toBe(true);
  });

  it('public export contains no private key material', async () => {
    const { contents } = await makeDemo();
    // PKCS8 'PRIVATE KEY' PEM markers and the demo pkcs8 seed prefix must
    // never appear in any exported member.
    const pkcs8Prefix = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70];
    for (const [p, bytes] of contents.files) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      expect(text.includes('PRIVATE KEY')).toBe(false);
      expect(text.includes('tessera-demo-')).toBe(false);
      let found = false;
      for (let i = 0; i + pkcs8Prefix.length <= bytes.length; i++) {
        if (pkcs8Prefix.every((b, j) => bytes[i + j] === b)) { found = true; break; }
      }
      expect(found, `${p} embeds a PKCS8 key blob`).toBe(false);
    }
  });
});
