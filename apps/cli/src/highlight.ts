/**
 * コードの色分け（#68）。Shiki で書き出しのときに色を付け、発表用の runtime は大きくしない。
 *
 * 配色は Shiki の「CSS 変数のテーマ」を使い、span に `color: var(--mds-code-token-…)` を書く。
 * 色の値はテーマ（clean・dark・bold）の CSS が決めるので、テーマを変えても色分けをやり直さなくてよい。
 * 文字は変えずに span で囲むだけなので、コードの高さ（計測）は変わらない。
 */
import type { CodeHighlighter } from '@mds/core';
import {
  bundledLanguages,
  createCssVariablesTheme,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from 'shiki';

const THEME = createCssVariablesTheme({
  name: 'mds',
  variablePrefix: '--mds-code-',
  variableDefaults: {},
  fontStyle: true,
});
/** 図として描くコード（構文仕様 §7）。色分けしない */
const FIGURE = new Set(['mermaid', 'arch', 'math']);
const FOREGROUND = 'var(--mds-code-foreground)';

let shared: Promise<Highlighter> | undefined;

/** 資料の中のコードブロックの言語名（```ts の ts） */
export function codeLanguages(source: string): string[] {
  const langs = Array.from(source.matchAll(/^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm), (m) =>
    m[1]!.toLowerCase(),
  );
  return [...new Set(langs)];
}

/**
 * 色分けの関数を作る。使う言語の文法だけを読み込む（Highlighter は使い回し、足りない文法だけを足す）。
 * Shiki が知らない言語・図にする言語は undefined を返し、色を付けずに出す。
 */
export async function codeHighlighter(langs: Iterable<string>): Promise<CodeHighlighter> {
  const wanted = new Set(
    [...langs]
      .map((lang) => lang.toLowerCase())
      .filter((lang) => !FIGURE.has(lang) && lang in bundledLanguages),
  );
  shared ??= createHighlighter({ themes: [THEME], langs: [] });
  const highlighter = await shared;
  const loaded = new Set(highlighter.getLoadedLanguages());
  const missing = [...wanted].filter((lang) => !loaded.has(lang)) as BundledLanguage[];
  if (missing.length > 0) await highlighter.loadLanguage(...missing);

  return (code, lang) => {
    const name = lang.toLowerCase();
    if (!wanted.has(name)) return undefined;
    const lines = highlighter.codeToTokensBase(code, {
      lang: name as BundledLanguage,
      theme: THEME,
    });
    return lines
      .map((line) =>
        line
          .map((token) => {
            const text = escapeHtml(token.content);
            const styles: string[] = [];
            if (token.color && token.color !== FOREGROUND) styles.push(`color:${token.color}`);
            // fontStyle：1 = 斜体、2 = 太字（Shiki の FontStyle）
            if (token.fontStyle && token.fontStyle & 1) styles.push('font-style:italic');
            if (token.fontStyle && token.fontStyle & 2) styles.push('font-weight:700');
            return styles.length > 0 ? `<span style="${styles.join(';')}">${text}</span>` : text;
          })
          .join(''),
      )
      .join('\n');
  };
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}
