import {
  base58AddressToBytes,
  encodeIntentV1,
  encodeStatementV1,
  hexToBytes,
  isPlainObject,
  parseIntentV1,
  parseStatementV1,
  sha256Hex,
  verifyEd25519Detached,
  type EvidenceBundleV1,
  type IntentV1,
  type NodeRecordV1,
  type NodeRef,
  type StatementV1,
} from '@tessera/types';
import { base64ToBytes, bytesEqual } from './bytes.js';
import { MANIFEST_PATH, type BundleContents } from './bundle.js';
import { parseJsonBytes, stableStringify } from './json.js';
import { parseManifestLenient, type LenientFileEntry } from './manifest.js';
import { unsafePathReason } from './paths.js';
import {
  parseBundleRecords,
  PAYOUT_TABLE_PATH,
  reconstructChain,
  recomputeChainEconomics,
  payoutTableForLeaf,
  PROJECT_PATH,
} from './recover.js';
import {
  rollUpStatus,
  summarize,
  VERIFIER_ID,
  type EvidenceCheck,
  type EvidenceVerificationReport,
} from './report.js';
import { rpcAccountChecks } from './rpc.js';

/**
 * Offline evidence-bundle verification (docs/06). Runs entirely on bundle
 * bytes: container hygiene, per-file SHA-256, intent digest recomputation
 * from wire bytes, Ed25519 detached signatures, residual-v1 economics,
 * ancestry completeness, release-anchor binding and coverage of
 * metadata/terms/artifacts.
 *
 * What it can never claim offline: live Solana finality, program binary or
 * upgrade state, and legal identity/ownership. Those surface as warn-level
 * checks plus mandatory report limitations — never silently "verified".
 */

export interface VerifyOptions {
  /** Optional independent RPC endpoint for account-existence checks.
   *  Results remain trust-assumption-labeled; never a finality proof. */
  readonly rpcUrl?: string;
  readonly rpcTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const MAX_LISTED = 6;

function listPaths(paths: readonly string[]): string {
  if (paths.length <= MAX_LISTED) return paths.join(', ');
  return `${paths.slice(0, MAX_LISTED).join(', ')} … and ${paths.length - MAX_LISTED} more`;
}

function check(name: string, result: EvidenceCheck['result'], detail: string): EvidenceCheck {
  return { name, result, detail };
}

interface SigSidecar {
  signer: string;
  signature_base64: string;
}

function parseSigSidecar(bytes: Uint8Array): SigSidecar | null {
  const parsed = parseJsonBytes(bytes);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const signer = parsed.value['signer'];
  const sig = parsed.value['signature_base64'];
  if (typeof signer !== 'string' || typeof sig !== 'string') return null;
  return { signer, signature_base64: sig };
}

function sameScope(a: NodeRef, b: NodeRef): boolean {
  return (
    a.genesis_hash === b.genesis_hash &&
    a.program_id === b.program_id &&
    a.project_address === b.project_address
  );
}

function intentMatchesRecord(intent: IntentV1, record: NodeRecordV1): string[] {
  const diffs: string[] = [];
  const cmp = (field: string, i: unknown, r: unknown): void => {
    if (i !== r) diffs.push(`${field}: intent=${JSON.stringify(i)} record=${JSON.stringify(r)}`);
  };
  cmp('network_genesis', intent.network_genesis, record.node_ref.genesis_hash);
  cmp('program_id', intent.program_id, record.node_ref.program_id);
  cmp('project_address', intent.project_address, record.node_ref.project_address);
  cmp('economic_parent', intent.economic_parent, record.economic_parent?.node_address ?? null);
  if (intent.references.length !== record.references.length || intent.references.some((r, i) => r !== record.references[i])) {
    diffs.push('references differ');
  }
  cmp('nonce', intent.nonce, record.nonce);
  cmp('contributor', intent.contributor, record.contributor);
  cmp('name', intent.name, record.name);
  cmp('title', intent.title, record.title);
  cmp('artifact_sha256', intent.artifact_sha256, record.artifact_sha256);
  cmp('metadata_sha256', intent.metadata_sha256, record.metadata_sha256);
  cmp('terms_sha256', intent.terms_sha256, record.terms_sha256);
  cmp('claim_bps', intent.claim_bps, record.claim_bps);
  cmp('declared_at', intent.declared_at, record.declared_at);
  cmp('custody_mode', intent.custody_mode, record.custody_mode);
  return diffs;
}

function payoutTablesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export async function verifyBundle(
  contents: BundleContents,
  opts: VerifyOptions = {},
): Promise<EvidenceVerificationReport> {
  const checks: EvidenceCheck[] = [];
  const limitations: string[] = [
    'OFFLINE VERIFICATION: this report proves byte integrity, signature validity and economic recomputation only. It does NOT establish live Solana finality, program binary/upgrade state, or legal identity/ownership.',
  ];

  // ------------------------------------------------------------------
  // 1. Manifest + inventory + per-file integrity (runs for ANY version —
  //    unknown schemas still get byte-level verification).
  // ------------------------------------------------------------------
  const lenient = contents.lenient ?? parseManifestLenient(contents.manifestRaw);
  const manifest: EvidenceBundleV1 | null = lenient.v1;
  // 'unsupported' is reserved for a *different* format_version. A manifest
  // claiming v1 but violating it (duplicate paths, bad fields) is invalid.
  const claimsV1 = lenient.formatVersion === 1;
  const unsupported = manifest === null && !claimsV1;
  const manifestBrokenV1 = manifest === null && claimsV1;
  for (const l of lenient.limitations) limitations.push(`bundle: ${l}`);
  if (unsupported) {
    limitations.push('Bundle manifest is not evidence-bundle v1 — semantic checks skipped; files remain integrity-checked and exportable.');
  }

  checks.push(
    manifest !== null
      ? check('manifest.schema', 'pass', 'bundle.json conforms to evidence-bundle v1')
      : manifestBrokenV1
        ? check(
            'manifest.schema',
            'fail',
            `claims format_version 1 but violates the schema: ${listPaths(lenient.structuralProblems)}`,
          )
        : check(
            'manifest.schema',
            'incomplete',
            `bundle.json is not evidence-bundle v1 (format_version=${JSON.stringify(lenient.formatVersion)}); structural problems: ${lenient.structuralProblems.length === 0 ? 'none beyond version/shape' : listPaths(lenient.structuralProblems)}`,
          ),
  );

  // Path safety across member names AND manifest-listed paths.
  {
    const bad: string[] = [];
    for (const name of contents.files.keys()) {
      const reason = unsafePathReason(name);
      if (reason !== null) bad.push(`${name} (${reason})`);
    }
    for (const f of lenient.files) {
      if (f.path !== '') {
        const reason = unsafePathReason(f.path);
        if (reason !== null) bad.push(`manifest:${f.path} (${reason})`);
        if (f.path === MANIFEST_PATH) bad.push(`${MANIFEST_PATH} lists itself (self-referential manifest)`);
      }
    }
    checks.push(
      bad.length === 0
        ? check('paths.safety', 'pass', 'all member names and manifest paths are safe relative paths')
        : check('paths.safety', 'fail', `unsafe paths: ${listPaths(bad)}`),
    );
  }

  // Inventory symmetry: every member listed, every listing present.
  const listedPaths = new Set(lenient.files.map((f) => f.path).filter((p) => p !== ''));
  {
    const missing: string[] = [];
    const unlisted: string[] = [];
    for (const f of lenient.files) {
      if (f.path !== '' && !contents.files.has(f.path)) missing.push(f.path);
    }
    for (const name of contents.files.keys()) {
      if (!listedPaths.has(name)) unlisted.push(name);
    }
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`listed but absent: ${listPaths(missing)}`);
    if (unlisted.length > 0) parts.push(`present but not inventoried: ${listPaths(unlisted)}`);
    checks.push(
      unlisted.length > 0
        ? check('container.inventory', 'fail', parts.join('; '))
        : missing.length > 0
          ? check('container.inventory', 'incomplete', parts.join('; '))
          : check('container.inventory', 'pass', `${listedPaths.size} listed file(s) all present; no unlisted members`),
    );
  }

  // Per-file SHA-256 + byte length (well-formed entries only).
  {
    const failures: string[] = [];
    let checked = 0;
    for (const f of lenient.files) {
      if (!f.wellFormed) continue;
      const data = contents.files.get(f.path);
      if (data === undefined) continue;
      checked++;
      const hash = await sha256Hex(data);
      const hashOk = hash.ok && hash.value === f.sha256;
      const sizeOk = f.bytes !== null && BigInt(data.length) === f.bytes;
      if (!hashOk || !sizeOk) {
        failures.push(
          `${f.path} (${hash.ok && hash.value !== f.sha256 ? 'sha256 mismatch' : ''}${!sizeOk ? `${hash.ok && hash.value !== f.sha256 ? '+ ' : ''}size ${data.length}≠${f.bytes}` : ''})`,
        );
      }
    }
    const skippedCount = lenient.files.filter((f: LenientFileEntry) => !f.wellFormed).length;
    const detail =
      failures.length === 0
        ? `${checked} file(s) byte-identical to manifest sha256/size${skippedCount > 0 ? `; ${skippedCount} malformed entr(ies) could not be checked` : ''}`
        : `integrity failures: ${listPaths(failures)}`;
    checks.push(check('payload.integrity', failures.length === 0 ? 'pass' : 'fail', detail));
  }

  const leaf = manifest?.selected_leaf ?? null;

  if (manifest === null) {
    for (const name of [
      'records.schema', 'records.scope', 'ancestry.reconstruct', 'economics.recompute',
      'project.consistency', 'payout_table.frozen', 'intents.digest', 'signatures.intent',
      'statements.verify', 'manifests.anchored', 'metadata.coverage', 'terms.coverage',
      'artifacts.coverage', 'references.resolve',
    ]) {
      checks.push(check(name, 'skipped', 'requires a valid evidence-bundle v1 manifest'));
    }
  } else {
    // --------------------------------------------------------------
    // 2. Record schema + scope + ancestry + economics (v1 only).
    // --------------------------------------------------------------
    const records = parseBundleRecords(contents.files);
    checks.push(
      records.failures.length === 0
        ? check('records.schema', 'pass', `${records.nodes.size} node record(s)${records.project ? ' + project record' : ''} parse cleanly`)
        : check('records.schema', 'fail', `unparseable records: ${listPaths(records.failures.map((f) => `${f.path} (${f.detail})`))}`),
    );

    {
      const outOfScope: string[] = [];
      for (const n of records.nodes.values()) {
        if (!sameScope(n.node_ref, leaf!)) {
          outOfScope.push(`${n.node_ref.node_address} (node_ref scope differs from selected_leaf)`);
        }
        if (n.economic_parent !== null && !sameScope(n.economic_parent, leaf!)) {
          outOfScope.push(`${n.node_ref.node_address} (economic_parent scope differs)`);
        }
      }
      checks.push(
        outOfScope.length === 0
          ? check('records.scope', 'pass', 'all records share the selected_leaf genesis/program/project scope')
          : check('records.scope', 'fail', `out-of-scope records: ${listPaths(outOfScope)}`),
      );
    }

    const walk = reconstructChain(records.nodes, leaf!.node_address);
    {
      const problems: string[] = [];
      let result: EvidenceCheck['result'] = 'pass';
      if (walk.leafMissing) {
        result = 'incomplete';
        problems.push('selected leaf record absent from bundle');
      } else {
        if (walk.cycle) {
          result = 'fail';
          problems.push('economic_parent cycle detected');
        }
        if (walk.missingAncestor !== null && !walk.leafMissing) {
          result = 'incomplete';
          problems.push(`ancestor ${walk.missingAncestor} not present in bundle`);
        }
        if (walk.depthMismatch.length > 0) {
          // A depth mismatch is contradictory only when the full chain is
          // present; with a missing ancestor the chain's start position is
          // unknowable, so this stays 'incomplete' rather than 'fail'.
          if (walk.missingAncestor === null) result = 'fail';
          problems.push(...walk.depthMismatch);
        }
        if (!walk.cycle && walk.missingAncestor === null && walk.chain.length > 0 && walk.chain[0]!.economic_parent !== null) {
          result = 'incomplete';
          problems.push('chain head is not a root record');
        }
      }
      checks.push(
        check(
          'ancestry.reconstruct',
          result,
          problems.length === 0
            ? `reconstructed ${walk.chain.length}-node chain root→leaf`
            : problems.join('; '),
        ),
      );
    }

    {
      if (walk.chain.length === 0 || walk.cycle) {
        checks.push(check('economics.recompute', walk.leafMissing || walk.cycle ? 'incomplete' : 'incomplete', 'cannot recompute: ancestor chain unavailable'));
      } else {
        const econ = recomputeChainEconomics(walk.chain);
        if (econ.error !== undefined) {
          const incomplete = econ.error.includes('does not start at a root');
          checks.push(check('economics.recompute', incomplete ? 'incomplete' : 'fail', econ.error));
        } else if (econ.mismatches.length > 0) {
          checks.push(
            check(
              'economics.recompute',
              'fail',
              `residual-v1 recomputation disagrees: ${listPaths(econ.mismatches.map((m) => `${m.node_address}.${m.field} recorded=${m.recorded} recomputed=${m.recomputed}`))}`,
            ),
          );
        } else {
          checks.push(check('economics.recompute', 'pass', `${walk.chain.length} node(s) recompute exactly under residual-v1`));
        }
      }
    }

    // Project record consistency (optional content).
    {
      const projBytes = contents.files.get(PROJECT_PATH);
      if (projBytes === undefined) {
        checks.push(check('project.consistency', 'warn', 'no project.json — project account fields unverified'));
      } else if (records.project === null) {
        checks.push(check('project.consistency', 'fail', 'project.json present but does not parse as ProjectV1'));
      } else {
        const p = records.project;
        const problems: string[] = [];
        if (p.project_address !== leaf!.project_address) problems.push('project_address differs from leaf scope');
        if (p.genesis_hash !== leaf!.genesis_hash) problems.push('genesis_hash differs');
        if (p.program_id !== leaf!.program_id) problems.push('program_id differs');
        if (walk.missingAncestor === null && walk.chain.length > 0) {
          const rootAddr = walk.chain[0]!.node_ref.node_address;
          if (p.root_node !== rootAddr) problems.push(`root_node ${p.root_node ?? 'null'} != chain root ${rootAddr}`);
        }
        checks.push(
          problems.length === 0
            ? check('project.consistency', 'pass', 'project record consistent with leaf scope and chain root')
            : check('project.consistency', 'fail', problems.join('; ')),
        );
      }
    }

    // Frozen payout table vs recomputation.
    {
      const frozenBytes = contents.files.get(PAYOUT_TABLE_PATH);
      if (frozenBytes === undefined) {
        checks.push(check('payout_table.frozen', 'incomplete', 'no verification/payout-table.json; payout table can still be recomputed from records'));
      } else if (walk.missingAncestor !== null || walk.cycle || walk.chain.length === 0) {
        checks.push(check('payout_table.frozen', 'incomplete', 'cannot compare: ancestor chain incomplete'));
      } else {
        const parsed = parseJsonBytes(frozenBytes);
        const leafRecord = records.nodes.get(leaf!.node_address);
        if (!parsed.ok || leafRecord === undefined) {
          checks.push(check('payout_table.frozen', 'fail', 'frozen payout table is not parseable JSON'));
        } else {
          const recomputed = payoutTableForLeaf(walk.chain, leafRecord, (parsed.value as { mode?: 'local' | 'devnet' | 'mainnet' }).mode ?? 'local');
          checks.push(
            payoutTablesEqual(parsed.value, recomputed)
              ? check('payout_table.frozen', 'pass', `frozen table equals recomputed table (${recomputed.entries.length} entries, issued ${recomputed.issued_total_units})`)
              : check('payout_table.frozen', 'fail', 'frozen payout table differs from recomputed residual-v1 table'),
          );
        }
      }
    }

    // --------------------------------------------------------------
    // 3. Intents + signatures.
    // --------------------------------------------------------------
    {
      const problems: string[] = [];
      const missing: string[] = [];
      let verifiedCount = 0;
      for (const n of records.nodes.values()) {
        const addr = n.node_ref.node_address;
        const jsonBytes = contents.files.get(`intents/${addr}.json`);
        const wireBytes = contents.files.get(`intents/${addr}.wire`);
        if (jsonBytes === undefined) missing.push(`intents/${addr}.json`);
        if (wireBytes === undefined) missing.push(`intents/${addr}.wire`);
        let intent: IntentV1 | null = null;
        let encoded: Uint8Array | null = null;
        if (jsonBytes !== undefined) {
          const parsed = parseJsonBytes(jsonBytes);
          if (!parsed.ok) {
            problems.push(`intents/${addr}.json: ${parsed.error.code}`);
          } else {
            const pi = parseIntentV1(parsed.value, `intents/${addr}.json`);
            if (!pi.ok) {
              problems.push(`intents/${addr}.json: ${pi.error.code} at ${pi.error.path}`);
            } else {
              intent = pi.value;
              const enc = encodeIntentV1(intent);
              if (!enc.ok) {
                problems.push(`intents/${addr}.json: encode failed ${enc.error.code}`);
              } else {
                encoded = enc.value;
                const digest = await sha256Hex(encoded);
                if (!digest.ok || digest.value !== n.intent_digest) {
                  problems.push(`${addr}: sha256(intent wire bytes) != record.intent_digest`);
                }
                const diffs = intentMatchesRecord(intent, n);
                for (const d of diffs) problems.push(`${addr}: ${d}`);
              }
            }
          }
        }
        if (wireBytes !== undefined) {
          const wireHash = await sha256Hex(wireBytes);
          if (!wireHash.ok || wireHash.value !== n.intent_digest) {
            problems.push(`${addr}: sha256(.wire) != record.intent_digest`);
          }
          if (encoded !== null && !bytesEqual(encoded, wireBytes)) {
            problems.push(`${addr}: .wire bytes differ from canonical re-encoding`);
          }
        }
        if (intent !== null && encoded !== null) verifiedCount++;
      }
      const parts: string[] = [];
      if (problems.length > 0) parts.push(listPaths(problems));
      if (missing.length > 0) parts.push(`missing: ${listPaths(missing)}`);
      checks.push(
        check(
          'intents.digest',
          problems.length > 0 ? 'fail' : missing.length > 0 ? 'incomplete' : 'pass',
          parts.length === 0
            ? `${verifiedCount} intent(s) re-encode to wire bytes whose sha256 matches record.intent_digest; intent fields match records`
            : parts.join('; '),
        ),
      );
    }

    {
      const problems: string[] = [];
      const missing: string[] = [];
      let verifiedCount = 0;
      for (const n of records.nodes.values()) {
        const addr = n.node_ref.node_address;
        const sigPath = `signatures/${addr}.sig`;
        const sig = contents.files.get(sigPath);
        if (sig === undefined) {
          missing.push(sigPath);
          continue;
        }
        if (sig.length !== 64) {
          problems.push(`${sigPath}: ${sig.length} bytes, expected 64`);
          continue;
        }
        const pub = base58AddressToBytes(n.contributor);
        const digestBytes = hexToBytes(n.intent_digest);
        if (pub === null || digestBytes === null) {
          problems.push(`${addr}: contributor/intent_digest not decodable`);
          continue;
        }
        const valid = await verifyEd25519Detached(pub, sig, digestBytes);
        if (!valid.ok) {
          problems.push(`${addr}: signature check could not run (${valid.error.message})`);
        } else if (!valid.value) {
          problems.push(`${addr}: Ed25519 signature INVALID over intent digest`);
        } else {
          verifiedCount++;
        }
      }
      const parts: string[] = [];
      if (problems.length > 0) parts.push(listPaths(problems));
      if (missing.length > 0) parts.push(`missing: ${listPaths(missing)}`);
      checks.push(
        check(
          'signatures.intent',
          problems.length > 0 ? 'fail' : missing.length > 0 ? 'incomplete' : 'pass',
          parts.length === 0
            ? `${verifiedCount} detached Ed25519 signature(s) verify over intent digests (proves key approval, not chain anchoring)`
            : parts.join('; '),
        ),
      );
    }

    // --------------------------------------------------------------
    // 4. Statements + release anchors.
    // --------------------------------------------------------------
    const anchoredManifestDigests = new Set<string>();
    {
      const problems: string[] = [];
      const incompleteNotes: string[] = [];
      const warnNotes: string[] = [];
      let verifiedCount = 0;
      const statementPaths = [...contents.files.keys()].filter(
        (p) => p.startsWith('statements/') && p.endsWith('.json') && !p.endsWith('.sig.json'),
      );
      for (const path of statementPaths) {
        const base = path.slice('statements/'.length, -'.json'.length);
        const jsonBytes = contents.files.get(path)!;
        const parsed = parseJsonBytes(jsonBytes);
        if (!parsed.ok) {
          problems.push(`${path}: ${parsed.error.code}`);
          continue;
        }
        const st = parseStatementV1(parsed.value, path);
        if (!st.ok) {
          problems.push(`${path}: ${st.error.code} at ${st.error.path}`);
          continue;
        }
        const stmt: StatementV1 = st.value;
        const enc = encodeStatementV1(stmt);
        if (!enc.ok) {
          problems.push(`${path}: encode failed ${enc.error.code}`);
          continue;
        }
        const wireBytes = contents.files.get(`statements/${base}.wire`);
        if (wireBytes === undefined) {
          incompleteNotes.push(`${base}: no .wire — statement digest not recomputable`);
        } else {
          const wireHash = await sha256Hex(wireBytes);
          const encHash = await sha256Hex(enc.value);
          if (!wireHash.ok || !encHash.ok || wireHash.value !== encHash.value || !bytesEqual(wireBytes, enc.value)) {
            problems.push(`${base}: .wire bytes do not match canonical statement encoding`);
          }
        }
        const sigBytes = contents.files.get(`statements/${base}.sig.json`);
        if (sigBytes === undefined) {
          incompleteNotes.push(`${base}: no signature sidecar`);
        } else {
          const sidecar = parseSigSidecar(sigBytes);
          if (sidecar === null) {
            problems.push(`${base}: signature sidecar unparseable`);
          } else {
            const pub = base58AddressToBytes(sidecar.signer);
            const sig = base64ToBytes(sidecar.signature_base64);
            if (pub === null || sig === null || sig.length !== 64) {
              problems.push(`${base}: bad signer/signature encoding`);
            } else {
              const digest = await sha256Hex(wireBytes ?? enc.value);
              if (digest.ok) {
                const digestBytes = hexToBytes(digest.value)!;
                const valid = await verifyEd25519Detached(pub, sig, digestBytes);
                if (!valid.ok) {
                  incompleteNotes.push(`${base}: signature check unavailable (${valid.error.message})`);
                } else if (!valid.value) {
                  problems.push(`${base}: Ed25519 signature INVALID over statement digest`);
                } else {
                  verifiedCount++;
                }
              }
            }
          }
        }
        if (stmt.subject_ref !== null && !records.nodes.has(stmt.subject_ref)) {
          incompleteNotes.push(`${base}: subject_ref ${stmt.subject_ref} not present in bundle`);
        }
        if (stmt.statement_type === 'RELEASE_ANCHOR') {
          anchoredManifestDigests.add(stmt.payload_sha256);
        }
      }
      const parts: string[] = [];
      if (problems.length > 0) parts.push(listPaths(problems));
      if (incompleteNotes.length > 0) parts.push(`incomplete: ${listPaths(incompleteNotes)}`);
      if (warnNotes.length > 0) parts.push(listPaths(warnNotes));
      checks.push(
        check(
          'statements.verify',
          problems.length > 0 ? 'fail' : incompleteNotes.length > 0 ? 'incomplete' : 'pass',
          parts.length === 0
            ? `${statementPaths.length} statement record(s) parsed; ${verifiedCount} signature(s) verified`
            : parts.join('; '),
        ),
      );
    }

    {
      const unanchored: string[] = [];
      let manifestCount = 0;
      for (const f of manifest!.files) {
        if (f.kind !== 'manifest') continue;
        manifestCount++;
        const data = contents.files.get(f.path);
        if (data === undefined) continue;
        const hash = await sha256Hex(data);
        if (hash.ok && !anchoredManifestDigests.has(hash.value)) {
          unanchored.push(f.path);
        }
      }
      checks.push(
        unanchored.length === 0
          ? check('manifests.anchored', 'pass', `${manifestCount} release manifest(s) each bound by a RELEASE_ANCHOR payload_sha256`)
          : check('manifests.anchored', 'warn', `manifest(s) without a matching RELEASE_ANCHOR: ${listPaths(unanchored)}`),
      );
    }

    // --------------------------------------------------------------
    // 5. Content coverage: metadata / terms / artifacts by digest.
    // --------------------------------------------------------------
    const coverage = (
      name: string,
      digests: readonly (string | null)[],
      prefix: string,
      missingNote: string,
    ): EvidenceCheck => {
      const missingD: string[] = [];
      let present = 0;
      for (const d of digests) {
        if (d === null) continue;
        if (contents.files.has(`${prefix}${d}`)) present++;
        else missingD.push(d.slice(0, 12) + '…');
      }
      return missingD.length === 0
        ? check(name, 'pass', `${present} digest(s) resolved to verified content under ${prefix}*`)
        : check(name, 'incomplete', `${missingNote}: ${listPaths(missingD)}`);
    };

    checks.push(
      coverage(
        'metadata.coverage',
        [...records.nodes.values()].map((n) => n.metadata_sha256),
        'metadata/',
        'metadata bytes absent for digest',
      ),
    );
    {
      const termsDigests = [...records.nodes.values()].map((n) => n.terms_sha256);
      if (records.project !== null) termsDigests.push(records.project.terms_sha256);
      checks.push(coverage('terms.coverage', termsDigests, 'terms/', 'terms bytes absent for digest — agreement text not in bundle'));
    }
    checks.push(
      coverage(
        'artifacts.coverage',
        [...records.nodes.values()].map((n) => n.artifact_sha256),
        'artifacts/',
        'artifact bytes absent for digest (may be excluded by license/permission)',
      ),
    );

    {
      const unresolved: string[] = [];
      for (const n of records.nodes.values()) {
        for (const ref of n.references) {
          if (!records.nodes.has(ref)) unresolved.push(`${n.node_ref.node_address}→${ref}`);
        }
      }
      checks.push(
        unresolved.length === 0
          ? check('references.resolve', 'pass', 'all signed references[] resolve to node records in the bundle')
          : check('references.resolve', 'incomplete', `unresolved references: ${listPaths(unresolved)}`),
      );
    }
  }

  // ------------------------------------------------------------------
  // 6. Inherent offline limitations + optional RPC assist.
  // ------------------------------------------------------------------
  if (opts.rpcUrl !== undefined && manifest !== null) {
    const rpcChecks = await rpcAccountChecks(opts.rpcUrl, manifest.selected_leaf, {
      timeoutMs: opts.rpcTimeoutMs ?? 10_000,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    });
    checks.push(...rpcChecks);
    limitations.push('RPC-assisted checks reflect one configured endpoint response — a labeled trust assumption, not independent finality proof.');
  } else {
    checks.push(
      check(
        'chain.finality',
        'warn',
        opts.rpcUrl !== undefined
          ? '--rpc supplied but manifest is not v1; chain check not attempted'
          : "no chain query performed: observed_slot/'finalized' labels inside records are claims, not proof; offline mode cannot establish live Solana finality",
      ),
    );
  }
  checks.push(
    check(
      'identity.rights',
      'warn',
      'Ed25519 verification proves a key approved the signed digest; legal identity, authorship and ownership are NOT independently verified by this bundle',
    ),
  );
  checks.push(
    check(
      'limitations.recorded',
      'pass',
      `${lenient.limitations.length} bundle limitation(s) surfaced verbatim below`,
    ),
  );

  const counts = summarize(checks);
  return {
    verifier: VERIFIER_ID,
    format: manifest !== null ? 'tessera-evidence/1' : 'unknown',
    mode: opts.rpcUrl !== undefined ? 'online-assisted' : 'offline',
    status: rollUpStatus(counts, unsupported),
    selected_leaf: leaf,
    project_address: leaf?.project_address ?? null,
    checks,
    limitations,
    counts,
  };
}
