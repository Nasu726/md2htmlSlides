// S2：自動分割の試作（issue #10、設計プラン §4）
// DOM に依存しない部分：原子に分ける・区切りのペナルティ・節ごとの動的計画法・スライドに戻す。

/**
 * スライドの本文を原子に分ける（§4.1）。
 * リストはトップレベルの項目ごと、表は行ごと（次のページには見出し行を出す）、それ以外はブロックごと。
 */
export function atomize(slide, md) {
  const atoms = [];
  let subheading; // 今いる小見出し（の原子の位置）
  let group = 0;
  for (const block of slide.blocks) {
    if (block.kind === 'comment' || block.kind === 'slide-attrs' || block.kind === 'directive')
      continue;
    if (block.kind === 'heading') {
      subheading = atoms.length;
      atoms.push({ block, kind: 'heading' });
      continue;
    }
    if (block.kind === 'list') {
      const lines = block.raw.split('\n');
      const items = md
        .parse(block.raw, {})
        .filter((t) => t.type === 'list_item_open' && t.level === 1 && t.map);
      group++;
      items.forEach((item, k) => {
        const raw = lines.slice(item.map[0], item.map[1]).join('\n').replace(/\n+$/, '');
        atoms.push({
          block: { ...block, raw },
          kind: 'list-item',
          group: { id: group, index: k, count: items.length },
          subheading,
        });
      });
      continue;
    }
    if (block.kind === 'table') {
      const [head, sep, ...rows] = block.raw.split('\n');
      group++;
      const headRaw = `${head}\n${sep}`;
      rows.forEach((row, k) => {
        atoms.push({
          block: { ...block, raw: `${headRaw}\n${row}` },
          kind: 'table-row',
          group: { id: group, index: k, count: rows.length, headRaw },
          subheading,
        });
      });
      continue;
    }
    atoms.push({ block, kind: block.kind, subheading });
  }
  return atoms;
}

const sameGroup = (a, b) => a.group && b.group && a.group.id === b.group.id;

/** 原子 i の直前で区切るときのペナルティ（§4.2）。Infinity は「区切らない」。 */
export function breakPenalty(atoms, i, w) {
  const prev = atoms[i - 1];
  const cur = atoms[i];
  if (prev.kind === 'heading') return Infinity; // 小見出しの直後
  if (prev.kind === 'pause' || cur.kind === 'pause') return Infinity; // . . . でつながった範囲
  if (prev.kind === 'paragraph' && /[：:]\s*$/.test(prev.block.raw)) return Infinity; // 「…：」の直後
  if (cur.kind === 'heading') return w.beforeHeading;
  if (sameGroup(prev, cur)) {
    const before = cur.group.index;
    const after = cur.group.count - cur.group.index;
    const base = cur.kind === 'table-row' ? w.tableRow : w.listItem;
    return base + (before === 1 || after === 1 ? w.orphan : 0);
  }
  return w.block;
}

/**
 * 節ごとの動的計画法（§4.3）。
 * m.heights[i]：原子 i の高さ（倍率 1。表の2行目以降は見出し行を除いた高さ）。
 * m.pairGap[i]：原子 i と i+1 の間隔。m.tableHead[i]：表の見出し行の高さ。m.avail：本文の高さ。
 */
export function split(atoms, m, w) {
  const n = atoms.length;
  if (n === 0) return [];
  const best = Array(n + 1).fill(Infinity);
  const from = Array(n + 1).fill(-1);
  const pageOf = Array(n + 1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    let sum = 0;
    let gaps = 0;
    for (let i = j - 1; i >= 0; i--) {
      sum += m.heights[i];
      if (i < j - 1) gaps += m.pairGap[i];
      // ページの先頭に足すもの：小見出しの再掲（§4.5）、表の見出し行
      const sub = atoms[i].kind !== 'heading' ? atoms[i].subheading : undefined;
      const resub = sub !== undefined && sub < i;
      let extra = resub ? m.heights[sub] + m.gap : 0;
      if (atoms[i].kind === 'table-row' && atoms[i].group.index > 0) extra += m.tableHead[i];
      const text = sum + extra;
      const needed = (m.avail - gaps) / text; // この倍率まで縮めれば収まる
      const single = j - i === 1;
      if (needed < w.minScale && !single) break; // i を前に戻すほど内容が増えるので打ち切る
      const penalty = i === 0 ? 0 : breakPenalty(atoms, i, w);
      if (penalty === Infinity || best[i] === Infinity) continue;
      const scale = Math.max(single ? 0.6 : w.minScale, Math.min(1, Math.floor(needed * 20) / 20));
      const overflow = text * scale + gaps > m.avail + 1;
      const fill = Math.min(1, (text * scale + gaps) / m.avail);
      let badness;
      if (j < n) badness = w.fill * (1 - fill) ** 2;
      else badness = i > 0 && fill < w.lastMin ? w.last * ((w.lastMin - fill) / w.lastMin) ** 2 : 0;
      // 縮小：softMinScale までは軽く、それより下は重くする
      const shrink =
        w.shrink * (1 - scale) + (w.deepShrink ?? 0) * Math.max(0, (w.softMinScale ?? 0) - scale);
      const cost = best[i] + penalty + badness + w.page + shrink + (overflow ? 1e4 : 0);
      if (cost < best[j]) {
        best[j] = cost;
        from[j] = i;
        pageOf[j] = {
          start: i,
          end: j,
          scale,
          fill,
          overflow,
          subheading: resub ? sub : undefined,
        };
      }
    }
  }
  const pages = [];
  for (let j = n; j > 0; j = from[j]) pages.unshift(pageOf[j]);
  return pages;
}

/** ページをスライドに戻す。続きのページは見出しに（続き）を付け、小見出しを再掲する。 */
export function toSlides(slide, atoms, pages) {
  return pages.map((page, k) => {
    const blocks = [];
    if (page.subheading !== undefined) {
      const h = atoms[page.subheading].block;
      blocks.push({ ...h, raw: `${h.raw.replace(/\s+$/, '')}（続き）` });
    }
    // 同じリスト・表の原子は1つのブロックにまとめる（番号付きのリストは元の番号が残る）
    let last;
    for (const atom of atoms.slice(page.start, page.end)) {
      if (last && sameGroup(last.atom, atom)) {
        const add = atom.kind === 'table-row' ? atom.block.raw.split('\n').pop() : atom.block.raw;
        last.block.raw += `\n${add}`;
        last.atom = atom;
      } else {
        const block = { ...atom.block };
        blocks.push(block);
        last = { atom, block };
      }
    }
    return {
      ...slide,
      id: k === 0 ? slide.id : `${slide.id}-${k + 1}`,
      ...(slide.heading
        ? { heading: { ...slide.heading, continued: k > 0 || slide.heading.continued } }
        : {}),
      blocks,
      page: { index: k + 1, total: pages.length, scale: page.scale, fill: page.fill },
    };
  });
}
