import { archEmbedAttrs, selectArchScenario } from '../render/arch.js';
import markdownIt, { type MarkdownIt, type StateCore, type Token } from 'markdown-it';
import type { Attrs } from '../attrs.js';
import { attrsPlugin, type BlockMeta } from './attrs.js';
import { containerPlugin } from './container.js';
import { directivePlugin } from './directive.js';
import { mathHtml, mathPlugin } from './math.js';
import {
  diagramHtml,
  mediaPlugin,
  renderMedia,
  renderMediaGroupInline,
  type MediaGroupMeta,
  type RenderEnv,
} from './media.js';

/** 図として描くコードの言語（色分けしない。構文仕様 §7） */
const FIGURE_LANGS = new Set(['mermaid', 'arch', 'math']);

/**
 * パースと描画で共有する markdown-it。
 * 生 HTML は許可する（構文仕様 §9）。表と打ち消し線は既定で有効。
 */
export const md: MarkdownIt = markdownIt({ html: true, linkify: false, typographer: false })
  .use(containerPlugin)
  .use(directivePlugin)
  .use(attrsPlugin)
  .use(mediaPlugin)
  .use(mathPlugin)
  .use(alertsPlugin)
  .use(renderRules);

const ALERT_TITLES: Record<string, string> = {
  note: 'メモ',
  tip: 'ヒント',
  important: '重要',
  warning: '注意',
  caution: '警告',
};

/** GitHub 形式のアラート `> [!NOTE]` を囲み枠にする（構文仕様 §4）。 */
function alertsPlugin(instance: MarkdownIt): void {
  instance.core.ruler.after('block', 'mds_alerts', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.type !== 'blockquote_open') continue;
      const inline = tokens[i + 2];
      if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(inline.content);
      if (!m) continue;
      tokens[i]!.meta = { ...(tokens[i]!.meta as object | null), alert: m[1]!.toLowerCase() };
      inline.content = inline.content.slice(m[0].length);
      if (inline.content.trim() === '') {
        tokens[i + 1]!.meta = { ...(tokens[i + 1]!.meta as object | null), empty: true };
      }
    }
  });
}

function applyAttrs(token: Token, attrs: Attrs | undefined): void {
  if (!attrs) return;
  if (attrs.classes.length > 0) token.attrJoin('class', attrs.classes.join(' '));
  if (attrs.id) token.attrSet('id', attrs.id);
  applyStep(token, attrs);
}

/**
 * `{step}`・`{step=N}` の印（構文仕様 §5.3）。番号はスライドを描いた後に文書順で決める
 * （`numberSteps`）ので、ここでは「自動」か「明示の番号」かだけを書く。
 */
function applyStep(token: Token, attrs: Attrs | undefined): void {
  const step = attrs?.values.step;
  if (step !== undefined) token.attrSet('data-mds-step', step === true ? 'auto' : String(step));
}

/** 描画の規則：属性のクラス、表示しない段落、アラート、画像・動画、コンテナ。 */
function renderRules(instance: MarkdownIt): void {
  const rules = instance.renderer.rules;
  const self = instance.renderer;

  type ParagraphMeta = BlockMeta & MediaGroupMeta;
  const paragraphMeta = (token: Token | undefined) =>
    token?.type === 'paragraph_open' ? (token.meta as ParagraphMeta | null) : null;
  const hiddenParagraph = (token: Token | undefined) => {
    const meta = paragraphMeta(token);
    return Boolean(meta?.pause || meta?.slideAttrs || meta?.empty);
  };
  rules.paragraph_open = (tokens, idx, options) => {
    const token = tokens[idx]!;
    if (hiddenParagraph(token)) return '';
    const meta = paragraphMeta(token);
    if (meta?.mediaGroup) {
      // 画像・動画だけの段落は、figure を並べる箱にする
      token.tag = 'div';
      token.attrJoin('class', `mds-media-group is-${meta.mediaGroup}`);
    }
    applyAttrs(token, meta?.attrs);
    return self.renderToken(tokens, idx, options);
  };
  rules.paragraph_close = (tokens, idx, options) => {
    const open = tokens[idx - 2];
    if (hiddenParagraph(open)) return '';
    if (paragraphMeta(open)?.mediaGroup) tokens[idx]!.tag = 'div';
    return self.renderToken(tokens, idx, options);
  };
  rules.inline = (tokens, idx, options, env) => {
    const open = tokens[idx - 1];
    if (hiddenParagraph(open)) return '';
    const children = tokens[idx]!.children ?? [];
    return paragraphMeta(open)?.mediaGroup
      ? renderMediaGroupInline(self, children, options, (env ?? {}) as RenderEnv)
      : self.renderInline(children, options, env);
  };
  rules.heading_open = (tokens, idx, options) => {
    applyAttrs(tokens[idx]!, (tokens[idx]!.meta as BlockMeta | null)?.attrs);
    return self.renderToken(tokens, idx, options);
  };

  rules.blockquote_open = (tokens, idx, options) => {
    const alert = (tokens[idx]!.meta as { alert?: string } | null)?.alert;
    if (!alert) return self.renderToken(tokens, idx, options);
    return `<div class="mds-alert mds-alert-${alert}" role="note"><p class="mds-alert-title">${ALERT_TITLES[alert]}</p>\n`;
  };
  rules.blockquote_close = (tokens, idx, options) => {
    // 対応する blockquote_open を探す
    let depth = 0;
    for (let j = idx; j >= 0; j--) {
      const t = tokens[j]!;
      if (t.type === 'blockquote_close') depth++;
      if (t.type === 'blockquote_open' && --depth === 0) {
        return (t.meta as { alert?: string } | null)?.alert
          ? '</div>\n'
          : self.renderToken(tokens, idx, options);
      }
    }
    return self.renderToken(tokens, idx, options);
  };

  // 箇条書きの項目の末尾に書いた {step} は、項目（li）に付ける
  rules.list_item_open = (tokens, idx, options) => {
    const next = tokens[idx + 1];
    if (next?.type === 'paragraph_open')
      applyStep(tokens[idx]!, (next.meta as BlockMeta | null)?.attrs);
    return self.renderToken(tokens, idx, options);
  };
  // コード・図（```mermaid {step}）の {step} は pre に付ける。
  // 色分けの関数（#68）があれば、コードに色を付ける（図にするコードは除く）
  const fence = rules.fence!;
  rules.fence = (tokens, idx, options, env, renderer) => {
    const token = tokens[idx]!;
    const lang = token.info.trim().split(/\s+/)[0] ?? '';
    const step = (token.meta as BlockMeta | null)?.attrs?.values.step;
    const stepAttr =
      step === undefined ? '' : ` data-mds-step="${step === true ? 'auto' : String(step)}"`;
    // ```math は独立した数式にする（#72）
    if (lang === 'math') {
      return mathHtml(instance.utils.escapeHtml, token.content.replace(/\n$/, ''), {
        display: true,
        block: true,
        render: (env as RenderEnv | undefined)?.math,
        attrs: stepAttr,
      });
    }
    // ```mermaid・```arch は図にする（#71・#107）。描けなければ（Chromium がないなど）コードのまま出す
    const diagram =
      lang === 'mermaid' || lang === 'arch'
        ? (env as RenderEnv | undefined)?.diagram?.({ lang, code: token.content })
        : undefined;
    if (diagram) {
      const arch = lang === 'arch';
      const inner = arch
        ? diagramHtml(instance.utils.escapeHtml, diagram, '動く構成図', '動く構成図を描けません')
        : diagramHtml(instance.utils.escapeHtml, diagram, 'Mermaid の図');
      // 動く構成図（#108）：シナリオの再生のための属性
      const embed =
        arch && !('error' in diagram)
          ? archEmbedAttrs(
              selectArchScenario(diagram.scenarios, (token.meta as BlockMeta | null)?.attrs),
              instance.utils.escapeHtml,
            )
          : '';
      return `<div class="mds-media-group is-flex"><figure class="mds-media mds-media-${arch ? 'arch' : 'diagram'}"${stepAttr}${embed}><div class="mds-media-frame">${inner}</div></figure></div>\n`;
    }
    const highlight = (env as RenderEnv | undefined)?.highlight;
    const colored =
      highlight && lang && !FIGURE_LANGS.has(lang) ? highlight(token.content, lang) : undefined;
    let html = fence(
      tokens,
      idx,
      colored === undefined ? options : { ...options, highlight: () => colored },
      env,
      renderer,
    );
    // 行ハイライトの段（{lines="1|2-3|5"}。構文仕様 §5.4、#105）：行ごとに印を付ける。
    // 最初の表示で1つ目の段を強調し、残りの段の数だけ内部ステップを取る（どの行かは runtime が決める）
    const lines = (token.meta as BlockMeta | null)?.attrs?.values.lines;
    const stages = typeof lines === 'string' ? parseLineStages(lines) : [];
    if (stages.length > 0 && !FIGURE_LANGS.has(lang)) {
      html = wrapCodeLines(html, stages.at(-1)!).replace(
        /^<pre/,
        `<pre data-embed="code-lines" data-lines="${stages.map((s) => s.join(',')).join('|')}" data-mds-substeps="${stages.length - 1}"`,
      );
    }
    if (step === undefined) return html;
    return html.replace(/^<pre/, `<pre${stepAttr}`);
  };

  // 数式（#72）。描く関数がなければ TeX のまま出す
  rules.math_inline = (tokens, idx, _options, env) => {
    const token = tokens[idx]!;
    return mathHtml(instance.utils.escapeHtml, token.content, {
      display: token.markup === '$$',
      block: false,
      render: (env as RenderEnv | undefined)?.math,
    });
  };
  rules.math_block = (tokens, idx, _options, env) => {
    const token = tokens[idx]!;
    const step = (token.meta as BlockMeta | null)?.attrs?.values.step;
    return mathHtml(instance.utils.escapeHtml, token.content, {
      display: true,
      block: true,
      render: (env as RenderEnv | undefined)?.math,
      attrs: step === undefined ? '' : ` data-mds-step="${step === true ? 'auto' : String(step)}"`,
    });
  };

  rules.image = (tokens, idx, _options, env) =>
    renderMedia(instance, tokens, idx, env as RenderEnv | undefined);

  rules.mds_container_open = (tokens, idx) =>
    `<div class="mds-c mds-c-${instance.utils.escapeHtml(tokens[idx]!.info)}">\n`;
  rules.mds_container_close = () => '</div>\n';
  rules.mds_directive = () => '';
}

/**
 * 行ハイライトの段を読む（`"1|2-3|5"` → [[1], [2, 3], [5]]。`,` で区切って1つの段に複数書ける）。
 * 読めない部分は捨てる。
 */
export function parseLineStages(spec: string): number[][] {
  return spec
    .split('|')
    .map((stage) =>
      stage.split(',').flatMap((part) => {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
        if (!m) return [];
        const from = Number(m[1]);
        const to = Math.max(from, Number(m[2] ?? m[1]));
        return from > 0
          ? Array.from({ length: Math.min(to - from + 1, 500) }, (_, i) => from + i)
          : [];
      }),
    )
    .filter((stage) => stage.length > 0);
}

/**
 * コードの各行を `<span class="mds-line">` で囲む（色分けの span は行をまたがない）。
 * 書き出した状態は最後の段（プレビュー・印刷と同じ）：その段の行のほかを薄くする
 */
function wrapCodeLines(html: string, last: number[]): string {
  const focus = new Set(last);
  return html.replace(
    /(<code[^>]*>)([\s\S]*?)(<\/code>)/,
    (_, open: string, body: string, close: string) => {
      const lines = body.replace(/\n$/, '').split('\n');
      const wrapped = lines.map(
        (line, i) => `<span class="mds-line${focus.has(i + 1) ? '' : ' is-dim'}">${line}</span>`,
      );
      return `${open}${wrapped.join('\n')}\n${close}`;
    },
  );
}
