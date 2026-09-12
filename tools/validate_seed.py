#!/usr/bin/env python3
"""Validate this repo seed's local document links, JSON and delivery inventory.
Only stdlib is required. This does not certify an application/program build.
After editing any seeded file, the delivery inventory will intentionally differ;
use --skip-inventory for ongoing development, and maintain normal Git history.
"""
from __future__ import annotations
import argparse, hashlib, json, re
from pathlib import Path
from urllib.parse import unquote, urlsplit

def validate(skip_inventory: bool=False) -> dict:
    root=Path(__file__).resolve().parents[1]
    errors=[];links=0;json_count=0
    for file in sorted(root.rglob('*.md')):
        text=file.read_text(encoding='utf-8')
        if text.count('```')%2:
            errors.append(f'unbalanced code fence: {file.relative_to(root)}')
        for match in re.finditer(r'(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)',text):
            target=match.group(1).strip().split(' "',1)[0]
            if target.startswith(('http:','https:','mailto:','#','urn:')):continue
            path=unquote(urlsplit(target).path)
            if not path:continue
            links+=1
            resolved=(file.parent/path).resolve()
            if not resolved.is_relative_to(root):
                errors.append(f'link escapes repo: {file.relative_to(root)} -> {target}')
            elif not resolved.exists():
                errors.append(f'broken link: {file.relative_to(root)} -> {target}')
    for file in sorted(root.rglob('*.json')):
        try:json.loads(file.read_text(encoding='utf-8'));json_count+=1
        except Exception as exc:errors.append(f'invalid JSON {file.relative_to(root)}: {exc}')
    manifest=root/'DELIVERY_MANIFEST.json'
    checked=0
    if manifest.exists() and not skip_inventory:
        data=json.loads(manifest.read_text())
        for entry in data['files']:
            file=root/entry['path']
            if not file.is_file():errors.append(f'missing inventoried file: {entry["path"]}');continue
            actual=hashlib.sha256(file.read_bytes()).hexdigest()
            if actual!=entry['sha256']:errors.append(f'delivery hash changed: {entry["path"]}')
            checked+=1
    else:
        data={}
    result={'repo':root.name,'local_links_checked':links,'json_files_parsed':json_count,
            'inventory_files_checked':checked,'errors':errors,'status':'passed' if not errors else 'failed'}
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--skip-inventory',action='store_true')
    a=p.parse_args();r=validate(a.skip_inventory);print(json.dumps(r,indent=2))
    raise SystemExit(0 if r['status']=='passed' else 1)
