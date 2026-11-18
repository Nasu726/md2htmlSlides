import { build, pdf, startDev, type DevServer } from '@mds/cli';
import { expect, test } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));

test('mds build で書き出した HTML を file:// で開くと、素材付きで発表できる', async ({ page }) => {
  const out = test.info().outputPath('dist');
  const result = await build(join(fixtures, '02-tech-talk.md'), { outDir: out, measure: false });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(pathToFileURL(result.index).href);
  await expect(page.locator('.mds-slide.is-current')).toHaveAttribute('data-kind', 'title');
  // ロゴと背景の画像を、書き出し先のフォルダから読めている
  const logo = page.locator('.mds-logo');
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  const photo = page.locator('.mds-slide.is-current .mds-media img');
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => location.hash)).toBe('#/2');
});

test('mds build は計測して自動で分割し、fixtures の目安の枚数に収める', async () => {
  const cases: Array<[string, number, number]> = [
    ['01-plain-document', 12, 17],
    ['03-long-lecture', 30, 40],
    ['04-layouts', 20, 21],
    ['05-overrides', 15, 15],
  ];
  for (const [name, min, max] of cases) {
    const result = await build(join(fixtures, `${name}.md`), {
      outDir: test.info().outputPath(name),
    });
    expect(result.measureError).toBeUndefined();
    expect(result.slides, name).toBeGreaterThanOrEqual(min);
    expect(result.slides, name).toBeLessThanOrEqual(max);
    expect(
      result.diagnostics.filter((d) => d.code === 'slide/overflow'),
      name,
    ).toEqual([]);
  }
});

/** フロントマターの theme を差し替える（なければ足す） */
function withTheme(source: string, theme: string): string {
  if (!source.startsWith('---\n')) return `---\ntheme: ${theme}\n---\n\n${source}`;
  const end = source.indexOf('\n---', 4);
  const front = source.slice(4, end);
  const replaced = /^theme:/m.test(front)
    ? front.replace(/^theme:.*$/m, `theme: ${theme}`)
    : `theme: ${theme}\n${front}`;
  return `---\n${replaced}${source.slice(end)}`;
}

test('どのテーマでも、計測して分割すればあふれない（#66・#93）', async () => {
  test.setTimeout(240_000);
  const root = mkdtempSync(join(tmpdir(), 'mds-theme-'));
  symlinkSync(join(fixtures, 'assets'), join(root, 'assets'));
  for (const theme of ['dark', 'bold', 'band', 'academic', 'pop']) {
    for (const name of ['01-plain-document', '04-layouts']) {
      const md = join(root, `${name}-${theme}.md`);
      writeFileSync(md, withTheme(readFileSync(join(fixtures, `${name}.md`), 'utf8'), theme));
      const result = await build(md, { outDir: join(root, `${name}-${theme}`) });
      const label = `${name}（${theme}）`;
      expect(result.measureError, label).toBeUndefined();
      const html = readFileSync(result.index, 'utf8');
      expect(html, label).toContain(`theme-${theme}`);
      // 明朝体は academic のときだけ埋め込む（#93）
      expect(html.includes("font-family:'MDS Noto Serif JP'"), label).toBe(theme === 'academic');
      expect(
        result.diagnostics.filter((d) => d.code === 'slide/overflow'),
        label,
      ).toEqual([]);
    }
  }
});

test('書き出した HTML は、使う文字だけに絞ったフォントを埋め込み、そのフォントで表示する（#67）', async ({
  page,
}) => {
  const out = mkdtempSync(join(tmpdir(), 'mds-fonts-'));
  const result = await build(join(fixtures, '02-tech-talk.md'), { outDir: out, measure: false });
  expect(result.fontBytes).toBeGreaterThan(50 * 1024);
  expect(result.fontBytes).toBeLessThan(400 * 1024);
  const html = readFileSync(result.index, 'utf8');
  expect(html).toContain("font-family:'MDS Noto Sans JP'");
  expect(html).toContain('data:font/woff2;base64,');
  expect(html).not.toContain('/__mds/fonts/');
  // 9枚目は日本語とコードがあるスライド
  await page.goto(`${pathToFileURL(result.index).href}#/9`);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [
      ...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)),
    ].sort(),
  );
  expect(loaded).toEqual(['MDS Inter', 'MDS JetBrains Mono', 'MDS Noto Sans JP']);
  const family = await page
    .locator('.mds-slide.is-current .mds-title')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/^"MDS Inter", "MDS Noto Sans JP"/);
});

test('mds build は Mermaid を SVG にし、構文エラーは枠と行番号付きの警告にする（#71）', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mds-mermaid-'));
  const result = await build(join(fixtures, '09-embeds.md'), { outDir: out });
  expect(result.measureError).toBeUndefined();
  const html = readFileSync(result.index, 'utf8');
  // フローチャート・シーケンス図・文章と並べる・ファイル参照・とても大きな図
  expect(html.match(/<div class="mds-diagram has-ratio"/g)).toHaveLength(5);
  expect(html.match(/<div class="mds-diagram-error"/g)).toHaveLength(1);
  // 書き出した HTML には Mermaid を含めない（SVG だけ）。配色はテーマ（clean）のアクセント
  expect(html).not.toContain('mermaid.initialize');
  expect(html).toContain('#2563eb');
  const errors = result.diagnostics.filter((d) => d.code === 'diagram/mermaid-error');
  expect(errors.map((d) => d.line)).toEqual([50]);
});

test('mds build は数式を KaTeX で描き、使った書体と文字だけのフォントを埋め込む（#72）', async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'mds-math-'));
  const md = join(dir, 'math.md');
  writeFileSync(
    md,
    [
      '## 数式',
      '',
      '二次方程式 $ax^2 + bx + c = 0$ の解。価格は $10 から $20。',
      '',
      '$$',
      'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
      '$$',
      '',
      '## エラー',
      '',
      '閉じ忘れ $\\frac{1}{2$ です。',
      '',
    ].join('\n'),
  );
  const result = await build(md, { outDir: join(dir, 'dist') });
  const html = readFileSync(result.index, 'utf8');
  // 書き出した HTML には KaTeX の JS を含めない。CSS と、使った書体のフォントだけを入れる
  expect(html).not.toContain('renderToString');
  expect(html).toContain('<div class="mds-math-block"><span class="katex-display">');
  expect(html).toContain('@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:400');
  expect(html).toContain('@font-face{font-family:KaTeX_Math;font-style:italic');
  expect(html).not.toContain('@font-face{font-family:KaTeX_Fraktur');
  // 金額は数式にしない
  expect(html).toContain('価格は $10 から $20。');
  expect(
    result.diagnostics.filter((d) => d.code === 'math/katex-error').map((d) => d.line),
  ).toEqual([11]);

  // 開くと、数式は KaTeX のフォントで描かれる
  await page.goto(pathToFileURL(result.index).href);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(
    () =>
      [...document.fonts].filter((f) => f.family === 'KaTeX_Main' && f.status === 'loaded').length,
  );
  expect(loaded).toBeGreaterThan(0);
  const error = page.locator('.mds-slide code.mds-math-error');
  await expect(error).toHaveText('$\\frac{1}{2$');
  await expect(error).toHaveAttribute('title', /expected '\}'/);
});

/** PDF のページの数（Chromium が書く PDF では、ページごとに /Type /Page がある） */
const pdfPages = (file: string) =>
  (readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

test('mds pdf：1スライド＝1ページ、--steps ではステップごとのページにする（#70）', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mds-pdf-'));
  const final = await pdf(join(fixtures, '06-steps.md'), { out: join(out, 'final.pdf') });
  expect(final.error).toBeUndefined();
  expect(readFileSync(final.file, 'latin1').startsWith('%PDF-')).toBe(true);
  expect(readFileSync(final.file, 'latin1')).toContain('/Type /Font');
  expect(final.pages).toBe(13);
  expect(pdfPages(final.file)).toBe(13);
  const steps = await pdf(join(fixtures, '06-steps.md'), {
    out: join(out, 'steps.pdf'),
    steps: true,
  });
  // コードの行ハイライト（3段 → 2ステップ。#105）を含めて 38 ページ
  expect(steps.pages).toBe(38);
  expect(pdfPages(steps.file)).toBe(38);
});

test('フロントマターの pdf: { steps: each } でも、ステップごとのページにする（#70）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mds-pdf-'));
  const body = '## A\n\n1つ目\n\n. . .\n\n2つ目\n\n. . .\n\n3つ目\n';
  writeFileSync(join(root, 'final.md'), body);
  writeFileSync(join(root, 'each.md'), `---\npdf:\n  steps: each\n---\n\n${body}`);
  const final = await pdf(join(root, 'final.md'), { out: join(root, 'final.pdf'), measure: false });
  const each = await pdf(join(root, 'each.md'), { out: join(root, 'each.pdf'), measure: false });
  expect([pdfPages(final.file), pdfPages(each.file)]).toEqual([1, 3]);
});

test.describe('mds dev', () => {
  let server: DevServer | undefined;
  test.afterEach(async () => {
    await server?.close();
  });

  test('ファイルを保存すると、プレビューが更新される', async ({ page }) => {
    const root = mkdtempSync(join(tmpdir(), 'mds-dev-'));
    cpSync(join(fixtures, '01-plain-document.md'), join(root, 'deck.md'));
    server = await startDev(join(root, 'deck.md'), { port: 0 });
    await page.goto(server.url);
    const second = page.locator('.mds-slide').nth(1).locator('.mds-title');
    const before = await second.textContent();
    const source = readFileSync(join(root, 'deck.md'), 'utf8');
    writeFileSync(join(root, 'deck.md'), source.replace(before!, '保存したら変わった見出し'));
    await expect(second).toHaveText('保存したら変わった見出し');
  });

  test('保存して発表の画面が読み込み直されても、発表者ビューをつなぎ直す（#59）', async ({
    page,
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'mds-dev-'));
    cpSync(join(fixtures, '01-plain-document.md'), join(root, 'deck.md'));
    server = await startDev(join(root, 'deck.md'), { port: 0, measure: false });
    await page.goto(`${server.url}present#/2`);
    const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
    const pageText = presenter.locator('.mds-pv-page');
    await expect(pageText).toHaveText(/^2 \/ \d+$/);
    const total = Number((await pageText.textContent())!.split(' / ')[1]);
    const source = readFileSync(join(root, 'deck.md'), 'utf8');
    writeFileSync(join(root, 'deck.md'), `${source}\n\n## 足したスライド\n\n本文\n`);
    // 読み込み直した発表の画面が、同じ発表者ビューを書き直す
    await expect(pageText).toHaveText(`2 / ${total + 1}`);
    await page.keyboard.press('ArrowRight');
    await expect(pageText).toHaveText(`3 / ${total + 1}`);
    expect(presenter.isClosed()).toBe(false);
  });

  test('プレビューを印刷すると、隠したスライドを除いて1スライド＝1ページになる（#70）', async ({
    page,
  }) => {
    server = await startDev(join(fixtures, '05-overrides.md'), { port: 0, measure: false });
    await page.goto(server.url);
    await page.evaluate(() => document.fonts.ready);
    const [slides, hidden] = await page.evaluate(() => [
      document.querySelectorAll('.mds-slide').length,
      document.querySelectorAll('.mds-slide[data-hidden]').length,
    ]);
    expect(hidden).toBeGreaterThan(0);
    const file = join(mkdtempSync(join(tmpdir(), 'mds-print-')), 'preview.pdf');
    await page.pdf({ path: file, printBackground: true, preferCSSPageSize: true });
    expect(pdfPages(file)).toBe(slides! - hidden!);
  });

  test('同梱したフォントの分割ファイルを /__mds/fonts/ から配る（#67）', async ({
    page,
    request,
  }) => {
    server = await startDev(join(fixtures, '10-japanese.md'), { port: 0, measure: false });
    await page.goto(server.url);
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(
      () => [...document.fonts].filter((f) => f.status === 'loaded').length,
    );
    expect(loaded).toBeGreaterThan(5);
    const url = /url\((\/__mds\/fonts\/[^)]+)\)/.exec(await page.content())![1]!;
    const response = await request.get(new URL(url, server.url).href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('font/woff2');
    const missing = await request.get(
      new URL('/__mds/fonts/@fontsource-variable/x.woff2', server.url).href,
    );
    expect(missing.status()).toBe(404);
    // 数式のフォント（#72）も同じ場所から配る
    const katex = await request.get(
      new URL('/__mds/fonts/katex/KaTeX_Main-Regular.woff2', server.url).href,
    );
    expect(katex.status()).toBe(200);
    expect(
      (await request.get(new URL('/__mds/fonts/katex/x.woff2', server.url).href)).status(),
    ).toBe(404);
  });

  test('プレビューは、スライド1枚がウィンドウに収まる大きさにする（#60）', async ({ page }) => {
    server = await startDev(join(fixtures, '01-plain-document.md'), { port: 0, measure: false });
    const first = page.locator('.mds-slide').first();
    // 半分の幅のウィンドウ：幅に合わせる
    await page.setViewportSize({ width: 960, height: 1000 });
    await page.goto(server.url);
    let box = (await first.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(960 - 48 + 1);
    expect(box.width).toBeGreaterThan(960 - 48 - 30); // スクロールバーの分だけ狭くなる
    expect(box.height / box.width).toBeCloseTo(720 / 1280, 2);
    // 横長のウィンドウ：高さに合わせる
    await page.setViewportSize({ width: 1600, height: 600 });
    // 大きさを変えた後の合わせ直し（resize のイベント）を待つ。変える前の高さ（513px）は、
    // 「600 − 64 以下」をすでに満たすので、それでは待てない
    await expect
      .poll(async () => (await first.boundingBox())!.height)
      .toBeGreaterThan(600 - 64 - 2);
    box = (await first.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(600 - 64 + 1);
  });

  test('S で見えているスライドから発表を始め、Esc でプレビューの同じスライドに戻る（#60）', async ({
    page,
  }) => {
    server = await startDev(join(fixtures, '01-plain-document.md'), { port: 0, measure: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(server.url);
    await page
      .locator('.mds-slide')
      .nth(3)
      .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.keyboard.press('s');
    await page.waitForURL(/\/present#\//);
    const player = () =>
      page.evaluate(() => (window as unknown as { mdsPlayer: { page: number } }).mdsPlayer.page);
    await expect.poll(player).toBe(4);
    await page.keyboard.press('ArrowRight');
    await expect.poll(player).toBe(5);
    // 発表者ビューを開いたまま終えると、発表者ビューも閉じる
    const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
    await expect(presenter.locator('.mds-pv-page')).toHaveText(/^5 \//);
    await page.keyboard.press('Escape');
    await page.waitForURL((url) => url.pathname === '/' && url.hash === '');
    await expect.poll(() => presenter.isClosed()).toBe(true);
    // プレビューでは、5枚目が画面の中央に見えている
    const box = (await page.locator('.mds-slide').nth(4).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(800 + 1);
  });

  test('書き出した HTML には戻る先がないので、Esc で発表は終わらない（#60）', async ({ page }) => {
    const out = mkdtempSync(join(tmpdir(), 'mds-build-'));
    await build(join(fixtures, '01-plain-document.md'), { outDir: out, measure: false });
    await page.goto(`${pathToFileURL(join(out, 'index.html')).href}#/2`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(page.url()).toMatch(/index\.html#\/2$/);
  });
});
