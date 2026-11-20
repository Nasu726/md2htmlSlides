/**
 * コードの色分け・数式・図（#84）。CLI（書き出し）と Web エディタ（プレビュー）で、同じ結果にするために共有する。
 *
 * - 数式（KaTeX）と Mermaid の補助：ここから読み込む。KaTeX 本体は、数式があるときだけ読み込む
 * - コードの色分け（Shiki）：`@mdhs/embeds/highlight` から読み込む（大きいので、使うときだけ読み込めるように分けている）
 */
export { visibleText } from './text.js';
export { codeLanguages, FIGURE_LANGS, needsHighlighter } from './langs.js';
export {
  mathDiagnostics,
  mathEngine,
  parseKatexCss,
  usedFaceKeys,
  type KatexCss,
  type KatexFace,
  type MathEngine,
  type MathUsage,
} from './math.js';
export { collectMermaid, diagramDiagnostic, normalizeCode, type MermaidSource } from './mermaid.js';
export { prepareDeck, type ArchItem, type PipelineHost, type Prepared } from './pipeline.js';
