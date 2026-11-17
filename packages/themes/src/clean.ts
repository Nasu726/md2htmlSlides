import { FONT_MONO, FONT_SANS } from './fonts.js';

/**
 * clean テーマ：白が基調で余白が広く、アクセントは控えめ（docs/design.md §6）。
 * デザイントークン（CSS カスタムプロパティ）と、テーマ固有の飾りだけを持つ。
 * レイアウトの格子は core の基本 CSS が持つ。
 */
export const CLEAN_TOKENS = `
  --mds-bg: #ffffff;
  --mds-fg: #0f172a;
  --mds-muted: #64748b;
  --mds-accent: #2563eb;
  --mds-surface: #f1f5f9;
  --mds-border: #e2e8f0;
  --mds-code-bg: #0f172a;
  --mds-code-fg: #e2e8f0;
  --mds-font-body: ${FONT_SANS};
  --mds-font-heading: var(--mds-font-body);
  --mds-font-mono: ${FONT_MONO};
  --mds-fs-title: 68px;
  --mds-fs-h1: 60px;
  --mds-fs-h2: 44px;
  --mds-fs-body: 28px;
  --mds-fs-small: 18px;
  --mds-gap: 22px;
  --mds-pad-x: 80px;
  --mds-pad-y: 60px;
  --mds-radius: 10px;
`;

export function cleanCss(selector: string): string {
  return `
${selector} {${CLEAN_TOKENS}}
${selector} .layout-stack > .mds-title::after {
  content: '';
  display: block;
  width: 56px;
  height: 5px;
  margin-top: 14px;
  border-radius: 3px;
  background: var(--mds-accent);
}
${selector} .layout-section {
  background: linear-gradient(135deg, var(--mds-surface), var(--mds-bg) 60%);
}
`;
}
