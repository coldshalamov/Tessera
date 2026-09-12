#!/usr/bin/env python3
"""Specification reference, not a Solana program or live payout service.

Uses only the Python standard library. Beneficiary test IDs are 32-byte values
encoded as lowercase hex; production JSON uses base58 but MUST sort decoded
raw bytes for dust tie breaks. No floats participate in economic arithmetic.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
import json
import random
from typing import Iterable

U = 1_000_000_000_000
BPS = 10_000
MAX_MONEY = (1 << 63) - 1

class EconomicError(ValueError):
    pass

@dataclass(frozen=True)
class Step:
    residual_in: int
    claim_bps: int
    effective: int
    residual_out: int
    issued: int
    payout_numerator: int
    payout_denominator: int

    def portable(self) -> dict[str, str | int]:
        return {
            'residual_in_units': str(self.residual_in),
            'claim_bps': self.claim_bps,
            'effective_units': str(self.effective),
            'residual_out_units': str(self.residual_out),
            'issued_total_units': str(self.issued),
            'own_payout_numerator_units': str(self.payout_numerator),
            'own_payout_denominator_units': str(self.payout_denominator),
        }

def integer(value: object, lo: int, hi: int, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise EconomicError(code)
    return value

def append(residual_in: int, claim_bps: int) -> Step:
    r = integer(residual_in, 0, U, 'RESIDUAL_OUT_OF_RANGE')
    q = integer(claim_bps, 0, BPS, 'CLAIM_OUT_OF_RANGE')
    if q > 0 and r == 0:
        raise EconomicError('BRANCH_CAPACITY_EXHAUSTED')
    effective = r * q // BPS
    if q > 0 and effective == 0:
        raise EconomicError('CLAIM_ROUNDS_TO_ZERO')
    residual_out = r - effective
    issued = U - residual_out
    return Step(r, q, effective, residual_out, issued, effective, issued)

def path(claims: Iterable[int]) -> list[Step]:
    residual = U
    result = []
    for claim in claims:
        node = append(residual, claim)
        result.append(node)
        residual = node.residual_out
    return result

def raw_key(key: str) -> bytes:
    if not isinstance(key, str) or len(key) != 64 or key != key.lower():
        raise EconomicError('INVALID_TEST_BENEFICIARY_KEY')
    try:
        decoded = bytes.fromhex(key)
    except ValueError as exc:
        raise EconomicError('INVALID_TEST_BENEFICIARY_KEY') from exc
    if len(decoded) != 32:
        raise EconomicError('INVALID_TEST_BENEFICIARY_KEY')
    return decoded

def allocate(amount: int, contributions: Iterable[tuple[str, int]]) -> dict[str, int]:
    """Largest-remainder allocation, aggregate beneficiaries BEFORE rounding."""
    integer(amount, 0, MAX_MONEY, 'INVALID_AMOUNT')
    grouped: dict[str, int] = defaultdict(int)
    for key, weight in contributions:
        raw_key(key)
        integer(weight, 0, U, 'INVALID_WEIGHT')
        grouped[key] += weight
    issued = sum(grouped.values())
    if not 0 < issued <= U:
        raise EconomicError('ZERO_ISSUED' if issued == 0 else 'ISSUED_OUT_OF_RANGE')
    keys = sorted(grouped, key=raw_key)
    allocated = {key: amount * grouped[key] // issued for key in keys}
    remainders = {key: amount * grouped[key] % issued for key in keys}
    dust = amount - sum(allocated.values())
    ranked = sorted(keys, key=lambda key: (-remainders[key], raw_key(key)))
    for key in ranked[:dust]:
        allocated[key] += 1
    assert sum(allocated.values()) == amount
    return allocated

def self_test() -> dict[str, int | str]:
    fixture_path = Path(__file__).resolve().parents[1] / 'fixtures' / 'economics.json'
    fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
    nodes: dict[str, Step] = {}
    for row in fixture['nodes']:
        residual = U if row['parent'] is None else nodes[row['parent']].residual_out
        computed = append(residual, row['claim_bps'])
        assert computed.portable() == row['expected'], row['id']
        nodes[row['id']] = computed
    for case in fixture['settlements']:
        got = allocate(case['amount_minor'], [(r['beneficiary_hex'], int(r['effective_units'])) for r in case['weights']])
        assert got == case['expected'], case['id']
    for case in fixture['invalid_append']:
        try:
            append(case['residual'], case['claim_bps'])
        except EconomicError as exc:
            assert str(exc) == case['error'], (case, str(exc))
        else:
            raise AssertionError(case)
    for bad in (True, -1, 1.2, '1000', None):
        try:
            append(U, bad)  # type: ignore[arg-type]
        except EconomicError:
            pass
        else:
            raise AssertionError('invalid claim accepted')
    keys = [f'{i:064x}' for i in range(1, 9)]
    rng = random.Random(20260911)
    paths_checked = allocations_checked = steps_checked = 0
    for _ in range(2500):
        residual = U
        weights: list[tuple[str, int]] = []
        for _ in range(rng.randint(1, 64)):
            q = rng.choice([0, 1, 10000, rng.randint(1, 10000)])
            try:
                step = append(residual, q)
            except EconomicError as exc:
                assert str(exc) in ('CLAIM_ROUNDS_TO_ZERO', 'BRANCH_CAPACITY_EXHAUSTED')
                step = append(residual, 0)
            weights.append((rng.choice(keys), step.effective))
            residual = step.residual_out
            assert sum(w for _, w in weights) + residual == U
            assert 0 <= residual <= U
            assert step.issued == U - residual
            steps_checked += 1
        paths_checked += 1
        issued = sum(w for _, w in weights)
        if issued:
            amount = rng.choice([0, 1, 1000, MAX_MONEY, rng.randint(0, 10000000)])
            paid = allocate(amount, weights)
            assert sum(paid.values()) == amount
            grouped: dict[str, int] = defaultdict(int)
            for key, weight in weights:
                grouped[key] += weight
            for key, value in paid.items():
                assert abs(value * issued - amount * grouped[key]) < issued
            # Equivalent splitting of a beneficiary's weight must not change dust.
            split = [(k, w // 2) for k, w in weights] + [(k, w - w // 2) for k, w in weights]
            assert allocate(amount, split) == paid
            assert allocate(amount, reversed(weights)) == paid
            allocations_checked += 1
    try:
        allocate(1000, [(keys[0], 0)])
    except EconomicError as exc:
        assert str(exc) == 'ZERO_ISSUED'
    else:
        raise AssertionError('zero-issued version was monetized')
    return {'status': 'passed', 'fixed_nodes': len(fixture['nodes']),
            'fixed_settlements': len(fixture['settlements']),
            'invalid_append_cases': len(fixture['invalid_append']),
            'random_paths': paths_checked, 'random_steps': steps_checked,
            'random_allocations': allocations_checked}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), indent=2))
    else:
        parser.print_help()
