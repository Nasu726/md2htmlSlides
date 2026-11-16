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

describe('fixtures/05-overrides（利用者の指定）', () => {
  const deck = buildSlides(parseDeck(readFileSync(new URL('05-overrides.md', fixtures), 'utf8')));
  const layoutOf = (heading: string, page = 0) => {
    const slides = deck.slides.filter((s) => s.heading?.text.startsWith(heading));
    return chooseLayout(slides[page]!, deck.slideLevel, probe);
  };

  it('--- で区切った2枚目も stack で、見出しを引き継ぐ', () => {
    expect(layoutOf('--- で区切る', 0).layout).toBe('stack');
    expect(layoutOf('--- で区切る', 1).layout).toBe('stack');
  });

  it('layout=split media=left ratio=2:3 は、画像が左で 画像：文章 ＝ 2：3', () => {
    expect(layoutOf('レイアウトと比率を指定する')).toEqual({
      layout: 'split',
      ratio: [2, 3],
      mediaLeft: true,
    });
  });

  it('layout=stack は自動の statement を上書きし、:::stack は左右に並べない', () => {
    expect(layoutOf('自動の判定を上書きする').layout).toBe('stack');
    expect(layoutOf('縦に並べる').layout).toBe('stack');
  });

  it('width= の画像は伸縮させず stack、見出しのない最後のスライドは media', () => {
    expect(layoutOf('画像の幅を固定する', 0).layout).toBe('stack');
    expect(layoutOf('画像の幅を固定する', 1).layout).toBe('media');
  });

  it('自動で選ぶ split の比は、メディアが左なら入れ替える', () => {
    const left = buildSlides(
      parseDeck('## A {media=left}\n\n本文\n\n![縦長](assets/portrait-3x4.png)\n'),
    );
    expect(chooseLayout(left.slides[0]!, 2, probe)).toEqual({
      layout: 'split',
      ratio: [2, 3],
      mediaLeft: true,
    });
  });
});
