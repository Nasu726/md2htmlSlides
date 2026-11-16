import { describe, expect, it } from 'vitest';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import { renderDeckHtml } from './html.js';
import { phraseBreaks } from './phrase.js';

describe('phraseBreaks', () => {
  it('日本語の文節の切れ目に <wbr> を入れる', () => {
    expect(phraseBreaks('コンフリクトしたファイルを編集して解消する', 'ja')).toBe(
      'コンフリクトした<wbr>ファイルを<wbr>編集して<wbr>解消する',
    );
  });

  it('タグ・code の中・エスケープした文字を壊さない', () => {
    const html = phraseBreaks('<code>git rebase</code> で履歴を&lt;きれいに&gt;する', 'ja');
    expect(html.startsWith('<code>git rebase</code>')).toBe(true);
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html.replace(/<wbr>/g, '')).toBe('<code>git rebase</code> で履歴を&lt;きれいに&gt;する');
  });

  it('日本語でない文書・日本語を含まない見出しには入れない', () => {
    expect(phraseBreaks('コンフリクトしたファイル', 'en')).toBe('コンフリクトしたファイル');
    expect(phraseBreaks('Getting started with Git', 'ja')).toBe('Getting started with Git');
  });
});

describe('見出しの文節改行', () => {
  const body = (markdown: string) => {
    const html = renderDeckHtml(buildSlides(parseDeck(markdown)), { fit: false });
    return html.slice(html.indexOf('<main'));
  };

  it('スライドの見出しと小見出しに <wbr> を入れる', () => {
    const html = body(
      // 小見出しのない節もあるので、slideLevel は 2（## がスライド、### が小見出し）
      '## 大きなファイルをコミットした\n\n### 履歴から完全に取り除く方法\n\n本文\n\n## 次の節\n\n本文',
    );
    expect(html).toContain('<h2 class="mds-title">大きな<wbr>ファイルを<wbr>コミットした</h2>');
    expect(html).toMatch(/<h3>履歴から<wbr>.*取り除く<wbr>方法<\/h3>/);
    // 本文には入れない
    expect(html).toContain('<p>本文</p>');
  });

  it('lang: en のデッキには入れない', () => {
    expect(body('---\nlang: en\n---\n\n## 大きなファイルをコミットした\n\n本文')).toContain(
      '<h2 class="mds-title">大きなファイルをコミットした</h2>',
    );
  });
});
