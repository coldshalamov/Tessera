import { describe, expect, it } from 'vitest';
import {
  decodeIntentV1,
  encodeIntentV1,
  parseIntentV1,
  type IntentV1,
} from '@tessera/types';
import { altAddress, fixtureIntent } from './helpers.js';

/**
 * Boundary vectors: absent metadata, empty title, maximum-length name/title
 * with multibyte UTF-8 exactly AT the byte bound (and the straddling
 * one-byte-over case rejected), and references counts 0/1/8 accepted with
 * count=9 rejected. These exercise the decoder's strict length checks too.
 */

const base = fixtureIntent();

function enc(i: IntentV1) {
  const r = encodeIntentV1(i);
  expect(r.ok).toBe(true);
  return r.ok ? r.value : new Uint8Array();
}

describe('name/title UTF-8 byte bounds (multibyte at the boundary)', () => {
  it('name = 64 bytes with a 2-byte char straddling the last position encodes+decodes', () => {
    // 62 ASCII + 'é' (2 bytes) = exactly 64
    const i: IntentV1 = { ...base, name: 'x'.repeat(62) + 'é' };
    const wire = enc(i);
    const d = decodeIntentV1(wire);
    expect(d.ok && d.value.name).toBe(i.name);
  });

  it('name = 65 bytes (63 ASCII + é) is rejected at parse and encode', () => {
    const i = { ...base, name: 'x'.repeat(63) + 'é' };
    const p = parseIntentV1(i);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe('NAME_OUT_OF_RANGE');
    expect(encodeIntentV1(i as IntentV1).ok).toBe(false);
  });

  it('name = 4-byte char at the bound (61 ASCII + 𐍈 = 65B) rejected; 60 + 𐍈 = 64B ok', () => {
    const over = { ...base, name: 'x'.repeat(61) + '𐍈' };
    expect(parseIntentV1(over).ok).toBe(false);
    const at = { ...base, name: 'x'.repeat(60) + '𐍈' };
    const p = parseIntentV1(at);
    expect(p.ok).toBe(true);
    const d = decodeIntentV1(enc(at as IntentV1));
    expect(d.ok && d.value.name).toBe(at.name);
  });

  it('empty name rejected; 1-byte name ok', () => {
    expect(parseIntentV1({ ...base, name: '' }).ok).toBe(false);
    expect(parseIntentV1({ ...base, name: 'A' }).ok).toBe(true);
  });

  it('empty title encodes (0..96) and max-multibyte 96-byte title round-trips', () => {
    const empty: IntentV1 = { ...base, title: '' };
    const d1 = decodeIntentV1(enc(empty));
    expect(d1.ok && d1.value.title).toBe('');
    // '€' = 3 bytes; 32 of them = exactly 96
    const maxed: IntentV1 = { ...base, title: '€'.repeat(32) };
    const d2 = decodeIntentV1(enc(maxed));
    expect(d2.ok && d2.value.title).toBe(maxed.title);
    // 33 × 3 = 99 > 96 rejected; mixed bound: 93 ASCII + € = 96 ok, 94 + € = 97 reject
    expect(parseIntentV1({ ...base, title: '€'.repeat(33) }).ok).toBe(false);
    expect(parseIntentV1({ ...base, title: 'y'.repeat(93) + '€' }).ok).toBe(true);
    const over = { ...base, title: 'y'.repeat(94) + '€' };
    const p = parseIntentV1(over);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe('TITLE_OUT_OF_RANGE');
  });

  it('absent metadata (metadata_sha256 null) encodes/decodes with tag 0', () => {
    const i: IntentV1 = { ...base, metadata_sha256: null };
    const wire = enc(i);
    // fixture had metadata set (33 bytes: tag+32); null is a single tag byte
    expect(wire.length).toBe(348 - 33 + 1);
    const d = decodeIntentV1(wire);
    expect(d.ok && d.value.metadata_sha256).toBeNull();
  });
});

describe('references count boundaries', () => {
  it.each([0, 1, 8])('references count %d encodes and round-trips', (n) => {
    const i: IntentV1 = {
      ...base,
      references: Array.from({ length: n }, (_v, k) => altAddress(100 + k)),
    };
    const wire = enc(i);
    const d = decodeIntentV1(wire);
    expect(d.ok && d.value.references).toEqual(i.references);
  });

  it('references count 9 rejected at parse and encode', () => {
    const i = { ...base, references: Array.from({ length: 9 }, (_v, k) => altAddress(110 + k)) };
    const p = parseIntentV1(i);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe('REFERENCES_OUT_OF_RANGE');
    const e = encodeIntentV1(i as IntentV1);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error.code).toBe('REFERENCES_OUT_OF_RANGE');
  });
});
