#!/usr/bin/env python3
"""Regenerate the fictional IntentV1 signing fixtures against docs/14_BINARY_LAYOUT_V1.md.

Generates a FRESH throwaway Ed25519 test keypair on every run (CSPRNG). The
private key exists in memory only and is never written to this repository; the
committed public key/signature are safe to distribute, and the keypair itself
must never be funded or used for production.

Usage: python tools/regen_intent_fixture.py
Rewrites fixtures/intent-v1.json and fixtures/intent-v1-signature.json, then
verifies the signature locally before writing. Run
tools/inspect_signature_fixture.py afterwards to confirm the committed vector.
"""
from __future__ import annotations
import base64, hashlib, json, struct
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

def b58encode(data: bytes) -> str:
    n = int.from_bytes(data, 'big'); out = ''
    while n:
        n, r = divmod(n, 58); out = ALPHABET[r] + out
    return '1' * (len(data) - len(data.lstrip(b'\0'))) + out

def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + ALPHABET.index(ch)
    out = n.to_bytes((n.bit_length() + 7) // 8, 'big') if n else b''
    return b'\0' * (len(s) - len(s.lstrip('1'))) + out

def bounded_string(s: str, limit: int) -> bytes:
    b = s.encode('utf8')
    if len(b) > limit:
        raise ValueError('string exceeds byte limit')
    return struct.pack('<I', len(b)) + b

def encode_intent(intent: dict) -> bytes:
    wire = b'TESSERA:CONTRIBUTION:1'
    wire += bytes([intent['format_version']])
    wire += b58decode(intent['network_genesis'])
    wire += b58decode(intent['program_id'])
    wire += b58decode(intent['project_address'])
    parent = intent['economic_parent']
    wire += b'\x00' if parent is None else b'\x01' + b58decode(parent)
    refs = intent['references']
    if len(refs) > 8:
        raise ValueError('references exceeds u8 bound of 8')
    wire += bytes([len(refs)]) + b''.join(b58decode(r) for r in refs)
    wire += bytes.fromhex(intent['nonce'])
    wire += b58decode(intent['contributor'])
    wire += bounded_string(intent['name'], 64)
    wire += bounded_string(intent['title'], 96)
    wire += bytes.fromhex(intent['artifact_sha256'])
    metadata = intent['metadata_sha256']
    wire += b'\x00' if metadata is None else b'\x01' + bytes.fromhex(metadata)
    wire += bytes.fromhex(intent['terms_sha256'])
    wire += struct.pack('<H', intent['claim_bps'])
    wire += bytes([1])  # CONTRIBUTE_AND_ACCEPT_TERMS
    wire += struct.pack('<q', int(intent['declared_at']))
    wire += bytes([{'user_controlled': 1, 'embedded_provider': 2,
                    'server_custodied': 3}[intent['custody_mode']]])
    return wire

def main() -> None:
    base = Path(__file__).resolve().parents[1] / 'fixtures'
    private = Ed25519PrivateKey.generate()
    public_bytes = private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    # Fictional values; network/program/project are not real deployments.
    # The single reference is a deterministic fictional node address exercising
    # the non-empty `references` path in the wire layout.
    intent = {
        'format_version': 1,
        'network_genesis': 'FzyYqPYZJDeb2qipvU2FVnaGYmGNfuwWnpWmgpW42imP',
        'program_id': '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn',
        'project_address': '2K8CfN8zTE59rgTjqZxeTWxTPXFUgKGoC2uVBzYa2XSq',
        'economic_parent': None,
        'references': [b58encode(hashlib.sha256(
            b'tessera fixture fictional ancestry reference node 01').digest())],
        'nonce': '000102030405060708090a0b0c0d0e0f',
        'contributor': b58encode(public_bytes),
        'name': 'Alex',
        'title': 'The Lantern Room test seed',
        'artifact_sha256': hashlib.sha256((base / 'artifact.txt').read_bytes()).hexdigest(),
        'metadata_sha256': hashlib.sha256((base / 'metadata.json').read_bytes()).hexdigest(),
        'terms_sha256': hashlib.sha256((base / 'terms.txt').read_bytes()).hexdigest(),
        'claim_bps': 1500,
        'statement_code': 'CONTRIBUTE_AND_ACCEPT_TERMS',
        'declared_at': '1789166400',
        'custody_mode': 'server_custodied',
    }
    wire = encode_intent(intent)
    digest = hashlib.sha256(wire).digest()
    signature = private.sign(digest)
    Ed25519PublicKey.from_public_bytes(public_bytes).verify(signature, digest)
    (base / 'intent-v1.json').write_text(json.dumps(intent, indent=2) + '\n')
    vector = {
        'fixture_only': True,
        'notice': 'Fictional network/program/project; no chain account or finalized transaction exists. Test signing key is unsafe for production.',
        'wire_base64': base64.b64encode(wire).decode(),
        'wire_bytes': len(wire),
        'intent_sha256': digest.hex(),
        'public_key_base58': intent['contributor'],
        'public_key_hex': public_bytes.hex(),
        'signature_base64': base64.b64encode(signature).decode(),
        'signed_message': '32-byte SHA-256 of IntentV1 bytes',
        'verified_locally': True,
    }
    (base / 'intent-v1-signature.json').write_text(json.dumps(vector, indent=2) + '\n')
    print(json.dumps({'wire_bytes': len(wire), 'intent_sha256': digest.hex(),
                      'contributor': intent['contributor'],
                      'references': intent['references']}, indent=2))

if __name__ == '__main__':
    main()
