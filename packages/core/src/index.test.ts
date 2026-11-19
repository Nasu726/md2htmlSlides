import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('core', () => {
  it('バージョンは semver 形式', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('バージョンは、ルートと各パッケージの package.json と同じ（#146）', () => {
    const dirs = [
      '',
      'packages/core/',
      'packages/embeds/',
      'packages/runtime/',
      'packages/themes/',
      'apps/cli/',
      'apps/web/',
    ];
    for (const dir of dirs) {
      const json = readFileSync(new URL(`../../../${dir}package.json`, import.meta.url), 'utf8');
      expect((JSON.parse(json) as { version: string }).version, dir || 'root').toBe(VERSION);
    }
  });

  it('README に書いたバージョンも同じ（タグとリリースは作らない。#152）', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(`バージョン：${VERSION}（`);
  });
});
