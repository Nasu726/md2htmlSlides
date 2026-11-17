/**
 * 発表用の runtime：拡大縮小・キー操作・URL でのページ指定（docs/design.md §8）。
 * 段階表示と発表者ビューは M2 で加える。
 */
import { startPlayer } from './player.js';
import { startPreview } from './preview.js';

export const RUNTIME_VERSION = '0.0.0';

export { startPlayer };

/**
 * 書き出した HTML の `<script>` に入れるソース。
 * `renderDeckHtml(deck, { scripts: [RUNTIME_SCRIPT] })` のように渡す。
 */
export const RUNTIME_SCRIPT = `(${startPlayer.toString()})(document);`;

export { startPreview };

/** `mds dev` のプレビュー（`/`）に入れるソース。画面に合わせる・S で発表を始める（#60） */
export const PREVIEW_SCRIPT = `(${startPreview.toString()})(document);`;

/** PDF にする前の準備（#70）。CLI の `mds pdf` が page.evaluate で呼ぶ */
export { preparePrint } from './print.js';
