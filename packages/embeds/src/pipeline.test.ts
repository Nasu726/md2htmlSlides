import type { DiagramResult } from '@mdhs/core';
import { describe, expect, it } from 'vitest';
import { prepareDeck, type PipelineHost } from './pipeline.js';

/** ファイルとブラウザを使わない、計測しない環境 */
function host(files: Record<string, string> = {}, extra: Partial<PipelineHost> = {}) {
  const calls: string[] = [];
  const base: PipelineHost = {
    readText: async (src) => files[src],
    probe: () => ({ exists: true }),
    assetUrl: (src) => src,
    parsed: () => void calls.push('parsed'),
    highlighter: async () => undefined,
    math: async () => ({ render: () => ({ html: '<x-math></x-math>' }), layoutCss: '' }),
    checkpoint: () => void calls.push('checkpoint'),
    ...extra,
  };
  return { host: base, calls };
}

describe('資料の処理の流れ（#170）', () => {
  it('css: のファイルがなければ、その行に警告する。あれば描画の設定に入れる', async () => {
    const md = '---\ntitle: T\ncss: style.css\n---\n\n## A\n';
    const missing = await prepareDeck(md, host().host);
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'frontmatter/css-not-found', line: 3 }),
    );
    const found = await prepareDeck(md, host({ 'style.css': '.x{}' }).host);
    expect(found.options.customCss).toBe('.x{}');
    expect(found.diagnostics.map((d) => d.code)).not.toContain('frontmatter/css-not-found');
  });

  it('Mermaid：コードとファイルの図を引けるようにし、構文エラーは警告して差し替えられる', async () => {
    const md = '## A\n\n```mermaid\ngraph LR; a-->b\n```\n\n## B\n\n![図](./flow.mmd)\n';
    const drawn: DiagramResult = { svg: '<svg/>', width: 10, height: 10 };
    const broken: DiagramResult = { error: 'Parse error' };
    const previous: DiagramResult = { svg: '<svg id="prev"/>', width: 1, height: 1 };
    const { host: h } = host(
      { './flow.mmd': 'graph TD; x' },
      {
        mermaid: async (_page, codes) =>
          new Map(codes.map((code) => [code, code.startsWith('graph LR') ? drawn : broken])),
        mermaidResult: (_index, result) => ('error' in result ? previous : result),
      },
    );
    const prepared = await prepareDeck(md, h);
    expect(prepared.options.diagram?.({ lang: 'mermaid', code: 'graph LR; a-->b\n' })).toBe(drawn);
    // ファイルの図は、パスの書き方が違っても同じものを引く
    expect(prepared.options.diagram?.({ lang: 'mermaid', src: 'flow.mmd' })).toBe(previous);
    expect(prepared.diagnostics.map((d) => d.code)).toContain('diagram/mermaid-error');
  });

  it('計測がなければ分割しない。区切りごとに checkpoint を呼ぶ', async () => {
    const items = Array.from({ length: 40 }, (_, i) => `- 項目 ${i}`).join('\n');
    const { host: h, calls } = host();
    const prepared = await prepareDeck(`## A\n\n${items}\n`, h);
    expect(prepared.slides.slides).toHaveLength(1);
    expect(calls).toEqual(['parsed', 'checkpoint', 'checkpoint']);
  });
});
