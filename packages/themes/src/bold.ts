import { FONT_MONO, FONT_SANS } from './fonts.js';

/**
 * bold テーマ：大きな文字と強い色。LT・ピッチ向け（docs/design.md §6）。
 * どのスライドも白地に太い文字。タイトルスライドと章扉は、見出しの下のアクセントの太い線で見せる
 * （一面を色で塗ると主張が強すぎるため。#100・#114・#137）。
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
  /* 見出しの下の線・強調の色。accent: で変えると一緒に変わる */
  --mds-strong: var(--mds-accent);
  /* 小さな文字に使うアクセントの色（明るいオレンジのままだと白地で 3.3:1 なので、少し暗くする。#131） */
  --mds-accent-text: color-mix(in srgb, var(--mds-accent) 78%, #000);
  /* コードの色分け（#68）：黒い地に、はっきりした色。キーワードはアクセントに近いオレンジ */
  --mds-code-token-keyword: #ff8a50;
  --mds-code-token-string: #fde047;
  --mds-code-token-string-expression: #fde047;
  --mds-code-token-comment: #9ca3af;
  --mds-code-token-function: #67e8f9;
  --mds-code-token-constant: #f9a8d4;
  --mds-code-token-parameter: #fdba74;
  --mds-code-token-punctuation: #e5e7eb;
  --mds-code-token-link: #93c5fd;
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
/*
 * タイトルスライド：白地のまま、見出しの下にアクセントの色の太い線（#137 の A 案。章扉と同じ形）。
 * 背景画像のあるタイトルスライドは、線を付けない
 */
${selector} .layout-title .mds-title { font-weight: 900; }
${selector} .layout-title:not([class*='has-bg-']) .mds-title {
  width: fit-content;
  max-width: 100%;
  padding-bottom: 0.18em;
  border-bottom: 14px solid var(--mds-strong);
}
/*
 * 章扉：白地のまま、見出しの下にアクセントの色の太い線（#100・#114）。
 * 一面を色で塗ると主張が強すぎるため。番号は付けない。背景画像のある章扉は、白い短い線だけ
 */
${selector} .layout-section .mds-title { font-weight: 900; }
${selector} .layout-section[class*='has-bg-'] .mds-title::before { height: 12px; width: 96px; border-radius: 0; background: #ffffff; }
${selector} .layout-section:not([class*='has-bg-']) .mds-title::before { display: none; }
${selector} .layout-section:not([class*='has-bg-']) .mds-title {
  width: fit-content;
  max-width: 100%;
  padding-bottom: 0.22em;
  border-bottom: 12px solid var(--mds-strong);
}
`;
}
