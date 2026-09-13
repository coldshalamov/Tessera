import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Tests run against package AND app SOURCE (same convention as tests/*):
// no build step is required and the code under version control is what runs.
export default defineConfig({
  plugins: [react()],
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
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/setup.ts'],
    testTimeout: 60_000,
  },
});
