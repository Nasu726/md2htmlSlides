// #149：動く構成図の方向を決めるための試作を、コマ送りの画像と GIF にする
//
// 1. deck.md（構成は今の arch で書いた7枚と、試作用の2枚）を CLI の renderFile で HTML にする。
//    配置（ELK）とテーマは本物
// 2. protos/NN-*.js（案ごとの試作）を、そのスライドのページに入れる。試作は図の上に描く1本の
//    時間軸で、P.seek(t) でその時刻の様子にする（protos/lib.js）
// 3. 時間軸を 1/FPS 秒ずつ進めてスクリーンショットを撮り、GIF にする。区切りの時刻（keys）の
//    スクリーンショットは 2×2 の一覧にする
//
// 使い方: node spikes/149-arch-direction/run.mjs <出力フォルダ> [案の番号,…]
// 必要なもの: pnpm build を済ませていること、ffmpeg
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('./', import.meta.url));
const repo = join(here, '../../');
const { renderFile, ChromiumMeasurer } = await import(join(repo, 'apps/cli/dist/index.js'));
const { RUNTIME_SCRIPT } = await import(join(repo, 'packages/runtime/dist/index.js'));

const out = process.argv[2] ?? join(here, 'result');
const only = process.argv[3]?.split(',').map(Number);
const FPS = 10;
mkdirSync(out, { recursive: true });

const measurer = new ChromiumMeasurer();
const deck = await renderFile(
  join(here, 'deck.md'),
  { scripts: [RUNTIME_SCRIPT], fonts: 'embed' },
  measurer,
);
await measurer.close();
writeFileSync(join(out, 'deck.html'), deck.html);
if (deck.diagnostics.length > 0) console.log(deck.diagnostics);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const result = [];
const protos = readdirSync(join(here, 'protos'))
  .filter((f) => /^\d\d-.*\.js$/.test(f))
  .filter((f) => !only || only.includes(Number(f.slice(0, 2))));
for (const file of protos) {
  const name = file.replace(/\.js$/, '');
  const source = readFileSync(join(here, 'protos', file), 'utf8');
  const slide = Number(/slide:\s*(\d+)/.exec(source)[1]);
  await page.goto(`file://${join(out, 'deck.html')}#/${slide}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.addScriptTag({ path: join(here, 'protos/lib.js') });
  await page.addScriptTag({ content: source });
  const info = await page.evaluate(() => window.PROTO.setup(window.P));
  const end = await page.evaluate(() => window.P.end());

  const frames = join(out, name);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  let n = 0;
  for (let t = 0; t <= end; t += 1000 / FPS) {
    await page.evaluate((time) => window.P.seek(time), t);
    await page.screenshot({ path: join(frames, `f${String(n++).padStart(4, '0')}.png`) });
  }
  const keys = [];
  for (const [i, t] of info.keys.entries()) {
    await page.evaluate((time) => window.P.seek(time), t);
    const path = join(frames, `key-${i + 1}.png`);
    await page.screenshot({ path });
    keys.push(path);
  }
  const grid = join(out, `${name}.png`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    ...keys.flatMap((k) => ['-i', k]),
    '-filter_complex',
    `${keys.map((_, i) => `[${i}]`).join('')}concat=n=${keys.length}:v=1:a=0,scale=960:540,tile=2x2:margin=10:padding=10:color=0xe2e8f0`,
    '-frames:v',
    '1',
    grid,
  ]);
  const gif = join(out, `${name}.gif`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    join(frames, 'f%04d.png'),
    '-vf',
    'scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    gif,
  ]);
  const row = {
    name,
    slide,
    seconds: Math.round(end / 100) / 10,
    frames: n,
    gifKB: Math.round(statSync(gif).size / 1024),
    gridKB: Math.round(statSync(grid).size / 1024),
  };
  result.push(row);
  console.log(row);
}
await browser.close();
writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
