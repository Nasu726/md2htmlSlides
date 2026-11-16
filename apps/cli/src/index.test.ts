import { VERSION } from '@mds/core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from './build.js';
import { startDev, type DevServer } from './dev.js';
import { HELP, main, run } from './index.js';

const png = readFileSync(new URL('../../../fixtures/assets/square.png', import.meta.url));

/** 一時フォルダに資料と素材を置く。 */
function project(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mds-cli-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function capture() {
  const io = { stdout: '', stderr: '' };
  return {
    io,
    sink: { out: (t: string) => void (io.stdout += t), err: (t: string) => void (io.stderr += t) },
  };
}

describe('mds', () => {
  it('--version でバージョンを表示する', () => {
    expect(run(['--version'])).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
  });

  it('引数がなければヘルプを表示する', () => {
    expect(run([])).toEqual({ code: 0, stdout: HELP, stderr: '' });
  });

  it('不明なコマンドは終了コード 1 でヘルプを添える', () => {
    const result = run(['publish']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('不明なコマンド: publish');
    expect(result.stderr).toContain('使い方:');
  });

  it('ファイルを指定しない・見つからないときは終了コード 1', async () => {
    const a = capture();
    expect(await main(['build'], a.sink)).toBe(1);
    expect(a.io.stderr).toContain('Markdown のファイルを指定してください');
    const b = capture();
    expect(await main(['build', 'nothing.md'], b.sink)).toBe(1);
    expect(b.io.stderr).toContain('ファイルが見つかりません: nothing.md');
  });
});

describe('mds build', () => {
  it('HTML と runtime と素材を書き出し、フォルダの外の素材は _external に置く', async () => {
    const root = project({
      'deck/slides.md': '## A\n\n![図](./img/a.png)\n\n## B\n\n![外](../shared/b.png)\n',
      'deck/img/a.png': png,
      'shared/b.png': png,
    });
    const out = join(root, 'dist');
    const result = await build(join(root, 'deck/slides.md'), { outDir: out, measure: false });
    expect(result.slides).toBe(2);
    expect(result.assets).toBe(2);
    expect(result.diagnostics).toEqual([]);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).toContain('<img src="img/a.png" alt="図" class="has-ratio"');
    const external = /<img src="(_external\/[0-9a-f]{8}\/b\.png)"/.exec(html)?.[1];
    expect(external).toBeDefined();
    expect(existsSync(join(out, 'img/a.png'))).toBe(true);
    expect(existsSync(join(out, external!))).toBe(true);
    // 発表用の runtime を埋め込んでいる
    expect(html).toContain('function startPlayer(doc)');
  });

  it('見つからない素材と CSS を、行番号付きで警告する', async () => {
    const root = project({
      'slides.md': '---\ntitle: T\ncss: ./style.css\n---\n\n## A\n\n![なし](./none.png)\n',
    });
    const a = capture();
    const code = await main(
      ['build', join(root, 'slides.md'), '-o', join(root, 'out'), '--no-measure'],
      a.sink,
    );
    expect(code).toBe(0);
    expect(a.io.stderr).toContain(
      'slides.md:3  warning  CSS ファイルが見つかりません：./style.css  [frontmatter/css-not-found]',
    );
    expect(a.io.stderr).toContain(
      'slides.md:8  warning  ファイルが見つかりません：./none.png  [media/not-found]',
    );
    expect(a.io.stdout).toMatch(/✓ .*index\.html（2 枚、素材 0 個、[\d.]+ 秒）/);
  });

  it('css: のファイルをデッキの中だけに効かせて埋め込む', async () => {
    const root = project({
      'slides.md': '---\ncss: style.css\n---\n\n## A\n\n本文\n',
      'style.css': '.mds-title { color: red; }',
    });
    await build(join(root, 'slides.md'), { outDir: join(root, 'out'), measure: false });
    const html = readFileSync(join(root, 'out/index.html'), 'utf8');
    expect(html).toContain('@scope (.mds-deck) {\n.mds-title { color: red; }\n}');
  });
});

describe('mds dev', () => {
  let server: DevServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('プレビュー・発表の画面・素材を返し、フォルダの外は返さない', async () => {
    const root = project({ 'slides.md': '## はじめに\n\n![図](a.png)\n', 'a.png': png });
    server = await startDev(join(root, 'slides.md'), { port: 0 });
    const preview = await (await fetch(server.url)).text();
    expect(preview).toContain('<h2 class="mds-title">はじめに</h2>');
    expect(preview).toContain("new EventSource('/__mds/events')");
    const present = await (await fetch(`${server.url}present`)).text();
    expect(present).toContain('function startPlayer(doc)');
    const image = await fetch(`${server.url}a.png`);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${server.url}..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });

  it('資料を保存すると、読み込み直しを知らせる', async () => {
    const root = project({ 'slides.md': '## 前\n\n本文\n' });
    server = await startDev(join(root, 'slides.md'), { port: 0 });
    const response = await fetch(`${server.url}__mds/events`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const waitFor = async (text: string) => {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error('接続が切れた');
        received += decoder.decode(value);
      }
    };
    await waitFor(': connected');
    writeFileSync(join(root, 'slides.md'), '## 後\n\n本文\n');
    await waitFor('event: reload');
    await reader.cancel();
    const html = await (await fetch(server.url)).text();
    expect(html).toContain('<h2 class="mds-title">後</h2>');
    expect(server.version).toBeGreaterThanOrEqual(2);
  });

  it('警告があれば、プレビューの右下に一覧を出す', async () => {
    const root = project({ 'slides.md': '## A\n\n![](a.png)\n', 'a.png': png });
    server = await startDev(join(root, 'slides.md'), { port: 0 });
    const html = await (await fetch(server.url)).text();
    expect(html).toContain('<aside class="mds-dev-panel" role="status"><p>警告 1 件</p>');
    expect(html).toContain('slides.md:3</b> 代替テキストがありません');
  });
});
