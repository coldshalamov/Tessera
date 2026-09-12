import { describe, expect, it } from 'vitest';
import {
  base58Decode,
  base58Encode,
  hexToBytes,
  intentDigestHex,
} from '@tessera/types';
import {
  UnconfiguredProviderSigner,
  CUSTODY_DISCLOSURES,
} from '@tessera/identity';
import sigFixture from '../../../fixtures/intent-v1-signature.json';
import {
  fixtureIntent,
  freezeIntentConsent,
  newSigner,
  nobleVerify,
} from './helpers.js';

/**
 * Consent/cancel/reauth/export semantics (docs/05, T02 scope 3):
 *  - a signature requires a frozen consent bound to the exact digest;
 *  - an altered claim/terms/artifact is refused with CONSENT_MISMATCH and
 *    produces NO record;
 *  - cancellation produces no record — the audit trail stays empty;
 *  - export requires fresh reauth, returns the raw seed in the caller's
 *    format, and the material never appears in logs or records;
 *  - the exported key verifies in an INDEPENDENT implementation (WebCrypto),
 *    and a WebCrypto-made signature verifies under noble.
 */

describe('consent freeze → sign → audit', () => {
  it('signs only the frozen digest and records it once', async () => {
    const signer = await newSigner();
    const intent = { ...fixtureIntent(), contributor: signer.publicKey };
    const consent = await freezeIntentConsent(signer, intent);
    expect(consent.state).toBe('frozen');
    expect(consent.custody_mode).toBe('server_custodied');
    expect(consent.custody_disclosure).toBe(CUSTODY_DISCLOSURES.server_custodied);
    expect(consent.display['terms_sha256']).toBe(intent.terms_sha256);
    expect(consent.display['claim_bps']).toBe(intent.claim_bps);

    const digest = await intentDigestHex(intent);
    expect(digest.ok).toBe(true);
    if (!digest.ok) return;
    expect(consent.digest_hex).toBe(digest.value);

    const signed = await signer.signIntent(consent.consent_id, intent);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.value.signer).toBe(signer.publicKey);
    expect(signed.value.digest_hex).toBe(digest.value);
    const ok = await nobleVerify(
      signer.publicKey,
      signed.value.signature_base64,
      hexToBytes(digest.value)!,
    );
    expect(ok).toBe(true);

    const records = signer.signedRecords();
    expect(records.length).toBe(1);
    expect(records[0]!.digest_hex).toBe(digest.value);
    // Consent is single-use.
    const again = await signer.signIntent(consent.consent_id, intent);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('CONSENT_STATE');
  });

  it('an altered intent after freeze is refused (CONSENT_MISMATCH), no record', async () => {
    const signer = await newSigner();
    const intent = { ...fixtureIntent(), contributor: signer.publicKey };
    const consent = await freezeIntentConsent(signer, intent);
    const altered = { ...intent, claim_bps: 9999 };
    const r = await signer.signIntent(consent.consent_id, altered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONSENT_MISMATCH');
    expect(signer.signedRecords().length).toBe(0);
    // consent stays frozen — it was not consumed by the refusal
    const c = await signer.getConsent(consent.consent_id);
    expect(c.ok && c.value.state).toBe('frozen');
  });

  it('signing without any consent is refused (CONSENT_NOT_FOUND)', async () => {
    const signer = await newSigner();
    const intent = { ...fixtureIntent(), contributor: signer.publicKey };
    const r = await signer.signIntent('no-such-consent', intent);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONSENT_NOT_FOUND');
  });

  it('freezeConsent without a session binding is refused (AUTH_REQUIRED)', async () => {
    const signer = await newSigner();
    const intent = { ...fixtureIntent(), contributor: signer.publicKey };
    const digest = await intentDigestHex(intent);
    if (!digest.ok) throw new Error('digest');
    const r = await signer.freezeConsent({
      kind: 'intent',
      digest_hex: digest.value,
      display: {},
      session_id: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTH_REQUIRED');
  });

  it('cancellation produces NO record and blocks later signing', async () => {
    const signer = await newSigner();
    const intent = { ...fixtureIntent(), contributor: signer.publicKey };
    const consent = await freezeIntentConsent(signer, intent);
    const cancelled = await signer.cancelConsent(consent.consent_id);
    expect(cancelled.ok).toBe(true);
    const c = await signer.getConsent(consent.consent_id);
    expect(c.ok && c.value.state).toBe('cancelled');
    const r = await signer.signIntent(consent.consent_id, intent);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONSENT_STATE');
    // The cancelled consent left no signature record — ever.
    expect(signer.signedRecords().length).toBe(0);
  });
});

describe('export + reauthentication', () => {
  it('export requires a fresh reauth ticket bound to the session', async () => {
    const signer = await newSigner();
    const r = await signer.exportSecretKey({
      format: 'hex',
      reauth_token: 'no-such-token',
      session_id: 'sess-1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('REAUTH_REQUIRED');
  });

  it('expired reauth is refused', async () => {
    let now = 1_800_000_000n;
    const signer = await newSigner({ now_unix: () => now });
    const ticket = await signer.reauthenticate('sess-1');
    expect(ticket.ok).toBe(true);
    if (!ticket.ok) return;
    now += 301n; // past the 300s TTL
    const r = await signer.exportSecretKey({
      format: 'hex',
      reauth_token: ticket.value.token,
      session_id: 'sess-1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('REAUTH_REQUIRED');
  });

  it('reauth bound to a different session is refused', async () => {
    const signer = await newSigner();
    const ticket = await signer.reauthenticate('sess-A');
    expect(ticket.ok).toBe(true);
    if (!ticket.ok) return;
    const r = await signer.exportSecretKey({
      format: 'hex',
      reauth_token: ticket.value.token,
      session_id: 'sess-B',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('REAUTH_REQUIRED');
  });

  it.each(['hex', 'base58', 'bytes'] as const)(
    'export format %s returns raw key material that independently verifies',
    async (format) => {
      const signer = await newSigner();
      const ticket = await signer.reauthenticate('sess-1');
      expect(ticket.ok).toBe(true);
      if (!ticket.ok) return;
      const r = await signer.exportSecretKey({
        format,
        reauth_token: ticket.value.token,
        session_id: 'sess-1',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.format).toBe(format);
      expect(r.value.warning.length).toBeGreaterThan(0);

      // Material → 32-byte seed in each format.
      const seed =
        format === 'bytes'
          ? (r.value.material as Uint8Array)
          : format === 'hex'
            ? hexToBytes(r.value.material as string)!
            : base58Decode(r.value.material as string)!;
      expect(seed.length).toBe(32);

      // Independent verifier: import the raw seed into WebCrypto via PKCS8 and
      // sign — the signature must verify under the signer's public key via noble.
      const PKCS8_PREFIX = hexToBytes('302e020100300506032b657004220420')!;
      const pkcs8 = new Uint8Array([...PKCS8_PREFIX, ...seed]);
      const sk = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', false, ['sign']);
      const msg = new Uint8Array(32).fill(0x5a);
      const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', sk, msg));
      expect(await nobleVerify(signer.publicKey, b64Encode(sig), msg)).toBe(true);
    },
  );

  it('secret material never appears in the audit trail or injected logger', async () => {
    const lines: string[] = [];
    const signer = await newSigner({ logger: (l) => lines.push(l) });
    const ticket = await signer.reauthenticate('sess-1');
    if (!ticket.ok) throw new Error('reauth');
    const r = await signer.exportSecretKey({
      format: 'hex',
      reauth_token: ticket.value.token,
      session_id: 'sess-1',
    });
    if (!r.ok) throw new Error('export');
    const secretHex = r.value.material as string;
    const secretB58 = base58Encode(hexToBytes(secretHex)!);

    const intent = { ...fixtureIntent(), contributor: signer.publicKey };
    const consent = await freezeIntentConsent(signer, intent);
    await signer.signIntent(consent.consent_id, intent);

    for (const line of lines) {
      expect(line).not.toContain(secretHex);
      expect(line).not.toContain(secretB58);
    }
    for (const rec of signer.signedRecords()) {
      const blob = JSON.stringify(rec);
      expect(blob).not.toContain(secretHex);
      expect(blob).not.toContain(secretB58);
    }
  });

  it('custody labels are honest per configured mode', async () => {
    const uc = await newSigner({ custody_mode: 'user_controlled' });
    expect(uc.custody_mode).toBe('user_controlled');
    expect(uc.custody_disclosure).toContain('user_controlled');
    const sc = await newSigner({ custody_mode: 'server_custodied' });
    expect(sc.custody_disclosure).toContain('could impersonate');
  });

  it('injected fixed seed produces a signer whose signatures verify via WebCrypto', async () => {
    const seedHex = '11'.repeat(32);
    const s = await newSigner({ secret_key_hex: seedHex });
    // Independent path: WebCrypto PKCS8 import of the same seed → sign → the
    // signature verifies under s.publicKey via noble, proving key agreement.
    const pkcs8 = new Uint8Array([...hexToBytes('302e020100300506032b657004220420')!, ...hexToBytes(seedHex)!]);
    const sk = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', false, ['sign']);
    const msg = new Uint8Array(32).fill(0x33);
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', sk, msg));
    expect(await nobleVerify(s.publicKey, b64Encode(sig), msg)).toBe(true);
  });

  it('the golden fixture signature verifies under noble too (impl agreement)', async () => {
    const ok = await nobleVerify(
      sigFixture.public_key_base58,
      sigFixture.signature_base64,
      hexToBytes(sigFixture.intent_sha256)!,
    );
    expect(ok).toBe(true);
  });
});

describe('UnconfiguredProviderSigner boundary', () => {
  it('refuses every operation with PROVIDER_NOT_CONFIGURED and records nothing', async () => {
    const p = new UnconfiguredProviderSigner('privy');
    expect(p.custody_mode).toBe('embedded_provider');
    expect(p.capabilities().can_export_secret_key).toBe('provider_dependent');
    const intent = { ...fixtureIntent(), contributor: p.publicKey };
    const c = await p.freezeConsent({
      kind: 'intent',
      digest_hex: 'a'.repeat(64),
      display: {},
      session_id: 's',
    });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    const s = await p.signIntent('x', intent);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    const e = await p.exportSecretKey({ format: 'hex', reauth_token: 't', session_id: 's' });
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(p.signedRecords().length).toBe(0);
  });
});

function b64Encode(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}
