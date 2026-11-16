import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/',
    'coverage/',
    'test-results/',
    'playwright-report/',
    'fixtures/',
    'docs/',
    'examples/',
    // 試作による検証のスクリプト（Node とブラウザの両方で動くコードを混ぜて書くため）
    'spikes/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
]);
