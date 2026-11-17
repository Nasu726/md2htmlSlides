/** 図として描くコード（構文仕様 §7）。色分けしない */
export const FIGURE_LANGS = new Set(['mermaid', 'arch', 'math']);

/** 資料の中のコードブロックの言語名（```ts の ts） */
export function codeLanguages(source: string): string[] {
  const langs = Array.from(source.matchAll(/^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm), (m) =>
    m[1]!.toLowerCase(),
  );
  return [...new Set(langs)];
}

/** 色分けする言語（図にする言語を除く）があるか。あれば Shiki を読み込む */
export const needsHighlighter = (source: string) =>
  codeLanguages(source).some((lang) => !FIGURE_LANGS.has(lang));
