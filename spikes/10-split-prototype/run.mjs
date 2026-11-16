// S2：自動分割の試作を fixtures の資料にかけ、スライドの一覧と評価の数字を出す（issue #10）
// 使い方: pnpm build && node spikes/10-split-prototype/run.mjs <出力フォルダ> <重みの名前>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomize, breakPenalty, split, toSlides } from './split.mjs';
import { WEIGHTS } from './weights.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const core = await import(pathToFileURL(`${repo}packages/core/dist/index.js`).href);
const [out, weightName = 'initial'] = process.argv.slice(2);
const w = WEIGHTS[weightName];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 1,
});
const summary = {};

/** 原子を測るための入れ物。本文と同じ幅・同じ CSS で、高さは中身に合わせる。 */
const measureSection = (k, atomHtml, headHtml) =>
  `<section class="mds-slide layout-stack" style="height:auto" data-measure="${k}"><div class="mds-body">${atomHtml
    .map(
      (h, i) =>
        `<div class="atom" style="display:flex;flex-direction:column;gap:var(--mds-gap)">${h}</div><div class="head" style="display:flex;flex-direction:column">${headHtml[i]}</div>`,
    )
    .join('')}</div></section>`;

for (const name of ['01-plain-document', '03-long-lecture']) {
  const deck = core.buildSlides(core.parseDeck(readFileSync(`${repo}fixtures/${name}.md`, 'utf8')));
  const targets = deck.slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => slide.kind === 'content' && !slide.hidden);

  // 1. 計測：スライドごとに「本文の高さ」と「原子の高さ」を測る（S1 のとおり、まとめて書き込んでから読む）
  const jobs = targets.map(({ slide }) => {
    const atoms = atomize(slide, core.md);
    const skeleton = core.renderSlide(
      { ...slide, blocks: [{ kind: 'paragraph', raw: 'x', hash: '', src: slide.src }] },
      deck,
      { page: 1, total: 1 },
    );
    const atomHtml = atoms.map((a) => core.renderBlocks([a.block], deck.slideLevel));
    // 表の見出し行だけの高さ（2行目以降の原子から引き、続きのページの先頭に足す）
    const headHtml = atoms.map((a) =>
      a.kind === 'table-row'
        ? core.renderBlocks([{ ...a.block, raw: a.group.headRaw }], deck.slideLevel)
        : '',
    );
    return { slide, atoms, skeleton, atomHtml, headHtml };
  });
  await page.setContent(core.renderDeckHtml({ ...deck, slides: [] }, { fit: false }));
  const markup = jobs
    .map(
      (job, k) =>
        job.skeleton.replace('<section ', `<section data-job="${k}" `) +
        measureSection(k, job.atomHtml, job.headHtml),
    )
    .join('');
  const measured = await page.evaluate(
    ({ markup, count }) => {
      document.querySelector('.mds-deck').innerHTML = markup;
      return Array.from({ length: count }, (_, k) => {
        const body = document.querySelector(`[data-job="${k}"] .mds-body`);
        const atoms = document.querySelectorAll(`[data-measure="${k}"] .atom`);
        const heads = document.querySelectorAll(`[data-measure="${k}"] .head`);
        const style = getComputedStyle(body);
        return {
          avail: body.clientHeight,
          gap: parseFloat(style.rowGap),
          listGap: parseFloat(style.fontSize) * 0.25, // .mds-body ul { gap: 0.25em }
          heights: Array.from(atoms, (a) => a.getBoundingClientRect().height),
          heads: Array.from(heads, (a) => a.getBoundingClientRect().height),
        };
      });
    },
    { markup, count: jobs.length },
  );

  // 2. 分割
  const replaced = new Map();
  const stats = {
    sections: targets.length,
    splitSections: 0,
    breaks: 0,
    atHeading: 0,
    orphans: 0,
    shortLast: 0,
    shrunk: 0,
  };
  jobs.forEach((job, k) => {
    const raw = measured[k];
    const atoms = job.atoms;
    const same = (a, b) => a.group && b.group && a.group.id === b.group.id;
    const m = {
      avail: raw.avail,
      gap: raw.gap,
      heights: raw.heights.map((h, i) =>
        atoms[i].kind === 'table-row' && atoms[i].group.index > 0 ? h - raw.heads[i] : h,
      ),
      tableHead: raw.heads,
      pairGap: atoms.map((a, i) =>
        i + 1 >= atoms.length
          ? 0
          : same(a, atoms[i + 1])
            ? a.kind === 'table-row'
              ? 0
              : raw.listGap
            : raw.gap,
      ),
    };
    const pages = split(atoms, m, w);
    if (pages.length > 1) stats.splitSections++;
    for (const p of pages.slice(1)) {
      stats.breaks++;
      if (job.atoms[p.start].kind === 'heading') stats.atHeading++;
      const pen = breakPenalty(job.atoms, p.start, w);
      if (job.atoms[p.start].group && pen >= Math.min(w.listItem, w.tableRow) + w.orphan)
        stats.orphans++;
    }
    const lastPage = pages[pages.length - 1];
    if (pages.length > 1 && lastPage.fill < 0.3) stats.shortLast++;
    stats.shrunk += pages.filter((p) => p.scale < 1).length;
    if (pages.length > 1) {
      (stats.details ??= []).push(
        `${job.slide.heading?.text}: ` +
          pages
            .map((p) => `[${p.start}-${p.end}) fill ${p.fill.toFixed(2)} x${p.scale}`)
            .join(' | ') +
          ` | avail ${m.avail} atoms ${atoms.map((a, i) => `${a.kind[0]}${Math.round(m.heights[i])}`).join(' ')}`,
      );
    }
    replaced.set(targets[k].index, toSlides(job.slide, job.atoms, pages));
  });
  const slides = deck.slides.flatMap((slide, i) => replaced.get(i) ?? [slide]);
  const result = { ...deck, slides };

  // 3. 描画して1枚ずつ撮る（縮小は試作で決めた倍率をそのまま使い、あふれたかを確かめる）
  let rendered = core.renderDeckHtml(result, { fit: false, debug: true });
  for (const s of slides) {
    if (!s.page || s.page.scale >= 1) continue;
    rendered = rendered.replace(
      `data-id="${s.id}"`,
      `data-id="${s.id}" style="--mds-fit-fixed:${s.page.scale}"`,
    );
  }
  rendered = rendered.replace(
    '</style>',
    '.mds-slide[style*="--mds-fit-fixed"] .mds-body { --mds-fit: var(--mds-fit-fixed); }\n</style>',
  );
  writeFileSync(`${out}/${name}.html`, rendered);
  await page.setContent(rendered);
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mds-slide')).map((s) => {
      const b = s.querySelector('.mds-body');
      return b ? b.scrollHeight > b.clientHeight + 1 : false;
    }),
  );
  stats.slides = slides.length;
  stats.overflow = overflow.filter(Boolean).length;
  const els = await page.$$('.mds-slide');
  const shots = [];
  for (let i = 0; i < els.length; i++) {
    const path = `${out}/${name}-${String(i + 1).padStart(2, '0')}.png`;
    await els[i].screenshot({ path });
    const s = slides[i];
    const label = [
      `${i + 1}. `,
      s.heading?.text ?? (s.kind === 'title' ? 'タイトル' : ''),
      s.page && s.page.total > 1 ? `（${s.page.index}/${s.page.total}）` : '',
      s.page && s.page.scale < 1 ? ` 縮小${Math.round(s.page.scale * 100)}%` : '',
      overflow[i] ? ' ⚠あふれ' : '',
    ].join('');
    shots.push({
      path,
      label,
      heading: s.heading?.text ?? '',
      split: Boolean(s.page && s.page.total > 1),
    });
  }
  writeFileSync(`${out}/${name}-shots.json`, JSON.stringify(shots, null, 1));
  const figures = shots
    .map(
      (s) =>
        `<figure class="${s.split ? 'split' : ''}"><img src="file://${s.path}"><figcaption>${s.label}</figcaption></figure>`,
    )
    .join('');
  writeFileSync(
    `${out}/${name}-sheet.html`,
    `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
body{margin:0;width:1800px;background:#e5e7eb;font-family:"IPAPGothic",sans-serif}
h1{font-size:22px;margin:16px 16px 0}
.g{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:12px 16px 16px}
figure{margin:0;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.2)}
figure.split{outline:3px solid #2a78d6}
img{width:100%;display:block}figcaption{font-size:13px;color:#334155;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style><h1>${name}（重み：${weightName}）— ${stats.slides} 枚。青い枠は自動で分けたスライド</h1><div class="g">${figures}</div></html>`,
  );
  const sheet = await browser.newPage({
    viewport: { width: 1800, height: 600 },
    deviceScaleFactor: 1,
  });
  await sheet.goto(pathToFileURL(`${out}/${name}-sheet.html`).href);
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: `${out}/${name}-sheet.png`, fullPage: true });
  await sheet.close();
  summary[name] = stats;
  const { details, ...rest } = stats;
  console.log(name, JSON.stringify(rest));
  if (process.env.DEBUG) console.log(details.join('\n'));
}
await browser.close();
writeFileSync(`${out}/summary.json`, JSON.stringify({ weights: w, summary }, null, 2));
