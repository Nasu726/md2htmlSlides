/**
 * テーマに依存しない基本の CSS（docs/design.md §5・§6）。
 * レイアウトの格子と、ブロックの基本の見た目を持つ。色・フォント・大きさはテーマのトークンを使う。
 * ブロックの間隔は margin ではなく gap で取る（計測と表示で高さを一致させるため）。
 */
export const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #d1d5db; }

.mds-deck {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  padding: 32px 0;
}

.mds-slide {
  position: relative;
  width: var(--mds-w);
  height: var(--mds-h);
  flex: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--mds-gap);
  padding: var(--mds-pad-y) var(--mds-pad-x) calc(var(--mds-pad-y) + 24px);
  background: var(--mds-bg);
  color: var(--mds-fg);
  font-family: var(--mds-font-body);
  font-size: var(--mds-fs-body);
  line-height: 1.55;
  line-break: strict;
  overflow-wrap: anywhere;
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.15);
}

.mds-chapter {
  margin: 0;
  font-size: var(--mds-fs-small);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mds-accent);
}

.mds-title {
  margin: 0;
  font-family: var(--mds-font-heading);
  font-size: var(--mds-fs-h2);
  font-weight: 700;
  line-height: 1.25;
  text-wrap: balance;
  word-break: auto-phrase;
  /* 見出しは約物（「、」など）を詰める。本文は詰めない（読みやすさのため） */
  font-feature-settings: 'palt';
}

.mds-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mds-gap);
  font-size: calc(1em * var(--mds-fit, 1));
}
.mds-body > *, .mds-col > *, .mds-c-stack > * { margin: 0; flex: none; }
.mds-body h3, .mds-body h4, .mds-body h5, .mds-body h6 {
  margin: 0;
  font-family: var(--mds-font-heading);
  line-height: 1.3;
  text-wrap: balance;
  word-break: auto-phrase;
  font-feature-settings: 'palt';
}
.mds-body h3 { font-size: 1.2em; }
.mds-body h4, .mds-body h5, .mds-body h6 { font-size: 1.05em; }
.mds-body p { margin: 0; }
.mds-body ul, .mds-body ol {
  margin: 0;
  padding-left: 1.3em;
  display: flex;
  flex-direction: column;
  gap: 0.25em;
}
.mds-body li > p { margin: 0; }
.mds-body li > ul, .mds-body li > ol { margin-top: 0.25em; font-size: 0.92em; }
.mds-body li::marker { color: var(--mds-accent); }
.mds-body a { color: var(--mds-accent); }
.mds-body code {
  font-family: var(--mds-font-mono);
  font-size: 0.88em;
  padding: 0.05em 0.3em;
  border-radius: 4px;
  background: var(--mds-surface);
}
.mds-body pre {
  margin: 0;
  padding: 0.7em 0.9em;
  border-radius: var(--mds-radius);
  background: var(--mds-code-bg);
  color: var(--mds-code-fg);
  font-family: var(--mds-font-mono);
  font-size: 0.72em;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow: hidden;
}
.mds-body pre code { padding: 0; background: none; font-size: inherit; }
/* コードの行ハイライト（{lines}。#105）：今の段の行のほかを薄くする（どの行かは runtime が決める） */
.mds-line { transition: opacity 0.3s ease; }
.mds-line.is-dim { opacity: 0.3; }
[data-no-anim] .mds-line { transition: none; }
/*
 * コードの色分け（#68）：Shiki の CSS 変数。コードの地はどのテーマでも暗いので、
 * 既定は暗い地に合う配色にし、テーマで変える。
 */
.mds-deck {
  --mds-code-foreground: var(--mds-code-fg);
  --mds-code-token-keyword: #ff7b72;
  --mds-code-token-string: #a5d6ff;
  --mds-code-token-string-expression: #a5d6ff;
  --mds-code-token-comment: #8b949e;
  --mds-code-token-function: #d2a8ff;
  --mds-code-token-constant: #79c0ff;
  --mds-code-token-parameter: #ffa657;
  --mds-code-token-punctuation: #c9d1d9;
  --mds-code-token-link: #a5d6ff;
  --mds-code-token-inserted: #7ee787;
  --mds-code-token-deleted: #ffa198;
  --mds-code-token-changed: #e3b341;
}
.mds-body table { border-collapse: collapse; font-size: 0.78em; }
.mds-body th, .mds-body td {
  padding: 0.35em 0.8em;
  border-bottom: 1px solid var(--mds-border);
  text-align: left;
}
.mds-body th { color: var(--mds-muted); font-weight: 600; border-bottom-width: 2px; }
.mds-body blockquote {
  margin: 0;
  padding: 0.2em 0 0.2em 0.9em;
  border-left: 5px solid var(--mds-accent);
  color: var(--mds-muted);
}
.mds-body hr { width: 100%; border: none; border-top: 2px solid var(--mds-border); }

/*
 * 画像・動画（構文仕様 §6.1、設計プラン §5.4）
 * 画像・動画だけの段落（.mds-media-group）は、空いた領域いっぱいに縦横比を保って伸縮する。
 * 最小の高さは --mds-media-min。すべてに width= があれば（.is-rigid）幅から高さを決める。
 */
.mds-slide { --mds-media-min: calc(var(--mds-h) * 0.28); }
.mds-media-group {
  display: flex;
  justify-content: center;
  gap: calc(var(--mds-gap) * 1.2);
  min-width: 0;
}
.mds-media-group.is-flex { flex: 1 1 0; min-height: var(--mds-media-min); }
.mds-body > .mds-c:has(.mds-media-group.is-flex),
.mds-col > .mds-c:has(.mds-media-group.is-flex) { flex: 1 1 0; min-height: var(--mds-media-min); }
.mds-c-row:has(.mds-media-group.is-flex) { align-items: stretch; }
.mds-media {
  margin: 0;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  container-type: size;
}
.mds-media:has(> figcaption) { --mds-cap-h: 1.4em; }
.mds-media.is-fixed { flex: none; max-width: 100%; }
.mds-media-frame {
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 縦横比がわからないものは、空いた領域いっぱいの枠に contain で収める */
.mds-media-frame:not(:has(> .has-ratio)) { flex: 1 1 0; }
.mds-media-frame > * {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border: 0;
}
/* 縦横比がわかるものは、キャプションの分を除いた領域に収まる大きさにする（角丸が中身に沿う） */
.mds-media-frame > .has-ratio {
  width: min(100cqw, (100cqh - var(--mds-cap-h, 0px)) * var(--mds-ar));
  height: auto;
  aspect-ratio: var(--mds-ar);
  border-radius: var(--mds-radius);
}
.mds-media-frame > video, .mds-media-frame > iframe {
  border-radius: var(--mds-radius);
  background: #000;
}
.is-rigid .mds-media { container-type: normal; }
.is-rigid .mds-media-frame > * { width: 100%; height: auto; }
.mds-media.fit-cover .mds-media-frame { flex: 1 1 0; }
.mds-media.fit-cover .mds-media-frame > * {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  object-fit: cover;
}
.mds-media figcaption {
  flex: none;
  font-size: 0.66em;
  line-height: 1.4;
  color: var(--mds-muted);
  text-align: center;
  text-wrap: balance;
  word-break: auto-phrase;
}
/* 見つからないファイルは枠だけを出す */
.mds-media-placeholder {
  width: 100%;
  height: 100%;
  min-height: 3em;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--mds-border);
  border-radius: var(--mds-radius);
  background: var(--mds-surface);
  color: var(--mds-muted);
  font-size: 0.7em;
}
.is-rigid .mds-media-placeholder { aspect-ratio: 16 / 9; }
/* Mermaid の図（#71）：SVG を縦横比を保って枠に合わせる（Mermaid が付ける max-width は外す） */
.mds-media-frame > .mds-diagram { border-radius: 0; }
/* エラーの枠は、中身の高さにして縦の中央に置く（枠いっぱいに伸ばさない） */
.mds-media-frame:has(> .mds-diagram-error) { align-items: center; }
.mds-media-frame > .mds-diagram-error { height: auto; }
.mds-diagram > svg { display: block; width: 100%; height: 100%; max-width: none !important; }
/*
 * 動く構成図（#107、docs/arch-diagram.md §6.3）：色はテーマの変数で塗る（SVG には書かない）。
 * 通常は accent、線は muted。グループは surface を地に混ぜた面
 */
.mds-arch-svg { overflow: visible; font-family: var(--mds-font-body); }
.mds-arch-svg text { text-anchor: middle; dominant-baseline: central; }
.mds-arch-svg .arch-group .shape,
.mds-arch-svg .arch-group-label rect {
  fill: color-mix(in srgb, var(--mds-surface) 75%, var(--mds-bg));
}
.mds-arch-svg .arch-group .shape { stroke: var(--mds-border); stroke-width: 1.5; stroke-dasharray: 6 4; }
.mds-arch-svg .arch-group-label text { text-anchor: start; fill: var(--mds-muted); font-size: 16px; font-weight: 600; }
.mds-arch-svg .arch-edge path { fill: none; stroke: var(--mds-muted); stroke-width: 2.5; }
.mds-arch-svg .arch-edge .arch-head { fill: var(--mds-muted); stroke: none; }
.mds-arch-svg .arch-edge-label rect { fill: var(--mds-bg); }
.mds-arch-svg .arch-edge-label text { fill: var(--mds-muted); font-size: 15px; }
.mds-arch-svg .arch-node .shape { fill: var(--mds-bg); stroke: var(--mds-accent); stroke-width: 2; }
.mds-arch-svg .arch-node .rim, .mds-arch-svg .arch-node .icon-line { fill: none; stroke: var(--mds-accent); stroke-width: 2; }
.mds-arch-svg .arch-node .icon, .mds-arch-svg .arch-node .dot { fill: var(--mds-accent); }
.mds-arch-svg .arch-node.kind-external .shape { stroke-dasharray: 7 5; }
.mds-arch-svg .arch-node text { fill: var(--mds-fg); font-size: 20px; font-weight: 500; }
/* 再生（#108）：今のステップのノードと線を強調し、ほかを薄くする。パケット・バッジ・番号の印 */
.mds-arch-svg .arch-node, .mds-arch-svg .arch-edge { transition: opacity 0.3s ease; }
.mds-arch-svg .is-dim { opacity: 0.3; }
.mds-arch-svg .arch-node.is-active .shape { fill: color-mix(in srgb, var(--mds-accent) 12%, var(--mds-bg)); stroke-width: 3; }
.mds-arch-svg .arch-edge.is-active path { stroke: var(--mds-accent); stroke-width: 3.5; }
.mds-arch-svg .arch-edge.is-active .arch-head { fill: var(--mds-accent); }
.mds-arch-svg .arch-node.is-flash .shape { fill: color-mix(in srgb, var(--mds-accent) 30%, var(--mds-bg)); }
.mds-arch-svg .arch-temp { fill: none; stroke: #dc2626; stroke-width: 2.5; stroke-dasharray: 5 5; }
.mds-arch-svg .arch-packet circle { fill: var(--mds-accent); stroke: var(--mds-bg); stroke-width: 3; }
.mds-arch-svg .arch-packet.is-reply circle { fill: var(--mds-bg); stroke: var(--mds-accent); stroke-dasharray: 4 3; }
.mds-arch-svg .arch-packet-label {
  fill: var(--mds-fg);
  font-size: 15px;
  font-weight: 700;
  paint-order: stroke;
  stroke: var(--mds-bg);
  stroke-width: 5px;
}
.mds-arch-svg .arch-bubble rect { fill: #0f172a; }
.mds-arch-svg .arch-bubble text { text-anchor: start; dominant-baseline: auto; fill: #e2e8f0; font: 14px var(--mds-font-mono); }
.mds-arch-svg .arch-badge rect { fill: #16a34a; }
.mds-arch-svg .arch-badge.is-error rect { fill: #dc2626; }
.mds-arch-svg .arch-badge text { fill: #ffffff; font-size: 13px; font-weight: 700; }
.mds-arch-svg .arch-mark circle { fill: var(--mds-accent); stroke: var(--mds-bg); stroke-width: 2; }
.mds-arch-svg .arch-mark text { fill: var(--mds-bg); font-size: 12px; font-weight: 700; }
.mds-body .mds-arch-captions li.is-future { opacity: 0.5; }
.mds-body .mds-arch-captions li.is-current {
  border-left-color: var(--mds-accent);
  background: color-mix(in srgb, var(--mds-accent) 10%, var(--mds-bg));
  font-weight: 700;
}
/* ステップの説明のリスト（§5.4）。図の横では縦に、図の下では横一列に並べる */
.mds-body .mds-arch-captions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4em;
  align-content: center;
  counter-reset: mds-arch;
  font-size: 0.8em;
  line-height: 1.35;
}
.mds-body .mds-arch-captions.is-row { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); flex: none; }
.mds-body .mds-arch-captions li {
  counter-increment: mds-arch;
  display: flex;
  gap: 0.55em;
  align-items: center;
  padding: 0.35em 0.6em;
  border-left: 4px solid transparent;
  border-radius: 0 var(--mds-radius) var(--mds-radius) 0;
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}
.mds-body .mds-arch-captions li::before {
  content: counter(mds-arch);
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 1.7em;
  height: 1.7em;
  border-radius: 50%;
  border: 2px solid var(--mds-accent);
  color: var(--mds-accent);
  font-size: 0.75em;
  font-weight: 700;
}
.mds-diagram-error {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  padding: 0.6em 0.9em;
  border: 2px dashed #dc2626;
  border-radius: var(--mds-radius);
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.7em;
}
.mds-diagram-error > span { font-family: var(--mds-font-mono); white-space: pre-wrap; font-size: 0.85em; }
/* 数式（#72）。KaTeX の HTML。KaTeX のフォントにない文字（日本語など）は本文のフォントで描く */
.mds-deck .katex { font-family: KaTeX_Main, var(--mds-font-body); }
.mds-math-block { text-align: center; padding-block: 0.15em; }
.mds-math-block .katex-display { margin: 0; }
.mds-math-block .katex-display > .katex { white-space: nowrap; }
/* 数式のエラー：TeX をその場に赤字で出す */
.mds-body code.mds-math-error {
  color: #dc2626;
  background: none;
  text-decoration: underline wavy #dc2626 1px;
  text-underline-offset: 0.2em;
}
.mds-math-block.mds-math-error {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  padding: 0.6em 0.9em;
  border: 2px dashed #dc2626;
  border-radius: var(--mds-radius);
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.7em;
  text-align: left;
}
.mds-math-block.mds-math-error > span { font-family: var(--mds-font-mono); white-space: pre-wrap; font-size: 0.85em; }
.mds-math-block.mds-math-error > code { color: #dc2626; background: none; padding: 0; white-space: pre-wrap; }
/* 文中の画像 */
.mds-body :is(p, li, td, th, a) > img {
  max-width: 100%;
  max-height: calc(var(--mds-h) * 0.45);
  vertical-align: middle;
}

.mds-alert {
  padding: 0.55em 0.9em;
  border-radius: var(--mds-radius);
  border-left: 6px solid var(--mds-alert-fg);
  background: var(--mds-alert-bg);
}
.mds-alert > * { margin: 0; }
.mds-alert-title { font-size: 0.75em; font-weight: 700; color: var(--mds-alert-fg); }
.mds-alert-note { --mds-alert-fg: #2563eb; --mds-alert-bg: #eff6ff; }
.mds-alert-tip { --mds-alert-fg: #16a34a; --mds-alert-bg: #f0fdf4; }
.mds-alert-important { --mds-alert-fg: #7c3aed; --mds-alert-bg: #f5f3ff; }
.mds-alert-warning { --mds-alert-fg: #d97706; --mds-alert-bg: #fffbeb; }
.mds-alert-caution { --mds-alert-fg: #dc2626; --mds-alert-bg: #fef2f2; }

.mds-c-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: calc(var(--mds-gap) * 1.5);
  align-items: start;
}
.mds-col, .mds-c-stack, .mds-c-keep, .mds-c-steps, .mds-c-maketitle {
  display: flex;
  flex-direction: column;
  gap: var(--mds-gap);
  min-width: 0;
}

.mds-footer {
  position: absolute;
  left: var(--mds-pad-x);
  right: var(--mds-pad-x);
  bottom: 22px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 16px;
  color: var(--mds-muted);
}

/* 章扉 */
.layout-section { justify-content: center; }
.layout-section .mds-title { font-size: var(--mds-fs-h1); }
.layout-section .mds-title::before {
  content: '';
  display: block;
  width: 72px;
  height: 8px;
  margin-bottom: 28px;
  border-radius: 4px;
  background: var(--mds-accent);
}
.layout-section .mds-body { flex: none; color: var(--mds-muted); }

/* statement：一文や引用を中央に大きく（§5.1） */
.layout-statement { justify-content: center; }
.layout-statement > .mds-title {
  font-size: var(--mds-fs-small);
  color: var(--mds-accent);
  letter-spacing: 0.04em;
}
.layout-statement > .mds-title::after { display: none; }
.layout-statement .mds-body {
  flex: none;
  font-size: calc(1.6em * var(--mds-fit, 1));
  font-weight: 700;
  line-height: 1.45;
  text-wrap: balance;
  word-break: auto-phrase;
  /* 大きく見せる一文は、見出しと同じく約物を詰める */
  font-feature-settings: 'palt';
}
.layout-statement .mds-body blockquote {
  padding: 0 0 0 0.8em;
  border-left-width: 8px;
  color: var(--mds-fg);
}

/* media：画像・動画・図を大きく。見出しは上に小さく、キャプションは重ねる */
.layout-media > .mds-title { font-size: var(--mds-fs-small); color: var(--mds-muted); }
.layout-media > .mds-title::after { display: none; }
.layout-media .mds-media figcaption {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 90%;
  padding: 0.25em 0.8em;
  border-radius: 6px;
  background: rgb(15 23 42 / 0.72);
  color: #fff;
}
.layout-media .mds-media { position: relative; }

/* split：文章とメディアを左右に（比は --mds-split、data-media="left" で左右を入れ替える） */
.layout-split .mds-body {
  display: grid;
  grid-template-columns: var(--mds-split, 1fr 1fr);
  gap: calc(var(--mds-gap) * 2);
  align-items: center;
}
/* {align=center}：本文を縦方向の中央に置く */
.mds-slide.align-center { justify-content: center; }
.mds-slide.align-center > .mds-body { flex: none; }
.mds-slide.align-top { justify-content: flex-start; }
.mds-split-text, .mds-split-media {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mds-gap);
}
.mds-split-text > *, .mds-split-media > * { margin: 0; flex: none; }
.mds-split-media { align-self: stretch; justify-content: center; }
.mds-split-media > .mds-media-group.is-flex { flex: 1 1 0; }

/* grid：画像を格子に */
.mds-grid {
  flex: 1 1 0;
  min-height: var(--mds-media-min);
  display: grid;
  grid-template-columns: repeat(var(--mds-cols, 2), minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: var(--mds-gap);
}
.mds-grid > .mds-media-group { display: contents; }

/* columns：小見出しごとのカード */
.mds-columns {
  display: grid;
  grid-template-columns: repeat(var(--mds-cols, 3), minmax(0, 1fr));
  gap: calc(var(--mds-gap) * 1.2);
  align-items: stretch;
}
.mds-card {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  min-width: 0;
  padding: 0.8em 1em;
  border-radius: var(--mds-radius);
  background: var(--mds-surface);
}
.mds-card > * { margin: 0; }
.mds-card h3, .mds-card h4 { color: var(--mds-accent); }

/* 短い項目が多いリストは2段組 */
.mds-list-cols > ul, .mds-list-cols > ol { display: block; columns: 2; column-gap: 2.5em; }
.mds-list-cols li { break-inside: avoid; margin-bottom: 0.25em; }

/* 発表者ノート：発表の画面と印刷には出さない（発表者ビューが読む） */
.mds-notes { display: none !important; }

/* 段階的表示（構文仕様 §5）。runtime が data-step-hidden を付け外しする（既定はフェード） */
.mds-step-group { display: contents; }
[data-step], .mds-step-group > * { transition: opacity 0.3s ease, visibility 0.3s; }
[data-step][data-step-hidden], .mds-step-group[data-step-hidden] > * { visibility: hidden; opacity: 0; }
[data-no-anim] [data-step], [data-no-anim] .mds-step-group > * { transition: none; }
@media (prefers-reduced-motion: reduce) {
  [data-step], .mds-step-group > * { transition: none; }
}

/* タイトルスライド（構文仕様 §2.2） */
.layout-title { justify-content: center; }
.mds-titleblock {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45em;
}
.mds-titleblock > * { margin: 0; }
.layout-title .mds-title { font-size: var(--mds-fs-title); line-height: 1.2; }
.mds-subtitle { font-size: 1.15em; color: var(--mds-muted); text-wrap: balance; word-break: auto-phrase; }
/*
 * 日本語の見出しは、core が BudouX で文節の切れ目に <wbr> を入れているので、そこでだけ改行する
 * （auto-phrase のないブラウザ・PDF でも同じ位置で改行される。設計プラン §5.5）
 */
.mds-deck:lang(ja) :is(.mds-title, .mds-subtitle, .mds-body h3, .mds-body h4, .mds-body h5, .mds-body h6) {
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.mds-event {
  font-size: var(--mds-fs-small);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mds-accent);
}
.mds-logo { height: 44px; width: auto; align-self: inherit; }
.mds-authors { display: flex; flex-wrap: wrap; gap: 0 1.2em; margin-top: 0.8em !important; }
.mds-affiliations {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.2em;
  font-size: 0.72em;
  color: var(--mds-muted);
}
.mds-titleblock sup { font-size: 0.6em; margin-left: 0.1em; }
.mds-date { font-size: 0.8em; color: var(--mds-muted); }
.mds-title-extra { font-size: 0.7em; color: var(--mds-muted); }
.variant-center .mds-titleblock { align-items: center; text-align: center; }
.variant-center .mds-authors, .variant-center .mds-affiliations { justify-content: center; }
.variant-left .mds-titleblock { align-items: flex-start; }
/* 背景（構文仕様 §6.2）：全面・左半分・右半分。中身は背景の上に重ねる */
.mds-bg { position: absolute; inset: 0; overflow: hidden; background: #000; }
.mds-bg-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background-size: cover;
  background-position: center;
}
.mds-bg.fit-contain .mds-bg-media { object-fit: contain; background-size: contain; background-repeat: no-repeat; }
/* fill=blur：収めたときの帯を、ぼかした同じ画像で埋める（ぼかしで端が透けないように外へ広げる） */
.mds-bg-fill {
  position: absolute;
  top: -48px;
  left: -48px;
  width: calc(100% + 96px);
  height: calc(100% + 96px);
  object-fit: cover;
  background-size: cover;
  background-position: center;
  filter: blur(36px) brightness(0.75);
}
.mds-bg-dim { position: absolute; inset: 0; background: #000; }
.mds-bg-left { right: 50%; }
.mds-bg-right { left: 50%; }
.mds-slide > :not(.mds-bg, .mds-footer) { position: relative; z-index: 1; }
.mds-slide > .mds-footer { z-index: 1; }
/* 左右の半分が背景のときは、本文を残りの半分に置く（余白の % は内容の幅が基準なので --mds-w から計算する） */
.mds-slide.has-bg-left:not(.layout-title) { padding-left: calc(var(--mds-w) / 2 + 48px); }
.mds-slide.has-bg-right:not(.layout-title) { padding-right: calc(var(--mds-w) / 2 + 48px); }
.has-bg-left .mds-titleblock { margin-left: calc(var(--mds-w) / 2 - var(--mds-pad-x) + 48px); }
.has-bg-right .mds-titleblock { margin-right: calc(var(--mds-w) / 2 - var(--mds-pad-x) + 48px); }
/* 半分が背景のときは幅が半分になるので、タイトルを少し小さくする */
.layout-title.has-bg-left .mds-title, .layout-title.has-bg-right .mds-title { font-size: calc(var(--mds-fs-title) * 0.78); }
/* 全面の背景の上の文字：暗い背景には明るい文字、明るい背景には暗い文字（明るさは CLI が測る） */
.mds-slide.bg-tone-dark {
  --mds-fg: #ffffff;
  --mds-muted: rgb(255 255 255 / 0.82);
  --mds-surface: rgb(255 255 255 / 0.14);
  color: var(--mds-fg);
}
.mds-slide.bg-tone-dark > :not(.mds-bg) { text-shadow: 0 1px 4px rgb(0 0 0 / 0.55); }
.mds-slide.bg-tone-light {
  --mds-fg: #0f172a;
  --mds-muted: #334155;
  --mds-surface: rgb(255 255 255 / 0.55);
  color: var(--mds-fg);
}
.mds-slide.bg-tone-light > :not(.mds-bg) { text-shadow: 0 1px 3px rgb(255 255 255 / 0.75); }

/* 縮小しても収まらなかったスライド（M2 の自動分割までの目印。debug のときだけ表示） */
.mds-deck[data-debug] .mds-slide[data-overflow] { outline: 4px dashed #dc2626; outline-offset: -4px; }

/* 印刷のときだけ出す、埋め込み動画の代わり（サムネイルとリンク） */
.mds-print-link { display: none; }

/*
 * 印刷・PDF（設計プラン §10、S5 #69）。1スライド＝1ページ（@page の大きさは描画のときに入れる）。
 */
@media print {
  html, body { margin: 0; background: none; }
  .mds-deck { display: block; padding: 0; }
  /* 最後のスライドの後に白いページを作らないよう、2枚目からページの前で区切る。
     影はテーマ（dark など）が付けていても消す（PDF でページ全体のぼかし画像になるため） */
  .mds-slide { box-shadow: none !important; break-inside: avoid; }
  .mds-slide ~ .mds-slide { break-before: page; }
  /* プレビューに出している「隠したスライド」と、収まらない印は印刷しない */
  .mds-slide[data-hidden] { display: none; }
  .mds-deck[data-debug] .mds-slide[data-overflow] { outline: none; }
  /* 段階的表示は最終状態にする。ステップごとのページでは data-step-print-hidden で隠す */
  [data-step][data-step-hidden], .mds-step-group[data-step-hidden] > * { visibility: visible; opacity: 1; }
  .mds-slide [data-step][data-step-print-hidden] { visibility: hidden !important; }
  /* 動画は操作ボタンを出さない（ポスターか最初のフレームだけ） */
  video::-webkit-media-controls { display: none !important; }
  /* YouTube・Vimeo の埋め込みは、サムネイルとリンクに置き換える */
  .mds-media-frame > iframe { display: none; }
  .mds-print-link, .mds-body a.mds-print-link {
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    background: #000 center / cover no-repeat;
    color: #fff;
    text-decoration: none;
    border-radius: var(--mds-radius);
  }
  .mds-print-link > span {
    margin: 0.6em;
    padding: 0.3em 0.7em;
    border-radius: 6px;
    background: rgb(0 0 0 / 0.72);
    font-size: 0.6em;
    overflow-wrap: anywhere;
  }
}
`;
