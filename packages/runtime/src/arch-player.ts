/**
 * 動く構成図の再生（#108、docs/arch-diagram.md §6.1）。
 *
 * 発表用のプレイヤー（player.ts）の「埋め込みの内部ステップ」（window.mdsEmbeds、#105）に、
 * 種類 `arch` を登録する。図（`data-embed="arch"`）の段は、終えたシナリオのステップの数。
 * - show(el, 段)：動きなしで、その段の状態にする（戻る・一覧・発表者ビュー・印刷）
 * - play(el, 段)：1つ進めたとき。パケットを区間ごとに動かし（S4：ノードの中は通さない）、
 *   最後に show と同じ状態にする
 *
 * 状態（強調・薄く・バッジ・番号の印）は SVG の中のクラスと、足した要素（.arch-fx）だけで持つ。
 * 色は基本の CSS（テーマの変数）で塗る。外側の変数を使わない1つの関数にしている。
 */
export function startArch(doc: Document): void {
  const win = doc.defaultView;
  if (!win) return;
  type Point = { x: number; y: number };
  type Move = { m: string[]; r: boolean[]; l?: string; c?: string[]; x?: number };
  type State = { s: string; t: string | null; e?: number };
  type Action = Move | State;
  const NS = 'http://www.w3.org/2000/svg';
  const data = new WeakMap<Element, Action[][]>();
  const runs = new WeakMap<Element, number>();

  const stepsOf = (figure: HTMLElement): Action[][] => {
    let steps = data.get(figure);
    if (!steps) {
      try {
        steps = JSON.parse(figure.dataset.archSteps ?? '[]') as Action[][];
      } catch {
        steps = [];
      }
      data.set(figure, steps);
    }
    return steps;
  };
  const make = (name: string, attrs: Record<string, string | number>, parent?: Element) => {
    const e = doc.createElementNS(NS, name) as SVGElement;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent?.append(e);
    return e;
  };
  const sel = (s: string) => s.replace(/["\\]/g, '\\$&');
  const nodeOf = (svg: Element, id: string) =>
    svg.querySelector(`.arch-node[data-node="${sel(id)}"]`);
  const edgeOf = (svg: Element, a: string, b: string) =>
    svg.querySelector(`.arch-edge[data-from="${sel(a)}"][data-to="${sel(b)}"]`);
  const boxOf = (node: Element) =>
    (node.querySelector('.shape') as SVGGraphicsElement | null)?.getBBox() ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  const pointsOf = (edge: Element): Point[] => {
    const nums = (edge.querySelector('path')?.getAttribute('d') ?? '').match(/-?[\d.]+/g) ?? [];
    const pts: Point[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: Number(nums[i]), y: Number(nums[i + 1]) });
    }
    return pts;
  };
  /** 区間 a → b の経路。構成にあれば線に沿って（逆向きなら逆にたどる）、なければ中心を結ぶ */
  const segment = (svg: Element, a: string, b: string) => {
    const fwd = edgeOf(svg, a, b);
    if (fwd) return { pts: pointsOf(fwd), edge: fwd, temp: false };
    const back = edgeOf(svg, b, a);
    if (back) return { pts: pointsOf(back).reverse(), edge: back, temp: false };
    const na = nodeOf(svg, a);
    const nb = nodeOf(svg, b);
    if (!na || !nb) return undefined;
    const c = (n: Element) => {
      const r = boxOf(n);
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    return { pts: [c(na), c(nb)] as Point[], edge: undefined, temp: true };
  };
  const pathOf = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  /** 折れ線の始めから dist の位置と、その区間の向き（単位ベクトル） */
  const pointAt = (pts: Point[], dist: number): Point & { dx: number; dy: number } => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist <= len || i + 2 === pts.length) {
        const t = len ? Math.min(1, dist / len) : 0;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          dx: len ? (b.x - a.x) / len : 1,
          dy: len ? (b.y - a.y) / len : 0,
        };
      }
      dist -= len;
    }
    return { ...(pts[0] ?? { x: 0, y: 0 }), dx: 1, dy: 0 };
  };
  const lengthOf = (pts: Point[]) =>
    pts.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0);

  /**
   * ステップの番号の印（通った区間の始めの近く）。
   * 同じ線に2つ以上なら線に沿ってずらし、線が短くて収まらなければ線の横に積む
   */
  const mark = (fx: Element, pts: Point[], n: number, nth: number) => {
    const room = lengthOf(pts) * 0.45;
    const along = 22 + nth * 24;
    const at = pointAt(pts, Math.min(room, along));
    // 収まらない分は、線の上（横向きの線なら上、縦向きなら左）に積む
    const side = along > room ? nth * 22 : 0;
    const ox = at.dy * side * (at.dy > 0 ? -1 : 1);
    const oy = -Math.abs(at.dx) * side;
    const g = make(
      'g',
      { class: 'arch-mark', transform: `translate(${at.x + ox} ${at.y + oy})` },
      fx,
    );
    make('circle', { r: 10 }, g);
    make('text', {}, g).textContent = String(n);
  };
  const badge = (fx: Element, svg: Element, id: string, text: string, error: boolean) => {
    const node = nodeOf(svg, id);
    if (!node) return;
    const box = boxOf(node);
    const w = Math.max(28, text.length * 14 + 14);
    const g = make(
      'g',
      {
        class: `arch-badge${error ? ' is-error' : ''}`,
        transform: `translate(${box.x + box.width - w + 8} ${box.y - 14})`,
      },
      fx,
    );
    make('rect', { width: w, height: 22, rx: 11 }, g);
    make('text', { x: w / 2, y: 11 }, g).textContent = text;
  };
  /** 今のステップに関係するノードと線を強調し、ほかを薄くする */
  const highlight = (svg: Element, step: Action[] | undefined) => {
    const nodes = new Set<string>();
    const edges = new Set<Element>();
    for (const a of step ?? []) {
      if ('s' in a) {
        nodes.add(a.s);
        continue;
      }
      a.m.forEach((id) => nodes.add(id));
      for (let i = 0; i + 1 < a.m.length; i++) {
        const seg = segment(svg, a.m[i]!, a.m[i + 1]!);
        if (seg?.edge) edges.add(seg.edge);
      }
    }
    const on = step !== undefined;
    for (const n of Array.from(svg.querySelectorAll<SVGElement>('.arch-node'))) {
      const active = nodes.has(n.dataset.node ?? '');
      n.classList.toggle('is-active', on && active);
      n.classList.toggle('is-dim', on && !active);
    }
    for (const e of Array.from(svg.querySelectorAll('.arch-edge'))) {
      e.classList.toggle('is-active', on && edges.has(e));
      e.classList.toggle('is-dim', on && !edges.has(e));
    }
  };
  /** 説明のリスト（同じスライドの中）：今のステップを強調し、まだのステップを薄くする */
  const captions = (figure: HTMLElement, stage: number) => {
    const list = figure.closest('.mds-slide')?.querySelector('.mds-arch-captions');
    Array.from(list?.children ?? []).forEach((li, i) => {
      li.classList.toggle('is-current', i === stage - 1);
      li.classList.toggle('is-future', i >= stage);
    });
  };

  const show = (figure: HTMLElement, stage: number) => {
    runs.set(figure, (runs.get(figure) ?? 0) + 1); // 再生中なら止める
    const svg = figure.querySelector('svg.mds-arch-svg');
    if (!svg) return;
    svg.querySelector('.arch-fx')?.remove();
    const fx = make('g', { class: 'arch-fx' }, svg);
    const steps = stepsOf(figure);
    const done = Math.min(stage, steps.length);
    const badges = new Map<string, { t: string; e: boolean }>();
    const used = new Map<Element | string, number>();
    for (let k = 0; k < done; k++) {
      for (const a of steps[k]!) {
        if ('s' in a) {
          if (a.t === null) badges.delete(a.s);
          else badges.set(a.s, { t: a.t, e: Boolean(a.e) });
          continue;
        }
        for (let i = 0; i + 1 < a.m.length; i++) {
          const seg = segment(svg, a.m[i]!, a.m[i + 1]!);
          if (!seg) continue;
          // 構成にない経路は、そのステップのあいだだけ点線で描く
          if (seg.temp && k === done - 1) {
            make('path', { class: 'arch-temp', d: pathOf(seg.pts) }, fx);
          }
          const key = seg.edge ?? `${a.m[i]}>${a.m[i + 1]}`;
          const nth = used.get(key) ?? 0;
          used.set(key, nth + 1);
          mark(fx, seg.pts, k + 1, nth);
        }
      }
    }
    for (const [id, b] of badges) badge(fx, svg, id, b.t, b.e);
    highlight(svg, done > 0 ? steps[done - 1] : undefined);
    captions(figure, done);
  };

  const play = async (figure: HTMLElement, stage: number) => {
    const svg = figure.querySelector('svg.mds-arch-svg');
    const step = stepsOf(figure)[stage - 1];
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!svg || !step || reduced) {
      show(figure, stage);
      return;
    }
    show(figure, stage - 1);
    const run = (runs.get(figure) ?? 0) + 1;
    runs.set(figure, run);
    highlight(svg, step);
    captions(figure, stage);
    const fx = svg.querySelector('.arch-fx')!;
    for (const a of step) {
      if ('s' in a) continue;
      for (let rep = 0; rep < (a.x ?? 1); rep++) {
        for (let i = 0; i + 1 < a.m.length; i++) {
          const seg = segment(svg, a.m[i]!, a.m[i + 1]!);
          if (!seg) continue;
          if (seg.temp) make('path', { class: 'arch-temp', d: pathOf(seg.pts) }, fx);
          const packet = make('g', { class: `arch-packet${a.r[i] ? ' is-reply' : ''}` }, fx);
          make('circle', { r: 9 }, packet);
          const label = `${a.l ?? ''}${(a.x ?? 1) > 1 ? ` ×${a.x}` : ''}`.trim();
          if (label)
            make('text', { class: 'arch-packet-label', y: -20 }, packet).textContent = label;
          if (a.c?.length) {
            const bubble = make(
              'g',
              { class: 'arch-bubble', transform: 'translate(14 14)' },
              packet,
            );
            const w = Math.max(...a.c.map((line) => line.length)) * 8.6 + 20;
            make('rect', { width: w, height: a.c.length * 19 + 12, rx: 6 }, bubble);
            a.c.forEach((line, j) => {
              make('text', { x: 10, y: 16 + j * 19 }, bubble).textContent = line;
            });
          }
          packet.style.setProperty('offset-path', `path('${pathOf(seg.pts)}')`);
          packet.style.setProperty('offset-rotate', '0deg');
          const anim = packet.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], {
            duration: 600,
            easing: 'ease-in-out',
            fill: 'forwards',
          });
          await anim.finished.catch(() => undefined);
          packet.remove();
          if (runs.get(figure) !== run) return;
          // 着いたノードを光らせる（パケットはノードの中を通さない）
          const target = nodeOf(svg, a.m[i + 1]!);
          target?.classList.add('is-flash');
          setTimeout(() => target?.classList.remove('is-flash'), 350);
        }
      }
    }
    if (runs.get(figure) === run) show(figure, stage);
  };

  const host = win as unknown as {
    mdsEmbeds?: Record<
      string,
      { show(el: HTMLElement, stage: number): void; play?(el: HTMLElement, stage: number): void }
    >;
  };
  (host.mdsEmbeds ??= {}).arch = {
    show,
    play: (figure, stage) => void play(figure, stage),
  };
}
