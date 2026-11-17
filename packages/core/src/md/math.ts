import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';

/**
 * 数式（#72、構文仕様 §7.3）。
 *
 * - `$$` で始まる行から `$$` で終わる行まで：独立した数式（1行で `$$ … $$` とも書ける）
 * - 文中の `$…$`：文中の数式。金額などを誤って数式にしないよう、Pandoc と同じ規則にする
 *   - 開く `$` の直後は空白でない
 *   - 閉じる `$` は、開く `$` の後の最初の（`\$` でない）`$`。その直前は空白でなく、直後は数字でない
 *   - 当てはまらなければ、開く `$` はただの文字になる
 * - 文中の `$$…$$`：その場に独立した数式の大きさで描く
 * - `\$` は、いつでもただの `$`
 *
 * ここでは見つけるだけで、描くのは呼ぶ側が渡す関数（`RenderEnv.math`）。
 */
export function mathPlugin(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.inline.ruler.after('escape', 'math_inline', mathInline);
}

/** 文中の数式のトークンに付ける情報：段落の中身の何文字目から始まるか（行番号に使う） */
export type MathInlineMeta = { offset: number; display: boolean };
/** 独立した数式のトークンに付ける情報：TeX が `$$` の行から何行目に始まるか */
export type MathBlockMeta = { texLine: number };

/** 閉じる行：`… $$` の後に、属性 `{…}` だけを書ける */
const CLOSE = /^(.*?)\$\$[ \t]*(\{[^{}\n]*\})?[ \t]*$/;

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]);
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const first = lineText(state, startLine);
  if (!first.startsWith('$$')) return false;
  const rest = first.slice(2);

  let content: string;
  let info = '';
  let last = startLine;
  if (rest.includes('$$')) {
    // 1行：`$$ … $$ {属性}`。後ろに文章が続くなら、文中の `$$…$$` にまかせる
    const m = CLOSE.exec(rest);
    if (!m || m[1]!.includes('$$')) return false;
    content = m[1]!;
    info = m[2] ?? '';
  } else {
    // 複数行：`$$` で終わる行まで。空行（TeX でも数式の中には書けない）か、リストなどの終わりで諦める
    const lines = [rest];
    let found = false;
    for (let line = startLine + 1; line < endLine; line++) {
      if (state.isEmpty(line) || state.sCount[line]! < state.blkIndent) break;
      const text = lineText(state, line);
      const m = CLOSE.exec(text);
      if (m) {
        lines.push(m[1]!);
        info = m[2] ?? '';
        last = line;
        found = true;
        break;
      }
      lines.push(text);
    }
    if (!found) return false;
    content = lines.join('\n');
  }
  if (content.trim() === '') return false;
  if (silent) return true;

  const token = state.push('math_block', 'div', 0);
  token.block = true;
  token.markup = '$$';
  token.content = content.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '');
  // 属性 `{step}` などは、コードと同じく info から読む（attrs.ts）
  token.info = info;
  // `$$` だけの行なら、TeX は次の行から（警告の行番号に使う）
  token.meta = { texLine: rest.trim() === '' ? 1 : 0 } satisfies MathBlockMeta;
  token.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

const isSpace = (code: number) => code === 0x20 || code === 0x09 || code === 0x0a;
const isDigit = (code: number) => code >= 0x30 && code <= 0x39;

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  const display = src.charCodeAt(start + 1) === 0x24;
  const open = display ? 2 : 1;
  if (start + open >= state.posMax) return false;
  if (!display && isSpace(src.charCodeAt(start + 1))) return false;

  // 閉じる `$`（`$$`）を探す。`\` の次の文字は飛ばす（`\$` は数式の中の文字）
  let pos = start + open;
  let close = -1;
  while (pos < state.posMax) {
    const code = src.charCodeAt(pos);
    if (code === 0x5c /* \ */) {
      pos += 2;
      continue;
    }
    if (code === 0x24) {
      if (display) {
        if (src.charCodeAt(pos + 1) === 0x24) close = pos;
      } else {
        close = pos;
      }
      break;
    }
    pos++;
  }
  if (close === -1) return false;
  const content = src.slice(start + open, close);
  if (content.trim() === '') return false;
  if (!display) {
    // 閉じる `$` の直前は空白でなく、直後は数字でない（`$5 と $10` を数式にしない）
    if (isSpace(src.charCodeAt(close - 1))) return false;
    if (isDigit(src.charCodeAt(close + 1))) return false;
  }
  if (!silent) {
    const token = state.push('math_inline', 'span', 0);
    token.markup = display ? '$$' : '$';
    token.content = display ? content.trim() : content;
    token.meta = { offset: start, display } satisfies MathInlineMeta;
  }
  state.pos = close + open;
  return true;
}

/** 数式を描いた結果：KaTeX の HTML か、構文エラー（メッセージと、TeX の何文字目か） */
export type MathResult = { html: string } | { error: string; position?: number };
/**
 * 数式を描く関数（#72）。CLI が KaTeX で HTML にする。
 * 描けないとき（KaTeX を読み込んでいないなど）は undefined を返し、TeX のまま出す。
 */
export type MathRenderer = (tex: string, display: boolean) => MathResult | undefined;

/**
 * 数式の HTML。
 * - 描けた：KaTeX の HTML（独立した数式は `.mds-math-block` で囲む）
 * - エラー：TeX をその場に赤字で出す（独立した数式なら、メッセージも出す）
 * - 描く関数がない：TeX をコードとして出す
 */
export function mathHtml(
  esc: (s: string) => string,
  tex: string,
  options: { display: boolean; block: boolean; render?: MathRenderer | undefined; attrs?: string },
): string {
  const { display, block } = options;
  const result = options.render?.(tex, display);
  const source = block ? tex : display ? `$$${tex}$$` : `$${tex}$`;
  const attrs = options.attrs ?? '';
  if (!block) {
    if (!result) return `<code class="mds-math-raw">${esc(source)}</code>`;
    if ('error' in result) {
      return `<code class="mds-math-error" title="${esc(result.error)}">${esc(source)}</code>`;
    }
    return result.html;
  }
  if (!result) {
    return `<pre class="mds-math-raw"${attrs}><code>${esc(source)}</code></pre>\n`;
  }
  if ('error' in result) {
    return `<div class="mds-math-block mds-math-error" role="note"${attrs}><b>数式のエラー</b><span>${esc(result.error)}</span><code>${esc(source)}</code></div>\n`;
  }
  return `<div class="mds-math-block"${attrs}>${result.html}</div>\n`;
}
