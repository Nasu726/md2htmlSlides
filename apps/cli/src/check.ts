import type { Diagnostic, Severity } from '@mdhs/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './build.js';

export interface CheckOptions {
  /** ヘッドレス Chromium で計測し、あふれを調べる（既定は行う）。false なら構文の警告だけ */
  measure?: boolean;
}

export interface CheckResult {
  slides: number;
  diagnostics: Diagnostic[];
  /** 重さごとの数 */
  counts: Record<Severity, number>;
  /** 計測できなかった理由（Chromium が見つからないなど）。このときはあふれを調べていない */
  measureError?: string;
}

/**
 * `mdhs check`（#148）：書き出さずに資料を確かめる。
 * build と同じ処理（計測・分割・あふれの確認）を一時フォルダで行い、警告だけを返す。書き出したものは消す。
 * 素材はコピーせずリンクにする（大きな動画を毎回コピーしない）。
 */
export async function check(mdFile: string, options: CheckOptions = {}): Promise<CheckResult> {
  const measure = options.measure !== false;
  const dir = mkdtempSync(join(tmpdir(), 'mdhs-check-'));
  try {
    // フォントはあふれの確認に要る（文字の幅が変わる）。計測しないなら埋め込まない
    const result = await build(mdFile, { outDir: dir, measure, fonts: measure, linkAssets: true });
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const diagnostic of result.diagnostics) counts[diagnostic.severity]++;
    return {
      slides: result.slides,
      diagnostics: result.diagnostics,
      counts,
      ...(result.measureError ? { measureError: result.measureError } : {}),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 終了コード：エラーがあれば 1。strict なら警告があっても 1。情報（info）は数えない */
export function checkExitCode(counts: Record<Severity, number>, strict: boolean): number {
  return counts.error > 0 || (strict && counts.warning > 0) ? 1 : 0;
}
