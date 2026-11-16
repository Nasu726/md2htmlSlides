import {
  applySplit,
  buildSlides,
  checkMediaFiles,
  parseDeck,
  planSplit,
  renderDeckHtml,
  type Deck,
  type Diagnostic,
  type RenderOptions,
  type SlideDeck,
} from '@mds/core';
import { RUNTIME_SCRIPT } from '@mds/runtime';
import type { Browser } from 'playwright-core';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAssets, registerDeckAssets, type Assets } from './assets.js';
import { ChromiumMeasurer } from './measurer.js';

export interface Rendered {
  html: string;
  deck: Deck;
  slides: SlideDeck;
  assets: Assets;
  diagnostics: Diagnostic[];
  /** `css:` で指定したファイル（監視に使う） */
  cssFile?: string;
}

/**
 * 資料を読み、警告を集めて HTML にする。素材のパスは書き出し先での URL に置き換える。
 * measurer を渡すと、計測して自動で分割する（docs/design.md §4）。
 */
export async function renderFile(
  mdFile: string,
  options: Pick<RenderOptions, 'scripts' | 'debug' | 'includeHidden'> = {},
  measurer?: ChromiumMeasurer,
): Promise<Rendered> {
  const source = readFileSync(mdFile, 'utf8');
  const deck = parseDeck(source);
  let slides = buildSlides(deck);
  const assets = createAssets(mdFile);
  const diagnostics = [...deck.diagnostics, ...checkMediaFiles(deck, (src) => assets.probe(src))];

  // css: で指定したファイルを、デッキの中だけに効かせて埋め込む
  let customCss: string | undefined;
  let cssFile: string | undefined;
  if (deck.meta.css) {
    cssFile = resolve(assets.root, deck.meta.css);
    if (existsSync(cssFile)) {
      customCss = readFileSync(cssFile, 'utf8');
    } else {
      const index = source.split('\n').findIndex((line) => /^css\s*:/.test(line));
      diagnostics.push({
        severity: 'warning',
        code: 'frontmatter/css-not-found',
        message: `CSS ファイルが見つかりません：${deck.meta.css}`,
        line: index >= 0 ? index + 1 : (deck.frontmatter?.start ?? 1),
      });
    }
  }
  registerDeckAssets(deck, assets);
  const renderOptions: RenderOptions = {
    probe: (src) => assets.probe(src),
    assetUrl: (src) => assets.url(src),
    ...(customCss !== undefined ? { customCss } : {}),
  };

  // 自動分割：スライドを空にしたデッキの上で原子の高さを測り、節ごとに区切る
  if (measurer) {
    const plan = planSplit(slides);
    if (plan.jobs.length > 0) {
      const page = renderDeckHtml({ ...slides, slides: [] }, { ...renderOptions, fit: false });
      const measurements = await measurer.measure(page, plan.jobs);
      if (measurements) slides = applySplit(slides, plan, measurements);
    }
  }

  const html = renderDeckHtml(slides, { ...options, ...renderOptions });
  diagnostics.sort((a, b) => a.line - b.line);
  return { html, deck, slides, assets, diagnostics, ...(cssFile ? { cssFile } : {}) };
}

export interface BuildOptions {
  outDir: string;
  /** ヘッドレス Chromium で計測して自動で分割し、収まらないスライドを調べる（既定は行う） */
  measure?: boolean;
}

export interface BuildResult {
  /** 書き出した index.html の絶対パス */
  index: string;
  slides: number;
  /** コピーした素材の数 */
  assets: number;
  diagnostics: Diagnostic[];
  /** 計測できなかった理由（Chromium が見つからないなど） */
  measureError?: string;
}

/** 静的な HTML・runtime・素材を書き出す（docs/design.md §10）。 */
export async function build(mdFile: string, options: BuildOptions): Promise<BuildResult> {
  const measurer = options.measure === false ? undefined : new ChromiumMeasurer();
  try {
    const rendered = await renderFile(mdFile, { scripts: [RUNTIME_SCRIPT] }, measurer);
    const outDir = resolve(options.outDir);
    mkdirSync(outDir, { recursive: true });
    const index = join(outDir, 'index.html');
    writeFileSync(index, rendered.html);

    let copied = 0;
    for (const [from, url] of rendered.assets.used()) {
      if (!existsSync(from)) continue;
      const to = join(outDir, ...url.split('/').map(decodeURIComponent));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied++;
    }

    const result: BuildResult = {
      index,
      slides: rendered.slides.slides.filter((slide) => !slide.hidden).length,
      assets: copied,
      diagnostics: rendered.diagnostics,
    };
    if (measurer) {
      const browser = await measurer.browser();
      if (browser) {
        result.diagnostics = [...result.diagnostics, ...(await checkOverflow(index, browser))];
        result.diagnostics.sort((a, b) => a.line - b.line);
      } else {
        result.measureError = measurer.error ?? 'Chromium を起動できませんでした';
      }
    }
    return result;
  } finally {
    await measurer?.close();
  }
}

interface SlideCheck {
  id: string;
  src: string;
  title: string;
  fit: number;
  overflow: boolean;
}

/** 書き出した HTML を開き、文字を縮小したスライドと、それでも収まらないスライドを調べる。 */
export async function checkOverflow(index: string, browser: Browser): Promise<Diagnostic[]> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(pathToFileURL(index).href);
    await page.evaluate('document.fonts.ready');
    const slides =
      (await page.evaluate(`Array.from(document.querySelectorAll('.mds-slide')).map((s) => ({
      id: s.dataset.id,
      src: s.dataset.src,
      title: s.querySelector('.mds-title')?.textContent?.trim() ?? '',
      fit: Number(s.dataset.fit ?? 1),
      overflow: 'overflow' in s.dataset,
    }))`)) as SlideCheck[];
    const diagnostics: Diagnostic[] = [];
    for (const slide of slides) {
      const line = Number(slide.src.split('-')[0]) || 1;
      const name = slide.title || slide.id;
      if (slide.overflow) {
        diagnostics.push({
          severity: 'warning',
          code: 'slide/overflow',
          message: `スライド「${name}」が収まりません（60% に縮小しても）。内容を減らすか、--- で分けてください`,
          line,
        });
      } else if (slide.fit < 1) {
        diagnostics.push({
          severity: 'info',
          code: 'slide/shrunk',
          message: `スライド「${name}」は文字を ${Math.round(slide.fit * 100)}% に縮小して収めました`,
          line,
        });
      }
    }
    return diagnostics;
  } finally {
    await page.close();
  }
}

/** 警告を `file:line  warning  message  [code]` の形にする。 */
export function formatDiagnostic(file: string, diagnostic: Diagnostic): string {
  return `${file}:${diagnostic.line}  ${diagnostic.severity}  ${diagnostic.message}  [${diagnostic.code}]`;
}
