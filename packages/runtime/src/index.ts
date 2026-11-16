/**
 * 発表用の runtime：拡大縮小・キー操作・URL でのページ指定（docs/design.md §8）。
 * 段階表示と発表者ビューは M2 で加える。
 */
import { startPlayer } from './player.js';

export const RUNTIME_VERSION = '0.0.0';

export { startPlayer };

/**
 * 書き出した HTML の `<script>` に入れるソース。
 * `renderDeckHtml(deck, { scripts: [RUNTIME_SCRIPT] })` のように渡す。
 */
export const RUNTIME_SCRIPT = `(${startPlayer.toString()})(document);`;
