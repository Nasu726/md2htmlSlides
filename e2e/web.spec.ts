import { build } from '@mds/cli';
import { expect, test, type Page } from '@playwright/test';
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Web エディタ（#73）。ビルドしたアプリ（apps/web/dist）を配り、fixtures/ も `/fixtures/` から配る
 * （`?src=` で開くため）。
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'apps/web/dist');
const fixtures = join(root, 'fixtures');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

let server: Server;
let origin = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const [base, rest] = path.startsWith('/fixtures/')
      ? [fixtures, path.slice('/fixtures/'.length)]
      : [dist, path.slice(1) || 'index.html'];
    const file = normalize(join(base, rest));
    if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const slideCount = (page: Page) => page.getByTestId('slide-count');
const preview = (page: Page) => page.frameLocator('.preview-frame');

test('エディタ：ファイルを開く → 編集するとプレビューが変わる → 発表して Esc で戻る（#73）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);

  // md と画像を一緒に選ぶ（相対パスの画像は、名前で探す）
  await page
    .getByTestId('file-input')
    .setInputFiles(
      [
        '02-tech-talk.md',
        'assets/logo.svg',
        'assets/cover.jpg',
        'assets/square.png',
        'assets/bg-dark.jpg',
      ].map((name) => join(fixtures, name)),
    );
  await expect(page.locator('.doc-name')).toHaveText('02-tech-talk.md');
  await expect(preview(page).locator('.mds-slide .mds-title').first()).toContainText('CI の');
  // 画像は、プレビューの iframe の中で作った URL で表示する
  await expect(preview(page).locator('.mds-bg-media').first()).toHaveAttribute(
    'style',
    /url\('blob:/,
  );
  const before = Number((await slideCount(page).textContent())!.split(' ')[0]);

  // 編集：最後に節を足すと、プレビューにスライドが増える
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n## エディタで足したスライド\n\n- 打鍵するとプレビューが変わる\n');
  await expect(slideCount(page)).toHaveText(`${before + 1} 枚`);
  await expect(preview(page).locator('.mds-slide .mds-title').last()).toHaveText(
    'エディタで足したスライド',
  );
  await expect(page.locator('.dirty')).toBeVisible();
  // 長い資料の最後まで書いても、画面ごと動かない（ツールバーは見えたまま）
  expect((await page.locator('.toolbar').boundingBox())?.y).toBe(0);

  // 発表：見えているスライド（1枚目）から始め、→ で進み、Esc で戻る
  await page.getByRole('button', { name: '▶ 発表' }).click();
  const show = page.frameLocator('.present-frame');
  await expect(show.locator('.mds-slide.is-current')).toHaveAttribute('data-kind', 'title');
  // キーは、フォーカスが発表の画面に移ってから押す
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.className))
    .toBe('present-frame');
  await page.keyboard.press('ArrowRight');
  await expect(show.locator('.mds-slide.is-current .mds-title')).toHaveText('自己紹介');
  await page.keyboard.press('Escape');
  await expect(page.locator('.present')).toHaveCount(0);
});

test('?src=URL で開き、ブラウザで測って分割した枚数は mds build と同じ（#73）', async ({
  page,
}) => {
  const name = '03-long-lecture.md';
  const cli = await build(join(fixtures, name), {
    outDir: mkdtempSync(join(tmpdir(), 'mds-web-')),
  });
  const expected = readFileSync(cli.index, 'utf8').match(/<section class="mds-slide/g)!.length;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?src=${encodeURIComponent(`${origin}/fixtures/${name}`)}`);
  await expect(page.locator('.doc-name')).toHaveText(name);
  await expect(slideCount(page)).toHaveText(`${expected} 枚`);
});

test('書いている内容は下書きとして保存され、開き直すと戻る（#73）', async ({ page }) => {
  await page.goto(origin);
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n## 下書きのスライド\n');
  await expect(preview(page).locator('.mds-slide .mds-title').last()).toHaveText(
    '下書きのスライド',
  );
  await page.waitForTimeout(800); // 自動保存（400ms 後）を待つ
  await page.reload();
  await expect(page.locator('.notice')).toContainText('前回の下書き');
  // エディタは見えている行しか描かないので、プレビューで確かめる
  await expect(preview(page).locator('.mds-slide .mds-title').last()).toHaveText(
    '下書きのスライド',
  );
});

test('一度開けば、オフラインでも開いて描ける（Service Worker。#73）', async ({ page, context }) => {
  await page.goto(origin);
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Service Worker が画面を受け持つまで、もう一度開く
  await page.reload();
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
  await expect(preview(page).locator('.mds-slide').first()).toBeVisible();
  await context.setOffline(false);
});

test('フォルダを開くと、一覧から資料を選べ、相対パスの画像を表示し、その場で保存できる（#73）', async ({
  page,
}) => {
  // フォルダを選ぶ画面は自動では操作できないので、ブラウザの中のファイル置き場（OPFS）のフォルダを返す
  const png = readFileSync(join(fixtures, 'assets/square.png')).toString('base64');
  await page.addInitScript((image: string) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('deck', { create: true });
      const write = async (folder: FileSystemDirectoryHandle, name: string, data: BlobPart) => {
        const file = await folder.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(data);
        await writable.close();
      };
      await write(dir, 'slides.md', '## 写真\n\n文章\n\n![写真](img/photo.png)\n');
      await write(dir, 'notes.md', '## メモ\n\n- 1\n');
      const img = await dir.getDirectoryHandle('img', { create: true });
      await write(
        img,
        'photo.png',
        Uint8Array.from(atob(image), (c) => c.charCodeAt(0)),
      );
      return dir;
    };
  }, png);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByRole('button', { name: 'フォルダを開く' }).click();
  await expect(page.locator('.files li')).toHaveText(['notes.md', 'slides.md']);
  await page.locator('.files').getByRole('button', { name: 'slides.md' }).click();
  await expect(page.locator('.doc-name')).toHaveText('slides.md');
  await expect(preview(page).locator('.mds-slide img')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      preview(page)
        .locator('.mds-slide img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1000);

  // 編集して Ctrl+S：フォルダのファイルに書き込む
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n## 保存したスライド\n');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.notice')).toContainText('保存しました');
  await expect(page.locator('.dirty')).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('deck');
    return (await (await dir.getFileHandle('slides.md')).getFile()).text();
  });
  expect(saved).toContain('## 保存したスライド');
});

test('プレビューでも、コードの色分け・数式・Mermaid を書き出しと同じように描く（#84）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page
    .getByTestId('file-input')
    .setInputFiles(['09-embeds.md', 'assets/flow.mmd'].map((name) => join(fixtures, name)));
  await expect(page.locator('.doc-name')).toHaveText('09-embeds.md');
  // フローチャート・シーケンス図・文章と並べる・ファイル参照・とても大きな図。構文エラーは枠
  await expect(preview(page).locator('.mds-diagram.has-ratio')).toHaveCount(5, { timeout: 20_000 });
  await expect(preview(page).locator('.mds-diagram-error')).toHaveCount(1);
  await expect(preview(page).locator('.mds-slide .katex').first()).toBeVisible();
  await expect(preview(page).locator('pre code span[style]').first()).toBeVisible();
  // 数式は KaTeX のフォントで描く
  await expect
    .poll(() =>
      preview(page)
        .locator('body')
        .evaluate(() =>
          [...document.fonts].some((f) => f.family === 'KaTeX_Main' && f.status === 'loaded'),
        ),
    )
    .toBe(true);
  // 構文エラーは、警告の一覧に行番号付きで出る（mds build と同じ 50 行目）
  await page.getByRole('button', { name: /警告/ }).click();
  const warning = page.locator('.warnings li').first();
  await expect(warning).toContainText('50 行');
  await expect(warning).toContainText('Mermaid の図を描けません');
});

test('Mermaid を書いている途中で構文エラーになっても、最後に描けた図を出したままにする（#84）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  const dir = mkdtempSync(join(tmpdir(), 'mds-web-mermaid-'));
  const md = join(dir, 'flow.md');
  writeFileSync(md, '## 図\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
  await page.getByTestId('file-input').setInputFiles([md]);
  const svg = preview(page).locator('.mds-diagram svg');
  await expect(svg).toHaveCount(1, { timeout: 20_000 });
  await expect(svg).toContainText('B');
  // 「A --> B」の後ろに「 -->」だけを足す（書きかけで、構文エラーになる）
  await page.locator('.cm-line', { hasText: 'A --> B' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' -->');
  await expect(page.getByRole('button', { name: /警告/ })).toHaveText('警告 1 件');
  await expect(svg).toHaveCount(1);
  await expect(preview(page).locator('.mds-diagram-error')).toHaveCount(0);
  // 書き終えると、新しい図になる
  await page.keyboard.type(' C');
  await expect(svg).toContainText('C');
  await expect(page.getByRole('button', { name: /警告/ })).toHaveText('警告 0 件');
});
