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

test('収まらないタイトルスライドは、文字とロゴを小さくして収める（#131）', async ({ page }) => {
  // bold の大きな見出しで、著者が多く、右半分が背景のタイトル（fixtures/08 の bold で上が切れていた）
  const authors = Array.from(
    { length: 6 },
    (_, i) => `  - name: 著者 ${i + 1}\n    affiliation: 所属 ${i + 1} の長い名前の研究室`,
  ).join('\n');
  const markdown = [
    '---',
    'title: とても長いタイトルが三行にわたって続くスライドの見本',
    'subtitle: 副題も二行になるくらいの長さにしておく',
    `author:\n${authors}`,
    'date: 2026-12-05',
    'event: 研究会',
    'theme: bold',
    '---',
    '',
    ':::maketitle {variant=left}',
    '![](cover.jpg){bg=right}',
    '',
    '補足の一行目',
    '',
    '補足の二行目',
    ':::',
  ].join('\n');
  await page.setContent(renderDeckHtml(buildSlides(parseDeck(markdown))));
  const slide = page.locator('.mds-slide').first();
  const fit = await slide.getAttribute('data-fit');
  expect(fit).not.toBeNull();
  expect(Number(fit)).toBeLessThan(1);
  const inside = await slide.evaluate((el) => {
    const s = el.getBoundingClientRect();
    const b = el.querySelector('.mds-titleblock')!.getBoundingClientRect();
    return b.top >= s.top && b.bottom <= s.bottom;
  });
  expect(inside).toBe(true);
  await expect(slide).not.toHaveAttribute('data-overflow');
});

test('bold・pop の章の名前とイベント名は、地とのコントラストが 4.5 以上（#131）', async ({
  page,
}) => {
  for (const theme of ['bold', 'pop']) {
    // H1 が1つだけだと資料のタイトルとみなすので章を2つ、本文が短いと statement になるのでリストにする
    const markdown = `---\ntitle: T\nevent: 勉強会\ntheme: ${theme}\n---\n\n# 章1\n\n## 節1\n\n- 項目 A\n- 項目 B\n- 項目 C\n\n# 章2\n\n## 節2\n\n- 項目 D\n- 項目 E\n- 項目 F\n`;
    await page.setContent(renderDeckHtml(buildSlides(parseDeck(markdown))));
    const ratios = await page.evaluate(() => {
      const rgb = (c: string) => {
        const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(c);
        if (srgb) return [1, 2, 3].map((i) => Number(srgb[i]) * 255);
        return (/rgba?\(([^)]+)\)/.exec(c)?.[1] ?? '')
          .split(/[\s,]+/)
          .map(Number)
          .slice(0, 3);
      };
      const lum = (c: string) => {
        const [r, g, b] = rgb(c).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      // 地：要素に地の色があればそれ（pop の丸い札）、なければスライド
      const ground = (el: Element) =>
        getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'
          ? el.closest('.mds-slide')!
          : el;
      const ratio = (el: Element) => {
        const [a, b] = [
          lum(getComputedStyle(el).color),
          lum(getComputedStyle(ground(el)).backgroundColor),
        ].sort((x, y) => y - x);
        return (a! + 0.05) / (b! + 0.05);
      };
      return ['.mds-chapter', '.mds-event'].map((s) => ratio(document.querySelector(s)!));
    });
    for (const r of ratios) expect(r, theme).toBeGreaterThanOrEqual(4.5);
  }
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
