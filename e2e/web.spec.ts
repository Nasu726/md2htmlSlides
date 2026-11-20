import { build, buildSingle } from '@mdhs/cli';
import { devices, expect, test, type Page, type Route } from '@playwright/test';
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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

  // 発表：見えているスライドから始める。カーソルを先頭に戻すと、プレビューは1枚目を見せる（#74）
  await page.keyboard.press('Control+Home');
  await expect(preview(page).locator('.mds-slide').first()).toHaveAttribute('data-editing', '');
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

test('?src=URL で開き、ブラウザで測って分割した枚数は mdhs build と同じ（#73）', async ({
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

test('GitHub の画面の URL（blob）でも、raw に読み替えて開き、相対パスの画像も読む（#90）', async ({
  page,
}) => {
  const cors = { 'access-control-allow-origin': '*' };
  // 資料のフォルダの中（img/）と、上のフォルダ（../shared/）の画像
  const md = '# GitHub から開く\n\n![](img/dot.png)\n![](../shared/dot.png)\n';
  const dot = readFileSync(join(fixtures, 'assets/square.png'));
  const seen: string[] = [];
  // GitHub の raw だけを用意する（github.com の画面は CORS を許さないので、読みに行ったら失敗する）
  await page.context().route('https://raw.githubusercontent.com/**', (route) => {
    const url = route.request().url();
    seen.push(url);
    if (url === 'https://raw.githubusercontent.com/o/r/main/docs/slides.md') {
      return route.fulfill({ body: md, contentType: 'text/plain; charset=utf-8', headers: cors });
    }
    if (
      url === 'https://raw.githubusercontent.com/o/r/main/docs/img/dot.png' ||
      url === 'https://raw.githubusercontent.com/o/r/main/shared/dot.png'
    ) {
      return route.fulfill({ body: dot, contentType: 'image/png', headers: cors });
    }
    return route.fulfill({ status: 404, headers: cors });
  });
  await page.goto(
    `${origin}/?src=${encodeURIComponent('https://github.com/o/r/blob/main/docs/slides.md')}`,
  );
  await expect(page.locator('.doc-name')).toHaveText('slides.md');
  await expect(preview(page).locator('.mds-slide .mds-title').first()).toHaveText(
    'GitHub から開く',
  );
  await expect
    .poll(() =>
      preview(page)
        .locator('.mds-slide img')
        .evaluateAll((imgs: HTMLImageElement[]) => imgs.map((img) => img.naturalWidth > 0)),
    )
    .toEqual([true, true]);
  expect(seen).toContain('https://raw.githubusercontent.com/o/r/main/shared/dot.png');

  // 見つからないときは、理由と対処を出す
  await page.goto(
    `${origin}/?src=${encodeURIComponent('https://github.com/o/r/blob/main/missing.md')}`,
  );
  await expect(page.locator('.notice')).toContainText('見つかりませんでした（404）');
  // 読み込めなくても、説明の資料を開いて描く（「描画中…」のまま止まらない）
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
  // フォルダの URL は、md ファイルの URL を入れるよう伝える
  await page.goto(`${origin}/?src=${encodeURIComponent('https://github.com/o/r/tree/main/docs')}`);
  await expect(page.locator('.notice')).toContainText('md ファイルを GitHub で開き');
});

test('明朝体（academic の見出し）は、academic のときだけ読み込む（#93）', async ({ page }) => {
  const cors = { 'access-control-allow-origin': '*' };
  await page.context().route('https://example.test/**', (route) =>
    route.fulfill({
      body: `---\ntheme: ${new URL(route.request().url()).pathname.slice(1, -3)}\n---\n\n## 見出しの書体\n\n本文\n`,
      contentType: 'text/plain; charset=utf-8',
      headers: cors,
    }),
  );
  const fonts: string[] = [];
  page.on('request', (request) => {
    const match = /\/fonts\/([^/]+)\//.exec(new URL(request.url()).pathname);
    if (match) fonts.push(match[1]!);
  });
  for (const theme of ['clean', 'academic']) {
    fonts.length = 0;
    await page.goto(`${origin}/?src=${encodeURIComponent(`https://example.test/${theme}.md`)}`);
    await expect(preview(page).locator('.mds-slide .mds-title').first()).toHaveText('見出しの書体');
    await expect(slideCount(page)).toHaveText('1 枚');
    const family = await preview(page)
      .locator('.mds-slide .mds-title')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    if (theme === 'academic') {
      expect(family).toMatch(/^"MDS Noto Serif JP"/);
      await expect.poll(() => fonts).toContain('noto-serif-jp');
    } else {
      expect(family).toMatch(/^"MDS Inter"/);
      expect(fonts).not.toContain('noto-serif-jp');
    }
  }
});

test('動く構成図：エディタのプレビューでも配置して描き、枚数は mdhs build と同じ（#107）', async ({
  page,
}) => {
  const name = '13-arch.md';
  const cli = await build(join(fixtures, name), {
    outDir: mkdtempSync(join(tmpdir(), 'mds-web-arch-')),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?src=${encodeURIComponent(`${origin}/fixtures/${name}`)}`);
  await expect(slideCount(page)).toHaveText(`${cli.slides} 枚`);
  await expect(preview(page).locator('.mds-arch-svg')).toHaveCount(9);
  await expect(preview(page).locator('.mds-arch-captions').first().locator('li')).toHaveText([
    '注文を送る',
    '在庫を確認して保存する',
    '決済を依頼する',
    '結果を返す',
  ]);
  // 発表でもシナリオを再生する（#108）：→ でパケットが動き、番号の印と説明の強調が残る
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.getByRole('button', { name: '▶ 発表' }).click();
  const show = page.frameLocator('.present-frame');
  const current = show.locator('.mds-slide.is-current');
  await expect(current.locator('.mds-title')).toHaveText('ファイル参照（正常時）');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.className))
    .toBe('present-frame');
  await page.keyboard.press('ArrowRight');
  await expect(current.locator('.arch-packet')).toHaveCount(1);
  await expect(current.locator('.arch-mark')).toHaveCount(2);
  await expect(current.locator('.mds-arch-captions .is-current')).toHaveText('注文を送る');
  await page.keyboard.press('Escape');
});

test('HTML を書き出す：素材を埋め込んだ HTML を1つダウンロードし、ネットワークなしで開ける。枚数と見出しは mdhs build --single と同じ（#121）', async ({
  page,
  browser,
}) => {
  const name = '02-tech-talk.md';
  const cli = await buildSingle(join(fixtures, name), {
    out: join(mkdtempSync(join(tmpdir(), 'mds-web-single-')), 'cli.html'),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?src=${encodeURIComponent(`${origin}/fixtures/${name}`)}`);
  await expect(slideCount(page)).toHaveText(`${cli.slides} 枚`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'HTML を書き出す' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('02-tech-talk.html');
  await expect(page.locator('.notice')).toContainText('素材 4 個を埋め込み');
  const file = join(mkdtempSync(join(tmpdir(), 'mds-web-single-')), 'deck.html');
  await download.saveAs(file);

  // 素材のない別のフォルダで、ネットワークを遮断して開く
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (/^(file|data|blob):/.test(url)) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  const offline = await context.newPage();
  const titles = async (url: string) => {
    await offline.goto(url);
    await offline.evaluate(() => document.fonts.ready);
    return offline
      .locator('.mds-deck > .mds-slide')
      .evaluateAll((els) => els.map((el) => el.querySelector('.mds-title')?.textContent ?? ''));
  };
  const exported = await titles(pathToFileURL(file).href);
  const images = await offline
    .locator('img')
    .evaluateAll((imgs) =>
      imgs.map(
        (img) =>
          (img as HTMLImageElement).src.startsWith('data:') &&
          (img as HTMLImageElement).naturalWidth > 0,
      ),
    );
  expect(images.length).toBeGreaterThan(0);
  expect(images.every(Boolean)).toBe(true);
  const families = await offline.evaluate(() => [
    ...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)),
  ]);
  expect(families).toEqual(expect.arrayContaining(['MDS Inter', 'MDS Noto Sans JP']));
  // 発表できる（→ で次のスライド）
  await offline.keyboard.press('ArrowRight');
  expect(await offline.evaluate(() => location.hash)).toBe('#/2');
  expect(blocked).toEqual([]);
  // CLI の単一 HTML と同じ枚数・見出し
  expect(exported).toEqual(await titles(pathToFileURL(cli.file).href));
  await context.close();
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
  // Mermaid が5つと、小さな動く構成図（#107）
  await expect(preview(page).locator('.mds-diagram.has-ratio')).toHaveCount(6, { timeout: 20_000 });
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
  // 構文エラーは、警告の一覧に行番号付きで出る（mdhs build と同じ 50 行目）
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

/** 長いリストで自動分割される節と、見つからない画像がある資料（#74） */
const SYNC_MD = [
  '---',
  'title: 同期のテスト',
  '---',
  '',
  '## はじめに',
  '',
  '左で書くと、右に出ます。',
  '',
  '## 長いリスト',
  '',
  ...Array.from({ length: 14 }, (_, i) => `- 項目 ${i + 1}：説明の文章`),
  '',
  '## 画像',
  '',
  '![見つからない図](img/nothing.png)',
  '',
  '## まとめ',
  '',
  '- 書くことに集中する',
  '',
].join('\n');

async function openSyncDeck(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), 'mds-web-sync-'));
  const md = join(dir, 'sync.md');
  writeFileSync(md, SYNC_MD);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByTestId('file-input').setInputFiles([md]);
  await expect(page.locator('.doc-name')).toHaveText('sync.md');
}

test('行番号欄に、スライドの番号・自動の区切り・警告を出し、区切りを固定・1枚にまとめられる（#74）', async ({
  page,
}) => {
  await openSyncDeck(page);
  const markers = page.locator('.cm-slide-marker');
  const auto = page.locator('.cm-slide-marker.is-auto');
  await expect(auto).toHaveCount(1);
  await expect(auto).toHaveText(/^自動 \d+$/);
  // 自動の区切りは、長いリストの途中の項目の行（その行の上に点線）
  await expect(page.locator('.cm-line.cm-auto-break')).toHaveText(/^- 項目 \d+：/);
  await expect(page.locator('.cm-lint-marker-warning')).toHaveCount(1);
  const count = await markers.count();

  // 1枚にまとめる：節の見出しに {keep} を付ける
  await auto.click();
  await page.getByRole('menuitem', { name: /1枚にまとめる/ }).click();
  await expect(page.locator('.cm-line', { hasText: '## 長いリスト {keep}' })).toBeVisible();
  await expect(auto).toHaveCount(0);
  await expect(markers).toHaveCount(count - 1);

  // 元に戻して、ここで区切りを固定：自動の区切りの前に --- を入れる
  await page.keyboard.press('Control+z');
  await expect(auto).toHaveCount(1);
  await auto.click();
  await page.getByRole('menuitem', { name: /区切りを固定/ }).click();
  await expect(page.locator('.cm-line', { hasText: /^---$/ }).last()).toBeVisible();
  await expect(auto).toHaveCount(0);
  await expect(markers).toHaveCount(count);
});

test('カーソルのあるスライドをプレビューで示し、スライドをクリックするとその行に移る（#74）', async ({
  page,
}) => {
  await openSyncDeck(page);
  await expect(page.locator('.cm-slide-marker.is-auto')).toHaveCount(1);
  const editing = preview(page).locator('.mds-slide[data-editing]');
  await page.locator('.cm-line', { hasText: '見つからない図' }).click();
  await expect(editing).toHaveCount(1);
  await expect(editing).toContainText('画像');
  await page.locator('.cm-line', { hasText: '左で書くと' }).click();
  await expect(editing).toContainText('はじめに');
  // プレビューの「まとめ」をクリックすると、エディタはその見出しの行に移る
  await preview(page)
    .locator('.mds-slide', { hasText: 'まとめ' })
    .click({ position: { x: 60, y: 60 } });
  await expect(page.locator('.cm-activeLine')).toHaveText('## まとめ');
});

test('打鍵からプレビューに反映されるまでの時間（50枚ほどの資料。#74）', async ({ page }) => {
  const parts = ['---\ntitle: 計測\n---'];
  for (let i = 1; i <= 46; i++) {
    parts.push(`## 節 ${i}`);
    parts.push(
      i % 5 === 0
        ? Array.from({ length: 18 }, (_, k) => `- 長いリストの項目 ${k + 1}`).join('\n')
        : `本文の段落です。${i} 番目の節の内容を説明します。\n\n- 項目 A\n- 項目 B`,
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'mds-web-bench-'));
  const md = join(dir, 'bench.md');
  writeFileSync(md, `${parts.join('\n\n')}\n`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByTestId('file-input').setInputFiles([md]);
  await expect(page.getByTestId('slide-count')).toHaveText(/^5\d 枚$/);
  await page.locator('.cm-line', { hasText: '3 番目の節' }).click();
  await page.keyboard.press('End');
  await page.evaluate(
    () => ((window as unknown as { mdsLatencies: number[] }).mdsLatencies.length = 0),
  );
  for (let i = 0; i < 20; i++) {
    await page.keyboard.type('あ');
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  const latencies = await page.evaluate(() =>
    [...(window as unknown as { mdsLatencies: number[] }).mdsLatencies].sort((a, b) => a - b),
  );
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? Infinity;
  console.log(`latency p95 ${Math.round(p95)} ms (n=${latencies.length})`);
  // 目標は p95 で 50ms（設計プラン §11.1）。CI の機械は遅いので、大きく遅くなっていないことだけを確かめる
  expect(p95).toBeLessThan(200);
});

const TALK_MD = [
  '---',
  'title: CI のビルド時間を 1/10 にした話',
  'theme: dark',
  '---',
  '',
  '::maketitle',
  '',
  '## やったこと',
  '',
  ':::steps',
  '- 影響を受けるパッケージだけをビルドする',
  ':::',
  '',
  '## Before / After {lyout=split}',
  '',
  '文章',
  '',
  '## 結果',
  '',
].join('\n');

async function openTalk(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), 'mds-web-assist-'));
  const md = join(dir, 'talk.md');
  writeFileSync(md, TALK_MD);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByTestId('file-input').setInputFiles([md]);
  await expect(page.locator('.doc-name')).toHaveText('talk.md');
  await expect(page.locator('.cm-slide-marker')).toHaveCount(4);
}

const completions = (page: Page) => page.locator('.cm-tooltip-autocomplete li');
/** 候補を選ぶ（CodeMirror は、候補が出てから 75ms は Enter で選ばない。打ち間違いを防ぐため） */
async function accept(page: Page) {
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
}
const lineWith = (page: Page, text: string) => page.locator('.cm-line', { hasText: text });

test('サジェスト：layout= の値・場所に合う属性・フロントマター・コンテナ（#75）', async ({
  page,
}) => {
  await openTalk(page);
  // layout= の値：説明と、このスライドの今のレイアウト
  await lineWith(page, '## 結果').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' {layout=');
  await expect(page.locator('.cm-tooltip-autocomplete completion-section')).toHaveText(
    /^layout の値・このスライドは今 \w+$/,
  );
  await expect(completions(page).filter({ hasText: 'split' })).toContainText(
    '文章とメディアを左右に',
  );
  await page.keyboard.type('spl');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('split');
  await accept(page);
  await expect(lineWith(page, '## 結果')).toHaveText('## 結果 {layout=split');
  await page.keyboard.type('}');

  // 見出しの { には、スライドに付けるキー（keep）が出て、画像の属性（bg）は出ない
  await page.keyboard.press('Enter');
  await page.keyboard.type('\n## 次 {');
  await expect(completions(page).filter({ hasText: /^keep/ })).toHaveCount(1);
  await expect(completions(page).filter({ hasText: /^bg/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // 画像の直後の { には、bg が出る
  await page.keyboard.type('}\n\n![](a.png){');
  await expect(completions(page).filter({ hasText: /^bg/ })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // 行頭の ::: はコンテナ名。選ぶと閉じる ::: まで入れる
  await page.keyboard.type('}\n\n:::ro');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText(
    '中身を横に並べる',
  );
  await accept(page);
  await expect(lineWith(page, ':::row')).toHaveCount(1);
  await expect(page.locator('.cm-line', { hasText: /^:::$/ })).toHaveCount(2);
});

test('サジェスト：Tab でも候補を入れる。出ていないときの Tab は字下げ（#98）', async ({ page }) => {
  await openTalk(page);
  await lineWith(page, '## 結果').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' {layout=spl');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('split');
  await page.waitForTimeout(150); // 候補が出てから 75ms は選ばない（打ち間違いを防ぐ）
  await page.keyboard.press('Tab');
  await expect(lineWith(page, '## 結果')).toHaveText('## 結果 {layout=split');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  // サジェストがなければ、Tab は字下げ・Shift+Tab は字下げの解除
  await page.keyboard.type('}\n\n- 項目');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(lineWith(page, '- 項目')).toHaveText(/^\s+- 項目$/);
  await page.keyboard.press('Shift+Tab');
  await expect(lineWith(page, '- 項目')).toHaveText('- 項目');
});

test('動く構成図：```arch の中の候補と、書き間違いの警告（#106）', async ({ page }) => {
  await openTalk(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n## 構成図\n\n```arch\nweb Webサーバー [ser');
  // [ の後は、ノードの種類
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('server');
  await accept(page);
  await page.keyboard.type(']\ndb DB [database]\nweb -> ');
  // 矢印の後は、定義したノードの ID
  await expect(completions(page).filter({ hasText: /^db/ })).toHaveCount(1);
  await page.keyboard.type('db\nscenario 例\n  st');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('step');
  await page.keyboard.press('Escape');
  await page.keyboard.type('ep 読む\n    db -> cache\n```');
  // 未定義のノード（cache）を警告する
  await page.getByRole('button', { name: /^警告 \d+ 件$/ }).click();
  await expect(page.locator('.warnings')).toContainText('ノード cache は定義されていません');
});

test('サジェスト：フロントマターのキーを選ぶと、続けて値の候補が出る（#75）', async ({ page }) => {
  await openTalk(page);
  await lineWith(page, 'theme: dark').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('aspe');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('aspect');
  await accept(page);
  // キーを選ぶと、続けて値の候補が出る
  await expect(lineWith(page, 'aspect:')).toHaveText('aspect: ');
  await expect(completions(page)).toHaveCount(3);
  await expect(completions(page).filter({ hasText: '16:9' })).toContainText('既定');
});

test('挿入メニュー（空の行で /）・構文ヒント・修正の候補・早見表（#75）', async ({ page }) => {
  await openTalk(page);
  // 修正の候補：{lyout=split} → 「layout」に直す
  await page.locator('.cm-lint-marker').first().hover();
  await page.getByRole('button', { name: '「layout」に直す' }).click();
  await expect(lineWith(page, '## Before / After')).toHaveText('## Before / After {layout=split}');
  await expect(page.getByRole('button', { name: /警告/ })).toHaveText('警告 0 件');

  // 構文ヒント：:::steps にカーソルを合わせる
  await lineWith(page, ':::steps').hover({ position: { x: 20, y: 5 } });
  await expect(page.locator('.cm-syntax-hint')).toContainText(':::steps — 中身を1つずつ表示する');

  // 挿入メニュー：空の行で / → 「横に並べる」
  await lineWith(page, '## 結果').click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n\n/');
  await expect(page.locator('.cm-tooltip-autocomplete completion-section')).toHaveText('挿入する');
  await accept(page);
  await expect(lineWith(page, ':::row')).toHaveCount(1);

  // 早見表：Ctrl+/ で開き、探して入れる
  await page.keyboard.press('Control+/');
  const sheet = page.getByRole('complementary', { name: '早見表' });
  await expect(sheet).toBeVisible();
  // 役割ごとの分類の見出しの下にまとまる（#99）
  await expect(sheet.locator('h3')).toHaveText([
    'スライドの区切りと構成',
    '並べ方',
    '段階表示',
    '画像・動画',
    '背景',
    '図・数式・コード',
    '発表者ノート',
    '資料全体の設定（フロントマター）',
  ]);
  await sheet
    .getByRole('navigation', { name: '分類' })
    .getByRole('button', { name: '背景' })
    .click();
  await expect(sheet.locator('h3', { hasText: '背景' })).toBeInViewport();
  // 切り替え効果（#110）：スライドの {transition=fade} と、フロントマターの transition:
  await sheet.getByRole('searchbox').fill('切り替え');
  await expect(sheet.locator('h3')).toHaveText([
    'スライドの区切りと構成',
    '資料全体の設定（フロントマター）',
  ]);
  await expect(sheet).toContainText('{transition=fade}');
  await expect(sheet).toContainText('transition:');
  await sheet.getByRole('searchbox').fill('ノート');
  await expect(sheet.locator('h3')).toHaveText(['発表者ノート']);
  await sheet.getByRole('button', { name: '挿入' }).first().click();
  await expect(lineWith(page, ':::notes')).toHaveCount(1);

  // Esc で閉じて、そのまま書ける（#164）
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.keyboard.type('Esc で閉じた');
  await expect(lineWith(page, 'Esc で閉じた')).toHaveCount(1);
  // 検索欄にいるときも閉じる
  await page.keyboard.press('Control+/');
  await sheet.getByRole('searchbox').fill('背景');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  // 補完の候補が出ているときの Esc は、候補だけを閉じる
  await page.keyboard.press('Control+/');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.type('\n\n/');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test.describe('スマホ（#154）', () => {
  // iPhone の大きさとタッチの操作（ブラウザの種類は Chromium のまま）
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('編集とスライドを1回で切り替え、ほかの操作はメニューから。崩れず、フォーカスで拡大しない文字の大きさ', async ({
    page,
  }) => {
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/\d+ 枚/);
    // ツールバーは2段（#157）：1段目に保存、2段目に切り替え・早見表・発表。ページは横にはみ出さない
    expect((await page.locator('.toolbar').boundingBox())!.height).toBeLessThan(100);
    const top = async (name: string) =>
      (await page.getByRole('button', { name, exact: true }).boundingBox())!.y;
    expect(await top('ダウンロード')).toBeLessThan(await top('スライド'));
    expect(await top('? 早見表')).toBe(await top('スライド'));
    expect(await top('▶ 発表')).toBe(await top('スライド'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    // 入力欄の文字は 16px（iOS の Safari は、16px 未満の入力欄にフォーカスすると拡大する）。行番号は隠す
    const fontSize = await page
      .locator('.cm-scroller')
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe('16px');
    await expect(page.locator('.cm-lineNumbers')).toBeHidden();
    await expect(page.locator('.cm-slide-marker').first()).toBeVisible();

    // はじめは編集。「スライド」でプレビューだけにする
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.preview-frame')).toBeHidden();
    await page.getByRole('button', { name: 'スライド', exact: true }).click();
    await expect(page.locator('.preview-frame')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeHidden();
    // スライドを押すと、編集に戻ってその見出しの行に移る
    await preview(page)
      .locator('.mds-slide', { hasText: 'このエディタについて' })
      .click({ position: { x: 20, y: 20 } });
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.cm-activeLine')).toHaveText('## このエディタについて');

    // 開く操作などは「≡」のメニューに
    await expect(page.getByRole('button', { name: 'ファイルを開く' })).toBeHidden();
    await page.getByRole('button', { name: 'メニュー' }).click();
    await expect(page.getByRole('menuitem', { name: 'ファイルを開く' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'HTML を書き出す' }).waitFor();
    await page.getByRole('button', { name: 'メニュー' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    // 早見表はスライドの側に重ね、挿入すると編集に戻る
    await page.getByRole('button', { name: '? 早見表' }).click();
    const sheet = page.getByRole('complementary', { name: '早見表' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: '挿入' }).first().click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeVisible();
  });

  test('キーボードが出たらカーソルを見える位置に動かし、フォーカスが外れたらすぐに高さを戻す（#159）', async ({
    page,
  }) => {
    // ソフトウェアキーボードを真似る：visualViewport の高さを、window.__keyboard の分だけ低くする
    await page.addInitScript(() => {
      const w = window as unknown as { __keyboard: number };
      w.__keyboard = 0;
      const fake = new EventTarget();
      Object.defineProperties(fake, {
        width: { get: () => window.innerWidth },
        height: { get: () => window.innerHeight - w.__keyboard },
        offsetTop: { get: () => 0 },
        offsetLeft: { get: () => 0 },
        scale: { get: () => 1 },
      });
      Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    });
    const keyboard = (height: number) =>
      page.evaluate((h) => {
        (window as unknown as { __keyboard: number }).__keyboard = h;
        window.visualViewport!.dispatchEvent(new Event('resize'));
      }, height);
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/\d+ 枚/);
    const full = await page.evaluate(() => window.innerHeight);
    const appHeight = async () => (await page.locator('.app').boundingBox())!.height;

    // 画面の下のほう（キーボードが出るところ）の行をタップしてから、キーボードが出る
    const line = page.locator('.cm-line', { hasText: '書いている内容は' });
    await line.tap();
    await keyboard(320);
    expect(Math.round(await appHeight())).toBe(full - 320);
    await expect(page.locator('.status')).toBeHidden();
    // カーソルのある行は、キーボードの上（見えている範囲）にある
    await expect
      .poll(async () => (await page.locator('.cm-activeLine').boundingBox())!.y)
      .toBeLessThan(full - 320 - 20);

    // キーボードを閉じる（フォーカスが外れる）：resize を待たずに、すぐ元の高さに戻す
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    expect(Math.round(await appHeight())).toBe(full);
    await expect(page.locator('.status')).toBeVisible();
  });

  test('発表の画面はタップで「一覧」「終える」を出し、「終える」でエディタに戻る（#157）', async ({
    page,
  }) => {
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/\d+ 枚/);
    await page.getByRole('button', { name: '▶ 発表' }).tap();
    const show = page.frameLocator('.present-frame');
    const current = show.locator('.mds-slide.is-current');
    await expect(current).toBeVisible();
    const bar = show.locator('.mds-player-touch');
    await expect(bar).toBeHidden();
    // タップすると出る（数秒で消える）
    await current.tap({ position: { x: 40, y: 40 } });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: '一覧' }).tap();
    await expect(show.locator('.mds-deck')).toHaveClass(/is-overview/);
    await bar.getByRole('button', { name: '一覧' }).tap();
    await expect(show.locator('.mds-deck')).not.toHaveClass(/is-overview/);
    await bar.getByRole('button', { name: '× 終える' }).tap();
    await expect(page.locator('.present')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeVisible();
  });
});

/**
 * GitHub の API を真似る（#147）。ファイルの中身と sha を持ち、sha が違えば保存を断る。
 * 2つの端末（ブラウザのコンテキスト）から、同じリポジトリとして使う
 */
function fakeGitHubApi(initial: Record<string, string | Buffer>) {
  const files = new Map<string, { body: Buffer; sha: string }>();
  let version = 0;
  const put = (path: string, body: string | Buffer) =>
    files.set(path, { body: Buffer.from(body), sha: `sha${++version}` });
  for (const [path, body] of Object.entries(initial)) put(path, body);
  const cors = { 'access-control-allow-origin': '*' };
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        headers: {
          ...cors,
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, PUT',
        },
      });
    }
    if (request.headers()['authorization'] !== 'Bearer test-token') {
      return route.fulfill({ status: 401, headers: cors });
    }
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, json: body, headers: cors });
    if (url.pathname === '/repos/me/slides') return json(200, { default_branch: 'main' });
    if (url.pathname === '/repos/me/slides/git/trees/main') {
      return json(200, {
        tree: [...files].map(([path, f]) => ({ path, type: 'blob', size: f.body.length })),
      });
    }
    const path = decodeURIComponent(url.pathname.replace('/repos/me/slides/contents/', ''));
    const file = files.get(path);
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { content: string; sha?: string };
      if (file && body.sha !== file.sha) return json(409, { message: 'conflict' });
      put(path, Buffer.from(body.content, 'base64'));
      return json(200, { content: { sha: files.get(path)!.sha } });
    }
    if (!file) return json(404, { message: 'Not Found' });
    if (request.headers()['accept'] === 'application/vnd.github.raw') {
      return route.fulfill({ body: file.body, headers: cors });
    }
    return json(200, { content: file.body.toString('base64'), encoding: 'base64', sha: file.sha });
  };
  return { files, put, handler, text: (path: string) => files.get(path)?.body.toString('utf8') };
}

test('GitHub に保存：端末 A で保存した内容を端末 B で開ける。先に保存されていたら上書きせずに知らせる（#147）', async ({
  browser,
}) => {
  const api = fakeGitHubApi({
    'talks/deck.md': '---\ntitle: GitHub の資料\n---\n\n## はじめ\n\n![図](img/sq.png)\n',
    'talks/img/sq.png': readFileSync(join(fixtures, 'assets/square.png')),
    'README.md': '# 資料の置き場',
  });
  /** 端末：GitHub の API は真似たものに向け、トークンを付けたリクエストがどこに行くかを記録する */
  const device = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('https://api.github.com/**', api.handler);
    const page = await context.newPage();
    const hosts = new Set<string>();
    page.on('request', (request) => {
      if (request.headers()['authorization']) hosts.add(new URL(request.url()).host);
    });
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
    return { context, page, hosts };
  };
  const connectAndOpen = async (page: Page) => {
    await page.getByRole('button', { name: 'GitHub' }).click();
    const dialog = page.getByRole('dialog', { name: 'GitHub' });
    await dialog.getByLabel('リポジトリ').fill('https://github.com/me/slides');
    await dialog.getByLabel('トークン').fill('test-token');
    await dialog.getByRole('button', { name: 'つなぐ' }).click();
    // 一覧は .md だけ
    await expect(dialog.getByRole('list', { name: '資料' }).getByRole('button')).toHaveText([
      'README.md',
      'talks/deck.md',
    ]);
    await dialog.getByRole('button', { name: 'talks/deck.md' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.doc-name')).toContainText('talks/deck.md');
  };
  const append = async (page: Page, line: string) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n${line}\n`);
  };

  // 端末 A：つないで開く。相対パスの画像も、リポジトリから読む
  const a = await device();
  await connectAndOpen(a.page);
  await expect(preview(a.page).locator('.mds-slide .mds-title').last()).toHaveText('はじめ');
  await expect
    .poll(() =>
      preview(a.page)
        .locator('.mds-media img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await append(a.page, '- 端末 A で書いた');
  await a.page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(a.page.locator('.notice')).toContainText('GitHub（me/slides）に保存しました');
  await expect(a.page.locator('.dirty')).toHaveCount(0);
  expect(api.text('talks/deck.md')).toContain('- 端末 A で書いた');

  // 端末 B：開くと、端末 A の内容になっている。書いて保存する
  const b = await device();
  await connectAndOpen(b.page);
  await expect(b.page.locator('.cm-content')).toContainText('- 端末 A で書いた');
  await append(b.page, '- 端末 B で書いた');
  await b.page.keyboard.press('Control+s');
  await expect(b.page.locator('.notice')).toContainText('保存しました');
  // 端末 A：B の保存を知らずに保存すると、上書きせずに知らせる。「上書きする」を選ぶと保存する
  await append(a.page, '- 端末 A でもう一度');
  await a.page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(a.page.locator('.notice')).toContainText('ほかの端末で先に保存されています');
  expect(api.text('talks/deck.md')).toContain('- 端末 B で書いた');
  await a.page.getByRole('button', { name: '上書きする' }).click();
  await expect(a.page.locator('.notice')).toContainText('保存しました');
  expect(api.text('talks/deck.md')).toContain('- 端末 A でもう一度');
  expect(api.text('talks/deck.md')).not.toContain('- 端末 B で書いた');

  // 端末 B：開き直すと、GitHub から最新を開く（つなぎはこのブラウザに残っている）
  await b.page.reload();
  await expect(b.page.locator('.cm-content')).toContainText('- 端末 A でもう一度');
  await expect(b.page.locator('.status')).toContainText('GitHub（me/slides）');

  // トークンを付けたリクエストは、api.github.com にだけ行く
  expect([...a.hosts, ...b.hosts].every((host) => host === 'api.github.com')).toBe(true);
  await a.context.close();
  await b.context.close();
});
