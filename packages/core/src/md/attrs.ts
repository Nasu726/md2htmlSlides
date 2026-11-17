import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { parseAttrs, type Attrs, type AttrsResult } from '../attrs.js';
import { fileLine, type ParseEnv } from './env.js';

/** 段落・見出し・コードの open トークンに付ける情報。 */
export type BlockMeta = {
  /** 末尾の `{…}` から読んだ属性 */
  attrs?: Attrs;
  /** `. . .` だけの段落 */
  pause?: boolean;
  /** `{…}` だけの段落（そのスライドに付ける属性） */
  slideAttrs?: Attrs;
};

const TRAILING = /[ \t]+(\{[^{}\n]*\})[ \t]*$/;
const WHOLE = /^\{[^{}\n]*\}$/;
const PAUSE = /^\.[ \t]\.[ \t]\.$/;

/**
 * 属性 `{…}`（構文仕様 §3）と `. . .`（§5.1）を読む。
 * - 見出し・段落の末尾（前に空白）：その見出しの節・その段落に付ける
 * - `{…}` だけの段落：それを含むスライドに付ける
 * - フェンスコードの情報文字列・独立した数式の閉じる `$$` の後：そのブロックに付ける
 * - 画像の直後（空白なし）：その画像に付ける
 */
export function attrsPlugin(md: MarkdownIt): void {
  md.core.ruler.before('inline', 'mds_block_attrs', blockAttrs);
  // 画像の直後の文字は text_join のあとで1つにまとまるので、最後に読む
  md.core.ruler.push('mds_inline_attrs', inlineAttrs);
}

function blockAttrs(state: StateCore): void {
  const env = state.env as ParseEnv;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type === 'fence' || token.type === 'math_block') {
      fenceAttrs(token, env);
      continue;
    }
    if (token.type !== 'inline') continue;
    const open = tokens[i - 1];
    if (!open || (open.type !== 'paragraph_open' && open.type !== 'heading_open')) continue;
    const startLine = open.map?.[0] ?? 0;
    const content = token.content;
    const trimmed = content.trim();

    if (open.type === 'paragraph_open') {
      if (PAUSE.test(trimmed)) {
        setMeta(open, { pause: true });
        continue;
      }
      if (WHOLE.test(trimmed)) {
        const result = parseAttrs(trimmed);
        if (result.ok) setMeta(open, { slideAttrs: result.attrs });
        report(result, env, fileLine(env, startLine));
        continue;
      }
    }

    const m = TRAILING.exec(content);
    if (!m) continue;
    const line = fileLine(env, startLine + countNewlines(content.slice(0, m.index)));
    const result = parseAttrs(m[1]!);
    if (result.ok) {
      token.content = content.slice(0, m.index);
      setMeta(open, { attrs: result.attrs });
    }
    report(result, env, line);
  }
}

function fenceAttrs(token: Token, env: ParseEnv): void {
  const info = token.info.trim();
  const brace = info.indexOf('{');
  if (brace === -1 || !info.endsWith('}')) return;
  const result = parseAttrs(info.slice(brace));
  if (result.ok) {
    token.info = info.slice(0, brace).trim();
    setMeta(token, { attrs: result.attrs });
  }
  report(result, env, fileLine(env, token.map?.[0] ?? 0));
}

function inlineAttrs(state: StateCore): void {
  const env = state.env as ParseEnv;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (inline.type !== 'inline' || !inline.children) continue;
    const line = fileLine(env, tokens[i - 1]?.map?.[0] ?? inline.map?.[0] ?? 0);
    const children = inline.children;
    for (let k = 0; k < children.length; k++) {
      const image = children[k]!;
      const next = children[k + 1];
      if (image.type !== 'image' || next?.type !== 'text' || !next.content.startsWith('{'))
        continue;
      const close = next.content.indexOf('}');
      if (close === -1) continue;
      const result = parseAttrs(next.content.slice(0, close + 1));
      if (result.ok) {
        image.meta = { ...(image.meta as object | null), attrs: result.attrs };
        next.content = next.content.slice(close + 1);
      }
      report(result, env, line);
    }
  }
}

function setMeta(token: Token, meta: BlockMeta): void {
  token.meta = { ...(token.meta as BlockMeta | null), ...meta };
}

function countNewlines(text: string): number {
  return text.split('\n').length - 1;
}

function report(result: AttrsResult, env: ParseEnv, line: number): void {
  if (result.ok) {
    for (const { key, expected } of result.invalid) {
      env.diagnostics.push({
        severity: 'warning',
        code: 'attrs/invalid-value',
        message: `属性「${key}」の値が正しくありません（${expected}）。この属性は無視します`,
        line,
      });
    }
    return;
  }
  if (!result.typo) return;
  const { key, suggestion } = result.typo;
  env.diagnostics.push({
    severity: 'warning',
    code: 'attrs/unknown-key',
    message:
      `未知の属性「${key}」` +
      (suggestion ? `。「${suggestion}」のことですか？` : '。文字のまま表示します'),
    line,
    ...(suggestion ? { suggestion, found: key } : {}),
  });
}
