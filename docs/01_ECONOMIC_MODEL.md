# Economic model: exact, version-specific residual claims

This is the normative arithmetic proposal. [Reference implementation](../tools/reference_economics.py) and [vectors](../fixtures/economics.json) accompany it. A change to this document requires new versioned vectors and coordinated changes in both repos.

## Four quantities, two denominators

Let total capacity `U = 1_000_000_000_000`. Let `q` be an integer in 0..10,000 basis points, where 100 basis points is one percent. At a node whose parent has residual `R_in`, compute:

```
effective = floor(R_in * q / 10_000)
R_out = R_in - effective
issued = U - R_out
own_as_is_payout = effective / issued   (undefined when issued == 0)
```

The root has `R_in = U`; later nodes take the exact parent's residual. All units are `u64`, with multiplication in checked `u128`. JSON encodes units as decimal strings. JavaScript uses `bigint`, never Number for financial arithmetic. Every implementation preserves `sum(effective along path) + R_out = U` exactly.

`q` divides the **incoming residual**. The as-is payout divides **all issued units in the selected version**. These are intentionally different denominators. A contributor claiming 10% of 50% residual gets 5% effective capacity, but if total issued after entry is 55%, its current payout is 5/55 = approximately 9.09%, not 5% and not 10%.

## Explicit stored economic fields

Each node carries `residual_in_units`, `claim_bps`, `effective_units`, `residual_out_units`, `issued_total_units`, `own_payout_numerator_units` and `own_payout_denominator_units`. The program derives all fields except the requested claim. Numerator must equal effective; denominator must equal issued. Redundant numeric fields are deliberately validated caches, not independently editable inputs. For all-zero issued state store numerator/denominator `0/0` and expose payout as null with `ZERO_ISSUED`.

Do not store rounded percentage strings as legal/economic authority. A display may show 9.0909%; the exact ratio remains 50,000,000,000 / 550,000,000,000. A full payout table for a release is exported as exact ratios. The node's cached own payout applies only to that node's version; it is not its payout at all descendants.

## Inheritance and versioning

For a selected version v, every ancestor i including v receives `effective_i / issued_v`. A sibling is not an ancestor. A later descendant does not alter a previous version's denominator. A script root can earn 100% of receipts from a root-only product even though it reserved only 15% effective capacity. Later descendants spend part of the residual and reduce the root's normalized payout only in those descendants.

There is no cash assigned to residual. It is unallocated future claim capacity. This resolves cash conservation without an orphan treasury. The word “rights” in the interface must be qualified: these are economic participation terms, not automatically copyright ownership, company shares or securities.

## Canonical worked branch

| Node | Parent | Claim | Effective units / U | Residual / U | Issued / U | Own payout at this node |
|---|---|---:|---:|---:|---:|---:|
| A script | none | 15% | .150 | .850 | .150 | 150/150 |
| Alice expensive take | A | 50% | .425 | .425 | .575 | 425/575 |
| B lower-price take | A | 20% | .170 | .680 | .320 | 170/320 |
| C sound design | B | 10% | .068 | .612 | .388 | 68/388 |
| D music | C | 25% | .153 | .459 | .541 | 153/541 |

At C the payout vector is (150,170,68)/388. At D it is (150,170,68,153)/541. Alice receives nothing from either of those versions. Decimal columns above are exact descriptions of these particular fractions, not the general computational representation.

## Integer money allocation

Input is a nonnegative integer number of **currency minor units** plus an exact version. Do not assume every currency has two decimals. Aggregate effective weights by beneficiary identity before allocation, so splitting one person's labor into many nodes does not win more rounding dust. Compute each floor allocation `floor(amount * weight / issued)`. Distribute the remaining minor units by descending remainder `(amount * weight) mod issued`. Break ties by ascending raw beneficiary-public-key bytes, never locale-sensitive names or database arrival time.

This largest-remainder rule conserves every minor unit and differs from exact proportional shares by less than one minor unit per aggregated beneficiary for that settlement. Micro-events should be accumulated into a defined release/currency/settlement period before allocation, rather than generating millions of zero-cent transfers. Residual remains unrelated to actual held payout balances.

A negative receipt is not passed through this positive allocator. Refunds reverse recorded allocations for the original receipt using the payment ledger's capped, deterministic reversal policy. Recomputing against today's head is forbidden. Repeating settlement with the same idempotency key produces the same result, never another payment.

## Boundary rules

- Claim zero is valid for credits/non-economic revisions. If issued remains zero, the version cannot be monetized. No silent “pay the founder” fallback.
- A positive claim whose effective units round to zero is rejected with `CLAIM_ROUNDS_TO_ZERO`. User must choose a higher claim or an explicit zero-credit contribution.
- Claim 100% consumes all remaining capacity. Positive descendants are then impossible without a future transfer/reallocation agreement. Zero-claim descendants remain possible where terms allow them.
- Values outside bounds, negative money, overlarge products, malformed decimal integers, and an unknown parent/network are rejected before signing and again on-chain where applicable.
- Fees and third-party license obligations are outside this fraction unless a contributor explicitly occupies a node. A rightsholder may insist on an external fee and can refuse permission entirely.

## What the mechanism does not guarantee

Low claims do not always increase personal revenue. The relevant expectation involves total effective share, remaining demand, completion probability and project receipts. Quality, reputation, access to an audience and first-mover position can dominate price. Ordering matters: the first equal residual claim has more effective units than the second. This is an intentional sequential bargain, not a fair-value oracle.

Padding a path with economically meaningless self-contributions can consume capacity. Multiple identities can conceal common control. Stolen or low-quality work can be offered cheaply. The program cannot adjudicate creative value; apps need consent, attribution, moderation and clear branch selection. Tests must demonstrate these limitations rather than advertising the mechanism as Sybil-proof or automatically fair.

There is no economically neutral automatic merge of two branches: shared ancestors must not be double-counted and already-promised weights cannot simply be added. V1 has one economic parent. Future economic joins require a separately versioned reallocation/consent design and new proof obligations.
