import { describe, expect, it } from 'vitest';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import { renderDeckHtml } from './html.js';

const render = (markdown: string, options = {}) =>
  renderDeckHtml(buildSlides(parseDeck(markdown)), { fit: false, ...options });
const sections = (html: string) => html.match(/<section [^>]*>/g) ?? [];

describe('renderDeckHtml', () => {
  it('スライドごとに section を出し、レイアウトのクラスを付ける', () => {
    const html = render('# 章\n\n導入\n\n## A\n\n本文\n\n## B\n\n本文');
    expect(sections(html).map((s) => /layout-(\w+)/.exec(s)?.[1])).toEqual([
      'section',
      'stack',
      'stack',
    ]);
    expect(html).toContain('<h1 class="mds-title">章</h1>');
    expect(html).toContain('<p class="mds-chapter">章</p>');
  });

  it('縦横比をスライドの大きさにし、テーマのクラスとアクセントを付ける', () => {
    const html = render('---\naspect: 4:3\ntheme: dark\naccent: "#e11d48"\n---\n## A\n\n本文');
    expect(html).toContain('class="mds-deck theme-dark"');
    expect(html).toContain('--mds-w:960px;--mds-h:720px;--mds-accent:#e11d48');
  });

  it('続きのスライドには（続き）を付け、ページ番号を出す', () => {
    const html = render('## A\n\n前半\n\n---\n\n後半');
    expect(html).toContain('（続き）');
    expect(html).toContain('<span class="mds-page">2 / 2</span>');
    expect(render('---\npaginate: false\n---\n## A\n\n本文')).not.toContain('mds-page');
  });

  it('{hidden} のスライドは既定では出さない', () => {
    const md = '## A\n\n本文\n\n## B {hidden}\n\n本文';
    expect(sections(render(md))).toHaveLength(1);
    expect(sections(render(md, { includeHidden: true }))).toHaveLength(2);
  });

  it(':::row は見出しごとに列にし、ratio を列の幅にする', () => {
    const html = render('## A\n\n:::row {ratio=2:1}\n### 左\n本文\n\n### 右\n本文\n:::');
    expect(html).toContain('style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"');
    expect(html.match(/class="mds-col"/g)).toHaveLength(2);
  });

  it('GitHub 形式のアラートは囲み枠にする', () => {
    const html = render('## A\n\n> [!WARNING]\n> 注意して');
    expect(html).toContain('<div class="mds-alert mds-alert-warning" role="note">');
    expect(html).toContain('<p class="mds-alert-title">注意</p>');
    expect(html).not.toContain('[!WARNING]');
  });

  it('段落のクラス属性を付け、背景の画像・コメント・pause は本文に出さない', () => {
    const html = render('## A\n\n強調 {.big}\n\n<!-- メモ -->\n\n. . .\n\n![](bg.jpg){bg}');
    expect(html).toContain('<p class="big">強調</p>');
    expect(html).not.toContain('メモ');
    expect(html).not.toContain('. . .');
    expect(html).not.toContain('bg.jpg');
  });

  it('カスタム CSS はデッキの中だけに効かせる', () => {
    expect(render('## A\n\n本文', { customCss: 'body { color: red }' })).toContain(
      '@scope (.mds-deck) {\nbody { color: red }\n}',
    );
  });

  it('文字はエスケープする', () => {
    const html = render('---\ntitle: "<b>危険</b>"\nfooter: "<i>x</i>"\n---\n::maketitle');
    expect(html).toContain('&lt;b&gt;危険&lt;/b&gt;');
    expect(html).not.toContain('<i>x</i>');
  });
});
