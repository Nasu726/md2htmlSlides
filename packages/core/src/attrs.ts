import { closest } from './suggest.js';
import { ATTRIBUTE_KEY_NAMES, findAttributeKey, type AttrValueSpec } from './syntax/elements.js';

/** `{key=value key .class #id}` を読んだ結果。値を書かないキーは true。 */
export interface Attrs {
  values: Record<string, string | true>;
  classes: string[];
  id?: string;
}

export type AttrsResult =
  /** 属性として読めた。値が正しくないキーは除き、invalid に入れる */
  | { ok: true; attrs: Attrs; invalid: { key: string; expected: string }[] }
  /**
   * 属性ではない（文字のまま表示する）。
   * typo は書き間違いと思われる場合だけ入る（`=` を含む、または既知のキーに似ている）
   */
  | { ok: false; typo?: { key: string; suggestion?: string } };

const TOKEN = /\s*(?:\.([\w-]+)|#([\w-]+)|([A-Za-z][\w-]*)(?:=("([^"]*)"|'([^']*)'|[^\s"'}]+))?)/y;

/** `{` と `}` を含む文字列を、属性として読む（構文仕様 §3.1）。 */
export function parseAttrs(text: string): AttrsResult {
  const inner = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  const attrs: Attrs = { values: {}, classes: [] };
  const invalid: { key: string; expected: string }[] = [];
  const unknown: string[] = [];

  let pos = 0;
  while (pos < inner.length) {
    if (/^\s*$/.test(inner.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(inner);
    if (!m || m[0].trim() === '') return notAttrs(inner, unknown);
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) {
      attrs.classes.push(m[1]);
      continue;
    }
    if (m[2] !== undefined) {
      attrs.id = m[2];
      continue;
    }
    const key = m[3]!;
    const raw = m[5] ?? m[6] ?? m[4];
    const def = findAttributeKey(key);
    if (!def) {
      unknown.push(key);
      continue;
    }
    const checked = checkValue(def.value, raw);
    if (checked.ok) attrs.values[key] = checked.value;
    else invalid.push({ key, expected: checked.expected });
  }

  if (unknown.length > 0) return notAttrs(inner, unknown);
  if (Object.keys(attrs.values).length === 0 && invalid.length === 0 && !hasClassOrId(attrs)) {
    return { ok: false };
  }
  return { ok: true, attrs, invalid };
}

function hasClassOrId(attrs: Attrs): boolean {
  return attrs.classes.length > 0 || attrs.id !== undefined;
}

function notAttrs(inner: string, unknown: string[]): AttrsResult {
  for (const key of unknown) {
    const suggestion = closest(key, ATTRIBUTE_KEY_NAMES);
    if (suggestion) return { ok: false, typo: { key, suggestion } };
  }
  if (inner.includes('=')) {
    const key = unknown[0] ?? inner.split('=')[0]!.trim();
    return { ok: false, typo: { key } };
  }
  return { ok: false };
}

type Checked = { ok: true; value: string | true } | { ok: false; expected: string };

function checkValue(spec: AttrValueSpec, raw: string | undefined): Checked {
  switch (spec.type) {
    case 'flag':
      return raw === undefined
        ? { ok: true, value: true }
        : { ok: false, expected: '値は書かない' };
    case 'flag-or-enum':
      if (raw === undefined) return { ok: true, value: true };
      return spec.values.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, expected: `値なし、または ${spec.values.join('・')}` };
    case 'flag-or-int':
      if (raw === undefined) return { ok: true, value: true };
      return /^[1-9]\d*$/.test(raw)
        ? { ok: true, value: raw }
        : { ok: false, expected: '値なし、または 1 以上の整数' };
    case 'enum':
      return raw !== undefined && spec.values.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, expected: spec.values.join('・') };
    case 'number': {
      const n = raw === undefined ? NaN : Number(raw);
      const inRange =
        !Number.isNaN(n) && n >= spec.min && (spec.max === undefined || n <= spec.max);
      return inRange
        ? { ok: true, value: raw! }
        : {
            ok: false,
            expected:
              spec.max === undefined ? `${spec.min} 以上の数` : `${spec.min}〜${spec.max} の数`,
          };
    }
    case 'length':
      return raw !== undefined && /^\d+(\.\d+)?(%|px)$/.test(raw)
        ? { ok: true, value: raw }
        : { ok: false, expected: '40% や 320px のような長さ' };
    case 'ratio':
      return raw !== undefined && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(raw)
        ? { ok: true, value: raw }
        : { ok: false, expected: '3:2 のような比' };
    case 'string':
    case 'path':
      return raw !== undefined && raw !== ''
        ? { ok: true, value: raw }
        : { ok: false, expected: '値を書く' };
  }
}

/** Attrs を `{…}` の形に戻す（表示とテスト用）。 */
export function formatAttrs(attrs: Attrs): string {
  const parts = [
    ...(attrs.id ? [`#${attrs.id}`] : []),
    ...attrs.classes.map((c) => `.${c}`),
    ...Object.entries(attrs.values).map(([k, v]) =>
      v === true ? k : /\s/.test(v) ? `${k}="${v}"` : `${k}=${v}`,
    ),
  ];
  return `{${parts.join(' ')}}`;
}
