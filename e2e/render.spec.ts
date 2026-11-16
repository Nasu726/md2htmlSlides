import { buildSlides, parseDeck, renderDeckHtml } from '@mds/core';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('01-plain-document：8枚のスライドを 1280×720 で描く', async ({ page }) => {
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
  await expect(slides.first()).toHaveClass(/layout-section/);
  await expect(slides.nth(1).locator('.mds-page')).toHaveText('2 / 8');
});

test('コードブロックが潰れずに表示される', async ({ page }) => {
  const deck = buildSlides(parseDeck('## A\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n'));
  await page.setContent(renderDeckHtml(deck));
  const height = await page.locator('.mds-body pre').evaluate((el) => el.clientHeight);
  expect(height).toBeGreaterThan(40);
});

test('あふれたスライドは文字を小さくして収める', async ({ page }) => {
  const items = Array.from({ length: 16 }, (_, i) => `- 項目 ${i + 1}`).join('\n');
  const deck = buildSlides(parseDeck(`## 長いリスト\n\n${items}\n`));
  await page.setContent(renderDeckHtml(deck));
  const fit = await page.locator('.mds-slide').getAttribute('data-fit');
  expect(Number(fit)).toBeLessThan(1);
  const overflow = await page
    .locator('.mds-body')
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(overflow).toBe(false);
});
