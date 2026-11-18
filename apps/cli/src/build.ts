import {
  applySplit,
  archDiagnostics,
  buildSlides,
  checkMediaFiles,
  collectArch,
  collectMedia,
  hashString,
  isLocalPath,
  parseDeck,
  planSplit,
  renderDeckHtml,
  type Deck,
  type DiagramResult,
  type Diagnostic,
  type RenderOptions,
  type SlideDeck,
} from '@mds/core';
import { ARCH_SCRIPT, RUNTIME_SCRIPT } from '@mds/runtime';
import { SERIF_FAMILY, themeFonts } from '@mds/themes';
import type { Browser } from 'playwright-core';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAssets, registerDeckAssets, type Assets } from './assets.js';
import { FONT_HOST, codeText, linkedFontCss, subsetFontCss, visibleText } from './fonts.js';
import { collectMermaid, diagramDiagnostic, normalizeCode } from '@mds/embeds';
import { codeHighlighter, codeLanguages } from '@mds/embeds/highlight';
import {
  linkedMathFontCss,
  mathDiagnostics,
  mathEngine,
  mathLayoutCss,
  subsetMathFontCss,
} from './math.js';
import { ChromiumMeasurer } from './measurer.js';

/**
 * 同梱するフォントの扱い（docs/design.md §6）。
 * - `embed`：スライドで使う文字だけに絞り、HTML に埋め込む（書き出し）
 * - `link`：分割ファイル一式を `/__mds/fonts/` から読み込む（`mds dev`）
 * - なし：フォントを含めない（OS のフォントで表示する）
 */
export type FontMode = 'embed' | 'link';

export interface Rendered {
  html: string;
  deck: Deck;
  slides: SlideDeck;
  assets: Assets;
  diagnostics: Diagnostic[];
  /** 埋め込んだフォントの大きさ（バイト。fonts: 'embed' のとき） */
  fontBytes?: number;
  /** `css:` で指定したファイル（監視に使う） */
  cssFile?: string;
}

/**
 * 資料を読み、警告を集めて HTML にする。素材のパスは書き出し先での URL に置き換える。
 * measurer を渡すと、計測して自動で分割する（docs/design.md §4）。
 */
export async function renderFile(
  mdFile: string,
  options: Pick<RenderOptions, 'scripts' | 'debug' | 'includeHidden'> & { fonts?: FontMode } = {},
  measurer?: ChromiumMeasurer,
): Promise<Rendered> {
  const { fonts, ...htmlOptions } = options;
  const source = readFileSync(mdFile, 'utf8');
  const deck = parseDeck(source);
  let slides = buildSlides(deck);
  const assets = createAssets(mdFile);
  const diagnostics = [...deck.diagnostics, ...checkMediaFiles(deck, (src) => assets.probe(src))];
  // 動く構成図（#106）：書き間違い・存在しないシナリオ・1つのスライドに2つ以上
  const readText = (src: string) => {
    const file = resolve(assets.root, src);
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  };
  const archSources = collectArch(slides, readText);
  diagnostics.push(...archDiagnostics(archSources));

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

  // 背景の明るさを測る（全面の背景の上の文字色を選ぶため）
  const luminance = new Map<string, number>();
  if (measurer) {
    const backgrounds = collectMedia(deck)
      .filter((m) => m.attrs?.values.bg !== undefined && isLocalPath(m.src))
      .map((m) => decodeSrc(m.src));
    const measured = await measurer.luminance(backgrounds.map((src) => resolve(assets.root, src)));
    for (const src of backgrounds) {
      const value = measured.get(resolve(assets.root, src));
      if (value !== undefined) luminance.set(src, value);
    }
  }
  // コードの色分け（#68）：資料で使っている言語の文法だけを読み込む
  const highlight = await codeHighlighter(codeLanguages(source));
  const renderOptions: RenderOptions = {
    highlight,
    probe: (src) => {
      const info = assets.probe(src);
      const value = luminance.get(src);
      return info && value !== undefined ? { ...info, luminance: value } : info;
    },
    assetUrl: (src) => assets.url(src),
    ...(customCss !== undefined ? { customCss } : {}),
  };

  // 数式（#72）：KaTeX は、資料に数式があるときだけ読み込む。CSS とフォントも、そのときだけ入れる
  const math = deck.math ? await mathEngine() : undefined;
  if (math) {
    renderOptions.math = math.render;
    renderOptions.libraryCss = mathLayoutCss();
    diagnostics.push(...mathDiagnostics(deck, math.render));
  }
  const linkedFonts = (prefix: string) =>
    linkedFontCss(prefix) + (math ? `\n${linkedMathFontCss(prefix)}` : '');

  // スライドを空にしたデッキ：計測と図の描画に使う（テーマ・カスタム CSS・同じフォント）
  const emptyPage = () =>
    renderDeckHtml(
      { ...slides, slides: [] },
      { ...renderOptions, fit: false, ...(fonts ? { fontCss: linkedFonts(FONT_HOST) } : {}) },
    );

  // Mermaid の図（#71）：ヘッドレス Chromium で SVG にしておき、描画では結果を返すだけにする
  if (measurer) {
    const found = collectMermaid(source, deck, readText);
    if (found.length > 0) {
      const results = await measurer.diagrams(
        emptyPage(),
        found.map((d) => d.code),
      );
      if (results) {
        const byCode = new Map<string, DiagramResult>();
        const bySrc = new Map<string, DiagramResult>();
        for (const item of found) {
          const result = results.get(item.code)!;
          if (item.src !== undefined) bySrc.set(item.src, result);
          else byCode.set(normalizeCode(item.code), result);
          if ('error' in result) diagnostics.push(diagramDiagnostic(item, result.error));
        }
        renderOptions.diagram = (input) =>
          'src' in input ? bySrc.get(input.src) : byCode.get(normalizeCode(input.code));
      }
    }
  }

  // 動く構成図（#107）：ELK で配置して SVG にしておく。説明のリストと再生のため、シナリオも渡す
  if (measurer && archSources.length > 0) {
    const results = await measurer.archs(
      emptyPage(),
      archSources.map((s) => ({ id: `mds-a-${hashString(s.code)}`, diagram: s.diagram })),
    );
    if (results) {
      const byCode = new Map<string, DiagramResult>();
      const bySrc = new Map<string, DiagramResult>();
      archSources.forEach((s, i) => {
        const drawn = results[i]!;
        const result = 'error' in drawn ? drawn : { ...drawn, scenarios: s.diagram.scenarios };
        if (s.src !== undefined) bySrc.set(s.src, result);
        else byCode.set(normalizeCode(s.code), result);
      });
      const mermaid = renderOptions.diagram;
      renderOptions.diagram = (input) =>
        input.lang !== 'arch'
          ? mermaid?.(input)
          : 'src' in input
            ? bySrc.get(input.src)
            : byCode.get(normalizeCode(input.code));
    }
  }

  // 自動分割：スライドを空にしたデッキの上で原子の高さを測り、節ごとに区切る
  if (measurer) {
    const plan = planSplit(slides, {
      ...(renderOptions.diagram ? { diagram: renderOptions.diagram } : {}),
      ...(renderOptions.math ? { math: renderOptions.math } : {}),
    });
    if (plan.jobs.length > 0) {
      const measurements = await measurer.measure(emptyPage(), plan.jobs);
      if (measurements) slides = applySplit(slides, plan, measurements);
    }
  }

  // 動く構成図の再生（#108）：構成図があり、発表用の runtime を入れるときだけ、その前に入れる
  const scripts =
    archSources.length > 0 && htmlOptions.scripts?.includes(RUNTIME_SCRIPT)
      ? htmlOptions.scripts.flatMap((s) => (s === RUNTIME_SCRIPT ? [ARCH_SCRIPT, s] : [s]))
      : htmlOptions.scripts;
  let html = renderDeckHtml(slides, {
    ...htmlOptions,
    ...(scripts ? { scripts } : {}),
    ...renderOptions,
    ...(fonts === 'link' ? { fontCss: linkedFonts('/__mds/fonts') } : {}),
  });
  // 書き出しでは、スライドに表示される文字だけに絞ったフォントを埋め込む（数式のフォントも同じ）
  let fontBytes: number | undefined;
  if (fonts === 'embed') {
    const subset = await subsetFontCss(visibleText(html), codeText(html), {
      serif: themeFonts(slides.meta.theme).includes(SERIF_FAMILY),
    });
    const mathSubset = math ? await subsetMathFontCss(math.used()) : { css: '', bytes: 0 };
    html = html.replace(
      '<style>',
      `<style>${subset.css}\n${mathSubset.css ? `${mathSubset.css}\n` : ''}`,
    );
    fontBytes = subset.bytes + mathSubset.bytes;
  }
  diagnostics.sort((a, b) => a.line - b.line);
  return {
    html,
    deck,
    slides,
    assets,
    diagnostics,
    ...(fontBytes !== undefined ? { fontBytes } : {}),
    ...(cssFile ? { cssFile } : {}),
  };
}

function decodeSrc(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

export interface BuildOptions {
  outDir: string;
  /** ヘッドレス Chromium で計測して自動で分割し、収まらないスライドを調べる（既定は行う） */
  measure?: boolean;
  /** 使っている文字だけに絞ったフォントを埋め込む（既定は埋め込む） */
  fonts?: boolean;
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
  /** 埋め込んだフォントの大きさ（バイト） */
  fontBytes?: number;
}

/** 静的な HTML・runtime・素材を書き出す（docs/design.md §10）。 */
export async function build(mdFile: string, options: BuildOptions): Promise<BuildResult> {
  const measurer = options.measure === false ? undefined : new ChromiumMeasurer();
  try {
    const rendered = await renderFile(
      mdFile,
      {
        scripts: [RUNTIME_SCRIPT],
        ...(options.fonts === false ? {} : { fonts: 'embed' as const }),
      },
      measurer,
    );
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
      ...(rendered.fontBytes !== undefined ? { fontBytes: rendered.fontBytes } : {}),
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
