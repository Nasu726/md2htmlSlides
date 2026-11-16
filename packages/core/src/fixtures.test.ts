import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatOutline } from './outline.js';
import { parseDeck } from './parse.js';

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
  });

  it('11-edge-cases：フロントマターの未知のキーと、空行のない --- を警告する', () => {
    const codes = parse('fixtures/11-edge-cases.md').diagnostics.map((d) => [d.code, d.line]);
    expect(codes).toContainEqual(['frontmatter/unknown-key', 5]);
    expect(codes).toContainEqual(['heading/setext-dash', 18]);
  });

  it('警告が出るのは 11-edge-cases だけ', () => {
    const noisy = files.filter(
      (path) => path !== 'fixtures/11-edge-cases.md' && parse(path).diagnostics.length > 0,
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
