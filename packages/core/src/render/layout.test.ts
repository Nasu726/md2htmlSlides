import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mediaSize } from '../media.js';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import { chooseLayout, isShortList } from './layout.js';

const fixtures = new URL('../../../../fixtures/', import.meta.url);
const probe = (src: string) => {
  const url = new URL(src, fixtures);
  if (!existsSync(url)) return { exists: false };
  return { exists: true, ...mediaSize(new Uint8Array(readFileSync(url))) };
};

describe('chooseLayout', () => {
  it('fixtures/04-layouts の各節が、見出しの「→」の後ろに書いたレイアウトになる', () => {
    const deck = buildSlides(parseDeck(readFileSync(new URL('04-layouts.md', fixtures), 'utf8')));
    const rows = deck.slides.map((slide) => {
      const expected = /→\s*(\w+)/.exec(slide.heading?.text ?? '')?.[1];
      return [slide.heading?.text, expected, chooseLayout(slide, deck.slideLevel, probe).layout];
    });
    for (const [heading, expected, actual] of rows)
      expect([heading, actual]).toEqual([heading, expected]);
  });

  it('split の比は画像の縦横比で決める（縦長は 60：40）', () => {
    const deck = buildSlides(parseDeck(readFileSync(new URL('04-layouts.md', fixtures), 'utf8')));
    const find = (text: string) => deck.slides.find((s) => s.heading?.text.startsWith(text))!;
    expect(chooseLayout(find('文章と縦長の画像'), 2, probe).ratio).toEqual([3, 2]);
    expect(chooseLayout(find('文章と横長の画像'), 2, probe).ratio).toEqual([1, 1]);
    expect(chooseLayout(find('画像4枚'), 2, probe).columns).toBe(2);
    expect(chooseLayout(find('キャプション付きの画像3枚'), 2, probe).columns).toBe(3);
  });

  it('{layout=…} と media=left・ratio= の指定を優先する', () => {
    const deck = buildSlides(
      parseDeck('## A {layout=split media=left ratio=2:1}\n\n本文\n\n![a](a.png)\n'),
    );
    expect(chooseLayout(deck.slides[0]!, 2)).toEqual({
      layout: 'split',
      ratio: [2, 1],
      mediaLeft: true,
    });
  });
});

describe('isShortList', () => {
  it('短い項目が8個以上あるリストだけを2段組にする', () => {
    const short = buildSlides(parseDeck(`## A\n\n${'- りんご\n'.repeat(8)}`)).slides[0]!.blocks[0]!;
    const few = buildSlides(parseDeck(`## A\n\n${'- りんご\n'.repeat(5)}`)).slides[0]!.blocks[0]!;
    const long = buildSlides(
      parseDeck(`## A\n\n${'- とても長い項目の説明文がここに入る\n'.repeat(8)}`),
    ).slides[0]!.blocks[0]!;
    expect([isShortList(short), isShortList(few), isShortList(long)]).toEqual([true, false, false]);
  });
});
