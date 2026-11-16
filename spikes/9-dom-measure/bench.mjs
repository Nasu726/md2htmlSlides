// S1：DOM での計測が十分に速く、結果が安定しているか確かめる（issue #9）
//
// fixtures/03-long-lecture.md のブロックを core で HTML にし、ヘッドレス Chromium で高さを一括で計測する。
// 使い方: pnpm build && node spikes/9-dom-measure/bench.mjs [出力フォルダ]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const core = await import(pathToFileURL(`${repo}packages/core/dist/index.js`).href);
const themes = await import(pathToFileURL(`${repo}packages/themes/dist/index.js`).href);
const out = process.argv[2] ?? fileURLToPath(new URL('./result/', import.meta.url));
mkdirSync(out, { recursive: true });

// 1. ブロックを集める（コンテナは中身ごと1ブロック）
const deck = core.parseDeck(readFileSync(`${repo}fixtures/03-long-lecture.md`, 'utf8'));
const slides = core.buildSlides(deck);
const blocks = slides.slides.flatMap((slide) =>
  slide.blocks
    .map((block) => core.renderBlocks([block], slides.slideLevel))
    .filter((html) => html.trim() !== ''),
);
console.log(`03-long-lecture のブロック: ${blocks.length} 個`);
const take = (n) => Array.from({ length: n }, (_, i) => blocks[i % blocks.length]);

// 2. 計測用のページ：本番と同じ CSS・同じ本文の幅（1280 − 左右 80px = 1120px）
const fontFile = '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf';
const page = (fontFace) => `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<style>${core.BASE_CSS}${themes.themeCss('clean')}
${
  fontFace
    ? `@font-face { font-family: 'MdsWeb'; src: url('file://${fontFile}'); font-display: swap; }
/* 読み込み前は、字幅の違う別の日本語フォント（WenQuanYi Zen Hei）で描かれる */
.theme-clean { --mds-font-body: 'MdsWeb', 'WenQuanYi Zen Hei', sans-serif; }`
    : ''
}
/* スライドの外に置くので、.mds-slide と同じ文字の指定をここでも行う */
.mds-measure { width: 1120px; font-family: var(--mds-font-body); font-size: var(--mds-fs-body); line-height: 1.55; line-break: strict; overflow-wrap: anywhere; }
</style></head><body><main class="mds-deck theme-clean" style="--mds-w:1280px;--mds-h:720px">
<div class="mds-body mds-measure" id="m"></div></main></body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const tab = await ctx.newPage();
await tab.setContent(page(false));
await tab.evaluate(() => document.fonts.ready);

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1] };
};

// 一括計測：書き込み（HTML の差し替え・幅の変更）をすべて済ませてから、高さをまとめて読む
const measureInPage = (args) =>
  tab.evaluate(({ html, widths, runs }) => {
    const el = document.getElementById('m');
    const read = () => Array.from(el.children, (c) => c.getBoundingClientRect().height);
    const result = { insert: [], relayout: {}, heights: null };
    for (let r = 0; r < runs; r++) {
      el.innerHTML = '';
      el.getBoundingClientRect();
      const t0 = performance.now();
      el.innerHTML = html.join('');
      const h = read();
      result.insert.push(performance.now() - t0);
      result.heights = h;
    }
    for (const w of widths) {
      result.relayout[w] = [];
      for (let r = 0; r < runs; r++) {
        el.style.width = `${w + (r % 2)}px`; // 毎回レイアウトをやり直させる
        const t0 = performance.now();
        read();
        result.relayout[w].push(performance.now() - t0);
      }
    }
    el.style.width = '';
    return result;
  }, args);

const sizes = [50, 100, 200, 400];
const widths = [1120, 672, 560, 448, 373]; // 全幅・3/5・1/2・2/5・1/3
const runs = 40;
const bySize = {};
for (const n of sizes) {
  const r = await measureInPage({ html: take(n), widths: n === 200 ? widths : [], runs });
  bySize[n] = {
    insert: stats(r.insert),
    relayout: Object.fromEntries(Object.entries(r.relayout).map(([w, xs]) => [w, stats(xs)])),
  };
  console.log(
    `${n} ブロック：挿入＋計測 中央値 ${bySize[n].insert.median.toFixed(2)}ms / p95 ${bySize[n].insert.p95.toFixed(2)}ms`,
  );
}

// 1ブロックだけ変えたとき（打鍵1回の想定）：そのブロックだけ差し替えて読む
const single = await tab.evaluate(
  ({ html, runs }) => {
    const el = document.getElementById('m');
    el.innerHTML = html.join('');
    el.getBoundingClientRect();
    const times = [];
    for (let r = 0; r < runs; r++) {
      const target = el.children[100];
      const t0 = performance.now();
      target.innerHTML = `${target.innerHTML}${r % 2 ? 'あ' : ''}`;
      target.getBoundingClientRect().height;
      times.push(performance.now() - t0);
    }
    return times;
  },
  { html: take(200), runs },
);
const singleStats = stats(single);
console.log(`1ブロックの差し替え＋計測：中央値 ${singleStats.median.toFixed(3)}ms`);

// 3. 安定性：同じ入力を5回、新しいページで計測して一致するか
const runsHeights = [];
for (let i = 0; i < 5; i++) {
  const t = await ctx.newPage();
  await t.setContent(page(false));
  await t.evaluate(() => document.fonts.ready);
  runsHeights.push(
    await t.evaluate((html) => {
      const el = document.getElementById('m');
      el.innerHTML = html.join('');
      return Array.from(el.children, (c) => c.getBoundingClientRect().height);
    }, take(200)),
  );
  await t.close();
}
const identical = runsHeights.every((h) => JSON.stringify(h) === JSON.stringify(runsHeights[0]));

// 4. Web フォント：読み込み前（代わりのフォント）と読み込み後で高さが変わるか
// file:// のフォントを読めるように、ページもファイルにして開く
const fontTab = await ctx.newPage();
writeFileSync(`${out}/font.html`, page(true));
await fontTab.goto(pathToFileURL(`${out}/font.html`).href);
const font = await fontTab.evaluate(async (html) => {
  const el = document.getElementById('m');
  el.innerHTML = html.join('');
  const before = Array.from(el.children, (c) => c.getBoundingClientRect().height);
  const loadedBefore = document.fonts.check("16px 'MdsWeb'");
  await document.fonts.load("16px 'MdsWeb'", 'あ');
  await document.fonts.ready;
  const after = Array.from(el.children, (c) => c.getBoundingClientRect().height);
  const again = Array.from(el.children, (c) => c.getBoundingClientRect().height);
  const changed = before.filter((h, i) => Math.abs(h - after[i]) > 0.5).length;
  const maxDiff = Math.max(...before.map((h, i) => Math.abs(h - after[i])));
  return {
    loadedBefore,
    changed,
    total: before.length,
    maxDiff,
    stableAfter: JSON.stringify(after) === JSON.stringify(again),
  };
}, take(200));
await browser.close();

const result = {
  blocks: blocks.length,
  runs,
  bySize,
  single: singleStats,
  identical,
  font,
  chromium: chromium.name(),
};
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ identical, font }, null, 0));
