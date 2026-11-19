import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // テストではビルドせずに、各パッケージのソースを直接読む
    alias: {
      '@mdhs/core': src('./packages/core/src/index.ts'),
      '@mdhs/embeds/highlight': src('./packages/embeds/src/highlight.ts'),
      '@mdhs/embeds': src('./packages/embeds/src/index.ts'),
      '@mdhs/runtime': src('./packages/runtime/src/index.ts'),
      '@mdhs/themes': src('./packages/themes/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
