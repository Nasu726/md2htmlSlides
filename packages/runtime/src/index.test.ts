import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { RUNTIME_SCRIPT } from './index.js';

describe('RUNTIME_SCRIPT', () => {
  it('gzip で 20KB 以下（docs/design.md §8.5）', () => {
    const size = gzipSync(RUNTIME_SCRIPT).length;
    expect(size).toBeLessThan(20 * 1024);
  });

  it('外側の変数を使わずに、そのまま実行できる形になっている', () => {
    // import した関数や定数を参照していれば、埋め込んだ先で ReferenceError になる
    expect(RUNTIME_SCRIPT).toMatch(/^\(function startPlayer\(doc\) \{/);
    expect(RUNTIME_SCRIPT).toMatch(/\}\)\(document\);$/);
    expect(() => new Function('document', RUNTIME_SCRIPT)).not.toThrow();
  });
});
