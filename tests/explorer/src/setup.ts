// Vitest (jsdom) setup. jsdom does not implement WebCrypto subtle; when the
// environment lacks it, install Node's webcrypto so the real signing and
// hashing code paths in @tessera/* run in tests (no stubbed crypto).
import { webcrypto } from 'node:crypto';

if (globalThis.crypto === undefined || globalThis.crypto.subtle === undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

// jsdom lacks CSS.escape; the tree uses it for attribute selectors.
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  const escape = (s: string): string =>
    s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch.codePointAt(0)!.toString(16)} `);
  Object.defineProperty(globalThis, 'CSS', {
    value: { escape },
    configurable: true,
  });
}
