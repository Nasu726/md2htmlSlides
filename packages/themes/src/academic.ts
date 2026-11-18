import { FONT_MONO, FONT_SANS, FONT_SERIF } from './fonts.js';

/**
 * academic テーマ：学会・講義向け（#93）。
 * - 見出しは明朝体（Noto Serif JP）、本文は読みやすいゴシック体
 * - 落ち着いた臙脂（えんじ）色、見出しの下の罫線、論文の表（上下に太い罫線、縦線なし）
 * - コードは明るい地（印刷・投影で読みやすい）
 */
export const ACADEMIC_TOKENS = `
  --mds-bg: #ffffff;
  --mds-fg: #1f2328;
  --mds-muted: #5b6370;
  --mds-accent: #8f1d2c;
  --mds-surface: #f5f4ef;
  --mds-border: #d6d3cb;
  --mds-code-bg: #f5f4ef;
  --mds-code-fg: #1f2328;
  --mds-font-body: ${FONT_SANS};
  --mds-font-heading: ${FONT_SERIF};
  --mds-font-mono: ${FONT_MONO};
  --mds-fs-title: 60px;
  --mds-fs-h1: 54px;
  --mds-fs-h2: 42px;
  --mds-fs-body: 26px;
  --mds-fs-small: 17px;
  --mds-gap: 20px;
  --mds-pad-x: 80px;
  --mds-pad-y: 56px;
  --mds-radius: 3px;
  /* コードの色分け（#68）：明るい地に、落ち着いた色 */
  --mds-code-token-keyword: #a2223a;
  --mds-code-token-string: #0b5a3a;
  --mds-code-token-string-expression: #0b5a3a;
  --mds-code-token-comment: #6e7781;
  --mds-code-token-function: #5b3cc4;
  --mds-code-token-constant: #0550ae;
  --mds-code-token-parameter: #8a4600;
  --mds-code-token-punctuation: #39404a;
  --mds-code-token-link: #0550ae;
  --mds-code-token-inserted: #116329;
  --mds-code-token-deleted: #82071e;
  --mds-code-token-changed: #8a4600;
`;

const TITLED = ':is(.layout-stack, .layout-split, .layout-columns, .layout-grid)';

export function academicCss(selector: string): string {
  return `
${selector} {${ACADEMIC_TOKENS}}
${selector} .mds-title { font-weight: 700; letter-spacing: 0.01em; }
/* 見出しの下に、端から端までの罫線（細い線の上に、アクセントの短い線） */
${selector} .mds-slide${TITLED} > .mds-title {
  padding-bottom: 0.3em;
  background:
    linear-gradient(var(--mds-accent), var(--mds-accent)) left bottom / 3.2em 4px no-repeat,
    linear-gradient(var(--mds-border), var(--mds-border)) left bottom / 100% 1px no-repeat;
}
${selector} .mds-chapter { font-weight: 600; letter-spacing: 0.12em; }
${selector} .mds-body h3, ${selector} .mds-body h4 { font-weight: 700; color: var(--mds-accent); }
${selector} .mds-body strong { color: var(--mds-accent); }
${selector} .mds-body pre { border: 1px solid var(--mds-border); }
${selector} .mds-body code { background: var(--mds-surface); }
${selector} .mds-body pre code { background: none; }
/* 論文の表：上下に太い罫線、見出し行の下に細い罫線、縦線なし */
${selector} .mds-body table { border-top: 2px solid var(--mds-fg); border-bottom: 2px solid var(--mds-fg); }
${selector} .mds-body th { color: var(--mds-fg); font-weight: 700; border-bottom: 1px solid var(--mds-fg); }
${selector} .mds-body td { border-bottom: none; }
${selector} .mds-body blockquote { border-left-width: 3px; border-left-color: var(--mds-border); font-family: var(--mds-font-heading); color: var(--mds-fg); }
${selector} .mds-body figcaption, ${selector} .mds-media figcaption { font-family: var(--mds-font-heading); }
${selector} .mds-card { background: none; border: 1px solid var(--mds-border); border-top: 3px solid var(--mds-accent); }
/* フッター：上に細い罫線 */
${selector} .mds-footer { padding-top: 6px; border-top: 1px solid var(--mds-border); }
/* 章扉：左寄せ。見出しの上下に罫線 */
${selector} .layout-section:not([class*='has-bg-']) { background: var(--mds-surface); }
${selector} .layout-section .mds-title { padding-bottom: 0.35em; border-bottom: 1px solid var(--mds-fg); }
${selector} .layout-section .mds-title::before { width: 100%; height: 3px; margin-bottom: 0.4em; border-radius: 0; }
/* タイトルスライド：タイトルを罫線で挟む */
${selector} .layout-title .mds-title {
  padding: 0.3em 0;
  border-top: 3px solid var(--mds-accent);
  border-bottom: 1px solid var(--mds-fg);
}
${selector} .layout-title .mds-subtitle { font-family: var(--mds-font-heading); }
`;
}
