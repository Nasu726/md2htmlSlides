// bench.mjs の結果（result.json）をグラフにする
// 使い方: node spikes/9-dom-measure/chart.mjs <result.json のあるフォルダ> <出力 png>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [dir, out] = process.argv.slice(2);
const r = JSON.parse(readFileSync(`${dir}/result.json`, 'utf8'));

const INK = '#1f2937';
const MUTED = '#6b7280';
const GRID = '#e5e7eb';
const SERIES = '#2a78d6';
const SURFACE = '#fcfcfb';

/** 縦棒（中央値）と、ひげ（p95）。目標の線を点線で引く。 */
function bars({ title, sub, items, max, target, unit = 'ms' }) {
  const w = 520,
    h = 300,
    left = 48,
    right = 16,
    top = 56,
    bottom = 52;
  const pw = w - left - right,
    ph = h - top - bottom;
  const y = (v) => top + ph - (v / max) * ph;
  const step = pw / items.length,
    bw = Math.min(44, step * 0.45);
  const ticks = Array.from({ length: 5 }, (_, i) => (max / 4) * i);
  const grid = ticks
    .map(
      (t) => `<line x1="${left}" x2="${w - right}" y1="${y(t)}" y2="${y(t)}" stroke="${GRID}"/>
<text x="${left - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${MUTED}">${t}</text>`,
    )
    .join('');
  const marks = items
    .map((it, i) => {
      const cx = left + step * i + step / 2;
      const top0 = y(it.median),
        hgt = Math.max(1, y(0) - top0);
      return `<g><title>${it.label}：中央値 ${it.median.toFixed(1)}${unit} / p95 ${it.p95.toFixed(1)}${unit}</title>
<path d="M${cx - bw / 2},${y(0)} V${top0 + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${y(0)} Z" fill="${SERIES}"/>
<line x1="${cx}" x2="${cx}" y1="${top0}" y2="${y(it.p95)}" stroke="${INK}" stroke-width="1.5"/>
<line x1="${cx - 6}" x2="${cx + 6}" y1="${y(it.p95)}" y2="${y(it.p95)}" stroke="${INK}" stroke-width="1.5"/>
<text x="${cx}" y="${top0 - 6 > y(it.p95) - 6 ? y(it.p95) - 6 : top0 - 6}" text-anchor="middle" font-size="12" font-weight="600" fill="${INK}">${it.median.toFixed(1)}</text>
<text x="${cx}" y="${h - bottom + 18}" text-anchor="middle" font-size="12" fill="${INK}">${it.label}</text></g>`;
    })
    .join('');
  const line = `<line x1="${left}" x2="${w - right}" y1="${y(target)}" y2="${y(target)}" stroke="${MUTED}" stroke-dasharray="5 4" stroke-width="1.5"/>
<text x="${left + 4}" y="${y(target) - 6}" font-size="11" fill="${MUTED}">目標 ${target}${unit}</text>`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">
<text x="0" y="20" font-size="15" font-weight="700" fill="${INK}">${title}</text>
<text x="0" y="40" font-size="12" fill="${MUTED}">${sub}</text>
${grid}${line}${marks}
<line x1="${left}" x2="${w - right}" y1="${y(0)}" y2="${y(0)}" stroke="${MUTED}"/>
<text x="${left + pw / 2}" y="${h - 8}" text-anchor="middle" font-size="11" fill="${MUTED}">${items.unitLabel ?? ''}</text>
</svg>`;
}

const sizes = Object.entries(r.bySize).map(([n, v]) => ({ label: `${n}`, ...v.insert }));
sizes.unitLabel = 'ブロック数（挿入＋スタイル＋レイアウト＋読み取り）';
const widthNames = { 1120: '全幅', 672: '3/5', 560: '1/2', 448: '2/5', 373: '1/3' };
const widths = Object.entries(r.bySize['200'].relayout)
  .sort((a, b) => Number(b[0]) - Number(a[0]))
  .map(([w, v]) => ({ label: widthNames[w] ?? `${w}px`, ...v }));
widths.unitLabel = '本文の幅（200 ブロック、DOM は置いたまま）';

const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
body { margin: 0; background: ${SURFACE}; font-family: 'IPAPGothic', sans-serif; color: ${INK}; }
.wrap { width: 1100px; padding: 24px 28px; }
h1 { font-size: 20px; margin: 0 0 4px; } .lead { margin: 0 0 18px; color: ${MUTED}; font-size: 13px; }
.row { display: flex; gap: 24px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px; }
.tile { border: 1px solid ${GRID}; border-radius: 10px; padding: 12px 16px; background: #fff; }
.tile b { display: block; font-size: 26px; margin: 2px 0; } .tile span { font-size: 12px; color: ${MUTED}; }
</style><div class="wrap">
<h1>S1：DOM での計測の速さと安定性（fixtures/03-long-lecture.md のブロック、ヘッドレス Chromium）</h1>
<p class="lead">棒は中央値、ひげは p95（各 ${r.runs} 回）。単位は ms。</p>
<div class="row">
${bars({ title: '① まとめて挿入して計測', sub: '初めて開いたとき（キャッシュなし）', items: sizes, max: 50, target: 10 })}
${bars({ title: '② 幅を変えて計測し直す', sub: 'レイアウトの候補ごとの計測', items: widths, max: 12, target: 10 })}
</div>
<div class="tiles">
<div class="tile"><span>③ 1ブロックだけ変えたとき（打鍵1回）</span><b>${r.single.median.toFixed(1)} ms</b><span>そのブロックだけ差し替えて計測（中央値）</span></div>
<div class="tile"><span>④ 同じ入力を5回、別のページで計測</span><b>${r.identical ? '5 回とも一致' : '不一致あり'}</b><span>200 ブロックの高さがすべて同じ</span></div>
<div class="tile"><span>⑤ Web フォントの読み込み前に計測すると</span><b>${r.font.changed} / ${r.font.total} ブロック</b><span>の高さがずれる（最大 ${r.font.maxDiff.toFixed(0)}px）。読み込み後は安定</span></div>
</div></div></html>`;
writeFileSync(`${dir}/chart.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1156, height: 400 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(`${dir}/chart.html`).href);
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
