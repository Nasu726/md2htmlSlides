import { describe, expect, it } from 'vitest';
import { codeHighlighter, codeLanguages } from './highlight.js';

describe('コードの色分け（#68）', () => {
  it('資料の中のコードブロックの言語名を集める', () => {
    const source = '```ts\na\n```\n\n~~~Python {step}\nb\n~~~\n\n```\nc\n```\n\n```ts\nd\n```\n';
    expect(codeLanguages(source)).toEqual(['ts', 'python']);
  });

  it('CSS 変数の色で span を付け、文字は変えない', async () => {
    const highlight = await codeHighlighter(['ts']);
    const code = 'const a = "x" < 1; // c\nfunction f() {}\n';
    const html = highlight(code, 'ts')!;
    expect(html).toContain('<span style="color:var(--mds-code-token-keyword)">const</span>');
    expect(html).toContain('var(--mds-code-token-comment)');
    // タグを除いて戻すと、エスケープした元の文字と同じ（高さが変わらない）
    const text = html
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    expect(text).toBe(code);
  });

  it('知らない言語・図にする言語・言語名の大文字は扱いを決めておく', async () => {
    const highlight = await codeHighlighter(['ts', 'mermaid', 'not-a-language', 'JSON']);
    expect(highlight('flowchart LR\n', 'mermaid')).toBeUndefined();
    expect(highlight('x\n', 'not-a-language')).toBeUndefined();
    expect(highlight('{"a": 1}\n', 'JSON')).toContain('<span');
    // 読み込んでいない言語は色を付けない
    expect(highlight('x = 1\n', 'python')).toBeUndefined();
  });
});
