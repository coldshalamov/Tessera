import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The explorer consumes the packages from SOURCE (same convention as
// tests/*): the published exports point at dist/, but aliasing src keeps the
// app buildable without a packages build step and exercises the exact code
// under version control. Component/model tests live in tests/explorer.
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
});
