import { VERSION } from '@mds/core';
import { describe, expect, it } from 'vitest';
import { HELP, run } from './index.js';

describe('mds', () => {
  it('--version でバージョンを表示する', () => {
    expect(run(['--version'])).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
  });

  it('引数がなければヘルプを表示する', () => {
    expect(run([])).toEqual({ code: 0, stdout: HELP, stderr: '' });
  });

  it('まだ実装していないコマンドは終了コード 1', () => {
    const result = run(['build', 'deck.md']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('まだ実装されていません');
  });

  it('不明なコマンドは終了コード 1 でヘルプを添える', () => {
    const result = run(['publish']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('不明なコマンド: publish');
    expect(result.stderr).toContain('使い方:');
  });
});
