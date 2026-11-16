import { hashString, measureJobs, type MeasureJob, type Measurement } from '@mds/core';
import type { Browser, Page } from 'playwright-core';

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
