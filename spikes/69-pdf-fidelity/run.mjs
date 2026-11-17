// S5：PDF での再現性を確かめる（issue #69、設計プラン §15）
//
// fixtures の資料を `mds build` で書き出し、ヘッドレス Chromium の page.pdf() で PDF にする。
// PDF の各ページを pdftoppm で画像にし、画面（最後のステップまで表示）のスクリーンショットと比べる。
// 文字を取り出せるか（pdftotext）、ファイルの大きさ、時間、ステップごとのページ（pdf.steps: each）も確かめる。
//
// 使い方: pnpm build && node spikes/69-pdf-fidelity/run.mjs [出力フォルダ]
// 必要なもの：poppler-utils（pdftoppm・pdftotext・pdfinfo・pdffonts）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { build } = await import(pathToFileURL(`${repo}apps/cli/dist/index.js`).href);
const out = process.argv[2] ?? fileURLToPath(new URL('./result/', import.meta.url));
mkdirSync(out, { recursive: true });
const names = ['02-tech-talk', '04-layouts', '06-steps', '07-media', '08-maketitle'];

/**
 * 試す印刷用の CSS。1スライド＝1ページ（ページの大きさはスライドと同じ）、余白なし、
 * 段階的表示はすべて表示、影は付けない。
 */
const printCss = (w, h) => `
@page { size: ${w}px ${h}px; margin: 0; }
@media print {
  html, body { margin: 0; background: none; }
  .mds-deck { display: block !important; padding: 0 !important; }
  .mds-slide { box-shadow: none !important; break-inside: avoid; transform: none !important;
    position: relative !important; left: auto !important; top: auto !important; visibility: visible !important; }
  /* 最後のスライドの後に白いページを作らないよう、2枚目からページの前で区切る */
  .mds-slide { break-after: auto !important; }
  /* 読み上げ用の要素（1px）が最後のスライドの下にはみ出し、白いページができるので隠す */
  .mds-player-sr { display: none !important; }
  .mds-slide ~ .mds-slide { break-before: page; }
  [data-step][data-step-hidden], .mds-step-group[data-step-hidden] > * { visibility: visible !important; opacity: 1 !important; }
}`;

/** ステップごとにスライドを複製する（pdf.steps: each の試作）。印刷用の CSS の後に呼ぶ */
function expandSteps() {
  for (const slide of Array.from(document.querySelectorAll('.mds-deck > .mds-slide'))) {
    const steps = Number(slide.dataset.steps ?? 0);
    if (!steps) continue;
    for (let k = 0; k <= steps; k++) {
      const copy = k === steps ? slide : slide.cloneNode(true);
      for (const el of copy.querySelectorAll('[data-step]')) {
        // 発表用の印（data-step-hidden）は外し、ページごとの印（data-step-print-hidden）で隠す。
        // 「印刷ではすべて表示する」規則より強くするため、セレクタを詳しくして後に置く
        el.removeAttribute('data-step-hidden');
        el.toggleAttribute('data-step-print-hidden', Number(el.dataset.step) > k);
      }
      if (copy !== slide) slide.before(copy);
    }
  }
  const style = document.createElement('style');
  style.textContent =
    '@media print { .mds-slide [data-step][data-step-print-hidden] { visibility: hidden !important; } }';
  document.head.append(style);
}

/**
 * 2枚の画像（data URL）の違う画素の割合（RGB の差の合計が 40 を超えるもの）。
 * radius > 0 なら、相手の画像の周り radius 画素の中に近い色があれば同じとみなす
 * （文字の縁のにじみ方の違い＝描き方の違いを除き、要素の欠け・ずれだけを数える）。
 */
async function diffRatio(page, a, b, radius = 0) {
  return page.evaluate(
    async ([a, b, radius]) => {
      const load = (src) =>
        new Promise((done) => {
          const img = new Image();
          img.onload = () => done(img);
          img.src = src;
        });
      const [x, y] = await Promise.all([load(a), load(b)]);
      const w = Math.min(x.width, y.width);
      const h = Math.min(x.height, y.height);
      const data = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, w, h);
        return g.getImageData(0, 0, w, h).data;
      };
      const d1 = data(x);
      const d2 = data(y);
      const near = (i, j) =>
        Math.abs(d1[i] - d2[j]) +
          Math.abs(d1[i + 1] - d2[j + 1]) +
          Math.abs(d1[i + 2] - d2[j + 2]) <=
        40;
      let n = 0;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          if (near(i, i)) continue;
          let found = false;
          for (let dy = -radius; dy <= radius && !found; dy++) {
            for (let dx = -radius; dx <= radius && !found; dx++) {
              const qx = px + dx;
              const qy = py + dy;
              if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
              found = near(i, (qy * w + qx) * 4);
            }
          }
          if (!found) n++;
        }
      }
      return n / (w * h);
    },
    [a, b, radius],
  );
}

const png = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const results = [];
for (const name of names) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const built = await build(join(repo, 'fixtures', `${name}.md`), { outDir: join(dir, 'html') });
  const url = pathToFileURL(built.index).href;

  // 1. 画面：1枚ずつ、最後のステップまで表示して撮る
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const total = await page.evaluate(() => window.mdsPlayer.total);
  for (let n = 1; n <= total; n++) {
    await page.evaluate((n) => (location.hash = `#/${n}/99`), n);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(dir, `screen-${String(n).padStart(2, '0')}.png`) });
  }

  // 2. PDF（最終状態）と、ステップごとのページの PDF
  const size = await page.evaluate(() => {
    const css = getComputedStyle(document.querySelector('.mds-deck'));
    return [
      parseFloat(css.getPropertyValue('--mds-w')),
      parseFloat(css.getPropertyValue('--mds-h')),
    ];
  });
  const makePdf = async (path, steps) => {
    const pdfPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await pdfPage.goto(url);
    await pdfPage.addStyleTag({ content: printCss(size[0], size[1]) });
    if (steps) await pdfPage.evaluate(expandSteps);
    await pdfPage.evaluate(() => document.fonts.ready);
    await pdfPage.waitForTimeout(800); // 動画の最初のフレーム・画像を待つ
    const start = Date.now();
    await pdfPage.pdf({ path, printBackground: true, preferCSSPageSize: true });
    const ms = Date.now() - start;
    await pdfPage.close();
    return ms;
  };
  const pdf = join(dir, 'deck.pdf');
  const ms = await makePdf(pdf, false);
  const pdfSteps = join(dir, 'deck-steps.pdf');
  await makePdf(pdfSteps, true);

  // 3. PDF を画像にする（96 dpi で 1280×720）・文字を取り出す
  execFileSync('pdftoppm', ['-r', '96', '-png', pdf, join(dir, 'pdf')]);
  const info = execFileSync('pdfinfo', [pdf]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
  const pageSize = /Page size:\s+([^\n]+)/.exec(info)?.[1];
  const stepPages = Number(
    /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdfSteps]).toString())?.[1],
  );
  const text = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
  const fonts = execFileSync('pdffonts', [pdf])
    .toString()
    .split('\n')
    .slice(2)
    .filter(Boolean).length;

  // 4. ページごとに比べる
  const diffs = [];
  const layoutDiffs = [];
  for (let n = 1; n <= Math.min(total, pages); n++) {
    const suffix = String(n).padStart(String(pages).length, '0');
    const screen = png(join(dir, `screen-${String(n).padStart(2, '0')}.png`));
    const pdfPng = png(join(dir, `pdf-${suffix}.png`));
    diffs.push(await diffRatio(page, screen, pdfPng));
    layoutDiffs.push(await diffRatio(page, screen, pdfPng, 1));
  }
  const result = {
    name,
    slides: total,
    pages,
    stepPages,
    pageSize,
    bytes: statSync(pdf).size,
    ms,
    textChars: text.replace(/\s/g, '').length,
    fonts,
    diffMax: Math.max(...diffs),
    diffMean: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    layoutMax: Math.max(...layoutDiffs),
    layoutMean: layoutDiffs.reduce((a, b) => a + b, 0) / layoutDiffs.length,
    diffs,
    layoutDiffs,
  };
  results.push(result);
  console.log(
    name.padEnd(14),
    `slides ${total} pages ${pages} (steps ${stepPages})`,
    `${(result.bytes / 1024).toFixed(0)}KB ${ms}ms text ${result.textChars} fonts ${fonts}`,
    `diff mean ${(result.diffMean * 100).toFixed(2)}% max ${(result.diffMax * 100).toFixed(2)}%`,
    `layout mean ${(result.layoutMean * 100).toFixed(2)}% max ${(result.layoutMax * 100).toFixed(2)}%`,
  );
}
await browser.close();
writeFileSync(join(out, 'result.json'), JSON.stringify(results, null, 2));
