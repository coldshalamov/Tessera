import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { PortError, PortResult } from '@tessera/types';
import type { RelayerService } from './service.js';

/**
 * Minimal dependency-free HTTP adapter over RelayerService.
 *
 *   GET  /healthz                       → liveness (no chain dependency)
 *   GET  /v1/relayer/status             → caps, pause state, outbox counts
 *   POST /v1/contributions/prepare      → {intent, consent_signature_base64, idempotency_key}
 *   POST /v1/contributions/submit       → {idempotency_key, tx_signatures}
 *   GET  /v1/submissions/:key           → submission state (key = idempotency
 *                                          key or intent digest)
 *
 * Request bodies are capped at 64 KiB; responses are always
 * { ok, value } | { ok, error:{code,message} } — the contract PortResult
 * shape, so callers get structured errors instead of HTTP-500 soup.
 */

const MAX_BODY = 64 * 1024;

const STATUS_FOR_ERROR: Record<string, number> = {
  INVALID_INTENT: 400,
  INVALID_SIGNATURE: 403,
  INSTRUCTION_REJECTED: 403,
  AUTH_REQUIRED: 403,
  NONCE_REUSE_MISMATCH: 409,
  PARENT_STATE_CONFLICT: 409,
  EVIDENCE_ROOT_MISMATCH: 409,
  NOT_FOUND: 404,
  NODE_NOT_FOUND: 404,
  TRANSACTION_EXPIRED: 410,
  SPONSOR_PAUSED: 423,
  SPONSOR_BUDGET_EXHAUSTED: 429,
  RPC_UNREACHABLE: 502,
  TRANSACTION_FAILED: 502,
  TIMEOUT_AMBIGUOUS: 504,
};

function errorStatus(code: string): number {
  return STATUS_FOR_ERROR[code] ?? 400;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

function sendResult<T>(res: ServerResponse, r: PortResult<T>): void {
  if (r.ok) {
    send(res, 200, { ok: true, value: r.value });
  } else {
    send(res, errorStatus(r.error.code), { ok: false, error: { code: r.error.code, message: r.error.message } });
  }
}

async function readBody(req: IncomingMessage): Promise<PortResult<unknown>> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolvePromise({
          ok: false,
          error: { code: 'INVALID_INTENT', message: `request body exceeds ${MAX_BODY} bytes` } as PortError,
        });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolvePromise({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolvePromise({
          ok: false,
          error: { code: 'INVALID_INTENT', message: 'request body is not valid JSON' } as PortError,
        });
      }
    });
    req.on('error', () => {
      resolvePromise({
        ok: false,
        error: { code: 'INVALID_INTENT', message: 'request read failed' } as PortError,
      });
    });
  });
}

export function createRelayerServer(service: RelayerService): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (req.method === 'GET' && path === '/healthz') {
        send(res, 200, { ok: true, value: { paused: service.paused() } });
        return;
      }
      if (req.method === 'GET' && path === '/v1/relayer/status') {
        sendResult(res, { ok: true, value: await service.status() });
        return;
      }
      if (req.method === 'POST' && path === '/v1/contributions/prepare') {
        const body = await readBody(req);
        if (!body.ok) return sendResult(res, body);
        sendResult(res, await service.prepare(body.value as Parameters<RelayerService['prepare']>[0]));
        return;
      }
      if (req.method === 'POST' && path === '/v1/contributions/submit') {
        const body = await readBody(req);
        if (!body.ok) return sendResult(res, body);
        sendResult(res, await service.submit(body.value as Parameters<RelayerService['submit']>[0]));
        return;
      }
      const subMatch = /^\/v1\/submissions\/([A-Za-z0-9_-]{1,128})$/.exec(path);
      if (req.method === 'GET' && subMatch) {
        sendResult(res, await service.submission(subMatch[1]!));
        return;
      }
      send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `no route ${req.method} ${path}` } });
    } catch (e) {
      // Never leak internals; the audit log has the structured trail.
      send(res, 500, {
        ok: false,
        error: { code: 'INTERNAL_INVARIANT', message: 'relayer internal error' },
      });
      void e;
    }
  });
}
