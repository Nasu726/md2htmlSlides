import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkMediaFiles, embedUrl, mediaSize, isLocalPath, mediaKind } from './media.js';
import { parseDeck } from './parse.js';
import { buildSlides } from './slides.js';
import { renderDeckHtml } from './render/html.js';

const fixtures = new URL('../../../fixtures/', import.meta.url);
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`assets/${name}`, fixtures)));

describe('mediaKind', () => {
  it('拡張子で動画を判定する（大文字・クエリ付きも）', () => {
    expect(mediaKind('./a.mp4')).toBe('video');
    expect(mediaKind('clip.WEBM')).toBe('video');
    expect(mediaKind('x/y.mov?t=3#frag')).toBe('video');
    expect(mediaKind('photo.jpg')).toBe('image');
    expect(mediaKind('logo.svg')).toBe('image');
  });

  it('YouTube と Vimeo の URL は埋め込みにする', () => {
    expect(mediaKind('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    expect(mediaKind('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(mediaKind('https://vimeo.com/76979871')).toBe('vimeo');
    expect(embedUrl('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(embedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(embedUrl('https://example.com/a.png')).toBeUndefined();
  });

  it('手元のパスと URL を区別する', () => {
    expect(isLocalPath('./assets/a.png')).toBe(true);
    expect(isLocalPath('assets/a.png')).toBe(true);
    expect(isLocalPath('https://example.com/a.png')).toBe(false);
    expect(isLocalPath('//cdn.example.com/a.png')).toBe(false);
    expect(isLocalPath('data:image/png;base64,AAAA')).toBe(false);
  });
});

describe('mediaSize', () => {
  it('PNG・JPEG・SVG の縦横を読む', () => {
    expect(mediaSize(asset('landscape-16x9.png'))).toEqual({ width: 1600, height: 900 });
    expect(mediaSize(asset('portrait-3x4.png'))).toEqual({ width: 900, height: 1200 });
    const jpeg = mediaSize(asset('cover.jpg'));
    expect(jpeg?.width).toBeGreaterThan(0);
    expect(jpeg?.height).toBeGreaterThan(0);
    expect(mediaSize(asset('logo.svg'))).toBeDefined();
  });

  it('GIF と WebP の縦横を読む', () => {
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
    expect(mediaSize(gif)).toEqual({ width: 320, height: 240 });
    // VP8X：幅と高さは 24bit の「値−1」
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
    webp.set([0x3f, 0x01, 0x00, 0xef, 0x00, 0x00], 24);
    expect(mediaSize(webp)).toEqual({ width: 320, height: 240 });
  });

  it('MP4 の映像のトラックから縦横を読む', () => {
    expect(mediaSize(asset('demo.mp4'))).toEqual({ width: 640, height: 360 });
    expect(mediaSize(asset('loop-bg.mp4'))).toEqual({ width: 640, height: 360 });
  });

  it('縦横のわからないファイルは undefined', () => {
    expect(mediaSize(new TextEncoder().encode('hello'))).toBeUndefined();
    expect(mediaSize(asset('custom.css'))).toBeUndefined();
  });
});

describe('checkMediaFiles', () => {
  it('見つからない手元のファイル（poster も）を、書いた行で警告する', () => {
    const deck = parseDeck(
      '## A\n\n![a](./a.png)\n\n## B\n\n![b](./b.mp4){poster=./p.jpg}\n![c](https://example.com/c.png)',
    );
    const probe = (path: string) => ({ exists: path === './a.png' });
    expect(checkMediaFiles(deck, probe).map((d) => [d.code, d.line, d.message])).toEqual([
      ['media/not-found', 7, 'ファイルが見つかりません：./b.mp4'],
      ['media/not-found', 7, 'ファイルが見つかりません：./p.jpg'],
    ]);
  });

  it('fixtures/07-media では not-found.png だけが見つからない', () => {
    const deck = parseDeck(readFileSync(new URL('07-media.md', fixtures), 'utf8'));
    const probe = (path: string) => ({ exists: existsSync(new URL(path, fixtures)) });
    expect(checkMediaFiles(deck, probe).map((d) => [d.code, d.line])).toEqual([
      ['media/not-found', 122],
    ]);
  });
});

describe('本文中の画像・動画の描画', () => {
  // 埋め込みの CSS にもクラス名が出るので、本文（<main> から後ろ）だけを見る
  const render = (markdown: string, probe?: (src: string) => { exists: boolean }) => {
    const html = renderDeckHtml(buildSlides(parseDeck(markdown)), {
      fit: false,
      ...(probe ? { probe } : {}),
    });
    return html.slice(html.indexOf('<main'));
  };

  it('画像だけの段落は figure の並びにし、タイトルをキャプションにする', () => {
    const html = render('## A\n\n![犬](dog.png "うちの犬")');
    expect(html).toContain('<div class="mds-media-group is-flex">');
    expect(html).toContain(
      '<figure class="mds-media mds-media-image"><div class="mds-media-frame"><img src="dog.png" alt="犬"></div><figcaption>うちの犬</figcaption></figure>',
    );
  });

  it('caption= はタイトルより優先する', () => {
    expect(render('## A\n\n![a](a.png "t"){caption="説明"}')).toContain(
      '<figcaption>説明</figcaption>',
    );
  });

  it('文の中の画像は figure にしない', () => {
    const html = render('## A\n\nアイコン ![i](i.png){.icon} です');
    expect(html).toContain('<p>アイコン <img class="icon" src="i.png" alt="i"> です</p>');
    expect(html).not.toContain('mds-media-group');
  });

  it('動画は属性を video に移し、何も指定しなければ操作ボタンを出す', () => {
    expect(render('## A\n\n![d](d.mp4){controls poster=p.jpg}')).toContain(
      '<video src="d.mp4" controls playsinline preload="metadata" poster="p.jpg" aria-label="d"></video>',
    );
    expect(render('## A\n\n![d](d.mp4){autoplay loop muted}')).toContain(
      '<video src="d.mp4" autoplay loop muted playsinline preload="metadata" aria-label="d"></video>',
    );
    expect(render('## A\n\n![d](d.webm)')).toContain('<video src="d.webm" controls ');
  });

  it('単一 HTML に埋め込まない動画（#120）は、ポスター（なければ枠）に、背景はポスターか暗い面にする', () => {
    const omit = (markdown: string) => {
      const html = renderDeckHtml(buildSlides(parseDeck(markdown)), {
        fit: false,
        omitVideo: (src) => src === 'big.mp4',
      });
      return html.slice(html.indexOf('<main'));
    };
    const poster = omit('## A\n\n![デモ](big.mp4){controls poster=p.jpg}');
    expect(poster).not.toContain('<video');
    expect(poster).toContain('<img class="mds-video-poster" src="p.jpg" alt="デモ">');
    expect(omit('## A\n\n![デモ](big.mp4)')).toContain(
      '<span class="mds-media-placeholder" role="img" aria-label="▶ デモ">▶ デモ</span>',
    );
    // 上限より小さい動画は、そのまま
    expect(omit('## A\n\n![s](small.mp4)')).toContain('<video src="small.mp4"');
    // 背景の動画
    const bg = omit('## A\n\n![](big.mp4){bg}\n\n本文');
    expect(bg).not.toContain('<video');
    expect(bg).toContain('<div class="mds-bg-media" style="background:#1e293b"></div>');
    expect(omit('## A\n\n![](big.mp4){bg poster=p.jpg}\n\n本文')).toContain(
      `style="background-image:url('p.jpg');"`,
    );
  });

  it('YouTube は埋め込みプレイヤーにする', () => {
    const html = render('## A\n\n![紹介](https://youtu.be/dQw4w9WgXcQ){autoplay muted}');
    expect(html).toContain('mds-media-embed');
    expect(html).toContain(
      'src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&amp;mute=1" title="紹介"',
    );
  });

  it('width= の画像は伸縮しない並び（is-rigid）にする', () => {
    const html = render('## A\n\n![a](a.png){width=40%}');
    expect(html).toContain('<div class="mds-media-group is-rigid">');
    expect(html).toContain('<figure class="mds-media mds-media-image is-fixed" style="width:40%">');
  });

  it('背景だけの段落は本文に何も出さない', () => {
    const html = render('## A\n\n![](bg.jpg){bg}\n\n本文');
    expect(html).not.toContain('mds-media');
    expect(html).not.toContain('<p></p>');
    expect(html).toContain('<p>本文</p>');
  });

  it('調べる関数があれば、縦横比を付け、見つからないものは枠だけにする', () => {
    const probe = (src: string) =>
      src === 'a.png' ? { exists: true, width: 1600, height: 900 } : { exists: false };
    const html = render('## A\n\n![a](a.png) ![なし](none.png)', probe);
    expect(html).toContain(
      '<img src="a.png" alt="a" class="has-ratio" style="--mds-ar:1.7778" width="1600" height="900">',
    );
    expect(html).toContain('<figure class="mds-media mds-media-image is-missing">');
    expect(html).toContain(
      '<span class="mds-media-placeholder" role="img" aria-label="なし">なし</span>',
    );
  });
});
