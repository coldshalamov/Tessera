import { describe, expect, it } from 'vitest';
import { deflateSync } from 'fflate';
import {
  buildBundle,
  readZip,
  writeZip,
  type ZipLimits,
} from '@tessera/evidence';
import { makeDemo, utf8 } from './helpers.js';

/**
 * Container hardening: traversal, absolute/backslash/NUL/reserved names,
 * duplicate names (incl. case-fold), symlink/device entries, encrypted or
 * unknown methods, zip64, truncation, and zip-bomb caps — including a
 * deflate stream that lies about its uncompressed size.
 *
 * A minimal raw-zip writer lives here so hostile headers can be crafted
 * byte-exactly (fflate zipSync always produces well-formed archives).
 */

interface RawEntry {
  name: Uint8Array;
  data: Uint8Array; // compressed bytes
  method: number;
  flags: number;
  usize: number;
  csize: number;
  eattr?: number;
}

const te = new TextEncoder();

function rawZip(entries: RawEntry[], opts: { eocdEntries?: number; truncate?: number } = {}): Uint8Array {
  const chunks: number[] = [];
  const push32 = (v: number) => { chunks.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); };
  const push16 = (v: number) => { chunks.push(v & 0xff, (v >> 8) & 0xff); };
  const pushBytes = (b: Uint8Array) => { for (const x of b) chunks.push(x); };

  const cds: { e: RawEntry; offset: number }[] = [];
  for (const e of entries) {
    const offset = chunks.length;
    push32(0x04034b50); push16(20); push16(e.flags); push16(e.method);
    push16(0); push16(0x21); push32(0); // crc=0 (reader uses sha256, not crc)
    push32(e.csize); push32(e.usize); push16(e.name.length); push16(0);
    pushBytes(e.name); pushBytes(e.data);
    cds.push({ e, offset });
  }
  const cdStart = chunks.length;
  for (const { e, offset } of cds) {
    push32(0x02014b50); push16(20); push16(20); push16(e.flags); push16(e.method);
    push16(0); push16(0x21); push32(0);
    push32(e.csize); push32(e.usize); push16(e.name.length); push16(0); push16(0);
    push16(0); push16(0); push32(e.eattr ?? 0); push32(offset);
    pushBytes(e.name);
  }
  const cdSize = chunks.length - cdStart;
  push32(0x06054b50); push16(0); push16(0);
  push16(opts.eocdEntries ?? entries.length); push16(opts.eocdEntries ?? entries.length);
  push32(cdSize); push32(cdStart); push16(0);
  const out = new Uint8Array(chunks);
  return opts.truncate === undefined ? out : out.subarray(0, out.length - opts.truncate);
}

function deflateEntry(name: string, plain: Uint8Array, opts: Partial<RawEntry> = {}): RawEntry {
  const compressed = deflateSync(plain, { level: 9 });
  return {
    name: te.encode(name),
    data: new Uint8Array(compressed),
    method: 8,
    flags: 0x0800,
    usize: plain.length,
    csize: compressed.length,
    ...opts,
  };
}

function storedEntry(name: string, plain: Uint8Array, opts: Partial<RawEntry> = {}): RawEntry {
  return { name: te.encode(name), data: plain, method: 0, flags: 0x0800, usize: plain.length, csize: plain.length, ...opts };
}

const TIGHT: ZipLimits = { maxFileBytes: 1024, maxTotalBytes: 4096, maxEntries: 8 };

describe('readZip — hostile containers fail closed', () => {
  it.each([
    ['../evil.txt', 'dotdot'],
    ['a/../../evil.txt', 'dotdot mid'],
    ['/etc/passwd', 'absolute'],
    ['C:/windows/system32/evil', 'drive letter'],
    ['sub\\..\\evil.txt', 'backslash zip-slip'],
    ['CON.txt', 'reserved device name'],
    ['foo /bar.txt', 'trailing space segment'],
    ['dir./x', 'trailing dot segment'],
  ])('rejects unsafe member name %s', (name) => {
    const zip = rawZip([storedEntry(name, utf8('x'))]);
    const r = readZip(zip);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSAFE_NAME');
  });

  it('rejects NUL byte in member name', () => {
    const name = new Uint8Array([...te.encode('a'), 0, ...te.encode('b.txt')]);
    const r = readZip(rawZip([{ name, data: utf8('x'), method: 0, flags: 0x0800, usize: 1, csize: 1 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSAFE_NAME');
  });

  it('rejects duplicate member names, exact and case-folded', () => {
    for (const names of [['a.txt', 'a.txt'], ['Dir/A.txt', 'dir/a.txt']]) {
      const r = readZip(rawZip(names.map((n) => storedEntry(n, utf8('x')))));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('DUPLICATE_NAME');
    }
  });

  it('rejects symlink (unix type 0xA000) entries', () => {
    const r = readZip(rawZip([storedEntry('link', utf8('target'), { eattr: 0xa0000000 })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSAFE_NAME');
  });

  it('rejects encrypted flag, unknown method and zip64 sentinel', () => {
    const enc = readZip(rawZip([storedEntry('a.txt', utf8('x'), { flags: 0x0801 })]));
    expect(enc.ok).toBe(false);
    if (!enc.ok) expect(enc.error.code).toBe('UNSUPPORTED_FEATURE');

    const m99 = readZip(rawZip([{ name: te.encode('a.txt'), data: utf8('x'), method: 99, flags: 0x0800, usize: 1, csize: 1 }]));
    expect(m99.ok).toBe(false);
    if (!m99.ok) expect(m99.error.code).toBe('UNSUPPORTED_FEATURE');

    const z64 = readZip(rawZip([storedEntry('a.txt', utf8('x'), { usize: 0xffffffff })]));
    expect(z64.ok).toBe(false);
    if (!z64.ok) expect(z64.error.code).toBe('UNSUPPORTED_FEATURE');
  });

  it('rejects non-ASCII name without the UTF-8 flag', () => {
    const r = readZip(rawZip([{ name: new Uint8Array([0x63, 0x61, 0x66, 0xe9]), data: utf8('x'), method: 0, flags: 0, usize: 1, csize: 1 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSAFE_NAME');
  });

  it('rejects declared-size zip bombs before inflating', () => {
    // deflate of 2 MiB of zeros, header claiming 2 MiB — exceeds 1 KiB cap.
    const big = new Uint8Array(2 * 1024 * 1024);
    const r = readZip(rawZip([deflateEntry('bomb.bin', big)]), TIGHT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SIZE_CAP_EXCEEDED');
  });

  it('rejects a deflate stream that produces MORE than the header declares', () => {
    // Header claims 4 bytes; the stream actually inflates to 2 MiB.
    const big = new Uint8Array(2 * 1024 * 1024);
    const compressed = deflateSync(big, { level: 9 });
    const r = readZip(
      rawZip([{ name: te.encode('liar.bin'), data: new Uint8Array(compressed), method: 8, flags: 0x0800, usize: 4, csize: compressed.length }]),
      { maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxEntries: 10 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INFLATE_FAILED');
  });

  it('rejects aggregate-size bombs across many small entries', () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      storedEntry(`f${i}.bin`, new Uint8Array(900)),
    );
    const r = readZip(rawZip(entries), TIGHT); // 7*900 = 6300 > 4096
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SIZE_CAP_EXCEEDED');
  });

  it('rejects too many entries and truncated archives', () => {
    const many = Array.from({ length: 9 }, (_, i) => storedEntry(`f${i}.bin`, utf8('x')));
    const r = readZip(rawZip(many), TIGHT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SIZE_CAP_EXCEEDED');

    const good = rawZip([storedEntry('a.txt', utf8('x'))]);
    const trunc = readZip(good.subarray(0, good.length - 10));
    expect(trunc.ok).toBe(false);
  });

  it('round-trips written zips byte-exact', async () => {
    const files = new Map<string, Uint8Array>([
      ['bundle.json', utf8('{"a":1}')],
      ['deep/dir/file.bin', new Uint8Array([1, 2, 3, 250])],
    ]);
    const r = readZip(writeZip(files));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([...r.value.keys()].sort()).toEqual([...files.keys()].sort());
      for (const [k, v] of files) expect(r.value.get(k)).toEqual(v);
    }
  });
});

describe('readBundleZip — boundary sizes', () => {
  it('accepts a file exactly at the cap and rejects cap+1', async () => {
    const at = readZip(rawZip([storedEntry('f.bin', new Uint8Array(1024))]), TIGHT);
    expect(at.ok).toBe(true);
    const over = readZip(rawZip([storedEntry('f.bin', new Uint8Array(1025))]), TIGHT);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('SIZE_CAP_EXCEEDED');
  });

  it('accepts 512-char paths, rejects 513-char paths in manifest', async () => {
    const { demo } = await makeDemo();
    const { sessionToBundleInput } = await import('@tessera/evidence');
    const input = await sessionToBundleInput(
      demo.session,
      async (rel) => demo.files.get(rel) ?? null,
      'test',
    );
    if (!input.ok) throw new Error('session');
    // manifests/<name>.json: 10 + name + 5 chars; name cap = 512-15 = 497.
    const okBundle = await buildBundle({
      ...input.value,
      payloads: [...(input.value.payloads ?? []), { kind: 'manifest', name: 'x'.repeat(497), data: utf8('{}') }],
    });
    expect(okBundle.ok).toBe(true);
    const badBundle = await buildBundle({
      ...input.value,
      payloads: [...(input.value.payloads ?? []), { kind: 'manifest', name: 'x'.repeat(498), data: utf8('{}') }],
    });
    expect(badBundle.ok).toBe(false);
    if (!badBundle.ok) expect(badBundle.error.code).toBe('UNSAFE_PATH');
  });
});
