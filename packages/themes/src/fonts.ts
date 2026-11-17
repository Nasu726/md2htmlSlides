/**
 * テーマで使う、同梱するフォント（docs/design.md §6、#67）。どれも OFL-1.1。
 *
 * 書体の名前は独自の名前（`MDS …`）にする。PC に同じフォントが入っていてもいなくても、
 * 同梱したものを使い、どの環境でも同じ字形・同じ改行の位置にするため。
 * ファイルは npm の fontsource の可変フォント（太さ 100〜900）を使う。
 */
export interface BundledFont {
  /** CSS の font-family の名前 */
  family: string;
  /** ファイルを持つ npm のパッケージ */
  package: string;
}

export const BUNDLED_FONTS = [
  { family: 'MDS Inter', package: '@fontsource-variable/inter' },
  { family: 'MDS Noto Sans JP', package: '@fontsource-variable/noto-sans-jp' },
  { family: 'MDS JetBrains Mono', package: '@fontsource-variable/jetbrains-mono' },
] as const satisfies readonly BundledFont[];

/** 同梱したフォントが読み込めなかったときに使う、OS のフォント */
const SANS_FALLBACK = `'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Meiryo', 'IPAPGothic', 'IPAexGothic', sans-serif`;

/** 本文・見出し：欧文は Inter、日本語は Noto Sans JP */
export const FONT_SANS = `'MDS Inter', 'MDS Noto Sans JP', ${SANS_FALLBACK}`;
/** コード：JetBrains Mono。日本語は Noto Sans JP */
export const FONT_MONO = `'MDS JetBrains Mono', 'MDS Noto Sans JP', ui-monospace, 'IPAGothic', monospace`;
