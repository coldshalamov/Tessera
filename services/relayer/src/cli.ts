#!/usr/bin/env node
import { AuditLog } from './audit.js';
import { loadRelayerConfig } from './config.js';
import { OutboxStore } from './outbox.js';
import { createRelayerServer } from './server.js';
import { RelayerService } from './service.js';

/**
 * tessera-relayer — bounded sponsor service entrypoint.
 *
 *   tessera-relayer serve    start the HTTP adapter
 *   tessera-relayer status   print caps/spend/outbox state (no serve)
 *
 * Configuration is entirely env-driven; see src/config.ts. The sponsor
 * keypair is referenced, never embedded:
 *   TESSERA_SPONSOR_KEYPAIR_FILE=/path/sponsor.json   (outside the repo)
 *   or TESSERA_SPONSOR_KEYPAIR_JSON=<json bytes>
 */

async function main(): Promise<number> {
  const cmd = process.argv[2] ?? 'serve';
  const cfg = loadRelayerConfig(process.env);
  if (!cfg.ok) {
    process.stderr.write(`config error: ${cfg.error.code} ${cfg.error.message}\n`);
    return 2;
  }
  const outboxR = OutboxStore.load(cfg.value.outboxPath);
  if (!outboxR.ok) {
    process.stderr.write(`outbox error: ${outboxR.error.code} ${outboxR.error.message}\n`);
    return 2;
  }
  const audit = new AuditLog(cfg.value.auditPath);
  const svc = await RelayerService.create({ cfg: cfg.value, outbox: outboxR.value, audit });
  if (!svc.ok) {
    process.stderr.write(`startup error: ${svc.error.code} ${svc.error.message}\n`);
    return 2;
  }
  const service = svc.value;

  if (cmd === 'status') {
    const status = await service.status();
    process.stdout.write(`${JSON.stringify({ ok: true, value: status }, null, 2)}\n`);
    return 0;
  }
  if (cmd !== 'serve') {
    process.stderr.write(`unknown command ${cmd} (serve|status)\n`);
    return 2;
  }

  const server = createRelayerServer(service);
  server.listen(cfg.value.listenPort, cfg.value.listenHost, () => {
    process.stdout.write(
      `tessera-relayer listening on http://${cfg.value.listenHost}:${cfg.value.listenPort} ` +
        `(mode=${cfg.value.mode} sponsor=${service.sponsorPubkey} paused=${service.paused()})\n`,
    );
  });
  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`fatal: ${e instanceof Error ? e.message : 'startup failure'}\n`);
    process.exit(1);
  },
);
