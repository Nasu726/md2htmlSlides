import markdownIt, { type MarkdownIt, type StateCore, type Token } from 'markdown-it';
import type { Attrs } from '../attrs.js';
import { attrsPlugin, type BlockMeta } from './attrs.js';
import { containerPlugin } from './container.js';
import { directivePlugin } from './directive.js';

/**
 * パースと描画で共有する markdown-it。
 * 生 HTML は許可する（構文仕様 §9）。表と打ち消し線は既定で有効。
 */
export const md: MarkdownIt = markdownIt({ html: true, linkify: false, typographer: false })
  .use(containerPlugin)
  .use(directivePlugin)
  .use(attrsPlugin)
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
}

/** 描画の規則：属性のクラス、表示しない段落、アラート、背景の画像、コンテナ。 */
function renderRules(instance: MarkdownIt): void {
  const rules = instance.renderer.rules;
  const self = instance.renderer;

  const hiddenParagraph = (token: Token | undefined) => {
    const meta = token?.meta as (BlockMeta & { empty?: boolean }) | null | undefined;
    return Boolean(meta?.pause || meta?.slideAttrs || meta?.empty);
  };
  rules.paragraph_open = (tokens, idx, options) => {
    const token = tokens[idx]!;
    if (hiddenParagraph(token)) return '';
    applyAttrs(token, (token.meta as BlockMeta | null)?.attrs);
    return self.renderToken(tokens, idx, options);
  };
  rules.paragraph_close = (tokens, idx, options) =>
    hiddenParagraph(tokens[idx - 2]) ? '' : self.renderToken(tokens, idx, options);
  rules.inline = (tokens, idx, options, env) => {
    if (hiddenParagraph(tokens[idx - 1])) return '';
    return self.renderInline(tokens[idx]!.children ?? [], options, env);
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

  const image = rules.image!;
  rules.image = (tokens, idx, options, env, renderer) => {
    const token = tokens[idx]!;
    const attrs = (token.meta as { attrs?: Attrs } | null)?.attrs;
    // 背景にする画像は本文に出さない（背景の描画は M2）
    if (attrs?.values.bg !== undefined) return '';
    if (typeof attrs?.values.width === 'string')
      token.attrSet('style', `width:${attrs.values.width}`);
    applyAttrs(token, attrs);
    return image(tokens, idx, options, env, renderer);
  };

  rules.mds_container_open = (tokens, idx) =>
    `<div class="mds-c mds-c-${instance.utils.escapeHtml(tokens[idx]!.info)}">\n`;
  rules.mds_container_close = () => '</div>\n';
  rules.mds_directive = () => '';
}
