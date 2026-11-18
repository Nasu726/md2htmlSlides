import { FONT_MONO, FONT_SANS } from './fonts.js';

/**
 * band テーマ：見出しとフッターに色の帯がある。社内資料・報告向け（#93）。
 * - 本文のスライド：見出し（と章の名前）を上の帯に入れ、下にフッターの帯を敷く
 * - タイトルスライドと章扉：帯の色の面に白い文字
 * 帯の色は accent に合わせて変わる（`accent:` で会社の色にできる）。
 */
export const BAND_TOKENS = `
  --mds-bg: #ffffff;
  --mds-fg: #1e293b;
  --mds-muted: #64748b;
  --mds-accent: #1e40af;
  --mds-surface: #eef2f7;
  --mds-border: #d5dde8;
  --mds-code-bg: #0f172a;
  --mds-code-fg: #e2e8f0;
  --mds-font-body: ${FONT_SANS};
  --mds-font-heading: var(--mds-font-body);
  --mds-font-mono: ${FONT_MONO};
  --mds-fs-title: 64px;
  --mds-fs-h1: 58px;
  --mds-fs-h2: 40px;
  --mds-fs-body: 27px;
  --mds-fs-small: 17px;
  --mds-gap: 22px;
  --mds-pad-x: 72px;
  --mds-pad-y: 52px;
  --mds-radius: 6px;
  /* 帯の色。上の帯は accent、下の帯は少し暗くする */
  --mds-band: var(--mds-accent);
  --mds-band-dark: color-mix(in srgb, var(--mds-band) 78%, #000);
  --mds-band-fg: #ffffff;
  /* 下の帯の高さ */
  --mds-band-foot: 46px;
`;

/** 見出しの帯を出すレイアウト（タイトルの領域があるもの） */
const TITLED = ':is(.layout-stack, .layout-split, .layout-columns, .layout-grid)';

export function bandCss(selector: string): string {
  return `
${selector} {${BAND_TOKENS}}
${selector} .mds-slide { padding-bottom: calc(var(--mds-band-foot) + 30px); }
/* 下の帯（フッターの文字とページ番号を、帯の上に白で出す） */
${selector} .mds-slide::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--mds-band-foot);
  background: var(--mds-band-dark);
}
${selector} .mds-footer {
  bottom: 0;
  height: var(--mds-band-foot);
  align-items: center;
  color: var(--mds-band-fg);
  font-weight: 600;
}
${selector} .mds-footer > span:first-child { opacity: 0.85; font-weight: 400; }
/* 全面の背景画像のスライドには、下の帯を敷かない */
${selector} .mds-slide.has-bg-full::after { display: none; }
/* 上の帯：章の名前と見出しを、スライドの端まで広げた帯に入れる */
${selector} .mds-slide${TITLED} > .mds-chapter,
${selector} .mds-slide${TITLED} > .mds-title {
  margin-left: calc(var(--mds-pad-x) * -1);
  margin-right: calc(var(--mds-pad-x) * -1);
  padding-left: var(--mds-pad-x);
  padding-right: var(--mds-pad-x);
  background: var(--mds-band);
  color: var(--mds-band-fg);
}
${selector} .mds-slide${TITLED} > :is(.mds-chapter, .mds-title):first-child {
  margin-top: calc(var(--mds-pad-y) * -1);
  padding-top: calc(var(--mds-pad-y) * 0.55);
}
${selector} .mds-slide${TITLED} > .mds-chapter {
  margin-bottom: calc(var(--mds-gap) * -1);
  padding-bottom: 6px;
  color: color-mix(in srgb, var(--mds-band-fg) 78%, transparent);
}
${selector} .mds-slide${TITLED} > .mds-title {
  padding-bottom: 0.42em;
  margin-bottom: 6px;
  font-size: calc(var(--mds-fs-h2) * 0.95);
  box-shadow: 0 6px 0 var(--mds-band-dark);
}
/* 左右の半分が背景のときは、帯を本文の側だけにする */
${selector} .mds-slide.has-bg-left${TITLED} > :is(.mds-chapter, .mds-title) { margin-left: -48px; padding-left: 48px; }
${selector} .mds-slide.has-bg-right${TITLED} > :is(.mds-chapter, .mds-title) { margin-right: -48px; padding-right: 48px; }
${selector} .mds-body h3, ${selector} .mds-body h4 {
  padding-left: 0.5em;
  border-left: 0.28em solid var(--mds-band);
  line-height: 1.3;
}
${selector} .mds-card h3, ${selector} .mds-card h4 { padding-left: 0; border-left: none; }
${selector} .mds-card { border-top: 6px solid var(--mds-band); border-radius: 0 0 var(--mds-radius) var(--mds-radius); }
${selector} .mds-body th { color: var(--mds-band-fg); background: var(--mds-band); border-bottom: none; }
${selector} .mds-body tr:nth-child(even) td { background: var(--mds-surface); }
/* タイトルスライド：帯の色の面に白い文字（背景画像があるときはそのまま） */
${selector} .layout-title:not([class*='has-bg-']) {
  --mds-fg: #ffffff;
  --mds-muted: rgb(255 255 255 / 0.82);
  --mds-accent: #ffffff;
  --mds-surface: rgb(255 255 255 / 0.16);
  background: var(--mds-band);
}
${selector} .layout-title .mds-title { font-weight: 800; }
/*
 * 章扉：白地のまま、左に帯の色の縦の帯を置き、見出しは右に（#100・#114）。
 * 一面を色で塗ると主張が強すぎるため。番号は付けない。背景画像のある章扉は、これまでどおり
 */
${selector} .layout-section .mds-title { font-weight: 800; }
${selector} .layout-section .mds-title::before { width: 96px; height: 6px; border-radius: 0; }
${selector} .layout-section:not([class*='has-bg-']) {
  background: linear-gradient(to right, var(--mds-band) 0 calc(var(--mds-w) * 0.28), var(--mds-bg) 0);
  padding-left: calc(var(--mds-w) * 0.28 + 64px);
}
${selector} .layout-section:not([class*='has-bg-']) .mds-title::before { background: var(--mds-band); }
`;
}
