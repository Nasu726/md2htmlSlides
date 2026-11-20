/**
 * 発表用の runtime（docs/design.md §8）：拡大縮小・キー操作・URL でのページ指定・段階表示・
 * 発表者ビュー・一覧・切り替え効果。書き出した HTML には、関数のソースを文字列にして入れる。
 */
import { startArch } from './arch-player.js';
import { startPlayer } from './player.js';
import { PLAYER_UI } from './player-ui.js';
import { startPreview } from './preview.js';

/**
 * 書き出した HTML の `<script>` に入れるソース。
 * `renderDeckHtml(deck, { scripts: [RUNTIME_SCRIPT] })` のように渡す。
 * 文言と見た目（player-ui.ts）は JSON にして渡す（`</script>` にならないよう、`<` は符号にする。#172）
 */
export const RUNTIME_SCRIPT = `(${startPlayer.toString()})(document, ${JSON.stringify(PLAYER_UI).replace(/</g, '\\u003c')});`;

/**
 * 動く構成図の再生（#108）。書き出した HTML の、RUNTIME_SCRIPT より前に入れる
 * （構成図がある資料のときだけ）
 */
export const ARCH_SCRIPT = `(${startArch.toString()})(document);`;

/** `mdhs dev` のプレビュー（`/`）に入れるソース。画面に合わせる・S で発表を始める（#60） */
export const PREVIEW_SCRIPT = `(${startPreview.toString()})(document);`;

/** PDF にする前の準備（#70）。CLI の `mdhs pdf` が page.evaluate で呼ぶ */
export { preparePrint } from './print.js';

/** Mermaid の図を描く（#71）。CLI が page.evaluate で呼ぶ */
export { renderMermaid } from './diagrams.js';

/** 動く構成図を配置して SVG にする（#107）。CLI とエディタが、ELK を入れたページで呼ぶ */
export { renderArch, type ArchRenderInput } from './arch.js';
