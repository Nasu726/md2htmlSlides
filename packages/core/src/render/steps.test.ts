import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import { numberSteps, renderDeckHtml } from './html.js';

const fixtures = new URL('../../../../fixtures/', import.meta.url);

/** 見出しごとのステップ数（data-steps）。 */
function stepsOf(name: string): Record<string, number> {
  const deck = buildSlides(parseDeck(readFileSync(new URL(name, fixtures), 'utf8')));
  const html = renderDeckHtml(deck, { fit: false });
  const out: Record<string, number> = {};
  for (const m of html.matchAll(/<section [^>]*>[\s\S]*?<\/section>/g)) {
    const section = m[0];
    const title = /<h[12] class="mds-title">([\s\S]*?)<\/h[12]>/.exec(section)?.[1] ?? '';
    const text = title.replace(/<[^>]+>/g, '');
    const steps = Number(/data-steps="(\d+)"/.exec(section)?.[1] ?? 0);
    out[text] = (out[text] ?? 0) + steps;
  }
  return out;
}

describe('段階的表示のステップ数', () => {
  it('fixtures/06-steps の表（fixtures/README.md）のとおり', () => {
    const steps = stepsOf('06-steps.md');
    expect(steps).toMatchObject({
      '. . . で区切る': 2,
      ':::steps でリストを1つずつ': 3,
      ':::steps でブロックを1つずつ': 3,
      '{step} で要素ごとに指定': 3,
      '{step=N} で順番を指定': 3,
      同じ番号は同時に出る: 2,
      自動の番号と明示の番号が混ざる: 3,
      ':::row の中で . . .': 1,
      '問題と答え（画像）': 1,
      図にステップを付ける: 1,
      'コードの行ハイライト（M4）': 2,
      '. . . の範囲は分割しない': 1,
      段階表示のないスライド: 0,
    });
  });

  it('fixtures/02-tech-talk：状況 1、クイズ 1、やったこと 4、残った課題 1、それ以外は 0', () => {
    const steps = stepsOf('02-tech-talk.md');
    expect(steps).toMatchObject({ 状況: 1, クイズ: 1, やったこと: 4, 残った課題: 1 });
    const others = Object.entries(steps).filter(
      ([title]) => !['状況', 'クイズ', 'やったこと', '残った課題'].includes(title),
    );
    expect(others.filter(([, n]) => n > 0)).toEqual([]);
  });
});

describe('numberSteps', () => {
  it('自動は「それまでの最大＋1」、明示はそのまま、欠けを詰める', () => {
    const html = ['auto', '3', 'auto'].map((v) => `<p data-mds-step="${v}"></p>`).join('');
    expect(numberSteps(html)).toEqual({
      html: '<p data-step="1"></p><p data-step="2"></p><p data-step="3"></p>',
      steps: 3,
    });
  });

  it('同じ番号は同じステップ、逆順の番号は逆順に出る', () => {
    const html = ['3', '2', '1', '1'].map((v) => `<li data-mds-step="${v}"></li>`).join('');
    expect(numberSteps(html).html).toBe(
      '<li data-step="3"></li><li data-step="2"></li><li data-step="1"></li><li data-step="1"></li>',
    );
  });
});

describe('埋め込みの内部ステップ（#105）', () => {
  const render = (md: string) =>
    renderDeckHtml(buildSlides(parseDeck(md)), { fit: false }).match(
      /<section [^>]*>[\s\S]*?<\/section>/g,
    )!;

  it('内部ステップは、その位置で続けて番号を取る', () => {
    const html =
      '<p data-mds-step="auto"></p><pre data-mds-substeps="3"></pre><p data-mds-step="auto"></p>';
    expect(numberSteps(html)).toEqual({
      html: '<p data-step="1"></p><pre data-substeps="2,3,4"></pre><p data-step="5"></p>',
      steps: 5,
    });
  });

  it('コードの行ハイライト {lines} は、最初の表示で1つ目の段、残りの段の数だけステップを取る', () => {
    const [slide] = render(
      '## コード\n\n```ts {lines="1|2-3|5"}\nconst a = 1;\nconst b = 2;\nconst c = a + b;\n\nconsole.log(c);\n```\n',
    );
    expect(slide).toContain('data-steps="2"');
    expect(slide).toMatch(
      /<pre data-embed="code-lines" data-lines="1\|2,3\|5" data-substeps="1,2"/,
    );
    // 書き出した状態は最後の段（5行目だけを強調）
    expect(slide!.match(/class="mds-line( is-dim)?"/g)).toEqual([
      'class="mds-line is-dim"',
      'class="mds-line is-dim"',
      'class="mds-line is-dim"',
      'class="mds-line is-dim"',
      'class="mds-line"',
    ]);
  });

  it('. . . と組み合わせると、文書の順に番号が続く', () => {
    const [slide] = render(
      '## コード {layout=stack}\n\n最初の段落\n\n. . .\n\n```js {lines="1|2"}\na();\nb();\n```\n\n. . .\n\n最後の段落\n',
    );
    // 1：コードが出る（1行目を強調）、2：2行目、3：最後の段落
    expect(slide).toContain('data-steps="3"');
    expect(slide).toMatch(/data-substeps="2"/);
    expect(slide!.match(/data-step="(\d)"/g)).toEqual(['data-step="1"', 'data-step="3"']);
  });

  it('行の指定が読めなければ、ふつうのコードのまま（ステップを取らない）', () => {
    const [slide] = render('## コード\n\n```ts {lines="x|"}\na();\n```\n');
    expect(slide).not.toContain('data-substeps');
    expect(slide).not.toContain('data-steps');
  });
});
