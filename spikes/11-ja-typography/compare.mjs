// S3：日本語の見出しの改行を、3つの方法で比べる（issue #11、設計プラン §5.5）
//
//   A. CSS の word-break: auto-phrase（Chromium・Edge）
//   B. auto-phrase なし（Firefox・Safari の今の動き。Chromium で auto-phrase を外して再現する）
//   C. BudouX で文節の切れ目に <wbr> を入れ、word-break: keep-all にする（どのブラウザでも同じ）
//
// fixtures の長い見出しを、本文の幅（全幅・3/5・1/2・2/5）で表示し、「文節の途中での改行」の数を数える。
// 使い方: pnpm build && node spikes/11-ja-typography/compare.mjs <出力フォルダ>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDefaultJapaneseParser } from 'budoux';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const core = await import(pathToFileURL(`${repo}packages/core/dist/index.js`).href);
const themes = await import(pathToFileURL(`${repo}packages/themes/dist/index.js`).href);
const out = process.argv[2] ?? fileURLToPath(new URL('./result/', import.meta.url));
mkdirSync(out, { recursive: true });
const budoux = loadDefaultJapaneseParser();

// 1. fixtures のすべての資料の見出しのうち、日本語を含む 12 文字以上のもの
const headings = new Set();
const names = readdirSync(`${repo}fixtures`).filter((f) => f.endsWith('.md') && f !== 'README.md');
for (const name of names) {
  const text = readFileSync(`${repo}fixtures/${name}`, 'utf8');
  for (const m of text.matchAll(/^#{1,3} (.+)$/gm)) {
    const h = m[1].replace(/\s*\{[^}]*\}\s*$/, '').trim();
    if (h.length >= 12 && /[぀-ヿ一-鿿]/.test(h)) headings.add(h);
  }
}
const list = [...headings];
const phrases = list.map((h) => budoux.parse(h));
// BudouX の文節の切れ目（何文字目の直前で改行してよいか）
const boundaries = phrases.map((ps) => {
  const set = new Set();
  let pos = 0;
  for (const p of ps) set.add((pos += p.length));
  return set;
});
// 文節の切れ目か、空白の前後（英単語の間など）での改行なら自然とみなす
const natural = (i, k) =>
  boundaries[i].has(k) || /\s/.test(list[i][k - 1] ?? '') || /\s/.test(list[i][k] ?? '');
console.log(`見出し ${list.length} 個`);

const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const widths = [1120, 672, 560, 448];
const variants = {
  A: { label: 'A. auto-phrase（Chromium）', css: 'word-break: auto-phrase;', html: (h) => esc(h) },
  B: {
    label: 'B. auto-phrase なし（Firefox・Safari）',
    css: 'word-break: normal;',
    html: (h) => esc(h),
  },
  C: {
    label: 'C. BudouX（<wbr> ＋ keep-all）',
    css: 'word-break: keep-all; overflow-wrap: anywhere;',
    html: (h, i) => phrases[i].map(esc).join('<wbr>'),
  },
};
const style = `${core.BASE_CSS}${themes.themeCss('clean')}
.cell { font-family: var(--mds-font-heading); font-size: var(--mds-fs-h2); font-weight: 700; line-height: 1.25;
  text-wrap: balance; line-break: strict; margin: 0; color: #0f172a; }`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await tab.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${style}</style></head>
<body><main class="mds-deck theme-clean" style="--mds-w:1280px;--mds-h:720px;display:block;padding:0"><div id="root"></div></main></body></html>`);
await tab.evaluate(() => document.fonts.ready);

// 2. 改行の位置：文字ごとの行の位置から、改行の直後の文字の番号を求める
const results = {};
for (const [key, v] of Object.entries(variants)) {
  results[key] = {};
  for (const width of widths) {
    const html = list
      .map((h, i) => `<h2 class="cell" style="width:${width}px;${v.css}">${v.html(h, i)}</h2>`)
      .join('');
    results[key][width] = await tab.evaluate((html) => {
      const root = document.getElementById('root');
      root.innerHTML = html;
      return Array.from(root.children, (el) => {
        const tops = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (let k = 0; k < node.data.length; k++) {
            range.setStart(node, k);
            range.setEnd(node, k + 1);
            tops.push(Math.round(range.getClientRects()[0]?.top ?? NaN));
          }
        }
        const breaks = [];
        for (let k = 1; k < tops.length; k++) if (tops[k] > tops[k - 1] + 2) breaks.push(k);
        return breaks;
      });
    }, html);
  }
}

// 3. 数える：文節の途中での改行（BudouX の切れ目以外での改行）
const table = {};
for (const key of Object.keys(variants)) {
  table[key] = {};
  for (const width of widths) {
    let breaks = 0;
    let bad = 0;
    const examples = [];
    results[key][width].forEach((row, i) => {
      for (const b of row) {
        breaks++;
        if (natural(i, b)) continue;
        bad++;
        if (examples.length < 3) examples.push(`${list[i].slice(0, b)} ／ ${list[i].slice(b)}`);
      }
    });
    table[key][width] = { breaks, bad, examples };
  }
}
writeFileSync(`${out}/result.json`, JSON.stringify({ headings: list, widths, table }, null, 2));
for (const [key, v] of Object.entries(variants)) {
  console.log(
    v.label,
    widths.map((w) => `${w}px: ${table[key][w].bad}/${table[key][w].breaks}`).join('  '),
  );
}

// 4. 見た目を並べる：幅 560px（本文の 1/2）で、B で文節の途中の改行が多い見出しを A・B・C で比べる
const W = 560;
const marked = (key, i) => {
  const breaks = new Set(results[key][W][i]);
  let html = '';
  [...list[i]].forEach((ch, k) => {
    if (breaks.has(k) && !natural(i, k)) html += '<b>／</b>';
    html += esc(ch);
  });
  return html;
};
const pick = list
  .map((_, i) => ({ i, bad: results.B[W][i].filter((b) => !natural(i, b)).length }))
  .sort((a, b) => b.bad - a.bad)
  .slice(0, 6);
const rows = pick
  .map(({ i }) => {
    const cells = Object.entries(variants).map(([key, v]) => {
      const body = key === 'C' ? v.html(list[i], i) : marked(key, i);
      return `<td><h2 class="cell" style="width:${W}px;${v.css}">${body}</h2></td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  })
  .join('');
const grid = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${style}
body { background: #f1f5f9; margin: 0; }
.wrap { padding: 20px 24px; width: 1860px; font-family: 'IPAPGothic', sans-serif; }
h1 { font-size: 22px; margin: 0 0 4px; color: #0f172a; } p.lead { margin: 0 0 14px; color: #475569; font-size: 14px; }
table { border-collapse: separate; border-spacing: 10px; }
th { font-size: 15px; color: #334155; text-align: left; padding: 0 4px; }
td { background: #fff; border-radius: 8px; padding: 14px 16px; vertical-align: top; box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
.cell b { color: #dc2626; font-weight: 400; }
</style></head><body><main class="mds-deck theme-clean" style="--mds-w:1280px;--mds-h:720px;display:block;padding:0">
<div class="wrap"><h1>S3：見出しの改行（幅 ${W}px ＝ 本文の 1/2、Chromium）</h1>
<p class="lead">赤い ／ は文節の途中での改行（BudouX の切れ目と違う位置）。B は Firefox・Safari の今の動きを、Chromium で auto-phrase を外して再現したもの。</p>
<table><tr>${Object.values(variants)
  .map((v) => `<th>${esc(v.label)}</th>`)
  .join('')}</tr>${rows}</table>
</div></main></body></html>`;
writeFileSync(`${out}/grid.html`, grid);
const g = await browser.newPage({ viewport: { width: 1900, height: 800 }, deviceScaleFactor: 1 });
await g.setContent(grid);
await g.evaluate(() => document.fonts.ready);
await g.screenshot({ path: `${out}/grid.png`, fullPage: true });
await browser.close();
console.log(`${out}/grid.png`);
