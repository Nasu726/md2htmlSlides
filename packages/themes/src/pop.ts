import { FONT_MONO, FONT_SANS } from './fonts.js';

/**
 * pop テーマ：明るい色と丸み、太い見出し。勉強会・LT 向け（#93）。
 * - 見出しに蛍光ペンの線、小見出しはラベル（丸い札）
 * - 箇条書きの印は、項目ごとに色が変わる
 * - カードと引用は、太い枠と、ずらした影
 * - 章扉はアクセントの色面に、丸い模様
 */
export const POP_TOKENS = `
  --mds-bg: #fffaf0;
  --mds-fg: #2b2d42;
  --mds-muted: #676b85;
  --mds-accent: #ff4d6d;
  /* 小さな文字に使うアクセントの色（明るいピンクのままだと地の色で 3.1:1 なので、少し暗くする。#131） */
  --mds-accent-text: color-mix(in srgb, var(--mds-accent) 78%, #000);
  --mds-surface: #ffffff;
  --mds-border: #2b2d42;
  --mds-code-bg: #2b2d42;
  --mds-code-fg: #f8f9fa;
  --mds-font-body: ${FONT_SANS};
  --mds-font-heading: var(--mds-font-body);
  --mds-font-mono: ${FONT_MONO};
  --mds-fs-title: 76px;
  --mds-fs-h1: 68px;
  --mds-fs-h2: 46px;
  --mds-fs-body: 28px;
  --mds-fs-small: 18px;
  --mds-gap: 22px;
  --mds-pad-x: 76px;
  --mds-pad-y: 54px;
  --mds-radius: 18px;
  /* 色の組み合わせ（アクセントのほかに3色） */
  --mds-pop-yellow: #ffbe0b;
  --mds-pop-blue: #3a86ff;
  --mds-pop-mint: #06c595;
  --mds-pop-marker: color-mix(in srgb, var(--mds-pop-yellow) 75%, transparent);
  /* コードの色分け（#68）：濃い紺の地に、はっきりした色 */
  --mds-code-token-keyword: #ff7096;
  --mds-code-token-string: #ffd166;
  --mds-code-token-string-expression: #ffd166;
  --mds-code-token-comment: #9a9db5;
  --mds-code-token-function: #4cc9f0;
  --mds-code-token-constant: #80ffdb;
  --mds-code-token-parameter: #ffb86b;
  --mds-code-token-punctuation: #e9ecef;
  --mds-code-token-link: #90caff;
`;

export function popCss(selector: string): string {
  return `
${selector} {${POP_TOKENS}}
${selector} .mds-title { font-weight: 900; letter-spacing: 0.01em; }
/* 見出し：行ごとに蛍光ペンの線（文字の下半分に重ねる） */
${selector} .mds-slide:is(.layout-stack, .layout-split, .layout-columns, .layout-grid) > .mds-title {
  text-decoration: underline;
  text-decoration-color: var(--mds-pop-marker);
  text-decoration-thickness: 0.36em;
  text-underline-offset: -0.2em;
  text-decoration-skip-ink: none;
}
${selector} .mds-chapter {
  align-self: flex-start;
  padding: 0.15em 0.8em;
  border-radius: 999px;
  background: var(--mds-fg);
  color: var(--mds-bg);
}
/* 小見出し：丸い札 */
${selector} .mds-body h3, ${selector} .mds-body h4 {
  align-self: flex-start;
  width: fit-content;
  padding: 0.12em 0.7em;
  border-radius: 999px;
  background: var(--mds-pop-blue);
  color: #ffffff;
  font-weight: 800;
}
${selector} .mds-card h3, ${selector} .mds-card h4 { background: var(--mds-accent); }
/* 箇条書きの印：項目ごとに色を変える */
${selector} .mds-body li::marker { font-size: 1.15em; }
${selector} .mds-body li:nth-child(4n + 2)::marker { color: var(--mds-pop-blue); }
${selector} .mds-body li:nth-child(4n + 3)::marker { color: var(--mds-pop-yellow); }
${selector} .mds-body li:nth-child(4n + 4)::marker { color: var(--mds-pop-mint); }
${selector} .mds-body strong { background: linear-gradient(transparent 60%, var(--mds-pop-marker) 60%); }
${selector} .mds-body code { background: color-mix(in srgb, var(--mds-pop-yellow) 28%, #fff); }
${selector} .mds-body pre code { background: none; }
/* カード・引用：太い枠と、ずらした影 */
${selector} .mds-card,
${selector} .mds-body blockquote {
  border: 3px solid var(--mds-fg);
  border-radius: var(--mds-radius);
  background: var(--mds-surface);
  box-shadow: 6px 6px 0 var(--mds-fg);
}
${selector} .mds-body blockquote { padding: 0.5em 0.9em; color: var(--mds-fg); }
${selector} .mds-body pre { box-shadow: 6px 6px 0 var(--mds-accent); }
${selector} .mds-body th { color: var(--mds-fg); background: var(--mds-pop-yellow); border-bottom: none; font-weight: 800; }
${selector} .mds-body th:first-child { border-radius: 10px 0 0 10px; }
${selector} .mds-body th:last-child { border-radius: 0 10px 10px 0; }
${selector} .mds-body td { border-bottom: 2px dashed color-mix(in srgb, var(--mds-fg) 22%, transparent); }
${selector} .mds-page {
  padding: 0.1em 0.75em;
  border-radius: 999px;
  background: var(--mds-fg);
  color: var(--mds-bg);
  font-weight: 700;
}
/* 章扉：アクセントの色面に、丸い模様 */
${selector} .layout-section:not([class*='has-bg-']) {
  --mds-fg: #ffffff;
  --mds-muted: rgb(255 255 255 / 0.9);
  --mds-accent: var(--mds-pop-yellow);
  background:
    radial-gradient(circle at 88% 18%, var(--mds-pop-yellow) 0 70px, transparent 71px),
    radial-gradient(circle at 96% 78%, var(--mds-pop-blue) 0 120px, transparent 121px),
    radial-gradient(circle at 76% 92%, var(--mds-pop-mint) 0 44px, transparent 45px),
    #ff4d6d;
}
${selector} .layout-section .mds-title { font-weight: 900; }
${selector} .layout-section .mds-page { background: rgb(255 255 255 / 0.28); color: #ffffff; }
${selector} .layout-section .mds-title::before { width: 88px; height: 12px; border-radius: 999px; }
/* タイトルスライド：明るい地に、丸い模様 */
${selector} .layout-title:not([class*='has-bg-']) {
  background:
    radial-gradient(circle at 92% 12%, var(--mds-pop-yellow) 0 110px, transparent 111px),
    radial-gradient(circle at 4% 96%, var(--mds-pop-blue) 0 90px, transparent 91px),
    radial-gradient(circle at 98% 88%, var(--mds-accent) 0 64px, transparent 65px),
    radial-gradient(circle at 12% 8%, var(--mds-pop-mint) 0 36px, transparent 37px),
    var(--mds-bg);
}
${selector} .layout-title .mds-title { font-weight: 900; }
${selector} .mds-event {
  align-self: inherit;
  width: fit-content;
  padding: 0.25em 0.9em;
  border-radius: 999px;
  background: var(--mds-accent-text);
  color: #ffffff;
}
`;
}
