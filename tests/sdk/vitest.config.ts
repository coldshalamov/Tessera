import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against package SOURCE so `pnpm -r test` works without a build.
// `pnpm -r build` + `pnpm typecheck` separately prove the emitted artifact.
export default defineConfig({
  resolve: {
    alias: {
      '@tessera/types': fileURLToPath(
        new URL('../../packages/types/src/index.ts', import.meta.url),
      ),
      '@tessera/math': fileURLToPath(
        new URL('../../packages/math/src/index.ts', import.meta.url),
      ),
      '@tessera/sdk': fileURLToPath(
        new URL('../../packages/sdk/src/index.ts', import.meta.url),
      ),
      '@tessera/relayer': fileURLToPath(
        new URL('../../services/relayer/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
