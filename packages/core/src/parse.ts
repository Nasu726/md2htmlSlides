import MarkdownIt, { type Token } from 'markdown-it';
import type { Diagnostic } from './diagnostics.js';
import { parseMeta, splitFrontmatter } from './frontmatter.js';
import { hashString } from './hash.js';
import type { Block, BlockKind, Deck, Heading, SectionNode, SourceRange } from './ir.js';
import { SlugRegistry } from './slug.js';

/** 生 HTML は許可する（構文仕様 §9）。表と打ち消し線は既定で有効。 */
const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

interface MutableSection {
  id: string;
  level: number;
  heading?: Heading;
  blocks: Block[];
  children: MutableSection[];
  start: number;
}

/** Markdown の文字列を、節のツリーとブロックからなる中間表現（IR）にする。 */
export function parseDeck(source: string): Deck {
  const text = source.replace(/\r\n?/g, '\n');
  const diagnostics: Diagnostic[] = [];

  const split = splitFrontmatter(text, diagnostics);
  const meta = parseMeta(split.frontmatter, diagnostics);

  const bodyLines = split.body.split('\n');
  const tokens = md.parse(split.body, {});
  // markdown-it の map は本文の 0 から始まる行番号で、リストなどは後ろの空行も含む。
  // 後ろの空行を除いてから、元のファイルの行番号に直す
  const range = (map: [number, number]): SourceRange => {
    let last = map[1] - 1;
    while (last > map[0] && (bodyLines[last] ?? '').trim() === '') last--;
    return { start: split.bodyStartLine + map[0], end: split.bodyStartLine + last };
  };

  const slugs = new SlugRegistry();
  const root: MutableSection = {
    id: '',
    level: 0,
    blocks: [],
    children: [],
    start: split.bodyStartLine,
  };
  const stack: MutableSection[] = [root];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.level !== 0 || token.nesting === -1 || !token.map) continue;
    const src = range(token.map);

    if (token.type === 'heading_open') {
      const inline = tokens[i + 1];
      const level = Number(token.tag.slice(1)) as Heading['level'];
      const setext = token.markup === '=' || token.markup === '-';
      if (token.markup === '-') {
        diagnostics.push({
          severity: 'warning',
          code: 'heading/setext-dash',
          message: `「---」の前に空行がないため、${src.start}行目が見出しになりました。スライドを区切るなら「---」の前に空行を入れてください`,
          line: src.end,
        });
      }
      const heading: Heading = {
        level,
        text: plainText(inline),
        raw: inline?.content ?? '',
        setext,
        line: src.start,
      };
      while (stack[stack.length - 1]!.level >= level) stack.pop();
      const section: MutableSection = {
        id: slugs.next(heading.text),
        level,
        heading,
        blocks: [],
        children: [],
        start: src.start,
      };
      stack[stack.length - 1]!.children.push(section);
      stack.push(section);
      continue;
    }

    const block = toBlock(token, src, bodyLines);
    if (block) stack[stack.length - 1]!.blocks.push(block);
  }

  return {
    meta,
    ...(split.frontmatter
      ? { frontmatter: { start: split.frontmatter.startLine, end: split.frontmatter.endLine } }
      : {}),
    root: finalize(root),
    diagnostics,
  };
}

function toBlock(token: Token, src: SourceRange, bodyLines: string[]): Block | undefined {
  const kind = blockKind(token);
  if (!kind) return undefined;
  const map = token.map!;
  const raw = bodyLines.slice(map[0], map[1]).join('\n').replace(/\n+$/, '');
  const block: Block = { kind, raw, hash: hashString(`${kind}\n${raw}`), src };
  if (kind === 'code' && token.type === 'fence') {
    const lang = token.info.trim().split(/\s+/)[0];
    if (lang) block.lang = lang;
  }
  if (kind === 'list') block.ordered = token.type === 'ordered_list_open';
  if (kind === 'rule') block.marker = token.markup;
  return block;
}

function blockKind(token: Token): BlockKind | undefined {
  switch (token.type) {
    case 'paragraph_open':
      return 'paragraph';
    case 'bullet_list_open':
    case 'ordered_list_open':
      return 'list';
    case 'blockquote_open':
      return 'quote';
    case 'table_open':
      return 'table';
    case 'fence':
    case 'code_block':
      return 'code';
    case 'html_block':
      return isOnlyComments(token.content) ? 'comment' : 'html';
    case 'hr':
      return 'rule';
    default:
      return undefined;
  }
}

function isOnlyComments(html: string): boolean {
  return html.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

/** 見出しのインライン要素から、書式を除いた文字列を取り出す。 */
function plainText(inline: Token | undefined): string {
  if (!inline) return '';
  if (!inline.children) return inline.content;
  return inline.children
    .map((child) => {
      switch (child.type) {
        case 'text':
        case 'code_inline':
          return child.content;
        case 'softbreak':
        case 'hardbreak':
          return ' ';
        case 'image':
          return child.content;
        default:
          return '';
      }
    })
    .join('')
    .trim();
}

function finalize(section: MutableSection): SectionNode {
  const children = section.children.map(finalize);
  const ends = [
    section.heading?.line ?? section.start,
    ...section.blocks.map((block) => block.src.end),
    ...children.map((child) => child.src.end),
  ];
  const hash = hashString(
    [
      section.level,
      section.heading?.raw ?? '',
      ...section.blocks.map((block) => block.hash),
      ...children.map((child) => child.hash),
    ].join('|'),
  );
  return {
    id: section.id,
    level: section.level,
    ...(section.heading ? { heading: section.heading } : {}),
    blocks: section.blocks,
    children,
    src: { start: section.start, end: Math.max(...ends) },
    hash,
  };
}
