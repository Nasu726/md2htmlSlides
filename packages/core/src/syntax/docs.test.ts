import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCH_KEYWORDS, ARCH_NODE_KINDS } from '../arch/parse.js';
import { slugify } from '../slug.js';
import {
  ATTRIBUTE_KEYS,
  CONTAINERS,
  CONTAINER_NAMES,
  DIRECTIVES,
  DIRECTIVE_NAMES,
  LAYOUTS,
  type AttrKey,
  type AttrPlace,
} from './elements.js';
import { FRONTMATTER_KEYS, FRONTMATTER_KEY_NAMES } from './frontmatter-keys.js';

/**
 * 構文の定義（elements.ts・frontmatter-keys.ts・arch/parse.ts）と、
 * 構文仕様（docs/syntax.md）・動く構成図の仕様（docs/arch-diagram.md）の表が一致するか（#130）。
 * 構文を足したのに文書を直し忘れる・見出しを変えてリンクが切れる、を防ぐ。
 */

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const syntax = read('docs/syntax.md');
const arch = read('docs/arch-diagram.md');

/** コードブロックの中の行を空にする（見出しや表を探すため） */
function outsideFences(markdown: string): string[] {
  let fence: string | undefined;
  return markdown.split('\n').map((line) => {
    const open = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (open && open[0] === fence[0] && open.length >= fence.length) fence = undefined;
      return '';
    }
    if (open) {
      fence = open;
      return '';
    }
    return line;
  });
}

/** 見出し（`### 1.1 …` なら「1.1 」）の直後にある表の行。見出し行と区切りの行は除く */
function tableAfter(markdown: string, heading: string): string[][] {
  const lines = outsideFences(markdown);
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.includes(` ${heading}`));
  expect(start, `見出し「${heading}」`).toBeGreaterThanOrEqual(0);
  const first = lines.findIndex((line, i) => i > start && line.startsWith('|'));
  const rows: string[][] = [];
  for (let i = first + 2; lines[i]?.startsWith('|'); i++) {
    rows.push(
      lines[i]!.slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** セルの中の `…` */
const ticks = (cell: string) => Array.from(cell.matchAll(/`([^`]+)`/g), (m) => m[1]!);
const nameOf = (row: string[]) => ticks(row[0]!)[0];

/** `key` や `key=value` の形の `…` から、キーごとに書かれた値を集める */
function keysOf(cells: string[]): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  for (const token of cells.flatMap(ticks)) {
    const [name, value] = token.split('=');
    const values = keys.get(name!) ?? new Set<string>();
    if (value !== undefined) values.add(value);
    keys.set(name!, values);
  }
  return keys;
}

const enumValues = (key: AttrKey): readonly string[] =>
  key.value.type === 'enum' || key.value.type === 'flag-or-enum' ? key.value.values : [];
const keysFor = (...places: AttrPlace[]) =>
  ATTRIBUTE_KEYS.filter((key) => key.places.some((place) => places.includes(place)));

describe('構文仕様の表と構文の定義', () => {
  it('§1.1 フロントマターのキー：名前・順番・値の候補・既定が同じ', () => {
    const rows = tableAfter(syntax, '1.1 ');
    expect(rows.map(nameOf)).toEqual(FRONTMATTER_KEY_NAMES);
    for (const key of FRONTMATTER_KEYS) {
      const [, value, fallback] = rows.find((row) => nameOf(row) === key.name)!;
      if (key.value.type === 'enum') {
        expect(ticks(value!), key.name).toEqual(key.value.values.map(String));
      }
      if (key.default !== undefined) {
        expect(ticks(fallback!), key.name).toEqual([String(key.default)]);
      }
    }
  });

  it('§3.3 スライドに付けるキー：名前と値の候補が同じ', () => {
    const rows = tableAfter(syntax, '3.3 ').filter((row) => !row[0]!.startsWith('`.'));
    const slideKeys = keysFor('slide');
    expect(rows.map(nameOf)).toEqual(slideKeys.map((key) => key.name));
    for (const key of slideKeys) {
      const [, value] = rows.find((row) => nameOf(row) === key.name)!;
      if (enumValues(key).length > 0) expect(ticks(value!), key.name).toEqual(enumValues(key));
    }
  });

  it('§3.4 要素に付けるキー：名前と値の候補が同じ', () => {
    const documented = keysOf(tableAfter(syntax, '3.4 ').map((row) => row[0]!));
    const elementKeys = keysFor('block', 'media');
    expect([...documented.keys()]).toEqual(elementKeys.map((key) => key.name));
    for (const key of elementKeys) {
      if (enumValues(key).length > 0) {
        expect([...documented.get(key.name)!].sort(), key.name).toEqual(
          [...enumValues(key)].sort(),
        );
      }
    }
  });

  it('§3.5 レイアウトと §4 コンテナ：名前が同じ', () => {
    expect(tableAfter(syntax, '3.5 ').map(nameOf)).toEqual([...LAYOUTS]);
    expect(tableAfter(syntax, '4. ').map((row) => nameOf(row)!.replace(/^:::/, ''))).toEqual(
      CONTAINER_NAMES,
    );
  });

  it('§11 指示は ::maketitle だけ', () => {
    expect(DIRECTIVE_NAMES).toEqual(['maketitle']);
    expect(syntax).toContain('今は `::maketitle` だけを定義している');
  });

  it('動く構成図：§5.2 の属性・§3.1 のノードの種類・キーワードが同じ', () => {
    const rows = tableAfter(arch, '5.2 ');
    const archKeys = keysFor('arch');
    expect(rows.map(nameOf).sort()).toEqual(archKeys.map((key) => key.name).sort());
    for (const key of archKeys) {
      const [, value] = rows.find((row) => nameOf(row) === key.name)!;
      if (enumValues(key).length > 0) expect(ticks(value!), key.name).toEqual(enumValues(key));
    }
    expect(tableAfter(arch, '3.1 ').map(nameOf)).toEqual([...ARCH_NODE_KINDS]);
    for (const keyword of ARCH_KEYWORDS) expect(arch).toContain(`\`${keyword.name}`);
  });
});

/** 文書の見出しのアンカー（GitHub と同じ。同じ見出しは2つ目から -1・-2 を付ける） */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of outsideFences(markdown)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line)?.[1];
    if (!heading) continue;
    const base = slugify(heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    let anchor = base;
    for (let n = 1; anchors.has(anchor); n++) anchor = `${base}-${n}`;
    anchors.add(anchor);
  }
  return anchors;
}

describe('文書のリンク', () => {
  it('構文の定義の docAnchor（エディタの構文ヒントのリンク）は、文書の見出しを指している', () => {
    const all = [...FRONTMATTER_KEYS, ...ATTRIBUTE_KEYS, ...CONTAINERS, ...DIRECTIVES];
    for (const { name, docAnchor } of all) {
      const [file, hash] = docAnchor.split('#');
      expect(anchorsOf(read(`docs/${file}`)), `${name}：${docAnchor}`).toContain(hash);
    }
  });

  it('md から md の見出しへのリンクが切れていない', () => {
    const files = [
      'README.md',
      'CONTRIBUTING.md',
      'fixtures/README.md',
      ...readdirSync(join(root, 'docs'))
        .filter((name) => name.endsWith('.md'))
        .map((name) => `docs/${name}`),
    ];
    const broken: string[] = [];
    for (const file of files) {
      const text = outsideFences(read(file))
        .join('\n')
        .replace(/`[^`\n]*`/g, '');
      for (const [, target, hash] of text.matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)) {
        if (/^[a-z]+:/i.test(target!)) continue;
        const path = target ? resolve(dirname(join(root, file)), target) : join(root, file);
        if (!path.endsWith('.md') || !existsSync(path)) continue;
        const anchor = decodeURIComponent(hash!);
        if (!anchorsOf(readFileSync(path, 'utf8')).has(anchor)) {
          broken.push(`${file} → ${target}#${anchor}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
