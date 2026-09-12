import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run against package SOURCE so `pnpm -r test` works without a
// build. The restore exercise additionally spawns `node` on the BUILT dist
// from a temp dir (see src/restore.test.ts); `pretest` builds it first.
export default defineConfig({
  resolve: {
    alias: {
      '@tessera/types': fileURLToPath(
        new URL('../../packages/types/src/index.ts', import.meta.url),
      ),
      '@tessera/math': fileURLToPath(
        new URL('../../packages/math/src/index.ts', import.meta.url),
      ),
      '@tessera/evidence': fileURLToPath(
        new URL('../../packages/evidence/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
