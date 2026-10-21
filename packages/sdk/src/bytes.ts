/**
 * Minimal byte plumbing for Solana transaction messages and Anchor/Borsh
 * instruction arguments. Independent of packages/types' private writer so the
 * SDK can encode layouts the intent wire format does not cover (Borsh vec =
 * u32 count, account metas, shortvec, u64 fields). All integers little-endian.
 */

export class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this;
  }

  u8(v: number): this {
    return this.push(Uint8Array.of(v & 0xff));
  }

  u16(v: number): this {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    return this.push(b);
  }

  u32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    return this.push(b);
  }

  u64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return this.push(b);
  }

  i64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    return this.push(b);
  }

  /** Borsh/Anchor string: u32 length prefix + UTF-8 bytes. */
  str(s: string): this {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).push(b);
  }

  /** Solana shortvec (compact-u16) length/index encoding. */
  shortvec(v: number): this {
    let n = v >>> 0;
    for (;;) {
      let elem = n & 0x7f;
      n >>= 7;
      if (n !== 0) elem |= 0x80;
      this.u8(elem);
      if (n === 0) break;
    }
    return this;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

export class ByteReader {
  private off = 0;
  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.off;
  }

  get offset(): number {
    return this.off;
  }

  take(n: number): Uint8Array | null {
    if (n < 0 || this.off + n > this.buf.length) return null;
    const out = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return out;
  }

  u8(): number | null {
    const b = this.take(1);
    return b === null ? null : b[0]!;
  }

  u16(): number | null {
    const b = this.take(2);
    return b === null ? null : new DataView(b.buffer, b.byteOffset, 2).getUint16(0, true);
  }

  u32(): number | null {
    const b = this.take(4);
    return b === null ? null : new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }

  u64(): bigint | null {
    const b = this.take(8);
    return b === null ? null : new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
  }

  i64(): bigint | null {
    const b = this.take(8);
    return b === null ? null : new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true);
  }

  shortvec(): number | null {
    let shift = 0;
    let out = 0;
    for (;;) {
      const b = this.u8();
      if (b === null) return null;
      out |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return out;
      shift += 7;
      if (shift > 28) return null;
    }
  }

  /** Borsh string: u32 len + UTF-8 bytes. Returns null on truncation. */
  str(maxBytes: number): string | null {
    const len = this.u32();
    if (len === null || len > maxBytes) return null;
    const raw = this.take(len);
    if (raw === null) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      return null;
    }
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function bytesToBase64(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export function base64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
