import { FONT_MONO, FONT_SANS } from './fonts.js';

/**
 * dark テーマ：背景が暗く、コードと図が映える。技術発表向け（docs/design.md §6）。
 * 寸法（文字の大きさ・余白）は clean と同じにし、色と飾りだけを変える。
 */
export const DARK_TOKENS = `
  --mds-bg: #0b1120;
  --mds-fg: #e2e8f0;
  --mds-muted: #94a3b8;
  --mds-accent: #38bdf8;
  --mds-surface: #1e293b;
  --mds-border: #334155;
  --mds-code-bg: #020617;
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
  /* コードの色分け（#68）：落ち着いた地に、明るめの色 */
  --mds-code-token-keyword: #c792ea;
  --mds-code-token-string: #c3e88d;
  --mds-code-token-string-expression: #c3e88d;
  --mds-code-token-comment: #7c84ab;
  --mds-code-token-function: #82aaff;
  --mds-code-token-constant: #f78c6c;
  --mds-code-token-parameter: #ffcb6b;
  --mds-code-token-punctuation: #89ddff;
  --mds-code-token-link: #7dd3fc;
`;

export function darkCss(selector: string): string {
  return `
${selector} {${DARK_TOKENS}}
${selector} .mds-slide { box-shadow: 0 2px 14px rgb(0 0 0 / 0.45); }
${selector} .layout-stack > .mds-title::after {
  content: '';
  display: block;
  width: 56px;
  height: 5px;
  margin-top: 14px;
  border-radius: 3px;
  background: var(--mds-accent);
}
${selector} .layout-section,
${selector} .layout-title {
  background:
    radial-gradient(ellipse 70% 90% at 100% 0%, color-mix(in srgb, var(--mds-accent) 22%, transparent), transparent 70%),
    var(--mds-bg);
}
${selector} .mds-body pre { border: 1px solid var(--mds-border); }
${selector} .mds-body th { color: var(--mds-fg); }
${selector} .mds-alert-note { --mds-alert-fg: #60a5fa; --mds-alert-bg: rgb(96 165 250 / 0.12); }
${selector} .mds-alert-tip { --mds-alert-fg: #4ade80; --mds-alert-bg: rgb(74 222 128 / 0.12); }
${selector} .mds-alert-important { --mds-alert-fg: #c084fc; --mds-alert-bg: rgb(192 132 252 / 0.12); }
${selector} .mds-alert-warning { --mds-alert-fg: #fbbf24; --mds-alert-bg: rgb(251 191 36 / 0.12); }
${selector} .mds-alert-caution { --mds-alert-fg: #f87171; --mds-alert-bg: rgb(248 113 113 / 0.12); }
`;
}
