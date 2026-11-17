import { describe, expect, it } from 'vitest';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import { renderDeckHtml } from './html.js';

const render = (markdown: string, options = {}) =>
  renderDeckHtml(buildSlides(parseDeck(markdown)), { fit: false, ...options });
const sections = (html: string) => html.match(/<section [^>]*>/g) ?? [];

describe('renderDeckHtml', () => {
  it('スライドごとに section を出し、レイアウトのクラスを付ける', () => {
    const body = '本文\n\n- 1\n- 2';
    const html = render(`# 章\n\n導入\n\n## A\n\n${body}\n\n# 章2\n\n## B\n\n${body}`);
    expect(sections(html).map((s) => /layout-(\w+)/.exec(s)?.[1])).toEqual([
      'section',
      'stack',
      'section',
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
    const html = render('## A\n\n前半\n\n- a\n- b\n\n---\n\n後半\n\n- c\n- d');
    expect(html).toContain('（続き）');
    expect(html).toContain('<span class="mds-page">2 / 2</span>');
    expect(render('---\npaginate: false\n---\n## A\n\n本文')).not.toContain('mds-page');
  });

  it('{.class align=center} はクラスと縦方向の中央揃えになる', () => {
    const html = render('## A {.highlight align=center}\n\n本文です。\n\n- 1\n- 2');
    expect(sections(html)[0]).toContain('class="mds-slide layout-stack align-center highlight"');
  });

  it('media=left の split は、画像を先（左）に置く', () => {
    const full = render('## A {layout=split media=left}\n\n本文\n\n![a](a.png)');
    const html = full.slice(full.indexOf('<main'));
    expect(html.indexOf('mds-split-media')).toBeLessThan(html.indexOf('mds-split-text'));
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
    // 背景の画像は本文ではなく、背景として描く
    const body = /<div class="mds-body"[\s\S]*?<\/div>/.exec(html)![0];
    expect(body).not.toContain('bg.jpg');
    expect(html).toContain("background-image:url('bg.jpg')");
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

  it('タイトルスライド：所属が違う著者には番号を付け、日付を整形する', () => {
    const html = render(
      [
        '---',
        'title: 発表',
        'author:',
        '  - name: 山田',
        '    affiliation: A大学',
        '  - name: 佐藤',
        '    affiliation: B社',
        'date: 2026-12-05',
        'event: 研究会',
        '---',
        ':::maketitle {variant=left}',
        '![](c.jpg){bg=right}',
        '',
        '資料: https://example.com',
        ':::',
      ].join('\n'),
    );
    expect(html).toContain('class="mds-slide layout-title variant-left has-bg-right"');
    expect(html).toContain('<span class="mds-author">山田<sup>1</sup></span>');
    expect(html).toContain('<span class="mds-author">佐藤<sup>2</sup></span>');
    expect(html).toContain('<span><sup>2</sup>B社</span>');
    expect(html).toContain('<p class="mds-date">2026年12月5日</p>');
    expect(html).toContain('<p class="mds-event">研究会</p>');
    expect(html).toContain("background-image:url('c.jpg')");
    expect(html).toContain('資料: https://example.com');
  });

  it('タイトルスライド：全員の所属が同じなら番号を付けず1回だけ出す', () => {
    const html = render(
      '---\ntitle: 発表\nauthor: [山田, 佐藤]\naffiliation: A大学\n---\n::maketitle',
    );
    expect(html).not.toContain('<sup>');
    expect(html.match(/A大学/g)).toHaveLength(1);
  });
});

describe('formatDate', () => {
  it('言語に合わせて整形し、日付でない文字列はそのまま返す', async () => {
    const { formatDate } = await import('./title.js');
    expect(formatDate('2026-12-05', 'ja')).toBe('2026年12月5日');
    expect(formatDate('2026-12-05', 'en')).toBe('December 5, 2026');
    expect(formatDate('today', 'ja', new Date(2026, 10, 16))).toBe('2026年11月16日');
    expect(formatDate('2026年 秋', 'ja')).toBe('2026年 秋');
  });
});

describe('コードの色分け（#68）', () => {
  const calls: string[] = [];
  const highlight = (code: string, lang: string) => {
    calls.push(lang);
    if (lang !== 'ts') return undefined;
    return code
      .split('\n')
      .map((line) =>
        line ? `<span style="color:var(--mds-code-token-keyword)">${line}</span>` : '',
      )
      .join('\n');
  };

  it('色分けの関数の結果を pre の中に入れ、言語のクラスと {step} は残す', () => {
    calls.length = 0;
    const html = render(
      '## A\n\n```ts {step}\nconst a\n```\n\n```python\nx = 1\n```\n\n```mermaid\nflowchart LR\n```\n',
      { highlight },
    );
    expect(html).toContain(
      '<pre data-step="1"><code class="language-ts"><span style="color:var(--mds-code-token-keyword)">const a</span>\n</code></pre>',
    );
    // 関数が undefined を返した言語は、今までどおり色なしで出す
    expect(html).toContain('<pre><code class="language-python">x = 1\n</code></pre>');
    // 図にするコード（mermaid・arch・math）は、関数に渡さない
    expect(calls).not.toContain('mermaid');
  });

  it('関数がなければ、今までどおり色なしで出す', () => {
    expect(render('## A\n\n```ts\nconst a\n```\n')).toContain(
      '<pre><code class="language-ts">const a\n</code></pre>',
    );
  });
});

describe('印刷・PDF（#70）', () => {
  it('ページの大きさをスライドの大きさにする（縦横比ごと）', () => {
    expect(render('## A\n')).toContain('@page { size: 1280px 720px; margin: 0; }');
    expect(render('---\naspect: "4:3"\n---\n## A\n')).toContain(
      '@page { size: 960px 720px; margin: 0; }',
    );
  });

  it('YouTube の埋め込みには、印刷のときだけ出すサムネイルとリンクを添える', () => {
    const html = render('## A\n\n![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n');
    expect(html).toContain(
      `<a class="mds-print-link has-ratio" style="--mds-ar:1.7778;background-image:url('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"><span>▶ YouTube · https://www.youtube.com/watch?v=dQw4w9WgXcQ</span></a>`,
    );
  });
});
