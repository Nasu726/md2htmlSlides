import type { MarkdownIt, StateBlock } from 'markdown-it';
import { parseAttrs, type Attrs } from '../attrs.js';
import { DIRECTIVE_NAMES } from '../syntax/elements.js';
import { fileLine, type ParseEnv } from './env.js';

export type DirectiveMeta = {
  name: string;
  attrs?: Attrs;
};

const DIRECTIVE = /^::([A-Za-z][\w-]*)[ \t]*(\{[^{}]*\})?[ \t]*$/;

/**
 * 単独行の指示 `::名前{属性}`（構文仕様 §2.2・§11）。今は `::maketitle` だけを受け付ける。
 * 未定義の名前は普通の段落として残し、IR を作るときに警告する。
 */
export function directivePlugin(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'mds_directive', directive, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}

function directive(state: StateBlock, startLine: number, _endLine: number, silent: boolean) {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const text = state.src.slice(
    state.bMarks[startLine]! + state.tShift[startLine]!,
    state.eMarks[startLine],
  );
  const m = DIRECTIVE.exec(text);
  if (!m || !DIRECTIVE_NAMES.includes(m[1]!)) return false;
  if (silent) return true;

  const env = state.env as ParseEnv;
  let attrs: Attrs | undefined;
  if (m[2]) {
    const result = parseAttrs(m[2]);
    if (result.ok) attrs = result.attrs;
    else
      env.diagnostics.push({
        severity: 'warning',
        code: 'attrs/unknown-key',
        message: `「::${m[1]}」の属性「${m[2]}」を読めません`,
        line: fileLine(env, startLine),
      });
  }

  const token = state.push('mds_directive', 'div', 0);
  token.block = true;
  token.info = m[1]!;
  token.map = [startLine, startLine + 1];
  token.meta = { name: m[1]!, ...(attrs ? { attrs } : {}) } satisfies DirectiveMeta;
  state.line = startLine + 1;
  return true;
}
