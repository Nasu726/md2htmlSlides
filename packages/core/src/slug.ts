/**
 * 見出しの文字列から ID を作る。GitHub の見出しアンカーに近い規則：
 * 小文字にし、文字・数字・空白・`_`・`-` 以外を除き、空白を `-` にする。
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** 同じ見出しが複数あっても ID が重ならないように、2つ目以降に `-1`・`-2` を付ける。 */
export class SlugRegistry {
  private readonly used = new Map<string, number>();

  next(text: string): string {
    const base = slugify(text) || 'section';
    const count = this.used.get(base) ?? 0;
    this.used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  }
}
