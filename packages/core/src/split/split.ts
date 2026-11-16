/**
 * 計測による自動分割（docs/design.md §4）。
 *
 * DOM には触らない。流れは次のとおり。
 * 1. `planSplit(deck)`：分割の対象のスライドごとに、測るもの（原子の HTML など）を用意する
 * 2. ブラウザで `measureJobs(jobs)` を実行して、高さを測る（CLI は Chromium、エディタはプレビューの iframe）
 * 3. `applySplit(deck, plan, measurements)`：節ごとの動的計画法で区切り、スライドを作り直す
 *
 * 重みは S2（#10）で決めた（§15.1）。
 */
import type { Block } from '../ir.js';
import { md } from '../md/instance.js';
import { renderBlocks, renderSlide } from '../render/html.js';
import { isMediaBlock, isShortList } from '../render/layout.js';
import type { Slide, SlideDeck } from '../slides.js';

export interface SplitWeights {
  /** 小見出しの直前での区切り */
  beforeHeading: number;
  /** ブロックとブロックの間 */
  block: number;
  /** リストの項目の間 */
  listItem: number;
  /** 表の行の間 */
  tableRow: number;
  /** リスト・表の片方に1つだけが残るときに足す */
  orphan: number;
  /** 1枚あたり */
  page: number;
  /** 最後以外のページの余白：fill·(1 − 充填率)² */
  fill: number;
  /** ページ（節が2枚以上のとき）が lastMin 未満のとき：last·((lastMin − 充填率)/lastMin)² */
  last: number;
  lastMin: number;
  /** 縮小：shrink·(1 − 倍率)。softMinScale より下は deepShrink を足す */
  shrink: number;
  deepShrink: number;
  softMinScale: number;
  /** 複数の原子を収めるときの最小の倍率 */
  minScale: number;
  /** 原子1つが収まらないときの最小の倍率（それでも収まらなければ警告） */
  atomMinScale: number;
}

export const DEFAULT_WEIGHTS: SplitWeights = {
  beforeHeading: 0,
  block: 10,
  listItem: 30,
  tableRow: 60,
  orphan: 50,
  page: 40,
  fill: 100,
  last: 400,
  lastMin: 0.35,
  shrink: 300,
  deepShrink: 2000,
  softMinScale: 0.85,
  minScale: 0.75,
  atomMinScale: 0.6,
};

/** 分けない最小単位（§4.1）。リストは項目ごと、表は行ごと、それ以外はブロックごと。 */
export interface Atom {
  block: Block;
  kind: Block['kind'] | 'list-item' | 'table-row';
  /** 同じリスト・表の原子の組 */
  group?: { id: number; index: number; count: number; head?: string };
  /** 今いる小見出しの原子の位置 */
  subheading?: number;
  /** 画像だけの段落が続いたもの（格子に並べるので分けない）の画像の数 */
  gallery?: number;
}

const SKIP = new Set<Block['kind']>(['comment', 'slide-attrs', 'directive']);

export function atomize(blocks: Block[]): Atom[] {
  const atoms: Atom[] = [];
  let subheading: number | undefined;
  let group = 0;
  const push = (atom: Atom) =>
    atoms.push(subheading === undefined ? atom : { ...atom, subheading });
  for (const block of blocks) {
    if (SKIP.has(block.kind)) continue;
    if (block.kind === 'heading') {
      subheading = atoms.length;
      atoms.push({ block, kind: 'heading' });
    } else if (block.kind === 'list' && !isShortList(block)) {
      const lines = block.raw.split('\n');
      const items = md
        .parse(block.raw, {})
        .filter((t) => t.type === 'list_item_open' && t.level === 1 && t.map);
      group++;
      items.forEach((item, index) => {
        const [from, to] = item.map!;
        const raw = lines.slice(from, to).join('\n').replace(/\n+$/, '');
        push({
          block: { ...block, raw },
          kind: 'list-item',
          group: { id: group, index, count: items.length },
        });
      });
    } else if (block.kind === 'table') {
      const [head = '', sep = '', ...rows] = block.raw.split('\n');
      group++;
      const headRaw = `${head}\n${sep}`;
      rows.forEach((row, index) => {
        push({
          block: { ...block, raw: `${headRaw}\n${row}` },
          kind: 'table-row',
          group: { id: group, index, count: rows.length, head: headRaw },
        });
      });
    } else if (isMediaBlock(block) && atoms.at(-1)?.gallery) {
      // 画像だけの段落が続いたら、1つの原子にまとめる（grid で並べる）
      const prev = atoms.at(-1)!;
      prev.block = {
        ...prev.block,
        raw: `${prev.block.raw}\n\n${block.raw}`,
        media: [...(prev.block.media ?? []), ...(block.media ?? [])],
        src: { start: prev.block.src.start, end: block.src.end },
      };
      prev.gallery! += 1;
    } else {
      push({ block, kind: block.kind, ...(isMediaBlock(block) ? { gallery: 1 } : {}) });
    }
  }
  // 1つだけの画像の段落は、ふつうの原子にもどす
  for (const atom of atoms) if (atom.gallery === 1) delete atom.gallery;
  return atoms;
}

const sameGroup = (a: Atom | undefined, b: Atom | undefined) =>
  Boolean(a?.group && b?.group && a.group.id === b.group.id);

/** 原子 i の直前で区切るときのペナルティ（§4.2）。Infinity は「区切らない」。 */
export function breakPenalty(atoms: Atom[], i: number, w: SplitWeights): number {
  const prev = atoms[i - 1]!;
  const cur = atoms[i]!;
  if (prev.kind === 'heading') return Infinity; // 小見出しの直後
  if (prev.kind === 'pause' || cur.kind === 'pause') return Infinity; // . . . でつながった範囲
  if (prev.kind === 'paragraph' && /[：:]\s*$/.test(prev.block.raw)) return Infinity; // 「…：」の直後
  if (cur.kind === 'heading') return w.beforeHeading;
  if (sameGroup(prev, cur)) {
    const { index, count } = cur.group!;
    const base = cur.kind === 'table-row' ? w.tableRow : w.listItem;
    return base + (index === 1 || count - index === 1 ? w.orphan : 0);
  }
  return w.block;
}

/** スライド1枚ぶんの計測の結果。 */
export interface Measurement {
  /** 本文の高さ */
  avail: number;
  /** ブロックの間隔（--mds-gap） */
  gap: number;
  /** リストの項目の間隔 */
  listGap: number;
  /** 原子の高さ（倍率 1） */
  heights: number[];
  /** 表の見出し行だけの高さ（表の行の原子のとき） */
  heads: number[];
}

export interface Page {
  start: number;
  end: number;
  scale: number;
  fill: number;
  overflow: boolean;
  /** 先頭に再掲する小見出しの原子 */
  subheading?: number;
}

/** 節ごとの動的計画法（§4.3）。 */
export function splitAtoms(
  atoms: Atom[],
  m: Measurement,
  w: SplitWeights = DEFAULT_WEIGHTS,
): Page[] {
  const n = atoms.length;
  if (n === 0) return [];
  // 表の2行目以降は、見出し行を除いた高さで数える（見出し行はページの先頭で足す）
  const heights = m.heights.map((h, i) => {
    const a = atoms[i]!;
    return a.kind === 'table-row' && a.group!.index > 0 ? Math.max(0, h - (m.heads[i] ?? 0)) : h;
  });
  const pairGap = atoms.map((a, i) =>
    sameGroup(a, atoms[i + 1]) ? (a.kind === 'table-row' ? 0 : m.listGap) : m.gap,
  );
  const best: number[] = Array<number>(n + 1).fill(Infinity);
  const from: number[] = Array<number>(n + 1).fill(-1);
  const pageOf: Page[] = Array<Page>(n + 1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    let sum = 0;
    let gaps = 0;
    for (let i = j - 1; i >= 0; i--) {
      sum += heights[i]!;
      if (i < j - 1) gaps += pairGap[i]!;
      // ページの先頭に足すもの：小見出しの再掲（§4.5）、表の見出し行
      const atom = atoms[i]!;
      const sub = atom.kind !== 'heading' ? atom.subheading : undefined;
      const resub = sub !== undefined && sub < i;
      let extra = resub ? heights[sub]! + m.gap : 0;
      if (atom.kind === 'table-row' && atom.group!.index > 0) extra += m.heads[i] ?? 0;
      const text = sum + extra;
      const needed = text > 0 ? (m.avail - gaps) / text : 1; // この倍率まで縮めれば収まる
      const single = j - i === 1;
      // i を前に戻すほど内容が増えるので打ち切る（まだ1つも収め方がなければ、あふれを覚悟で続ける）
      if (needed < w.minScale && !single && best[j]! < Infinity) break;
      const penalty = i === 0 ? 0 : breakPenalty(atoms, i, w);
      if (penalty === Infinity || best[i] === Infinity) continue;
      const floor = single ? w.atomMinScale : w.minScale;
      const scale = Math.max(floor, Math.min(1, Math.floor(needed * 20) / 20));
      const overflow = text * scale + gaps > m.avail + 1;
      const fill = Math.min(1, (text * scale + gaps) / m.avail);
      // 余白：最後以外のページは余白が多いほど悪い。どのページも、数行だけなら重く罰する
      // （節が1枚で済むときは罰しない）
      let badness = j < n ? w.fill * (1 - fill) ** 2 : 0;
      if ((i > 0 || j < n) && fill < w.lastMin) {
        badness += w.last * ((w.lastMin - fill) / w.lastMin) ** 2;
      }
      const shrink = w.shrink * (1 - scale) + w.deepShrink * Math.max(0, w.softMinScale - scale);
      const cost = best[i]! + penalty + badness + w.page + shrink + (overflow ? 1e4 : 0);
      if (cost < best[j]!) {
        best[j] = cost;
        from[j] = i;
        pageOf[j] = {
          start: i,
          end: j,
          scale,
          fill,
          overflow,
          ...(resub ? { subheading: sub } : {}),
        };
      }
    }
  }
  const pages: Page[] = [];
  for (let j = n; j > 0; j = from[j]!) pages.unshift(pageOf[j]!);
  return pages;
}

/** ブラウザで測るもの（スライド1枚ぶん）。 */
export interface MeasureJob {
  /** 本文が1行だけのスライド（本文の高さを測る） */
  skeleton: string;
  /** 原子の HTML */
  atoms: string[];
  /** 表の見出し行だけの HTML（表の行の原子のとき。ほかは空文字） */
  heads: string[];
}

export interface SplitPlan {
  /** 分割の対象のスライドの位置と、その原子 */
  targets: Array<{ index: number; atoms: Atom[] }>;
  jobs: MeasureJob[];
}

/** 分割の対象（普通のスライド。`split: manual` なら対象なし）と、測るものを用意する。 */
export function planSplit(deck: SlideDeck): SplitPlan {
  const plan: SplitPlan = { targets: [], jobs: [] };
  if (deck.meta.split === 'manual') return plan;
  deck.slides.forEach((slide, index) => {
    if (slide.kind !== 'content' || slide.attrs?.values.keep !== undefined) return;
    const atoms = atomize(slide.blocks);
    if (atoms.length === 0) return;
    const one: Block = { kind: 'paragraph', raw: 'x', hash: '', src: slide.src };
    plan.targets.push({ index, atoms });
    plan.jobs.push({
      // 本文の高さは stack で測る（1行だけの本文は statement に自動で選ばれてしまうため）
      skeleton: renderSlide(
        {
          ...slide,
          blocks: [one],
          attrs: {
            classes: slide.attrs?.classes ?? [],
            values: { ...slide.attrs?.values, layout: 'stack' },
          },
        },
        deck,
        { page: 1, total: 1 },
      ),
      atoms: atoms.map((a) => {
        const html = renderBlocks([a.block], deck.slideLevel, { lang: deck.meta.lang });
        // 続いた画像は格子に並べるので、格子の高さで測る
        if (!a.gallery) return html;
        const cols = a.gallery <= 3 ? a.gallery : a.gallery === 4 ? 2 : 3;
        return `<div class="mds-grid" style="--mds-cols:${cols}">${html}</div>`;
      }),
      heads: atoms.map((a) =>
        a.group?.head
          ? renderBlocks([{ ...a.block, raw: a.group.head }], deck.slideLevel, {
              lang: deck.meta.lang,
            })
          : '',
      ),
    });
  });
  return plan;
}

/** 計測の結果で区切り、スライドを作り直す。続きのスライドは見出しを引き継ぐ（§4.5）。 */
export function applySplit(
  deck: SlideDeck,
  plan: SplitPlan,
  measurements: Measurement[],
  weights: SplitWeights = DEFAULT_WEIGHTS,
): SlideDeck {
  const replaced = new Map<number, Slide[]>();
  plan.targets.forEach((target, k) => {
    const m = measurements[k];
    if (!m) return;
    const pages = splitAtoms(target.atoms, m, weights);
    replaced.set(target.index, toSlides(deck.slides[target.index]!, target.atoms, pages));
  });
  const slides = deck.slides.flatMap((slide, i) => replaced.get(i) ?? [slide]);
  return { ...deck, slides };
}

function toSlides(slide: Slide, atoms: Atom[], pages: Page[]): Slide[] {
  return pages.map((page, k) => {
    const blocks: Block[] = [];
    if (page.subheading !== undefined) {
      const h = atoms[page.subheading]!.block;
      blocks.push({ ...h, raw: `${h.raw.replace(/\s+$/, '')}（続き）` });
    }
    // 同じリスト・表の原子は1つのブロックにまとめる（番号付きのリストは元の番号が残る）
    let last: { atom: Atom; block: Block } | undefined;
    for (const atom of atoms.slice(page.start, page.end)) {
      if (last && sameGroup(last.atom, atom)) {
        const add = atom.kind === 'table-row' ? atom.block.raw.split('\n').pop()! : atom.block.raw;
        last.block.raw += `\n${add}`;
        last.atom = atom;
      } else {
        const block = { ...atom.block };
        blocks.push(block);
        last = { atom, block };
      }
    }
    const next: Slide = {
      ...slide,
      id: k === 0 ? slide.id : `${slide.id}~p${k + 1}`,
      blocks,
      ...(k > 0 ? { notes: [] } : {}),
      ...(page.scale < 1 ? { scale: page.scale } : {}),
      ...(pages.length > 1 ? { page: { index: k + 1, total: pages.length } } : {}),
    };
    if (slide.heading) {
      next.heading = { ...slide.heading, continued: k > 0 || slide.heading.continued };
    }
    return next;
  });
}

/**
 * ブラウザで実行して高さを測る（Playwright の page.evaluate にそのまま渡せるように、外側の変数を使わない）。
 * `.mds-deck` があるページ（renderDeckHtml でスライドを空にしたもの）で呼ぶ。
 * 書き込みをすべて済ませてから、まとめて読む（S1）。
 */
export function measureJobs(jobs: MeasureJob[]): Measurement[] {
  const deck = document.querySelector('.mds-deck');
  if (!deck) throw new Error('.mds-deck がありません');
  const holder = document.createElement('div');
  holder.innerHTML = jobs
    .map((job, k) => {
      const atoms = job.atoms
        .map(
          (html, i) =>
            `<div class="mds-atom" style="display:flex;flex-direction:column;gap:var(--mds-gap)">${html}</div>` +
            `<div class="mds-atom-head" style="display:flex;flex-direction:column">${job.heads[i] ?? ''}</div>`,
        )
        .join('');
      return (
        job.skeleton.replace('<section ', `<section data-mds-job="${k}" `) +
        `<section class="mds-slide layout-stack" style="height:auto" data-mds-measure="${k}"><div class="mds-body">${atoms}</div></section>`
      );
    })
    .join('');
  deck.append(holder);
  const result = jobs.map((_, k) => {
    const body = holder.querySelector<HTMLElement>(`[data-mds-job="${k}"] .mds-body`)!;
    const style = getComputedStyle(body);
    const measure = holder.querySelector(`[data-mds-measure="${k}"]`)!;
    const height = (el: Element) => el.getBoundingClientRect().height;
    return {
      avail: body.clientHeight,
      gap: parseFloat(style.rowGap) || 0,
      listGap: (parseFloat(style.fontSize) || 0) * 0.25, // .mds-body ul { gap: 0.25em }
      heights: Array.from(measure.querySelectorAll('.mds-atom'), height),
      heads: Array.from(measure.querySelectorAll('.mds-atom-head'), height),
    };
  });
  holder.remove();
  return result;
}
