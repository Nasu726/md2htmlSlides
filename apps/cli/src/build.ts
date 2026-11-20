import {
  collectMedia,
  isLocalPath,
  renderDeckHtml,
  decodePath,
  type Deck,
  type Diagnostic,
  type RenderOptions,
  type SlideDeck,
  type MeasureJob,
} from '@mdhs/core';
import { ARCH_SCRIPT, RUNTIME_SCRIPT } from '@mdhs/runtime';
import { SERIF_FAMILY, themeFonts } from '@mdhs/themes';
import type { Browser } from 'playwright-core';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAssets, registerDeckAssets, type Assets } from './assets.js';
import { FONT_HOST, codeText, linkedFontCss, subsetFontCss, visibleText } from './fonts.js';
import { prepareDeck, type ArchItem } from '@mdhs/embeds';
import { codeHighlighter, codeLanguages } from '@mdhs/embeds/highlight';
import {
  linkedMathFontCss,
  mathEngine,
  mathLayoutCss,
  subsetMathFontCss,
  type MathEngine,
} from './math.js';
import { ChromiumMeasurer } from './measurer.js';

/**
 * 同梱するフォントの扱い（docs/design.md §6）。
 * - `embed`：スライドで使う文字だけに絞り、HTML に埋め込む（書き出し）
 * - `link`：分割ファイル一式を `/__mds/fonts/` から読み込む（`mdhs dev`）
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
  options: Pick<RenderOptions, 'scripts' | 'debug' | 'includeHidden'> & {
    fonts?: FontMode;
    /**
     * 単一 HTML（#120）：素材を data: URL で埋め込む。videoLimit（バイト）より大きい動画は
     * 埋め込まず、ポスター（なければ枠）にして警告する。計測は今までどおりの URL で行う
     */
    embed?: { videoLimit: number };
  } = {},
  measurer?: ChromiumMeasurer,
): Promise<Rendered> {
  const { fonts, embed, ...htmlOptions } = options;
  const source = readFileSync(mdFile, 'utf8');
  const assets = createAssets(mdFile);
  const readText = (src: string) => {
    const file = resolve(assets.root, src);
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  };
  // 数式（#72）：KaTeX は、資料に数式があるときだけ読み込む。CSS とフォントも、そのときだけ入れる
  let math: MathEngine | undefined;
  const linkedFonts = (prefix: string) =>
    linkedFontCss(prefix) + (math ? `\n${linkedMathFontCss(prefix)}` : '');

  // 資料の処理の流れは、エディタと共通（#170）。計測・図はヘッドレス Chromium で行う
  const prepared = await prepareDeck(source, {
    readText: async (src) => readText(src),
    probe: (src) => assets.probe(src),
    assetUrl: (src) => assets.url(src),
    parsed: (deck) => registerDeckAssets(deck, assets),
    // コードの色分け（#68）：資料で使っている言語の文法だけを読み込む
    highlighter: (text) => codeHighlighter(codeLanguages(text)),
    math: async () => {
      math = await mathEngine();
      return { render: math.render, layoutCss: mathLayoutCss() };
    },
    ...(fonts ? { pageFontCss: () => linkedFonts(FONT_HOST) } : {}),
    ...(measurer
      ? {
          luminance: async (srcs: string[]) => {
            const measured = await measurer.luminance(srcs.map((src) => resolve(assets.root, src)));
            const luminance = new Map<string, number>();
            for (const src of srcs) {
              const value = measured.get(resolve(assets.root, src));
              if (value !== undefined) luminance.set(src, value);
            }
            return luminance;
          },
          mermaid: (page: string, codes: string[]) => measurer.diagrams(page, codes),
          archs: (page: string, items: ArchItem[]) => measurer.archs(page, items),
          measure: (page: string, jobs: MeasureJob[]) => measurer.measure(page, jobs),
        }
      : {}),
  });
  const { deck, slides, diagnostics, archSources, options: renderOptions } = prepared;
  const cssFile = deck.meta.css ? resolve(assets.root, deck.meta.css) : undefined;

  // 動く構成図の再生（#108）：構成図があり、発表用の runtime を入れるときだけ、その前に入れる
  const scripts =
    archSources.length > 0 && htmlOptions.scripts?.includes(RUNTIME_SCRIPT)
      ? htmlOptions.scripts.flatMap((s) => (s === RUNTIME_SCRIPT ? [ARCH_SCRIPT, s] : [s]))
      : htmlOptions.scripts;
  // 単一 HTML（#120）：素材を data: URL にし、大きすぎる動画はポスター（なければ枠）にする
  const omitVideo = (src: string) => {
    const size = assets.bytes(src);
    return embed !== undefined && size !== undefined && tooLarge(size, embed.videoLimit);
  };
  if (embed) diagnostics.push(...omittedVideos(deck, assets, embed.videoLimit));
  let html = renderDeckHtml(slides, {
    ...htmlOptions,
    ...(scripts ? { scripts } : {}),
    ...renderOptions,
    ...(fonts === 'link' ? { fontCss: linkedFonts('/__mds/fonts') } : {}),
    ...(embed ? { assetUrl: (src: string) => assets.dataUrl(src), omitVideo } : {}),
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

/** 大きさの表示（1 MB 未満は KB） */
export const sizeText = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** 単一 HTML に埋め込まない（大きすぎる）動画の警告 */
/** 単一 HTML に埋め込まない動画か（上限 0 は「動画を埋め込まない」：0 バイトの動画も外す） */
const tooLarge = (size: number, limit: number) => limit <= 0 || size > limit;

function omittedVideos(deck: Deck, assets: Assets, limit: number): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const media of collectMedia(deck)) {
    if (media.kind !== 'video' || !isLocalPath(media.src)) continue;
    const src = decodePath(media.src);
    const size = assets.bytes(src);
    if (size === undefined || !tooLarge(size, limit)) continue;
    const poster = media.attrs?.values.poster;
    const instead =
      typeof poster === 'string'
        ? 'ポスターの画像を表示します'
        : media.attrs?.values.bg !== undefined
          ? '背景は暗い面にします（poster= で代わりの画像を指定できます）'
          : '枠だけを表示します（poster= で代わりの画像を指定できます）';
    out.push({
      severity: 'warning',
      code: 'export/video-omitted',
      message:
        limit <= 0
          ? `--video-limit 0 なので、単一 HTML には動画を埋め込みません：${src}。${instead}`
          : `動画が大きいので（${sizeText(size)}。上限 ${sizeText(limit)}）、単一 HTML には埋め込みません：${src}。${instead}`,
      line: media.line,
    });
  }
  return out;
}

export interface BuildOptions {
  outDir: string;
  /** ヘッドレス Chromium で計測して自動で分割し、収まらないスライドを調べる（既定は行う） */
  measure?: boolean;
  /** 使っている文字だけに絞ったフォントを埋め込む（既定は埋め込む） */
  fonts?: boolean;
  /** 素材をコピーせず、シンボリックリンクにする（`mdhs check`。作れなければコピーする） */
  linkAssets?: boolean;
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
      if (!options.linkAssets || !tryLink(from, to)) copyFileSync(from, to);
      copied++;
    }

    const result: BuildResult = {
      index,
      slides: rendered.slides.slides.filter((slide) => !slide.hidden).length,
      assets: copied,
      diagnostics: rendered.diagnostics,
      ...(rendered.fontBytes !== undefined ? { fontBytes: rendered.fontBytes } : {}),
    };
    if (measurer) await addOverflow(result, measurer, index);
    return result;
  } finally {
    await measurer?.close();
  }
}

/** シンボリックリンクを作る（Windows で権限がないときなど、作れなければ false） */
function tryLink(from: string, to: string): boolean {
  try {
    symlinkSync(resolve(from), to);
    return true;
  } catch {
    return false;
  }
}

/** 書き出した HTML を開いて、収まらないスライドの警告を足す（開けなければ理由を残す） */
async function addOverflow(
  result: { diagnostics: Diagnostic[]; measureError?: string },
  measurer: ChromiumMeasurer,
  file: string,
): Promise<void> {
  const browser = await measurer.browser();
  if (browser) {
    result.diagnostics = [...result.diagnostics, ...(await checkOverflow(file, browser))];
    result.diagnostics.sort((a, b) => a.line - b.line);
  } else {
    result.measureError = measurer.error ?? 'Chromium を起動できませんでした';
  }
}

/** 動画の上限（MB）をバイトにする。負の数（-1）は無制限、0 は動画を埋め込まない（#124） */
const videoLimitBytes = (mb: number) => (mb < 0 ? Infinity : mb * 1024 * 1024);

export interface SingleOptions {
  /** 書き出す HTML のパス */
  out: string;
  /** ヘッドレス Chromium で計測して自動で分割し、収まらないスライドを調べる（既定は行う） */
  measure?: boolean;
  /** 使っている文字だけに絞ったフォントを埋め込む（既定は埋め込む） */
  fonts?: boolean;
  /** これより大きい動画（MB）は埋め込まない（既定は 10。0 は動画を埋め込まない、-1 は無制限） */
  videoLimit?: number;
}

export interface SingleResult {
  /** 書き出した HTML の絶対パス */
  file: string;
  slides: number;
  /** HTML の大きさ（バイト） */
  bytes: number;
  /** 埋め込んだ素材（大きい順。パスは資料のフォルダから） */
  embedded: Array<{ src: string; bytes: number }>;
  diagnostics: Diagnostic[];
  measureError?: string;
}

/**
 * 素材を埋め込んだ HTML を1つだけ書き出す（#120、docs/design.md §10）。
 * ネットワークなしで開いて発表できる（YouTube・Vimeo を除く）。
 */
export async function buildSingle(mdFile: string, options: SingleOptions): Promise<SingleResult> {
  const measurer = options.measure === false ? undefined : new ChromiumMeasurer();
  try {
    const rendered = await renderFile(
      mdFile,
      {
        scripts: [RUNTIME_SCRIPT],
        ...(options.fonts === false ? {} : { fonts: 'embed' as const }),
        embed: { videoLimit: videoLimitBytes(options.videoLimit ?? 10) },
      },
      measurer,
    );
    const file = resolve(options.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, rendered.html);
    const root = rendered.assets.root;
    const result: SingleResult = {
      file,
      slides: rendered.slides.slides.filter((slide) => !slide.hidden).length,
      bytes: Buffer.byteLength(rendered.html),
      embedded: rendered.assets
        .embedded()
        .sort((a, b) => b[1] - a[1])
        .map(([path, bytes]) => ({
          src: relative(root, path).startsWith('..') ? path : relative(root, path),
          bytes,
        })),
      diagnostics: rendered.diagnostics,
    };
    if (measurer) await addOverflow(result, measurer, file);
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
