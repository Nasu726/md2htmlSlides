import { describe, expect, it } from 'vitest';
import type { MediaProbe } from '../media.js';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import { applySplit, planSplit } from '../split/split.js';
import { renderDeckHtml } from './html.js';

const lum =
  (values: Record<string, number>): MediaProbe =>
  (src) =>
    src in values ? { exists: true, width: 1600, height: 900, luminance: values[src]! } : undefined;

const sectionsOf = (markdown: string, probe?: MediaProbe) => {
  const html = renderDeckHtml(buildSlides(parseDeck(markdown)), {
    fit: false,
    ...(probe ? { probe } : {}),
  });
  return html.match(/<section [\s\S]*?<\/section>/g) ?? [];
};

describe('本文のスライドの背景', () => {
  const probe = lum({ 'dark.jpg': 0.15, 'bright.jpg': 0.85 });

  it('暗い背景には明るい文字、明るい背景には暗い文字、dim で暗くしたら明るい文字', () => {
    const [dark, bright, dimmed] = sectionsOf(
      '## A\n\n![](dark.jpg){bg}\n\n本文\n\n## B\n\n![](bright.jpg){bg}\n\n本文\n\n## C\n\n![](bright.jpg){bg dim=0.6}\n\n本文\n',
      probe,
    );
    expect(dark).toContain('has-bg-full bg-tone-dark');
    expect(bright).toContain('has-bg-full bg-tone-light');
    expect(dimmed).toContain('has-bg-full bg-tone-dark');
    expect(dimmed).toContain('<div class="mds-bg-dim" style="opacity:0.6"></div>');
  });

  it('明るさがわからなければ、少し暗くして明るい文字にする', () => {
    const [slide] = sectionsOf('## A\n\n![](x.jpg){bg}\n\n本文\n');
    expect(slide).toContain('bg-tone-dark');
    expect(slide).toContain('<div class="mds-bg-dim" style="opacity:0.35"></div>');
  });

  it('左右の半分の背景・ぼかし・contain・動画', () => {
    const [left, blur, contain, video] = sectionsOf(
      [
        '## A\n\n![](a.jpg){bg=left}\n\n本文',
        '## B\n\n![](b.jpg){bg blur=8}\n\n本文',
        '## C\n\n![](c.jpg){bg fit=contain}\n\n本文',
        '## D\n\n![](loop.mp4){bg dim=0.4}\n\n本文',
      ].join('\n\n'),
    );
    expect(left).toContain('class="mds-slide layout-statement has-bg-left"');
    expect(left).toContain('<div class="mds-bg mds-bg-left">');
    expect(blur).toContain('filter:blur(8px)');
    expect(contain).toContain('<div class="mds-bg mds-bg-full fit-contain">');
    expect(video).toContain(
      '<video class="mds-bg-media" src="loop.mp4" style="" autoplay muted loop playsinline',
    );
  });

  it('分割した続きのスライドにも同じ背景を使う', () => {
    const deck = buildSlides(
      parseDeck(
        `## A\n\n![](dark.jpg){bg}\n\n${Array.from({ length: 8 }, (_, i) => `段落${i}`).join('\n\n')}\n`,
      ),
    );
    const plan = planSplit(deck);
    const m = plan.targets[0]!.atoms.map((a) => (a.block.raw.includes('{bg}') ? 0 : 100));
    const split = applySplit(deck, plan, [
      { avail: 480, gap: 20, listGap: 7, heights: m, heads: m.map(() => 0) },
    ]);
    expect(split.slides.length).toBeGreaterThan(1);
    const html = renderDeckHtml(split, { fit: false, probe });
    const slides = html.match(/<section [\s\S]*?<\/section>/g) ?? [];
    for (const slide of slides) expect(slide).toContain("background-image:url('dark.jpg')");
  });
});
