import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // テストではビルドせずに、各パッケージのソースを直接読む
    alias: {
      '@mds/core': src('./packages/core/src/index.ts'),
      '@mds/runtime': src('./packages/runtime/src/index.ts'),
      '@mds/themes': src('./packages/themes/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
