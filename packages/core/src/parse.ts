import type { Token } from 'markdown-it';
import type { Attrs } from './attrs.js';
import type { Diagnostic } from './diagnostics.js';
import { parseMeta, splitFrontmatter } from './frontmatter.js';
import { hashString } from './hash.js';
import type { Block, BlockKind, Deck, Heading, MediaRef, SectionNode, SourceRange } from './ir.js';
import type { BlockMeta } from './md/attrs.js';
import type { ContainerMeta } from './md/container.js';
import type { DirectiveMeta } from './md/directive.js';
import type { ParseEnv } from './md/env.js';
import { md } from './md/instance.js';
import { detectSlideLevel, scanHeadings } from './slide-level.js';
import { SlugRegistry } from './slug.js';
import { closest } from './suggest.js';
import { DIRECTIVE_NAMES } from './syntax/elements.js';

interface MutableSection {
  id: string;
  level: number;
  heading?: Heading;
  attrs?: Attrs;
  blocks: Block[];
  children: MutableSection[];
  start: number;
}

interface Context {
  tokens: Token[];
  bodyLines: string[];
  range: (map: [number, number]) => SourceRange;
}

/** Markdown の文字列を、節のツリーとブロックからなる中間表現（IR）にする。 */
export function parseDeck(source: string): Deck {
  const text = source.replace(/\r\n?/g, '\n');
  const diagnostics: Diagnostic[] = [];

  const split = splitFrontmatter(text, diagnostics);
  const meta = parseMeta(split.frontmatter, diagnostics);

  const bodyLines = split.body.split('\n');
  const env: ParseEnv = {
    diagnostics,
    lineOffset: split.bodyStartLine,
    implicitCloseLevel:
      meta.slideLevel === 'auto' ? detectSlideLevel(scanHeadings(bodyLines)) : meta.slideLevel,
  };
  const tokens = md.parse(split.body, env);
  // markdown-it の map は本文の 0 から始まる行番号で、リストなどは後ろの空行も含む。
  // 後ろの空行を除いてから、元のファイルの行番号に直す
  const range = (map: [number, number]): SourceRange => {
    let last = map[1] - 1;
    while (last > map[0] && (bodyLines[last] ?? '').trim() === '') last--;
    return { start: split.bodyStartLine + map[0], end: split.bodyStartLine + last };
  };
  const ctx: Context = { tokens, bodyLines, range };

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

    if (token.type === 'heading_open') {
      const src = range(token.map);
      const heading = readHeading(token, tokens[i + 1], src);
      if (token.markup === '-') {
        diagnostics.push({
          severity: 'warning',
          code: 'heading/setext-dash',
          message: `「---」の前に空行がないため、${src.start}行目が見出しになりました。スライドを区切るなら「---」の前に空行を入れてください`,
          line: src.end,
        });
      }
      while (stack[stack.length - 1]!.level >= heading.level) stack.pop();
      const attrs = (token.meta as BlockMeta | null)?.attrs;
      const section: MutableSection = {
        id: slugs.next(heading.text),
        level: heading.level,
        heading,
        ...(attrs ? { attrs } : {}),
        blocks: [],
        children: [],
        start: src.start,
      };
      stack[stack.length - 1]!.children.push(section);
      stack.push(section);
      continue;
    }

    const [block, end] = readBlock(ctx, i);
    if (block) stack[stack.length - 1]!.blocks.push(block);
    i = end;
  }

  const deck: Deck = {
    meta,
    ...(split.frontmatter
      ? { frontmatter: { start: split.frontmatter.startLine, end: split.frontmatter.endLine } }
      : {}),
    root: finalize(root),
    diagnostics,
  };
  checkUnknownDirectives(deck.root, diagnostics);
  diagnostics.sort((a, b) => a.line - b.line);
  return deck;
}

/** tokens[i] から始まるブロックを読み、ブロックと、最後に読んだトークンの位置を返す。 */
function readBlock(ctx: Context, i: number): [Block | undefined, number] {
  const { tokens } = ctx;
  const token = tokens[i]!;
  const end = token.nesting === 1 ? matchingClose(tokens, i) : i;
  const kind = blockKind(token);
  if (!kind || !token.map) return [undefined, end];

  const src = ctx.range(token.map);
  const raw = ctx.bodyLines.slice(token.map[0], token.map[1]).join('\n').replace(/\n+$/, '');
  const block: Block = { kind, raw, hash: hashString(`${kind}\n${raw}`), src };
  const meta = token.meta as (BlockMeta & Partial<ContainerMeta & DirectiveMeta>) | null;

  switch (token.type) {
    case 'paragraph_open': {
      if (meta?.attrs) block.attrs = meta.attrs;
      if (meta?.slideAttrs) block.attrs = meta.slideAttrs;
      const media = readMedia(tokens[i + 1]);
      if (media.length > 0 && kind === 'paragraph') block.media = media;
      break;
    }
    case 'fence': {
      const lang = token.info.trim().split(/\s+/)[0];
      if (lang) block.lang = lang;
      if (meta?.attrs) block.attrs = meta.attrs;
      break;
    }
    case 'bullet_list_open':
    case 'ordered_list_open':
      block.ordered = token.type === 'ordered_list_open';
      break;
    case 'hr':
      block.marker = token.markup;
      break;
    case 'heading_open': {
      const heading = readHeading(token, tokens[i + 1], src);
      block.level = heading.level;
      block.text = heading.text;
      if (meta?.attrs) block.attrs = meta.attrs;
      break;
    }
    case 'mds_container_open':
      block.name = meta!.name!;
      if (meta?.attrs) block.attrs = meta.attrs;
      block.children = readChildren(ctx, i + 1, end);
      break;
    case 'mds_directive':
      block.name = meta!.name!;
      if (meta?.attrs) block.attrs = meta.attrs;
      break;
  }
  return [block, end];
}

/** コンテナの中のブロックを読む。中の見出しは節にせず、heading ブロックにする。 */
function readChildren(ctx: Context, from: number, to: number): Block[] {
  const blocks: Block[] = [];
  const level = ctx.tokens[from]?.level;
  for (let i = from; i < to; i++) {
    const token = ctx.tokens[i]!;
    if (token.level !== level || token.nesting === -1 || !token.map) continue;
    const [block, end] = readBlock(ctx, i);
    if (block) blocks.push(block);
    i = end;
  }
  return blocks;
}

function matchingClose(tokens: Token[], i: number): number {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    depth += tokens[j]!.nesting;
    if (depth === 0) return j;
  }
  return tokens.length - 1;
}

function blockKind(token: Token): BlockKind | undefined {
  const meta = token.meta as BlockMeta | null;
  switch (token.type) {
    case 'paragraph_open':
      if (meta?.pause) return 'pause';
      if (meta?.slideAttrs) return 'slide-attrs';
      return 'paragraph';
    case 'heading_open':
      return 'heading';
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
    case 'mds_container_open':
      return 'container';
    case 'mds_directive':
      return 'directive';
    default:
      return undefined;
  }
}

function readHeading(open: Token, inline: Token | undefined, src: SourceRange): Heading {
  return {
    level: Number(open.tag.slice(1)) as Heading['level'],
    text: plainText(inline),
    raw: (inline?.content ?? '').trim(),
    setext: open.markup === '=' || open.markup === '-',
    line: src.start,
  };
}

function readMedia(inline: Token | undefined): MediaRef[] {
  const media: MediaRef[] = [];
  for (const child of inline?.children ?? []) {
    if (child.type !== 'image') continue;
    const title = child.attrGet('title');
    const attrs = (child.meta as { attrs?: Attrs } | null)?.attrs;
    media.push({
      src: String(child.attrGet('src') ?? ''),
      alt: child.content,
      ...(title ? { title: String(title) } : {}),
      ...(attrs ? { attrs } : {}),
    });
  }
  return media;
}

function isOnlyComments(html: string): boolean {
  return html.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

/** 見出しのインライン要素から、書式を除いた文字列を取り出す。 */
function plainText(inline: Token | undefined): string {
  if (!inline) return '';
  if (!inline.children) return inline.content.trim();
  return inline.children
    .map((child) => {
      switch (child.type) {
        case 'text':
        case 'code_inline':
        case 'text_special':
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

/** `::toc` のような未定義の指示は段落として残るので、ここで警告する（構文仕様 §11）。 */
function checkUnknownDirectives(section: SectionNode, diagnostics: Diagnostic[]): void {
  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.children) visit(block.children);
      if (block.kind !== 'paragraph') continue;
      const m = /^::([A-Za-z][\w-]*)/.exec(block.raw);
      if (!m || DIRECTIVE_NAMES.includes(m[1]!)) continue;
      const suggestion = closest(m[1]!, DIRECTIVE_NAMES);
      diagnostics.push({
        severity: 'warning',
        code: 'directive/unknown',
        message:
          `未定義の指示「::${m[1]}」。` +
          (suggestion ? `「::${suggestion}」のことですか？` : '文字のまま表示します'),
        line: block.src.start,
        ...(suggestion ? { suggestion } : {}),
      });
    }
  };
  visit(section.blocks);
  section.children.forEach((child) => checkUnknownDirectives(child, diagnostics));
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
      JSON.stringify(section.attrs ?? null),
      ...section.blocks.map((block) => block.hash),
      ...children.map((child) => child.hash),
    ].join('|'),
  );
  return {
    id: section.id,
    level: section.level,
    ...(section.heading ? { heading: section.heading } : {}),
    ...(section.attrs ? { attrs: section.attrs } : {}),
    blocks: section.blocks,
    children,
    src: { start: section.start, end: Math.max(...ends) },
    hash,
  };
}
