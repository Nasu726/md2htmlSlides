import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatOutline } from './outline.js';
import { parseDeck } from './parse.js';
import { formatSlides } from './slides-outline.js';
import { buildSlides } from './slides.js';

const root = new URL('../../../', import.meta.url);

const files = [
  ...readdirSync(new URL('fixtures/', root))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => `fixtures/${name}`),
  'fixtures/stability/before.md',
  'fixtures/stability/after.md',
  'examples/demo.md',
].sort();

const parse = (path: string) => parseDeck(readFileSync(new URL(path, root), 'utf8'));

describe('fixtures の資料を IR に変換する', () => {
  it.each(files)('%s', async (path) => {
    const name = path
      .replace(/^fixtures\//, '')
      .replace(/\//g, '__')
      .replace(/\.md$/, '');
    await expect(formatOutline(parse(path))).toMatchFileSnapshot(`./__outlines__/${name}.txt`);
    await expect(formatSlides(buildSlides(parse(path)))).toMatchFileSnapshot(
      `./__slides__/${name}.txt`,
    );
  });

  it('スライドの枚数（fixtures/README.md の「必須」）', () => {
    const count = (path: string) => buildSlides(parse(path)).slides;
    const s05 = count('fixtures/05-overrides.md');
    expect(s05).toHaveLength(16);
    expect(s05.filter((s) => !s.hidden)).toHaveLength(15);
    expect(count('fixtures/08-maketitle.md').map((s) => s.kind)).toEqual([
      'content',
      'title',
      'content',
      'content',
      'content',
      'title',
    ]);
    expect(count('fixtures/12-settings.md')).toHaveLength(6);
    expect(buildSlides(parse('fixtures/12-settings.md')).slideLevel).toBe(1);
  });

  it('11-edge-cases：フロントマターの未知のキーと、空行のない --- を警告する', () => {
    const codes = parse('fixtures/11-edge-cases.md').diagnostics.map((d) => [d.code, d.line]);
    expect(codes).toContainEqual(['frontmatter/unknown-key', 5]);
    expect(codes).toContainEqual(['heading/setext-dash', 18]);
  });

  it('11-edge-cases：追加構文の書き間違いを警告する（fixtures/README.md の表）', () => {
    const deck = parse('fixtures/11-edge-cases.md');
    const codes = deck.diagnostics.map((d) => [d.code, d.line]);
    expect(codes).toContainEqual(['attrs/unknown-key', 22]);
    expect(codes).toContainEqual(['container/unknown', 36]);
    expect(codes).toContainEqual(['container/unclosed', 42]);
    expect(codes).toContainEqual(['directive/unknown', 47]);
    // 文中の {name} とエスケープした \{step} は警告しない
    expect(codes.filter(([code]) => code === 'attrs/unknown-key')).toHaveLength(1);
    // 閉じていない :::row のあとの節も崩れない
    const titles = deck.root.children.map((s) => s.heading?.text);
    expect(titles).toContain('未知の指示');
    expect(titles).toContain('水平線');
  });

  it('07-media：代替テキストのない画像を警告する（背景は除く）', () => {
    const codes = parse('fixtures/07-media.md').diagnostics.map((d) => [d.code, d.line]);
    expect(codes).toEqual([['media/no-alt', 104]]);
  });

  it('警告が出るのは 07-media と 11-edge-cases だけ', () => {
    const expected = ['fixtures/07-media.md', 'fixtures/11-edge-cases.md'];
    const noisy = files.filter(
      (path) => !expected.includes(path) && parse(path).diagnostics.length > 0,
    );
    expect(noisy).toEqual([]);
  });

  it('stability：編集した節以外のハッシュは変わらない（提案B）', () => {
    const [before, after] = ['before', 'after'].map((n) => parse(`fixtures/stability/${n}.md`));
    const hashes = (deck: typeof before) =>
      Object.fromEntries(deck!.root.children.map((s) => [s.id, s.hash]));
    const [b, a] = [hashes(before), hashes(after)];
    expect(a['節a']).toBe(b['節a']);
    expect(a['節c']).toBe(b['節c']);
    expect(a['節b']).not.toBe(b['節b']);
  });
});
