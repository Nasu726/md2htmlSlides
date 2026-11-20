/** Web エディタ（#73）：開く・編集・プレビュー・下書き・オフライン・フォルダ・図と数式 */
import { build } from '@mdhs/cli';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures, preview, serveEditor, slideCount } from './editor-server.js';

let origin = '';
serveEditor((value) => (origin = value));

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
  await expect(preview(page).locator('.mds-arch-svg')).toHaveCount(16);
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
