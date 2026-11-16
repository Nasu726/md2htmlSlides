import { formatAttrs } from './attrs.js';
import type { Block } from './ir.js';
import type { SlideDeck } from './slides.js';

/**
 * スライドの一覧を人が読める文字列にする（テストのスナップショットと動作の確認用）。
 * 例：` 3. [content] ## ブランチ戦略  L17-L39  #ブランチ戦略  paragraph, heading, …`
 */
export function formatSlides(deck: SlideDeck): string {
  const out = [`slideLevel: ${deck.slideLevel}`, `slides: ${deck.slides.length}`];
  deck.slides.forEach((slide, i) => {
    const heading = slide.heading
      ? `${'#'.repeat(slide.heading.level)} ${slide.heading.text}${slide.heading.continued ? '（続き）' : ''}`
      : '(見出しなし)';
    const flags = [
      slide.hidden ? '非表示' : '',
      slide.attrs ? formatAttrs(slide.attrs) : '',
      slide.chapter ? `章=${slide.chapter}` : '',
      slide.notes.length > 0 ? `ノート${slide.notes.length}` : '',
    ].filter(Boolean);
    const range =
      slide.src.start === slide.src.end
        ? `L${slide.src.start}`
        : `L${slide.src.start}-L${slide.src.end}`;
    out.push(
      `${String(i + 1).padStart(3)}. [${slide.kind}] ${heading}  ${range}  #${slide.id}` +
        (flags.length > 0 ? `  ${flags.join(' ')}` : ''),
    );
    const blocks = slide.blocks.map(describe).join(', ');
    if (blocks) out.push(`       ${blocks}`);
  });
  return out.join('\n') + '\n';
}

function describe(block: Block): string {
  switch (block.kind) {
    case 'container':
      return `:::${block.name}(${(block.children ?? []).map(describe).join(', ')})`;
    case 'directive':
      return `::${block.name}`;
    case 'heading':
      return `${'#'.repeat(block.level ?? 1)}${block.text ?? ''}`;
    case 'code':
      return `code[${block.lang ?? ''}]`;
    case 'rule':
      return `rule[${block.marker}]`;
    case 'paragraph':
      return block.media && block.media.length > 0 ? `image×${block.media.length}` : 'paragraph';
    default:
      return block.kind;
  }
}
