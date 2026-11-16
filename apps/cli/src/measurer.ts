import {
  averageLuminance,
  hashString,
  measureJobs,
  type MeasureJob,
  type Measurement,
} from '@mds/core';
import type { Browser, Page } from 'playwright-core';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

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
  /** Chromium を起動できなかった理由 */
  error: string | undefined;

  /** ブラウザ（起動できなければ undefined）。収まらないスライドの確認にも使う。 */
  browser(): Promise<Browser | undefined> {
    this.browserPromise ??= launch().then((result) => {
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
      this.page ??= await browser.newPage({ viewport: { width: 1400, height: 900 } });
      if (this.pageHtml !== pageHtml) {
        await this.page.setContent(pageHtml);
        await this.page.evaluate('document.fonts.ready');
        this.pageHtml = pageHtml;
      }
      const results = await this.page.evaluate(measureJobs, missing);
      let r = 0;
      jobs.forEach((_, i) => {
        if (!this.cache.has(keys[i]!)) this.cache.set(keys[i]!, results[r++]!);
      });
    }
    return keys.map((key) => this.cache.get(key)!);
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
    this.page ??= await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const values = await this.page.evaluate(
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
  }
}

async function launch(): Promise<{ browser: Browser } | { error: string }> {
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
