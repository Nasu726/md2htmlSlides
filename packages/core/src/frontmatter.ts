import type { ThemeId } from '@mds/themes';
import { LineCounter, isMap, isScalar, parseDocument } from 'yaml';
import type { Diagnostic } from './diagnostics.js';
import { closest } from './suggest.js';
import {
  FRONTMATTER_KEY_NAMES,
  findFrontmatterKey,
  type ValueSpec,
} from './syntax/frontmatter-keys.js';

export interface Author {
  name: string;
  affiliation?: string;
}

/** フロントマターを検証し、既定値を補ったもの。 */
export interface DeckMeta {
  title?: string;
  subtitle?: string;
  authors: Author[];
  /** 全員に共通の所属（フロントマターの affiliation） */
  affiliation?: string;
  date?: string;
  event?: string;
  logo?: string;
  theme: ThemeId;
  aspect: '16:9' | '4:3' | '16:10';
  lang: string;
  slideLevel: 'auto' | 1 | 2 | 3;
  split: 'auto' | 'manual';
  titleSlide: 'auto' | false;
  paginate: boolean;
  footer?: string;
  accent?: string;
  css?: string;
  /** PDF の書き出し（構文仕様 §5.5）。steps: each ならステップごとのページにする */
  pdf?: { steps: 'final' | 'each' };
}

export const DEFAULT_META: Readonly<DeckMeta> = {
  authors: [],
  theme: 'clean',
  aspect: '16:9',
  lang: 'ja',
  slideLevel: 'auto',
  split: 'auto',
  titleSlide: 'auto',
  paginate: true,
};

export interface FrontmatterBlock {
  /** `---` と `---` の間の YAML */
  yaml: string;
  /** 開始の `---` の行（1 から始まる） */
  startLine: number;
  /** 終わりの `---` の行 */
  endLine: number;
}

export interface SplitResult {
  frontmatter: FrontmatterBlock | null;
  /** 本文（フロントマターを除いた Markdown） */
  body: string;
  /** 本文の1行目が、元のファイルの何行目か */
  bodyStartLine: number;
}

const OPEN = /^---[ \t]*$/;
const CLOSE = /^(---|\.\.\.)[ \t]*$/;

/** ファイルの先頭のフロントマターを切り出す。改行は LF にそろえてから渡す。 */
export function splitFrontmatter(text: string, diagnostics: Diagnostic[]): SplitResult {
  const lines = text.split('\n');
  if (!OPEN.test(lines[0] ?? '')) {
    return { frontmatter: null, body: text, bodyStartLine: 1 };
  }
  const close = lines.findIndex((line, i) => i > 0 && CLOSE.test(line));
  if (close === -1) {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter/unclosed',
      message: 'フロントマターが閉じていません。2つ目の「---」がないため、本文として扱います',
      line: 1,
    });
    return { frontmatter: null, body: text, bodyStartLine: 1 };
  }
  return {
    frontmatter: { yaml: lines.slice(1, close).join('\n'), startLine: 1, endLine: close + 1 },
    body: lines.slice(close + 1).join('\n'),
    bodyStartLine: close + 2,
  };
}

/** フロントマターの YAML を読み、構文の定義に照らして検証する。 */
export function parseMeta(block: FrontmatterBlock | null, diagnostics: Diagnostic[]): DeckMeta {
  const meta: DeckMeta = { ...DEFAULT_META, authors: [] };
  if (block === null || block.yaml.trim() === '') return meta;

  const lineCounter = new LineCounter();
  const doc = parseDocument(block.yaml, { lineCounter });
  // YAML の1行目は、ファイルでは開始の `---` の次の行
  const fileLine = (offset: number) => block.startLine + lineCounter.linePos(offset).line;

  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      diagnostics.push({
        severity: 'error',
        code: 'frontmatter/yaml',
        message: `フロントマターの YAML を読めません：${error.message.split('\n')[0]}`,
        line: fileLine(error.pos[0]),
      });
    }
    return meta;
  }
  if (!isMap(doc.contents)) {
    diagnostics.push({
      severity: 'error',
      code: 'frontmatter/not-a-map',
      message: 'フロントマターは「キー: 値」の形で書いてください',
      line: block.startLine + 1,
    });
    return meta;
  }

  let affiliation: string | undefined;
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key)) continue;
    const name = String(pair.key.value);
    const line = fileLine(pair.key.range?.[0] ?? 0);
    const value: unknown = isScalar(pair.value)
      ? pair.value.value
      : (pair.value?.toJSON() as unknown);
    const key = findFrontmatterKey(name);
    if (!key) {
      const suggestion = closest(name, FRONTMATTER_KEY_NAMES);
      diagnostics.push({
        severity: 'warning',
        code: 'frontmatter/unknown-key',
        message:
          `未知のキー「${name}」` +
          (suggestion ? `。「${suggestion}」のことですか？` : 'は無視します'),
        line,
        ...(suggestion ? { suggestion } : {}),
      });
      continue;
    }
    const checked = checkValue(key.value, value);
    if (!checked.ok) {
      diagnostics.push({
        severity: 'warning',
        code: 'frontmatter/invalid-value',
        message: `「${name}」の値が正しくありません。${checked.expected}。既定値を使います`,
        line,
      });
      continue;
    }
    if (name === 'affiliation') affiliation = checked.value as string;
    else assign(meta, name, checked.value);
  }

  if (affiliation !== undefined) {
    // 全員に共通の所属は、所属を書いていない著者に付ける。著者がいなくても meta に残す
    meta.affiliation = affiliation;
    meta.authors = meta.authors.map((author) =>
      author.affiliation === undefined ? { ...author, affiliation } : author,
    );
  }
  return meta;
}

type Checked = { ok: true; value: unknown } | { ok: false; expected: string };

function checkValue(spec: ValueSpec, value: unknown): Checked {
  switch (spec.type) {
    case 'string':
    case 'path':
      if (typeof value === 'string') return { ok: true, value };
      if (typeof value === 'number') return { ok: true, value: String(value) };
      return { ok: false, expected: '文字列を書いてください' };
    case 'date':
      if (typeof value === 'string') return { ok: true, value };
      if (value instanceof Date) return { ok: true, value: value.toISOString().slice(0, 10) };
      if (typeof value === 'number') return { ok: true, value: String(value) };
      return { ok: false, expected: '日付・today・文字列のどれかを書いてください' };
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value };
      return { ok: false, expected: 'true か false を書いてください' };
    case 'color':
      if (typeof value === 'string' && isColor(value)) return { ok: true, value };
      return { ok: false, expected: '色を「#e11d48」のように書いてください' };
    case 'enum': {
      const match = spec.values.find(
        (candidate) => candidate === value || String(candidate) === String(value),
      );
      if (match !== undefined) return { ok: true, value: match };
      return {
        ok: false,
        expected: `${spec.values.map(String).join('・')} のどれかを書いてください`,
      };
    }
    case 'authors':
      return checkAuthors(value);
    case 'pdf': {
      const steps =
        typeof value === 'object' && value !== null
          ? (value as { steps?: unknown }).steps
          : undefined;
      if (steps === undefined || steps === 'final' || steps === 'each') {
        return { ok: true, value: { steps: steps ?? 'final' } };
      }
      return {
        ok: false,
        expected: '「pdf: { steps: each }」のように書いてください（final か each）',
      };
    }
  }
}

function checkAuthors(value: unknown): Checked {
  const list = Array.isArray(value) ? value : [value];
  const authors: Author[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim() !== '') {
      authors.push({ name: item });
    } else if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { name?: unknown }).name === 'string'
    ) {
      const { name, affiliation } = item as { name: string; affiliation?: unknown };
      authors.push(typeof affiliation === 'string' ? { name, affiliation } : { name });
    } else {
      return {
        ok: false,
        expected: '名前の文字列か、{ name, affiliation } の配列を書いてください',
      };
    }
  }
  return { ok: true, value: authors };
}

function isColor(value: string): boolean {
  return (
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
    /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(.+\)$/i.test(value) ||
    /^[a-z]+$/i.test(value)
  );
}

function assign(meta: DeckMeta, name: string, value: unknown): void {
  if (name === 'author') {
    meta.authors = value as Author[];
    return;
  }
  (meta as unknown as Record<string, unknown>)[name] = value;
}
