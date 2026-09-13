/**
 * Display-only formatting helpers. Nothing here is authoritative: exact
 * integer ratios rendered beside every derived value are the authority
 * (docs/08: a formatted percentage is not an assertion of exact equality).
 */

/** "1AbC…xYz9" — abbreviated key/address for table cells; full value on title/copy. */
export function abbreviate(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

const GROUP_SEP = ',';

/** Group a base-10 integer string: "571600000000" → "571,600,000,000". */
export function formatUnits(decimal: string): string {
  const neg = decimal.startsWith('-');
  const digits = neg ? decimal.slice(1) : decimal;
  const out: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) {
    out.unshift(digits.slice(Math.max(0, i - 3), i));
  }
  return (neg ? '-' : '') + out.join(GROUP_SEP);
}

/** Claim basis points → "2,000 bps (20% of incoming residual)". */
export function formatClaimBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = (bps % 100).toString(10).padStart(2, '0');
  return `${bps.toLocaleString('en-US')} bps (${whole}.${frac}%)`;
}

/**
 * Exact ratio → display percentage with four decimals, computed in bigint
 * (floor of numerator·10^6/denominator, rendered as NN.NNNN%). Returns null
 * for a zero denominator — the caller shows the explicit "not monetizable"
 * state instead of "0.0000%".
 */
export function ratioPercentDisplay(numerator: string, denominator: string): string | null {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d === 0n) return null;
  const scaled = (n * 1_000_000n) / d; // 1e4 = one percent unit of 4 decimals
  const whole = scaled / 10_000n;
  const frac = (scaled % 10_000n).toString(10).padStart(4, '0');
  return `${whole.toString(10)}.${frac}%`;
}

/** Minor units with a conventional major-unit hint: "1,000,000 minor units (≈ 10,000.00 major)". */
export function formatMinorHint(amountMinor: string): string {
  const a = BigInt(amountMinor);
  const major = a / 100n;
  const cents = (a % 100n).toString(10).padStart(2, '0');
  return `${formatUnits(amountMinor)} minor units (≈ ${formatUnits(major.toString(10))}.${cents} major)`;
}

/** Unix seconds (i64 decimal string) → readable UTC; falls back to raw string. */
export function formatUnixTime(decimal: string): string {
  const n = Number(decimal);
  if (!Number.isFinite(n)) return decimal;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return decimal;
  return d.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}
