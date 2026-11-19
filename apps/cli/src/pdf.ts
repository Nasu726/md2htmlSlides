/**
 * PDF の書き出し（`mdhs pdf`、設計プラン §10、#70）。
 *
 * S5（#69）の結果に従い、書き出した HTML をヘッドレス Chromium で開いて `page.pdf()` で PDF にする。
 * 1スライド＝1ページ（ページの大きさはスライドと同じ）、文字は選択・検索できる。
 * 段階的表示は最終状態。`--steps`（フロントマター `pdf: { steps: each }`）ならステップごとのページ。
 */
import { parseDeck, type Diagnostic } from '@mdhs/core';
import { preparePrint } from '@mdhs/runtime';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build.js';
import { launchChromium } from './measurer.js';

export interface PdfOptions {
  /** 書き出す PDF のパス */
  out: string;
  /** ステップごとのページにする。省くとフロントマターの `pdf.steps` に従う */
  steps?: boolean;
  /** 計測して自動で分割する（既定は行う） */
  measure?: boolean;
}

export interface PdfResult {
  file: string;
  pages: number;
  bytes: number;
  diagnostics: Diagnostic[];
  /** Chromium を起動できなかった理由（このときは PDF を書き出していない） */
  error?: string;
}

export async function pdf(mdFile: string, options: PdfOptions): Promise<PdfResult> {
  const steps = options.steps ?? parseDeck(readFileSync(mdFile, 'utf8')).meta.pdf?.steps === 'each';
  // 素材をそろえるため、いったん一時フォルダに HTML として書き出す
  const dir = mkdtempSync(join(tmpdir(), 'mds-pdf-'));
  try {
    const built = await build(mdFile, { outDir: dir, measure: options.measure !== false });
    const launched = await launchChromium();
    if ('error' in launched) {
      return {
        file: options.out,
        pages: 0,
        bytes: 0,
        diagnostics: built.diagnostics,
        error: launched.error,
      };
    }
    const browser = launched.browser;
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(built.index).href);
      const mode: { steps: 'final' | 'each' } = { steps: steps ? 'each' : 'final' };
      const pages = await page.evaluate(preparePrint, mode);
      await page.pdf({ path: options.out, printBackground: true, preferCSSPageSize: true });
      return {
        file: options.out,
        pages,
        bytes: statSync(options.out).size,
        diagnostics: built.diagnostics,
      };
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
