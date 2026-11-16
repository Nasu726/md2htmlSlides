import type { Diagnostic } from '../diagnostics.js';

/**
 * markdown-it のプラグインに渡す情報。
 * markdown-it の Env（添字シグネチャ付き）と互換にするため、interface ではなく type にする。
 */
export type ParseEnv = {
  diagnostics: Diagnostic[];
  /** 本文の0行目が、元のファイルの何行目か */
  lineOffset: number;
  /** 閉じていないコンテナを、このレベル以上の見出しの直前で閉じる */
  implicitCloseLevel: number;
};

export function fileLine(env: ParseEnv, bodyLine: number): number {
  return env.lineOffset + bodyLine;
}
