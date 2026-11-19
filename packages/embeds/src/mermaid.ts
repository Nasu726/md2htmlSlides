/**
 * Mermaid の図（#71）の補助。描くのは runtime の renderMermaid（ブラウザの中で動く）。
 * CLI（ヘッドレス Chromium）と Web エディタ（計測用の iframe）で共有する（#84）。
 */
import { collectMedia, decodePath, isLocalPath, type Deck, type Diagnostic } from '@mds/core';

/** 図にする Mermaid のコード（```mermaid と、`![](flow.mmd)` で参照するファイル） */
export interface MermaidSource {
  code: string;
  /** コードブロックの開始の行（```mermaid の行）、またはファイルを参照した行 */
  line: number;
  /** ファイルを参照したとき（資料のフォルダからのパス） */
  src?: string;
}

/**
 * 資料の中の Mermaid を、出てくる順に集める。`.mmd` のファイルは read で読む（なければ undefined を返す）。
 */
export function collectMermaid(
  source: string,
  deck: Deck,
  read: (src: string) => string | undefined,
): MermaidSource[] {
  const found: MermaidSource[] = [];
  const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;
  for (const m of source.matchAll(fence)) {
    found.push({ code: m[3]!, line: source.slice(0, m.index).split('\n').length });
  }
  for (const media of collectMedia(deck)) {
    if (media.kind !== 'diagram' || !isLocalPath(media.src)) continue;
    const src = decodePath(media.src);
    const code = read(src);
    if (code === undefined) continue;
    found.push({ code, line: media.line, src });
  }
  return found;
}

/** コードブロックの中身と、markdown-it が渡す中身を同じキーにする（末尾の空白・改行を除く） */
export const normalizeCode = (code: string) => code.replace(/\s+$/, '');

/** Mermaid の構文エラーの警告。「line N」があれば、コードブロックの中の行に直す */
export function diagramDiagnostic(item: MermaidSource, error: string): Diagnostic {
  const first = error.split('\n')[0] ?? error;
  const inner = Number(/line (\d+)/i.exec(first)?.[1]);
  const lines = item.code.split('\n').length;
  const line =
    item.src === undefined && inner >= 1 && inner <= lines ? item.line + inner : item.line;
  return {
    severity: 'warning',
    code: 'diagram/mermaid-error',
    message: `Mermaid の図を描けません：${first}${item.src ? `（${item.src}）` : ''}`,
    line,
  };
}
