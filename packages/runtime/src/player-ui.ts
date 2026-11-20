/**
 * 発表の画面の文言と見た目（#172 で player.ts から分けた）。データだけを持つ。
 * 書き出した HTML には JSON にして入れ、startPlayer に渡す（index.ts の RUNTIME_SCRIPT）
 */

/** 文言（lang が ja のとき） */
const JA = {
  help: 'キー操作',
  close: 'Esc か ? で閉じる',
  keys: [
    ['→ / Space / PageDown / Enter', '次へ'],
    ['← / PageUp / Backspace', '前へ'],
    ['Home / End', '最初 / 最後'],
    ['数字 → Enter（または G）', '指定したページへ'],
    ['O', '一覧表示'],
    ['F', '全画面'],
    ['B / .', '画面を暗くする'],
    ['P', '発表者ビューを開く・閉じる'],
    ['?', 'このヘルプ'],
  ],
  pvKeys: [
    ['→ / Space / PageDown / Enter', '次へ'],
    ['← / PageUp / Backspace', '前へ'],
    ['数字 → Enter（または G）', '指定したページへ'],
    ['O', '一覧（選ぶまで観客の画面は変わらない）'],
    ['B / .', '観客の画面を暗くする'],
    ['F', 'このウィンドウを全画面'],
    ['P / Esc', '発表者ビューを閉じる（発表は続く）'],
    ['?', 'このヘルプ'],
  ],
  pvHint: '? でキー操作',
  pvPick: 'スライドを選ぶ：矢印で選んで Enter（クリックでも可）。Esc で戻る',
  pvBlack: '暗転中',
  pvOverview: '観客の画面は一覧を表示中',
  pvHelp: '観客の画面はヘルプを表示中',
  slide: 'スライド',
  presenter: '発表者ビュー',
  now: '現在（観客の画面）',
  next: '次',
  nextStep: '次（このスライドの続き）',
  notes: 'ノート',
  noNotes: 'ノートはありません',
  elapsed: '経過',
  clock: '時刻',
  end: '最後のスライドです',
  exit: ['Esc', 'スライドショーを終える（プレビューに戻る）'],
  touchOverview: '一覧',
  touchExit: '× 終える',
};

export type PlayerText = typeof JA;

/** 文言（lang が ja 以外のとき） */
const EN: PlayerText = {
  help: 'Keyboard shortcuts',
  close: 'Press Esc or ? to close',
  keys: [
    ['→ / Space / PageDown / Enter', 'Next'],
    ['← / PageUp / Backspace', 'Previous'],
    ['Home / End', 'First / last'],
    ['Number → Enter (or G)', 'Go to page'],
    ['O', 'Overview'],
    ['F', 'Fullscreen'],
    ['B / .', 'Black screen'],
    ['P', 'Open / close presenter view'],
    ['?', 'This help'],
  ],
  pvKeys: [
    ['→ / Space / PageDown / Enter', 'Next'],
    ['← / PageUp / Backspace', 'Previous'],
    ['Number → Enter (or G)', 'Go to page'],
    ['O', 'Overview (audience view stays until you pick)'],
    ['B / .', 'Black out the audience view'],
    ['F', 'Fullscreen this window'],
    ['P / Esc', 'Close presenter view (the show goes on)'],
    ['?', 'This help'],
  ],
  pvHint: 'Press ? for shortcuts',
  pvPick: 'Pick a slide: arrows then Enter (or click). Esc to go back',
  pvBlack: 'Black screen',
  pvOverview: 'Audience sees the overview',
  pvHelp: 'Audience sees the help',
  slide: 'Slide',
  presenter: 'Presenter view',
  now: 'Current (audience view)',
  next: 'Next',
  nextStep: 'Next (same slide)',
  notes: 'Notes',
  noNotes: 'No notes',
  elapsed: 'Elapsed',
  clock: 'Clock',
  end: 'This is the last slide',
  exit: ['Esc', 'End the slideshow (back to preview)'],
  touchOverview: 'Overview',
  touchExit: '× Exit',
};

/** 発表用の見た目。印刷では使わない（screen だけ） */
const PLAYER_CSS = `
@media screen {
  html.mds-presenting, html.mds-presenting body { height: 100%; margin: 0; overflow: hidden; background: #000; }
  .mds-deck.is-presenting { position: fixed; inset: 0; display: block; padding: 0; }
  .mds-deck.is-presenting > .mds-slide {
    position: absolute;
    left: 50%;
    top: 50%;
    margin: 0;
    box-shadow: none;
    transform: translate(-50%, -50%) scale(var(--mds-scale, 1));
    visibility: hidden;
  }
  .mds-deck.is-presenting > .mds-slide.is-current { visibility: visible; }
  .mds-deck.is-presenting.is-idle { cursor: none; }
  .mds-deck.is-overview {
    flex-flow: row wrap;
    justify-content: center;
    align-items: flex-start;
    gap: 20px;
    padding: 28px;
  }
  .mds-deck.is-overview > .mds-slide { zoom: 0.22; cursor: pointer; }
  /* 一覧では、クリックを中身（動画など）に渡さず、スライドを選ぶだけにする */
  .mds-deck.is-overview > .mds-slide > * { pointer-events: none; }
  .mds-deck.is-overview > .mds-slide.is-current { outline: 14px solid var(--mds-accent); outline-offset: 6px; }
  /* 大きな資料でも探せるように、一覧では番号を出す（#110。縮小しているので大きく書く） */
  .mds-deck.is-overview { counter-reset: mds-overview; }
  .mds-deck.is-overview > .mds-slide { counter-increment: mds-overview; }
  .mds-deck.is-overview > .mds-slide::before {
    content: counter(mds-overview);
    position: absolute;
    left: 0;
    top: 0;
    z-index: 5;
    padding: 4px 30px;
    border-radius: 0 0 28px 0;
    background: rgb(15 23 42 / 0.78);
    color: #fff;
    font: 700 64px/1.3 system-ui, sans-serif;
  }
  .mds-deck.is-overview > .mds-slide.is-current::before { background: var(--mds-accent); }
  .mds-deck:not(.is-presenting) > .mds-player-progress { display: none; }
}
/* 切り替え効果（#110）：View Transitions API の画面全体の写しを動かす */
html[data-mds-transition]::view-transition { background: #000; }
html[data-mds-transition='fade']::view-transition-old(root),
html[data-mds-transition='fade']::view-transition-new(root) { animation-duration: 0.4s; }
html[data-mds-transition='slide']::view-transition-old(root) { animation: 0.45s cubic-bezier(0.4, 0, 0.2, 1) both mds-slide-out; }
html[data-mds-transition='slide']::view-transition-new(root) { animation: 0.45s cubic-bezier(0.4, 0, 0.2, 1) both mds-slide-in; }
html[data-mds-transition='slide'][data-mds-direction='back']::view-transition-old(root) { animation-name: mds-slide-out-back; }
html[data-mds-transition='slide'][data-mds-direction='back']::view-transition-new(root) { animation-name: mds-slide-in-back; }
@keyframes mds-slide-out { to { transform: translateX(-100%); } }
@keyframes mds-slide-in { from { transform: translateX(100%); } }
@keyframes mds-slide-out-back { to { transform: translateX(100%); } }
@keyframes mds-slide-in-back { from { transform: translateX(-100%); } }
/* 読み上げ用の要素（1px）も隠す。最後のスライドの下にはみ出し、白いページができるため（#69） */
@media print { .mds-player-progress, .mds-player-layer, .mds-player-jump, .mds-player-sr, .mds-player-touch { display: none !important; } }
.mds-player-progress {
  position: fixed;
  left: 0;
  bottom: 0;
  z-index: 2;
  height: 4px;
  width: calc(var(--mds-progress, 0) * 100%);
  background: var(--mds-accent);
  transition: width 0.2s ease;
}
.mds-player-layer { position: fixed; inset: 0; z-index: 3; }
.mds-player-layer[hidden], .mds-player-jump[hidden] { display: none; }
.mds-player-black { background: #000; }
.mds-player-help {
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.55);
  /* 操作画面は OS のフォントで出す（同梱するフォントは、スライドで使う文字だけに絞るため） */
  font-family: system-ui, sans-serif;
}
.mds-player-help > div {
  zoom: var(--mds-ui-scale, 1);
  min-width: 360px;
  padding: 24px 32px;
  border-radius: 14px;
  background: #fff;
  color: #0f172a;
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.35);
}
.mds-player-help h2 { margin: 0 0 12px; font-size: 20px; }
.mds-player-help table { border-collapse: collapse; font-size: 15px; }
.mds-player-help td { padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
.mds-player-help td:first-child { padding-right: 28px; font-family: ui-monospace, monospace; color: #475569; }
.mds-player-help p { margin: 12px 0 0; font-size: 13px; color: #64748b; }
.mds-player-jump {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 3;
  padding: 6px 14px;
  border-radius: 8px;
  background: rgb(15 23 42 / 0.85);
  color: #fff;
  font: 600 22px/1.4 ui-monospace, monospace;
  zoom: var(--mds-ui-scale, 1);
}
.mds-player-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
/* キーボードのない端末（スマホ）の操作（#157）：タップすると右上に数秒出す */
.mds-player-touch {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 4;
  display: flex;
  gap: 8px;
}
.mds-player-touch[hidden] { display: none; }
.mds-player-touch button {
  min-width: 44px;
  min-height: 44px;
  padding: 8px 16px;
  border: 0;
  border-radius: 22px;
  background: rgb(15 23 42 / 0.82);
  color: #fff;
  font: 600 15px/1 system-ui, sans-serif;
}
`;

/** 発表者ビューの見た目 */
const PRESENTER_CSS = `
html, body { height: 100%; margin: 0; background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; }
.mds-pv { box-sizing: border-box; height: 100vh; display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr); gap: 14px; padding: 16px; }
.mds-pv-bar { grid-column: 1 / -1; display: flex; gap: 28px; align-items: baseline; font-size: 15px; color: #94a3b8; }
.mds-pv-bar b { margin-left: 8px; font-size: 30px; color: #f8fafc; font-variant-numeric: tabular-nums; }
.mds-pv-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.mds-pv-current { grid-row: 2 / 4; }
.mds-pv-label { font-size: 13px; letter-spacing: 0.04em; color: #94a3b8; }
.mds-pv-frame { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.mds-pv-frame > .mds-deck { display: block; padding: 0; background: none; }
.mds-pv-frame .mds-slide { box-shadow: 0 4px 24px rgb(0 0 0 / 0.45); }
.mds-pv-notes { flex: 1; min-height: 0; overflow: auto; padding: 14px 18px; border-radius: 10px;
  background: #1e293b; font-size: 22px; line-height: 1.6; }
.mds-pv-notes > :first-child { margin-top: 0; }
.mds-pv-empty { color: #64748b; }
.mds-pv-bar .mds-pv-jump { margin-left: auto; padding: 0 10px; border-radius: 6px; background: #334155; }
.mds-pv-bar .mds-pv-jump[hidden] { display: none; }
.mds-pv-hint { margin-left: auto; font-size: 13px; }
.mds-pv-jump:not([hidden]) + .mds-pv-hint { margin-left: 0; }
.mds-pv-status { margin-left: 10px; padding: 1px 8px; border-radius: 999px; background: #f59e0b; color: #0f172a;
  font-weight: 700; letter-spacing: 0; }
.mds-pv-status[hidden] { display: none; }
.mds-pv-current.is-black .mds-pv-frame .mds-slide { filter: brightness(0); }
.mds-pv-layer { position: fixed; inset: 0; z-index: 5; background: rgb(15 23 42 / 0.97); }
.mds-pv-layer[hidden] { display: none; }
.mds-pv-overview { overflow: auto; padding: 16px 20px; background: #0f172a; }
.mds-pv-pick { margin: 0 0 14px; font-size: 15px; color: #94a3b8; }
.mds-pv-grid { display: flex; flex-wrap: wrap; gap: 16px; }
.mds-pv-thumb { position: relative; cursor: pointer; border-radius: 3px; outline: 4px solid transparent; outline-offset: 3px; }
.mds-pv-thumb > .mds-deck { display: block; padding: 0; background: none; pointer-events: none; }
.mds-pv-thumb.is-selected { outline-color: #38bdf8; }
.mds-pv-num { position: absolute; left: 6px; bottom: 4px; padding: 0 6px; border-radius: 4px; background: rgb(15 23 42 / 0.8);
  color: #f8fafc; font-size: 12px; }
.mds-pv-help { display: grid; place-items: center; background: rgb(15 23 42 / 0.75); }
.mds-pv-help > div { min-width: 380px; padding: 24px 32px; border-radius: 14px; background: #fff; color: #0f172a; }
.mds-pv-help h2 { margin: 0 0 12px; font-size: 20px; }
.mds-pv-help table { border-collapse: collapse; font-size: 15px; }
.mds-pv-help td { padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
.mds-pv-help td:first-child { padding-right: 28px; font-family: ui-monospace, monospace; color: #475569; }
.mds-pv-help p { margin: 12px 0 0; font-size: 13px; color: #64748b; }`;

export interface PlayerUi {
  text: { ja: PlayerText; en: PlayerText };
  css: string;
  presenterCss: string;
}

export const PLAYER_UI: PlayerUi = {
  text: { ja: JA, en: EN },
  css: PLAYER_CSS,
  presenterCss: PRESENTER_CSS,
};
