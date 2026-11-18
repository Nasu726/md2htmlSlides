import {
  averageLuminance,
  hashString,
  measureJobs,
  type DiagramResult,
  type MeasureJob,
  type Measurement,
} from '@mds/core';
import { renderArch, renderMermaid, type ArchRenderInput } from '@mds/runtime';
import { isThemeId, themeFonts } from '@mds/themes';
import type { Browser, Page } from 'playwright-core';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { FONT_HOST, fontFileFor } from './fonts.js';
import { mathFontFileFor } from './math.js';

const require = createRequire(import.meta.url);

/**
 * ヘッドレス Chromium で、自動分割のための高さを測る（docs/design.md §4、S1）。
 * ブラウザは1つを使い回し、結果はスライドの中身のハッシュでキャッシュする
 * （mds dev では、編集した節だけを測り直す）。
 */
export class ChromiumMeasurer {
  private browserPromise: Promise<Browser | undefined> | undefined;
  private page: Page | undefined;
  private pageHtml: string | undefined;
  private readonly cache = new Map<string, Measurement>();
  private readonly luminanceCache = new Map<string, number>();
  private diagramPage: Page | undefined;
  private diagramPageHtml: string | undefined;
  private readonly diagramCache = new Map<string, DiagramResult>();
  private archPage: Page | undefined;
  private archPageHtml: string | undefined;
  private readonly archCache = new Map<string, DiagramResult>();
  /** Chromium を起動できなかった理由 */
  error: string | undefined;

  /** ブラウザ（起動できなければ undefined）。収まらないスライドの確認にも使う。 */
  browser(): Promise<Browser | undefined> {
    this.browserPromise ??= launchChromium().then((result) => {
      if ('error' in result) {
        this.error = result.error;
        return undefined;
      }
      return result.browser;
    });
    return this.browserPromise;
  }

  /**
   * 測る。pageHtml はスライドを空にしたデッキの HTML（テーマ・カスタム CSS・縦横比をそろえるため）。
   * Chromium がなければ undefined を返す。
   */
  async measure(pageHtml: string, jobs: MeasureJob[]): Promise<Measurement[] | undefined> {
    const css = hashString(pageHtml);
    const keys = jobs.map((job) =>
      hashString(`${css}\n${job.skeleton}\n${job.atoms.join('\0')}\n${job.heads.join('\0')}`),
    );
    const missing = jobs.filter((_, i) => !this.cache.has(keys[i]!));
    if (missing.length > 0) {
      const browser = await this.browser();
      if (!browser) return undefined;
      const page = await this.measurePage(browser);
      if (this.pageHtml !== pageHtml) {
        await page.setContent(pageHtml);
        await page.evaluate('document.fonts.ready');
        // 数式のフォント（#72）は、書体・太さ・斜体ごとに分かれているので、一式を先に読み込む
        if (pageHtml.includes('KaTeX_')) {
          await page.evaluate(
            `Promise.all([...document.fonts].filter((f) => f.family.startsWith('KaTeX')).map((f) => f.load().catch(() => {})))`,
          );
        }
        this.pageHtml = pageHtml;
      }
      // フォントは文字を描くときに初めて読み込まれるので、測る文字の分を先に読み込んでおく
      // （読み込む前に測ると、代わりのフォントの幅で測ってしまう）
      if (pageHtml.includes(FONT_HOST)) {
        const text = missing
          .flatMap((job) => [job.skeleton, ...job.atoms, ...job.heads])
          .join(' ')
          .replace(/<[^>]*>/g, ' ');
        const families = JSON.stringify(fontFamiliesOf(pageHtml));
        await page.evaluate(
          `Promise.all(${families}.map((family) =>
            document.fonts.load('16px "' + family + '"', ${JSON.stringify(text)}).catch(() => [])))`,
        );
      }
      const results = await page.evaluate(measureJobs, missing);
      let r = 0;
      jobs.forEach((_, i) => {
        if (!this.cache.has(keys[i]!)) this.cache.set(keys[i]!, results[r++]!);
      });
    }
    return keys.map((key) => this.cache.get(key)!);
  }

  /** 計測用のページ。同梱するフォントのファイルを、架空の場所（FONT_HOST）から返す */
  private async measurePage(browser: Browser): Promise<Page> {
    if (this.page) return this.page;
    this.page = await fontPage(browser);
    return this.page;
  }

  /**
   * Mermaid の図を描く（#71）。pageHtml はスライドを空にしたデッキの HTML
   * （テーマの色とフォントを読むため）。結果はコードとテーマでキャッシュする（dev で描き直さない）。
   * Chromium がなければ undefined を返す。
   */
  async diagrams(
    pageHtml: string,
    codes: string[],
  ): Promise<Map<string, DiagramResult> | undefined> {
    const css = hashString(pageHtml);
    const key = (code: string) => hashString(`${css}\n${code}`);
    const unique = [...new Set(codes)];
    const missing = unique.filter((code) => !this.diagramCache.has(key(code)));
    if (missing.length > 0) {
      const browser = await this.browser();
      if (!browser) return undefined;
      this.diagramPage ??= await fontPage(browser);
      const page = this.diagramPage;
      if (this.diagramPageHtml !== pageHtml) {
        await page.setContent(pageHtml);
        await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
        this.diagramPageHtml = pageHtml;
      }
      // 図の中の文字の幅を正しく測れるよう、使う文字の分のフォントを先に読み込む
      if (pageHtml.includes(FONT_HOST)) {
        const families = JSON.stringify(fontFamiliesOf(pageHtml));
        await page.evaluate(
          `Promise.all(${families}.map((family) =>
            document.fonts.load('16px "' + family + '"', ${JSON.stringify(missing.join(' '))}).catch(() => [])))`,
        );
      }
      const ids = missing.map((code) => `mds-m-${key(code)}`);
      const results = await page.evaluate(renderMermaid, { codes: missing, ids });
      missing.forEach((code, i) => this.diagramCache.set(key(code), results[i]!));
    }
    return new Map(unique.map((code) => [code, this.diagramCache.get(key(code))!]));
  }

  /**
   * 動く構成図を配置して SVG にする（#107）。テーマの CSS と同梱のフォントのページに elkjs を入れ、
   * runtime の renderArch を呼ぶ。構成（とページの CSS）が同じなら、前の結果を使う。
   * Chromium がなければ undefined。結果は items と同じ順。
   */
  async archs(pageHtml: string, items: ArchRenderInput[]): Promise<DiagramResult[] | undefined> {
    const css = hashString(pageHtml);
    const key = (item: ArchRenderInput) => hashString(`${css}\n${JSON.stringify(item)}`);
    const missing = items.filter((item) => !this.archCache.has(key(item)));
    if (missing.length > 0) {
      const browser = await this.browser();
      if (!browser) return undefined;
      this.archPage ??= await fontPage(browser);
      const page = this.archPage;
      if (this.archPageHtml !== pageHtml) {
        await page.setContent(pageHtml);
        await page.addScriptTag({ path: require.resolve('elkjs/lib/elk.bundled.js') });
        this.archPageHtml = pageHtml;
      }
      // 表示名の幅を正しく測れるよう、使う文字の分のフォントを先に読み込む
      if (pageHtml.includes(FONT_HOST)) {
        const text = missing
          .flatMap((item) => [
            ...item.diagram.nodes.map((n) => n.label),
            ...item.diagram.groups.map((g) => g.label),
            ...item.diagram.edges.map((e) => e.label ?? ''),
          ])
          .join(' ');
        const families = JSON.stringify(fontFamiliesOf(pageHtml));
        await page.evaluate(
          `Promise.all(${families}.map((family) =>
            document.fonts.load('20px "' + family + '"', ${JSON.stringify(text)}).catch(() => [])))`,
        );
      }
      const results = await page.evaluate(renderArch, { items: missing });
      missing.forEach((item, i) => this.archCache.set(key(item), results[i]!));
    }
    return items.map((item) => this.archCache.get(key(item))!);
  }

  /**
   * 背景の画像・動画（最初のフレーム）の明るさ（0〜1）を測る。文字色を選ぶのに使う（構文仕様 §6.2）。
   * 測れなかったファイルは結果に含めない。
   */
  async luminance(paths: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const todo: Array<{ path: string; key: string; url: string; video: boolean }> = [];
    for (const path of new Set(paths)) {
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      // 大きすぎる動画は測らない（文字色は既定の明るい文字になる）
      if (!stat.isFile() || stat.size > 30 * 1024 * 1024) continue;
      const key = `${path}\n${stat.mtimeMs}`;
      const cached = this.luminanceCache.get(key);
      if (cached !== undefined) {
        result.set(path, cached);
        continue;
      }
      const ext = extname(path).slice(1).toLowerCase();
      const video = ['mp4', 'webm', 'mov', 'm4v'].includes(ext);
      const type = video ? `video/${ext === 'mov' ? 'quicktime' : ext}` : MIME[ext];
      if (!type) continue;
      const url = `data:${type};base64,${readFileSync(path).toString('base64')}`;
      todo.push({ path, key, url, video });
    }
    if (todo.length === 0) return result;
    const browser = await this.browser();
    if (!browser) return result;
    const page = await this.measurePage(browser);
    const values = await page.evaluate(
      averageLuminance,
      todo.map(({ url, video }) => ({ url, video })),
    );
    todo.forEach((item, i) => {
      const value = values[i];
      if (typeof value !== 'number') return;
      this.luminanceCache.set(item.key, value);
      result.set(item.path, value);
    });
    return result;
  }

  async close(): Promise<void> {
    const browser = await this.browserPromise;
    await browser?.close();
    this.browserPromise = undefined;
    this.page = undefined;
    this.pageHtml = undefined;
    this.diagramPage = undefined;
    this.diagramPageHtml = undefined;
    this.archPage = undefined;
    this.archPageHtml = undefined;
  }
}

/** 同梱するフォントのファイルを、架空の場所（FONT_HOST）から返すページ */
async function fontPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route(`${FONT_HOST}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const file = fontFileFor(path) ?? mathFontFileFor(path);
    if (!file) return route.abort();
    await route.fulfill({
      body: readFileSync(file),
      contentType: 'font/woff2',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return page;
}

/** ヘッドレス Chromium を起動する（Playwright の Chromium、なければ PC の Chrome） */
export async function launchChromium(): Promise<{ browser: Browser } | { error: string }> {
  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return { error: 'playwright-core を読み込めませんでした' };
  }
  for (const options of [{}, { channel: 'chrome' }]) {
    try {
      return { browser: await chromium.launch(options) };
    } catch {
      // 次の方法を試す
    }
  }
  return { error: 'Chromium が見つかりません（npx playwright install chromium で入れられます）' };
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** ページのテーマが使う書体（明朝体は academic だけ。#93） */
function fontFamiliesOf(pageHtml: string): string[] {
  const theme = /class="mds-deck theme-([\w-]+)/.exec(pageHtml)?.[1] ?? 'clean';
  return themeFonts(isThemeId(theme) ? theme : 'clean');
}
