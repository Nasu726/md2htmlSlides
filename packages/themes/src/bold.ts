import { FONT_MONO, FONT_SANS } from './fonts.js';

/**
 * bold テーマ：大きな文字と強い色面。LT・ピッチ向け（docs/design.md §6）。
 * 章扉とタイトルスライドはアクセントの色面にし、本文のスライドは白地に太い文字で見せる。
 * 文字が大きいぶん、自動分割で枚数は増える（計測はこのテーマの CSS で行う）。
 */
export const BOLD_TOKENS = `
  --mds-bg: #ffffff;
  --mds-fg: #111111;
  --mds-muted: #4b5563;
  --mds-accent: #ff4f00;
  --mds-surface: #f3f4f6;
  --mds-border: #d1d5db;
  --mds-code-bg: #111111;
  --mds-code-fg: #f9fafb;
  --mds-font-body: ${FONT_SANS};
  --mds-font-heading: var(--mds-font-body);
  --mds-font-mono: ${FONT_MONO};
  --mds-fs-title: 84px;
  --mds-fs-h1: 76px;
  --mds-fs-h2: 52px;
  --mds-fs-body: 31px;
  --mds-fs-small: 19px;
  --mds-gap: 24px;
  --mds-pad-x: 80px;
  --mds-pad-y: 56px;
  --mds-radius: 4px;
  /* 色面の色。accent: で変えると一緒に変わる（色面の中では --mds-accent を別の色にするため分ける） */
  --mds-strong: var(--mds-accent);
`;

export function boldCss(selector: string): string {
  return `
${selector} {${BOLD_TOKENS}}
${selector} .mds-title { font-weight: 800; letter-spacing: -0.01em; }
${selector} .mds-body h3, ${selector} .mds-body h4 { font-weight: 800; }
${selector} .layout-stack > .mds-title::after {
  content: '';
  display: block;
  width: 96px;
  height: 10px;
  margin-top: 16px;
  background: var(--mds-strong);
}
${selector} .mds-body ul { list-style: square; }
/* コードは大きくしない（本文が大きいぶん小さめの比にして、clean と同じ大きさにする） */
${selector} .mds-body pre { font-size: 0.65em; }
${selector} .mds-body strong { color: var(--mds-strong); }
${selector} .mds-body blockquote { border-left-width: 10px; color: var(--mds-fg); }
${selector} .mds-body th { color: var(--mds-fg); border-bottom-color: var(--mds-fg); }
/* 章扉とタイトルスライドは、アクセントの色面に白い文字 */
${selector} .layout-section:not([class*='has-bg-']),
${selector} .layout-title:not([class*='has-bg-']) {
  --mds-fg: #ffffff;
  --mds-muted: rgb(255 255 255 / 0.86);
  --mds-accent: #111111;
  --mds-surface: rgb(255 255 255 / 0.18);
  background: var(--mds-strong);
}
${selector} .layout-section .mds-title { font-weight: 900; }
${selector} .layout-section .mds-title::before { height: 12px; width: 96px; border-radius: 0; background: #ffffff; }
${selector} .layout-title .mds-title { font-weight: 900; }
`;
}
