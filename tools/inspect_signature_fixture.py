#!/usr/bin/env python3
"""Inspect the fictional IntentV1 vector. SHA/binary checks need only stdlib.
Optional Ed25519 verification needs the cryptography package; --require-signature
fails rather than silently skipping that check when the dependency is missing.
"""
from __future__ import annotations
import argparse, base64, hashlib, json, struct
from pathlib import Path

ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58(data: bytes) -> str:
    n=int.from_bytes(data,'big');out=''
    while n:
        n,r=divmod(n,58);out=ALPHABET[r]+out
    return '1'*(len(data)-len(data.lstrip(b'\0')))+out

def inspect(require_signature: bool=False) -> dict:
    base=Path(__file__).resolve().parents[1]/'fixtures'
    intent=json.loads((base/'intent-v1.json').read_text())
    vector=json.loads((base/'intent-v1-signature.json').read_text())
    wire=base64.b64decode(vector['wire_base64'],validate=True)
    offset=0
    def take(n: int) -> bytes:
        nonlocal offset
        if n<0 or offset+n>len(wire): raise ValueError('truncated wire')
        part=wire[offset:offset+n];offset+=n;return part
    def text(limit: int) -> str:
        length=struct.unpack('<I',take(4))[0]
        if length>limit: raise ValueError('string too long')
        return take(length).decode('utf8',errors='strict')
    def optional() -> bytes | None:
        tag=take(1)[0]
        if tag not in (0,1):raise ValueError('bad option tag')
        return take(32) if tag else None
    domain=b'TESSERA:CONTRIBUTION:1'
    assert take(len(domain))==domain
    got={'format_version':take(1)[0],
         'network_genesis':b58(take(32)),
         'program_id':b58(take(32)),
         'project_address':b58(take(32))}
    parent=optional();got['economic_parent']=None if parent is None else b58(parent)
    ref_count=take(1)[0]
    if ref_count>8:raise ValueError('references exceeds bound')
    got['references']=[b58(take(32)) for _ in range(ref_count)]
    got['nonce']=take(16).hex();got['contributor']=b58(take(32))
    got['name']=text(64);got['title']=text(96)
    got['artifact_sha256']=take(32).hex()
    metadata=optional();got['metadata_sha256']=None if metadata is None else metadata.hex()
    got['terms_sha256']=take(32).hex()
    got['claim_bps']=struct.unpack('<H',take(2))[0]
    assert take(1)==bytes([1]);got['statement_code']='CONTRIBUTE_AND_ACCEPT_TERMS'
    got['declared_at']=str(struct.unpack('<q',take(8))[0])
    got['custody_mode']={1:'user_controlled',2:'embedded_provider',3:'server_custodied'}[take(1)[0]]
    assert offset==len(wire)==vector['wire_bytes']
    assert got==intent
    digest=hashlib.sha256(wire).digest()
    assert digest.hex()==vector['intent_sha256']
    for file,field in [('artifact.txt','artifact_sha256'),('metadata.json','metadata_sha256'),('terms.txt','terms_sha256')]:
        assert hashlib.sha256((base/file).read_bytes()).hexdigest()==intent[field]
    signature_status='not_checked_optional_dependency_unavailable'
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        public=Ed25519PublicKey.from_public_bytes(bytes.fromhex(vector['public_key_hex']))
        assert b58(bytes.fromhex(vector['public_key_hex']))==intent['contributor']
        sig=base64.b64decode(vector['signature_base64'],validate=True)
        public.verify(sig,digest)
        try:
            public.verify(sig,bytes([digest[0]^1])+digest[1:])
        except Exception:
            pass
        else:
            raise AssertionError('tamper accepted')
        signature_status='verified_and_tamper_rejected'
    except ImportError:
        if require_signature:raise SystemExit('cryptography package required for Ed25519 check')
    return {'binary_decode':'passed','file_hashes':'passed','wire_bytes':len(wire),
            'ed25519':signature_status,'chain_status':'fictional_fixture_not_deployed'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--require-signature',action='store_true')
    args=p.parse_args()
    print(json.dumps(inspect(args.require_signature),indent=2))
