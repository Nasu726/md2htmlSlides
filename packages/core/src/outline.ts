import { formatAttrs } from './attrs.js';
import type { Block, Deck, SectionNode, SourceRange } from './ir.js';

/**
 * IR を人が読める文字列にする。テストのスナップショットと、動作の確認に使う。
 * 例：`## SQL の基本 {layout=split}  L11-L20  #sql-の基本`
 */
export function formatOutline(deck: Deck): string {
  const out: string[] = [];
  const { meta } = deck;

  out.push('meta');
  const titleInfo: [string, string | undefined][] = [
    ['title', meta.title],
    ['subtitle', meta.subtitle],
    [
      'authors',
      meta.authors.length > 0
        ? meta.authors
            .map((a) => (a.affiliation ? `${a.name}（${a.affiliation}）` : a.name))
            .join(', ')
        : undefined,
    ],
    ['affiliation', meta.affiliation],
    ['date', meta.date],
    ['event', meta.event],
    ['logo', meta.logo],
    ['footer', meta.footer],
    ['accent', meta.accent],
    ['css', meta.css],
  ];
  for (const [name, value] of titleInfo) {
    if (value !== undefined) out.push(`  ${name}: ${value}`);
  }
  out.push(
    `  theme=${meta.theme} aspect=${meta.aspect} lang=${meta.lang} slideLevel=${meta.slideLevel}` +
      ` split=${meta.split} titleSlide=${meta.titleSlide} paginate=${meta.paginate}`,
  );

  out.push('diagnostics');
  if (deck.diagnostics.length === 0) out.push('  (なし)');
  for (const d of deck.diagnostics) {
    out.push(`  L${d.line} ${d.severity} ${d.code}: ${d.message}`);
  }

  out.push('sections');
  writeSection(deck.root, 1, out);
  return out.join('\n') + '\n';
}

function writeSection(section: SectionNode, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  const label = section.heading
    ? `${'#'.repeat(section.heading.level)} ${section.heading.text}` +
      (section.heading.setext ? '（下線の見出し）' : '') +
      (section.attrs ? ` ${formatAttrs(section.attrs)}` : '')
    : '(先頭)';
  out.push(`${indent}${label}  ${lines(section.src)}${section.id ? `  #${section.id}` : ''}`);
  writeBlocks(section.blocks, depth + 1, out);
  for (const child of section.children) writeSection(child, depth + 1, out);
}

function writeBlocks(blocks: Block[], depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  for (const block of blocks) {
    out.push(`${indent}- ${describe(block)}`);
    for (const media of block.media ?? []) {
      out.push(
        `${indent}    image ${media.src}` +
          (media.alt ? ` alt="${media.alt}"` : '') +
          (media.title ? ` title="${media.title}"` : '') +
          (media.attrs ? ` ${formatAttrs(media.attrs)}` : ''),
      );
    }
    if (block.children) writeBlocks(block.children, depth + 1, out);
  }
}

function describe(block: Block): string {
  let label: string = block.kind;
  switch (block.kind) {
    case 'code':
      label += `[${block.lang ?? ''}]`;
      break;
    case 'list':
      if (block.ordered) label += '[番号付き]';
      break;
    case 'rule':
      label += `[${block.marker}]`;
      break;
    case 'container':
      label = `:::${block.name}`;
      break;
    case 'directive':
      label = `::${block.name}`;
      break;
    case 'heading':
      label = `${'#'.repeat(block.level ?? 1)} ${block.text}`;
      break;
  }
  if (block.attrs) label += ` ${formatAttrs(block.attrs)}`;
  return `${label}  ${lines(block.src)}`;
}

function lines(src: SourceRange): string {
  return src.start === src.end ? `L${src.start}` : `L${src.start}-L${src.end}`;
}
