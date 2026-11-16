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
}
.mds-continued {
  margin-left: 0.5em;
  font-size: 0.5em;
  font-weight: 400;
  color: var(--mds-muted);
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
/* 画像が本文を押し出さないように高さを抑える（空いた領域に合わせた伸縮は #18） */
.mds-body img { max-width: 100%; max-height: calc(var(--mds-h) * 0.55); object-fit: contain; }

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
.mds-col img { width: 100%; }

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

/* タイトルスライド（中身は #17） */
.layout-title { justify-content: center; }
.layout-title .mds-title { font-size: var(--mds-fs-title); }
.layout-title .mds-subtitle { margin: 0; font-size: 1.1em; color: var(--mds-muted); }

/* 縮小しても収まらなかったスライド（M2 の自動分割までの目印。debug のときだけ表示） */
.mds-deck[data-debug] .mds-slide[data-overflow] { outline: 4px dashed #dc2626; outline-offset: -4px; }

@media print {
  body { background: none; }
  .mds-deck { display: block; padding: 0; }
  .mds-slide { box-shadow: none; break-after: page; }
}
`;
