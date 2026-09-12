#!/usr/bin/env python3
"""Verify this repo's shared/ directory is byte-identical to the sibling repo's.

The integration contract requires identical checked-in copies of shared/ in
Tessera and Morpheus. Drift must be resolved before any integration release.
Only stdlib is required.

Usage: python tools/check_shared.py [--sibling PATH]
Default sibling: ../Morpheus for the Tessera repo, ../Tessera for Morpheus.
"""
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path

def digests(shared: Path) -> dict[str, str]:
    out = {}
    for f in sorted(shared.rglob('*')):
        if f.is_file():
            out[f.relative_to(shared).as_posix()] = hashlib.sha256(f.read_bytes()).hexdigest()
    return out

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sibling', default=None, help='Path to sibling repo root')
    a = p.parse_args()
    root = Path(__file__).resolve().parents[1]
    sibling_name = 'Morpheus' if root.name == 'Tessera' else 'Tessera'
    sibling = Path(a.sibling).resolve() if a.sibling else (root.parent / sibling_name).resolve()
    mine, theirs = root / 'shared', sibling / 'shared'
    if not mine.is_dir() or not theirs.is_dir():
        print(json.dumps({'status': 'failed', 'error': f'missing shared/ dir: {mine} or {theirs}'}, indent=2))
        return 1
    mine_h, theirs_h = digests(mine), digests(theirs)
    problems = [f'only in {root.name}: {k}' for k in sorted(set(mine_h) - set(theirs_h))]
    problems += [f'only in {sibling.name}: {k}' for k in sorted(set(theirs_h) - set(mine_h))]
    problems += [f'content differs: {k}' for k in sorted(set(mine_h) & set(theirs_h)) if mine_h[k] != theirs_h[k]]
    result = {'repo': root.name, 'sibling': sibling.name,
              'files_compared': len(set(mine_h) | set(theirs_h)),
              'problems': problems, 'status': 'passed' if not problems else 'failed'}
    print(json.dumps(result, indent=2))
    return 0 if not problems else 1

if __name__ == '__main__':
    sys.exit(main())
