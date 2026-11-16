/** 見出し1つ分の、slideLevel の判定に必要な情報。 */
export interface HeadingSummary {
  level: number;
  /** 次の見出しまでの間に本文がある */
  followedByContent: boolean;
  /** 次の見出しが、これより深いレベル（子の見出しを持つ） */
  hasChildren: boolean;
}

/**
 * slideLevel を決める（構文仕様 §2.1）：
 * 「子の見出しを持たず、直後に本文が続く見出し」の中で最も浅いレベル。
 * 文書の先頭にあって唯一の H1 は資料タイトルとみなし、判定に含めない。
 */
export function detectSlideLevel(headings: readonly HeadingSummary[]): number {
  const singleTitle =
    headings[0]?.level === 1 && headings.filter((h) => h.level === 1).length === 1;
  const rest = singleTitle ? headings.slice(1) : headings;
  const candidates = rest.filter((h) => h.followedByContent && !h.hasChildren);
  if (candidates.length > 0) return Math.min(...candidates.map((h) => h.level));
  // 当てはまる見出しがない（本文のない見出しだけ）なら、最も深いレベル
  return rest.length > 0 ? Math.max(...rest.map((h) => h.level)) : 1;
}

/**
 * Markdown の行から ATX 見出し（`#`）を拾い、HeadingSummary の列にする。
 * コードブロックの中は見ない。パースの前に slideLevel を見積もるときに使う。
 */
export function scanHeadings(lines: readonly string[]): HeadingSummary[] {
  const found: { level: number; line: number }[] = [];
  let fence: { char: string; length: number } | null = null;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length) {
        if (/^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      }
      return;
    }
    if (marker) {
      fence = { char: marker[1]![0]!, length: marker[1]!.length };
      return;
    }
    const heading = /^ {0,3}(#{1,6})(\s|$)/.exec(line);
    if (heading) found.push({ level: heading[1]!.length, line: index });
  });

  return found.map((h, i) => {
    const next = found[i + 1];
    const between = lines.slice(h.line + 1, next ? next.line : lines.length);
    return {
      level: h.level,
      followedByContent: between.some((l) => l.trim() !== ''),
      hasChildren: next !== undefined && next.level > h.level,
    };
  });
}
