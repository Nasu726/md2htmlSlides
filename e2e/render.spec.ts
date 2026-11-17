import { codeHighlighter, codeLanguages } from '@mds/cli';
import { buildSlides, parseDeck, renderDeckHtml } from '@mds/core';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('01-plain-document：先頭の H1 がタイトルスライドになり、8枚を 1280×720 で描く', async ({
  page,
}) => {
  const deck = buildSlides(parseDeck(fixture('01-plain-document.md')));
  await page.setContent(renderDeckHtml(deck));
  const slides = page.locator('.mds-slide');
  await expect(slides).toHaveCount(8);
  const boxes = await slides.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  );
  for (const box of boxes) {
    expect(Math.round(box.width)).toBe(1280);
    expect(Math.round(box.height)).toBe(720);
  }
  await expect(slides.first()).toHaveClass(/layout-title/);
  await expect(slides.first().locator('.mds-page')).toHaveCount(0);
  await expect(slides.nth(1).locator('.mds-page')).toHaveText('2 / 8');
});

test('コードブロックが潰れずに表示される', async ({ page }) => {
  const deck = buildSlides(parseDeck('## A\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n'));
  await page.setContent(renderDeckHtml(deck));
  const height = await page.locator('.mds-body pre').evaluate((el) => el.clientHeight);
  expect(height).toBeGreaterThan(40);
});

test('あふれたスライドは文字を小さくして収める', async ({ page }) => {
  // 2段組にならない長さの項目（短い項目が多いリストは2段組になって収まる）
  const items = Array.from({ length: 16 }, (_, i) => `- 長めの説明が入った項目 ${i + 1}`).join(
    '\n',
  );
  const deck = buildSlides(parseDeck(`## 長いリスト\n\n${items}\n`));
  await page.setContent(renderDeckHtml(deck));
  const fit = await page.locator('.mds-slide').getAttribute('data-fit');
  expect(Number(fit)).toBeLessThan(1);
  const overflow = await page
    .locator('.mds-body')
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(overflow).toBe(false);
});

test('画像だけの段落は、空いた領域いっぱいに縦横比を保って広がる', async ({ page }) => {
  // 縦横比は調べる関数から渡すので、画像を読み込まなくても大きさが決まる
  const probe = () => ({ exists: true, width: 1600, height: 900 });
  const deck = buildSlides(parseDeck('## A\n\n本文\n\n![a](a.png "キャプション")'));
  await page.setContent(renderDeckHtml(deck, { probe }));
  const box = await page.locator('.mds-media img').boundingBox();
  const body = await page.locator('.mds-body').boundingBox();
  const caption = await page.locator('.mds-media figcaption').boundingBox();
  if (!box || !body || !caption) throw new Error('要素が見つからない');
  expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  expect(box.height).toBeGreaterThan(body.height * 0.6);
  // キャプションは画像のすぐ下にあり、本文の領域からはみ出さない
  expect(caption.y - (box.y + box.height)).toBeLessThan(20);
  expect(caption.y + caption.height).toBeLessThanOrEqual(body.y + body.height + 1);
});

test('width= の画像は、指定した幅で表示する', async ({ page }) => {
  const probe = () => ({ exists: true, width: 300, height: 100 });
  const deck = buildSlides(parseDeck('## A\n\n![a](a.png){width=50%}'));
  await page.setContent(renderDeckHtml(deck, { probe }));
  const box = await page.locator('.mds-media img').boundingBox();
  const body = await page.locator('.mds-body').boundingBox();
  if (!box || !body) throw new Error('要素が見つからない');
  expect(box.width / body.width).toBeCloseTo(0.5, 2);
  expect(box.width / box.height).toBeCloseTo(3, 1);
});

test('コードに色を付けても、コードの高さは変わらない（#68）', async ({ page }) => {
  const source =
    fixture('02-tech-talk.md') + fixture('04-layouts.md').replace(/^---[\s\S]*?\n---\n/, '');
  const deck = buildSlides(parseDeck(source));
  const highlight = await codeHighlighter(codeLanguages(source));
  const plain = renderDeckHtml(deck, { fit: false });
  const colored = renderDeckHtml(deck, { fit: false, highlight });
  expect(colored).toContain('var(--mds-code-token-keyword)');
  const heights = async (html: string) => {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('.mds-body pre'), (pre) => [
        pre.getBoundingClientRect().width,
        pre.getBoundingClientRect().height,
      ]),
    );
  };
  const before = await heights(plain);
  const after = await heights(colored);
  expect(after.length).toBeGreaterThanOrEqual(4);
  expect(after).toEqual(before);
});
