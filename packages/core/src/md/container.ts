import type { MarkdownIt, StateBlock } from 'markdown-it';
import { parseAttrs, type Attrs } from '../attrs.js';
import { closest } from '../suggest.js';
import { CONTAINER_NAMES } from '../syntax/elements.js';
import { fileLine, type ParseEnv } from './env.js';

export type ContainerMeta = {
  name: string;
  attrs?: Attrs;
  known: boolean;
  closed: boolean;
};

const OPEN = /^(:{3,})[ \t]*([A-Za-z][\w-]*)[ \t]*(\{[^{}]*\})?[ \t]*$/;
const CLOSE = /^(:{3,})[ \t]*$/;
const FENCE = /^(`{3,}|~{3,})/;

/**
 * `:::名前 {属性}` … `:::` のコンテナ（構文仕様 §4）。
 * 入れ子は外側のコロンを増やす。閉じる `:::` がなければ、
 * 次の implicitCloseLevel 以上の見出しの直前で閉じたものとして扱い、警告する。
 */
export function containerPlugin(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'mds_container', container, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]);
}

function container(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const open = OPEN.exec(lineText(state, startLine));
  if (!open) return false;
  if (silent) return true;

  const env = state.env as ParseEnv;
  const marker = open[1]!;
  const name = open[2]!;
  const known = CONTAINER_NAMES.includes(name);

  // 閉じる `:::` を探す（コードブロックの中は見ない）
  let closeLine = -1;
  let fence: string | null = null;
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(state, line);
    if (text !== '' && state.sCount[line]! < state.blkIndent) break;
    const f = FENCE.exec(text);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      continue;
    }
    const close = CLOSE.exec(text);
    if (close && close[1]!.length >= marker.length) {
      closeLine = line;
      break;
    }
  }

  let contentEnd = closeLine;
  if (closeLine === -1) {
    contentEnd = endLine;
    for (let line = startLine + 1; line < endLine; line++) {
      const heading = /^(#{1,6})(\s|$)/.exec(lineText(state, line));
      if (heading && heading[1]!.length <= env.implicitCloseLevel) {
        contentEnd = line;
        break;
      }
    }
    env.diagnostics.push({
      severity: 'warning',
      code: 'container/unclosed',
      message: `「${marker}${name}」を閉じる「${marker}」がありません。${
        contentEnd < endLine ? `${fileLine(env, contentEnd)}行目の見出しの直前` : '文書の最後'
      }で閉じたものとして扱います`,
      line: fileLine(env, startLine),
    });
  }

  if (!known) {
    const suggestion = closest(name, CONTAINER_NAMES);
    env.diagnostics.push({
      severity: 'warning',
      code: 'container/unknown',
      message:
        `未知のコンテナ「${name}」。` +
        (suggestion ? `「${suggestion}」のことですか？` : '中身は普通に表示します'),
      line: fileLine(env, startLine),
      ...(suggestion ? { suggestion, found: name } : {}),
    });
  }

  let attrs: Attrs | undefined;
  if (open[3]) {
    const result = parseAttrs(open[3]);
    if (result.ok) attrs = result.attrs;
    else
      env.diagnostics.push({
        severity: 'warning',
        code: 'attrs/unknown-key',
        message: `コンテナの属性「${open[3]}」を読めません`,
        line: fileLine(env, startLine),
      });
  }

  const meta: ContainerMeta = {
    name,
    known,
    closed: closeLine !== -1,
    ...(attrs ? { attrs } : {}),
  };
  const end = closeLine === -1 ? contentEnd : closeLine + 1;

  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;
  state.parentType = 'mds_container';
  state.lineMax = contentEnd;

  const openToken = state.push('mds_container_open', 'div', 1);
  openToken.block = true;
  openToken.markup = marker;
  openToken.info = name;
  openToken.map = [startLine, end];
  openToken.meta = meta;

  state.md.block.tokenize(state, startLine + 1, contentEnd);

  const closeToken = state.push('mds_container_close', 'div', -1);
  closeToken.block = true;
  closeToken.markup = closeLine === -1 ? '' : marker;

  state.parentType = oldParent;
  state.lineMax = oldLineMax;
  state.line = end;
  return true;
}
