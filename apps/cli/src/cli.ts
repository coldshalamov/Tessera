#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import {
  buildBundle,
  buildDemoSession,
  bundleMemberMap,
  bundleToZip,
  contentsFromFileMap,
  MANIFEST_PATH,
  parsePortSession,
  quoteBundleRecords,
  readBundleZip,
  recoverBundle,
  renderReportText,
  rpcRentExemption,
  lamportsToSol,
  sessionToBundleInput,
  unsafePathReason,
  verifyBundle,
  type BundleContents,
  type EvidenceVerificationReport,
} from '@tessera/evidence';

/**
 * tessera-evidence — offline evidence-bundle CLI (docs/06, docs/08).
 *
 * Commands:
 *   inspect <bundle> [--json] [--extract <dir>]
 *   verify  <bundle> [--json] [--rpc <url>]
 *   export  --from-port <session-dir> [--out <path>] [--dir]
 *   quote   <bundle> [--json] [--rpc <url>]
 *   recover-known-project <bundle> [--json] [--out <dir>]
 *   demo    --out <session-dir>
 *
 * <bundle> is a .zip file or an extracted bundle directory.
 *
 * Exit codes (docs/08: distinguish invalid / incomplete / network /
 * unsupported):
 *   0  success — verify: 'valid-offline' (never a bare "verified")
 *   1  usage / CLI error
 *   2  evidence INVALID (contradictory: bad hash, bad signature, bad math)
 *   3  evidence INCOMPLETE (missing ancestor/terms/artifact/file)
 *   4  UNSUPPORTED bundle version (files still inspectable/exportable)
 *   5  unreadable container or manifest
 *   6  network failure — --rpc requested but endpoint unreachable
 *
 * --rpc is a minimal read-only getAccountInfo probe with the trust
 * assumption printed on the report; full online verification (program
 * binary/upgrade state, independent finality) is NOT implemented in T05.
 */

const EXIT = {
  ok: 0,
  usage: 1,
  invalid: 2,
  incomplete: 3,
  unsupported: 4,
  unreadable: 5,
  network: 6,
} as const;

const SELF = 'tessera-evidence';

function usage(): void {
  process.stderr.write(
    [
      `${SELF} — offline Tessera evidence-bundle tools`,
      '',
      'Usage:',
      `  ${SELF} inspect <bundle.zip|dir> [--json] [--extract <dir>]`,
      `  ${SELF} verify <bundle.zip|dir> [--json] [--rpc <url>]`,
      `  ${SELF} export --from-port <session-dir> [--out <path>] [--dir]`,
      `  ${SELF} quote <bundle.zip|dir> [--json] [--rpc <url>]`,
      `  ${SELF} recover-known-project <bundle.zip|dir> [--json] [--out <dir>]`,
      `  ${SELF} demo --out <session-dir>`,
      '',
      'Exit codes: 0 ok | 2 invalid | 3 incomplete | 4 unsupported | 5 unreadable | 6 network',
    ].join('\n') + '\n',
  );
}

interface Args {
  readonly positional: string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else if (['json', 'dir', 'zip', 'help'].includes(a.slice(2))) {
        flags.set(a.slice(2), true);
      } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
        flags.set(a.slice(2), argv[++i]!);
      } else {
        flags.set(a.slice(2), true);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------------------------------------------------------------------------
// Bundle input: zip file or directory → BundleContents
// ---------------------------------------------------------------------------

async function dirToFileMap(root: string): Promise<Map<string, Uint8Array> | { error: string }> {
  const out = new Map<string, Uint8Array>();
  const walk = async (rel: string): Promise<string | null> => {
    const abs = rel === '' ? root : path.join(root, ...rel.split('/'));
    const st = await lstat(abs);
    if (st.isSymbolicLink()) return `symlink not allowed in bundle directory: ${rel}`;
    if (st.isDirectory()) {
      const entries = await readdir(abs);
      for (const e of entries) {
        const childRel = rel === '' ? e : `${rel}/${e}`;
        const err = await walk(childRel);
        if (err !== null) return err;
      }
      return null;
    }
    const reason = unsafePathReason(rel);
    if (reason !== null) return `unsafe path in bundle directory: ${rel} (${reason})`;
    const bytes = new Uint8Array(await readFile(abs));
    out.set(rel, bytes);
    return null;
  };
  const err = await walk('');
  if (err !== null) return { error: err };
  return out;
}

async function loadBundle(inputPath: string): Promise<BundleContents | { error: string; code: number }> {
  const st = await stat(inputPath).catch(() => null);
  if (st === null) return { error: `no such path: ${inputPath}`, code: EXIT.unreadable };
  if (st.isDirectory()) {
    const files = await dirToFileMap(inputPath);
    if ('error' in files) return { error: files.error, code: EXIT.invalid };
    const contents = contentsFromFileMap(files);
    if (!contents.ok) return { error: `${contents.error.code}: ${contents.error.message}`, code: EXIT.unreadable };
    return contents.value;
  }
  const zipBytes = new Uint8Array(await readFile(inputPath));
  const contents = readBundleZip(zipBytes);
  if (!contents.ok) {
    const detail = contents.error.zip !== undefined ? ` (${contents.error.zip.code}${contents.error.zip.entry !== undefined ? `: ${contents.error.zip.entry}` : ''})` : '';
    return { error: `${contents.error.code}: ${contents.error.message}${detail}`, code: EXIT.unreadable };
  }
  return contents.value;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function verifyExitCode(report: EvidenceVerificationReport, rpcRequested: boolean): number {
  if (rpcRequested) {
    const rpcCheck = report.checks.find((c) => c.name === 'chain.rpc');
    if (rpcCheck !== undefined && rpcCheck.result === 'incomplete') return EXIT.network;
  }
  switch (report.status) {
    case 'valid-offline':
      return EXIT.ok;
    case 'invalid':
      return EXIT.invalid;
    case 'incomplete':
      return EXIT.incomplete;
    case 'unsupported':
      return EXIT.unsupported;
    case 'unreadable':
      return EXIT.unreadable;
  }
}

/** Write bundle payload files to a directory — paths already validated. */
async function extractToDir(files: ReadonlyMap<string, Uint8Array>, manifestBytes: Uint8Array | null, outDir: string): Promise<void> {
  const root = path.resolve(outDir);
  const writeOne = async (rel: string, bytes: Uint8Array): Promise<void> => {
    const reason = unsafePathReason(rel);
    if (reason !== null) throw new Error(`refusing to extract unsafe path ${rel}: ${reason}`);
    const abs = path.resolve(root, ...rel.split('/'));
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      throw new Error(`refusing to extract outside target dir: ${rel}`);
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  };
  if (manifestBytes !== null) await writeOne(MANIFEST_PATH, manifestBytes);
  for (const [rel, bytes] of files) await writeOne(rel, bytes);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInspect(args: Args): Promise<number> {
  const target = args.positional[0];
  if (target === undefined) return EXIT.usage;
  const contents = await loadBundle(target);
  if ('error' in contents) {
    process.stderr.write(`inspect: ${contents.error}\n`);
    return contents.code;
  }
  const lenient = contents.lenient!;
  const extractDir = args.flags.get('extract');
  if (typeof extractDir === 'string') {
    await extractToDir(contents.files, contents.manifestBytes, extractDir);
    process.stderr.write(`extracted ${contents.files.size} file(s) to ${extractDir}\n`);
  }
  const summary = {
    format_version: lenient.formatVersion ?? null,
    valid_v1: contents.manifestV1 !== null,
    exporter: lenient.exporter,
    selected_leaf: contents.manifestV1?.selected_leaf ?? null,
    file_count: contents.files.size,
    listed_count: lenient.files.length,
    limitations: lenient.limitations,
    structural_problems: lenient.structuralProblems,
    files: lenient.files.map((f) => ({
      path: f.path,
      kind: f.kind,
      bytes: f.bytes === null ? null : f.bytes.toString(10),
      sha256: f.sha256,
      present: contents.files.has(f.path),
      well_formed: f.wellFormed,
    })),
    unlisted_members: [...contents.files.keys()].filter(
      (p) => !lenient.files.some((f) => f.path === p),
    ),
  };
  if (args.flags.has('json')) {
    printJson(summary);
  } else {
    const s = summary;
    const lines = [
      `bundle: ${target}`,
      `  format_version: ${JSON.stringify(s.format_version)}${s.valid_v1 ? ' (evidence-bundle v1)' : ' (NOT v1 — forward-compatible inspection only)'}`,
      `  exporter: ${s.exporter ?? 'unknown'}`,
    ];
    if (s.selected_leaf !== null) {
      lines.push(`  leaf: ${s.selected_leaf.node_address}`);
      lines.push(`  project: ${s.selected_leaf.project_address}`);
    }
    lines.push(`  files: ${s.file_count} member(s), ${s.listed_count} manifest entrie(s)`);
    if (s.unlisted_members.length > 0) lines.push(`  UNLISTED members: ${s.unlisted_members.join(', ')}`);
    for (const f of s.files) {
      lines.push(`    ${f.present ? ' ' : '!'} ${f.kind.padEnd(9)} ${f.bytes ?? '?'}B ${f.path}${f.well_formed ? '' : '  [malformed entry]'}`);
    }
    for (const l of s.limitations) lines.push(`  limitation: ${l}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
  return EXIT.ok;
}

async function cmdVerify(args: Args): Promise<number> {
  const target = args.positional[0];
  if (target === undefined) return EXIT.usage;
  const contents = await loadBundle(target);
  if ('error' in contents) {
    process.stderr.write(`verify: ${contents.error}\n`);
    return contents.code;
  }
  const rpc = args.flags.get('rpc');
  if (typeof rpc === 'string') {
    process.stderr.write(
      'note: --rpc performs only a minimal getAccountInfo probe; full online verification (program binary, upgrade state, independent finality) is not implemented in T05\n',
    );
  }
  const report = await verifyBundle(contents, typeof rpc === 'string' ? { rpcUrl: rpc } : {});
  if (args.flags.has('json')) printJson(report);
  else process.stdout.write(renderReportText(report) + '\n');
  return verifyExitCode(report, typeof rpc === 'string');
}

async function cmdExport(args: Args): Promise<number> {
  const fromPort = args.flags.get('from-port');
  if (typeof fromPort !== 'string') {
    process.stderr.write('export: --from-port <session-dir> is required\n');
    return EXIT.usage;
  }
  const sessionRaw = await readFile(path.join(fromPort, 'session.json')).catch(() => null);
  if (sessionRaw === null) {
    process.stderr.write(`export: no session.json in ${fromPort}\n`);
    return EXIT.unreadable;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(sessionRaw));
  } catch (e) {
    process.stderr.write(`export: session.json is not JSON: ${e instanceof Error ? e.message : e}\n`);
    return EXIT.unreadable;
  }
  const session = parsePortSession(parsedJson);
  if (!session.ok) {
    process.stderr.write(`export: session invalid: ${session.error.code} at ${session.error.path}: ${session.error.message}\n`);
    return EXIT.invalid;
  }
  const readSessionFile = async (rel: string): Promise<Uint8Array | null> => {
    const reason = unsafePathReason(rel);
    if (reason !== null) return null;
    const abs = path.resolve(fromPort, ...rel.split('/'));
    const root = path.resolve(fromPort);
    if (!abs.startsWith(root + path.sep)) return null;
    const b = await readFile(abs).catch(() => null);
    return b === null ? null : new Uint8Array(b);
  };
  const input = await sessionToBundleInput(
    session.value,
    readSessionFile,
    `${SELF}/0.1.0 (${session.value.mode} port session)`,
  );
  if (!input.ok) {
    process.stderr.write(`export: ${input.error.code}: ${input.error.message}\n`);
    return EXIT.invalid;
  }
  const built = await buildBundle(input.value);
  if (!built.ok) {
    process.stderr.write(`export: ${built.error.code}: ${built.error.message}\n`);
    return EXIT.invalid;
  }
  const out = args.flags.get('out');
  const asDir = args.flags.has('dir');
  if (typeof out === 'string' && asDir) {
    await mkdir(out, { recursive: true });
    await extractToDir(built.value.files, bundleMemberMap(built.value.manifest, built.value.files).get(MANIFEST_PATH)!, out);
  } else {
    const zipPath = typeof out === 'string' ? out : `${fromPort.replace(/[/\\]+$/, '')}.tessera-bundle.zip`;
    await mkdir(path.dirname(path.resolve(zipPath)), { recursive: true });
    await writeFile(zipPath, bundleToZip(built.value));
    process.stderr.write(`wrote ${zipPath}\n`);
  }
  const rep = built.value.selfReport;
  process.stderr.write(
    `export self-check: ${rep.status} (${rep.counts.pass} pass/${rep.counts.fail} fail/${rep.counts.warn} warn/${rep.counts.incomplete} incomplete); leaf ${built.value.manifest.selected_leaf.node_address}\n`,
  );
  return rep.counts.fail > 0 ? EXIT.invalid : EXIT.ok;
}

/**
 * Storage/rent quote (docs/08 `quote`, docs/10 "quote account sizes").
 * Byte sizes are documented field-sum ESTIMATES pending T03's measured
 * IDL; the offline figure uses the labeled LAUNCH_BUDGET legacy model —
 * never a live rent quote. `--rpc` adds a real getMinimumBalanceForRentExemption
 * query for those estimated sizes (read-only; still not a guarantee).
 */
async function cmdQuote(args: Args): Promise<number> {
  const target = args.positional[0];
  if (target === undefined) return EXIT.usage;
  const contents = await loadBundle(target);
  if ('error' in contents) {
    process.stderr.write(`quote: ${contents.error}\n`);
    return contents.code;
  }
  const quote = quoteBundleRecords(contents);
  if ('error' in quote) {
    process.stderr.write(`quote: ${quote.error}\n`);
    return EXIT.unsupported;
  }
  const rpc = args.flags.get('rpc');
  let live: { lamports: string; source: string } | { error: string } | null = null;
  if (typeof rpc === 'string') {
    const r = await rpcRentExemption(rpc, quote.total_estimated_bytes, { timeoutMs: 10_000 });
    if (!r.ok) {
      process.stderr.write(`quote: --rpc rent query failed: ${r.error}\n`);
      return EXIT.network;
    }
    live = { lamports: r.lamports, source: rpc };
  }
  const view = {
    note: 'account byte sizes are ESTIMATES from the docs/14 field list — T03 measures the real layout; illustrative rent is the legacy-parameter model, NOT a current rent quote',
    node_estimates: quote.node_estimates,
    project_estimate_bytes: quote.project_estimate_bytes,
    total_estimated_bytes: quote.total_estimated_bytes,
    illustrative_rent: {
      model: 'legacy-parameter (B+128)*6960 lamports — illustrative scenario, not a quote',
      lamports: quote.illustrative_rent_lamports,
      sol: quote.illustrative_rent_sol,
    },
    ...(live !== null && 'lamports' in live
      ? {
          live_rent: {
            method: 'getMinimumBalanceForRentExemption',
            endpoint: live.source,
            estimated_bytes: quote.total_estimated_bytes,
            lamports: live.lamports,
            sol: lamportsToSol(BigInt(live.lamports)),
            caveat: 'real rent query for ESTIMATED sizes — actual account layout unfixed until T03; not a guarantee against fee/rent changes',
          },
        }
      : {}),
    assumptions: quote.assumptions,
  };
  if (args.flags.has('json')) {
    printJson(view);
  } else {
    const lines = [`storage quote for ${target} (estimated sizes — see assumptions):`];
    for (const n of quote.node_estimates) lines.push(`    node ${n.node_address.slice(0, 16)}… ~${n.bytes}B`);
    if (quote.project_estimate_bytes !== null) lines.push(`    project ~${quote.project_estimate_bytes}B`);
    lines.push(`    total ~${quote.total_estimated_bytes}B`);
    lines.push(`  illustrative legacy-model rent: ${quote.illustrative_rent_sol} SOL (${quote.illustrative_rent_lamports} lamports) — NOT a live quote`);
    if (live !== null && 'lamports' in live) {
      lines.push(`  live getMinimumBalanceForRentExemption @ ${live.source}: ${lamportsToSol(BigInt(live.lamports))} SOL (${live.lamports} lamports) — for estimated sizes only`);
    }
    for (const a of quote.assumptions) lines.push(`  assumption: ${a}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
  return EXIT.ok;
}

async function cmdRecover(args: Args): Promise<number> {
  const target = args.positional[0];
  if (target === undefined) return EXIT.usage;
  const contents = await loadBundle(target);
  if ('error' in contents) {
    process.stderr.write(`recover-known-project: ${contents.error}\n`);
    return contents.code;
  }
  const recovered = recoverBundle(contents);
  if ('error' in recovered) {
    process.stderr.write(`recover-known-project: ${recovered.error}\n`);
    return EXIT.unsupported;
  }
  const outDir = args.flags.get('out');
  if (typeof outDir === 'string') {
    await extractToDir(contents.files, contents.manifestBytes, outDir);
    const payoutsJson = new TextEncoder().encode(JSON.stringify(recovered.payout_table, null, 2) + '\n');
    await writeFile(path.join(outDir, 'recovered-payout-table.json'), payoutsJson);
  }
  const view = {
    note: 'reconstructed from bundle bytes only — no application/index/network consulted; offline economics, not a finality claim',
    project: recovered.project,
    leaf: recovered.leaf.node_ref.node_address,
    chain_length: recovered.chain.length,
    chain: recovered.chain.map((n) => ({
      depth: n.depth,
      node_address: n.node_ref.node_address,
      contributor: n.contributor,
      name: n.name,
      claim_bps: n.claim_bps,
      effective_units: n.effective_units,
      issued_total_units: n.issued_total_units,
    })),
    payout_table: recovered.payout_table,
    economics_ok: recovered.economics.ok,
    economics_mismatches: recovered.economics.mismatches,
    missing_ancestor: recovered.walk.missingAncestor,
    unresolved_references: recovered.unresolvedReferences,
    record_failures: recovered.recordFailures,
  };
  if (args.flags.has('json')) printJson(view);
  else {
    const lines = [
      `recovered leaf: ${view.leaf}`,
      `project: ${recovered.project?.title ?? '(no project record)'} [${recovered.project?.project_address ?? 'n/a'}]`,
      `chain: ${view.chain_length} node(s), economics recompute: ${recovered.economics.ok ? 'MATCH' : 'MISMATCH'}`,
      `payout table (issued ${recovered.payout_table.issued_total_units}):`,
    ];
    for (const e of recovered.payout_table.entries) {
      lines.push(`    ${e.numerator_units}/${e.denominator_units} -> ${e.beneficiary} (${e.node_address.slice(0, 12)}…)`);
    }
    if (recovered.payout_table.zero_issued) lines.push('    (issued total is 0 — no monetizable payout)');
    if (recovered.unresolvedReferences.length > 0) lines.push(`  unresolved references: ${recovered.unresolvedReferences.join(', ')}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
  return recovered.economics.ok && recovered.walk.missingAncestor === null ? EXIT.ok : EXIT.incomplete;
}

async function cmdDemo(args: Args): Promise<number> {
  const out = args.flags.get('out');
  if (typeof out !== 'string') {
    process.stderr.write('demo: --out <session-dir> is required\n');
    return EXIT.usage;
  }
  const demo = await buildDemoSession();
  await mkdir(out, { recursive: true });
  for (const [rel, bytes] of demo.files) {
    const abs = path.resolve(out, ...rel.split('/'));
    const root = path.resolve(out);
    if (!abs.startsWith(root + path.sep)) return EXIT.invalid;
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }
  await writeFile(path.join(out, 'session.json'), JSON.stringify(demo.session, null, 2) + '\n');
  process.stderr.write(
    `demo session written to ${out} (local mode, deterministic throwaway keys; leaf ${demo.session.selected_leaf!.node_address})\n`,
  );
  return EXIT.ok;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if ('error' in args || args.flags.has('help') || args.positional.length === 0) {
    usage();
    return EXIT.usage;
  }
  const cmd = args.positional[0]!;
  const rest: Args = { positional: args.positional.slice(1), flags: args.flags };
  switch (cmd) {
    case 'inspect':
      return cmdInspect(rest);
    case 'verify':
      return cmdVerify(rest);
    case 'export':
      return cmdExport(rest);
    case 'quote':
      return cmdQuote(rest);
    case 'recover-known-project':
      return cmdRecover(rest);
    case 'demo':
      return cmdDemo(rest);
    default:
      process.stderr.write(`unknown command '${cmd}'\n`);
      usage();
      return EXIT.usage;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`${SELF}: fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(EXIT.usage);
  });
