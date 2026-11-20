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
  // b：届かない区間（`-x`）、p：止める `d`・戻す `u`、k：つながりを切る（u なら戻す）（#180）
  type Move = { m: string[]; r: boolean[]; b?: boolean[]; l?: string; c?: string[]; x?: number };
  type State = { s: string; t: string | null; e?: number; p?: 'd' | 'u' };
  type Cut = { k: [string, string]; u?: number };
  type Action = Move | State | Cut;
  const isState = (a: Action): a is State => 's' in a;
  const isCut = (a: Action): a is Cut => 'k' in a;
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
  /**
   * ノードの枠（renderArch が data-box に書く）。getBBox は使わない：
   * 発表者ビューの複製など、まだ描かれていない要素では 0 になるため
   */
  const boxOf = (node: Element) => {
    const [x = 0, y = 0, width = 0, height = 0] = (node.getAttribute('data-box') ?? '')
      .split(' ')
      .map(Number);
    return { x, y, width, height };
  };
  const pointsOf = (edge: Element): Point[] => {
    const nums = (edge.querySelector('path')?.getAttribute('d') ?? '').match(/-?[\d.]+/g) ?? [];
    const pts: Point[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: Number(nums[i]), y: Number(nums[i + 1]) });
    }
    return pts;
  };
  /**
   * 区間 a → b の経路。構成にあれば線に沿って、なければ中心を結ぶ（点線で仮に描く）。
   * 逆にたどれるのは、応答（-->）か、向きのない線（--・<->）のとき（parseArch の判定と同じ）
   */
  const segment = (svg: Element, a: string, b: string, reply: boolean) => {
    const fwd = edgeOf(svg, a, b);
    if (fwd) return { pts: pointsOf(fwd), edge: fwd, temp: false };
    const back = edgeOf(svg, b, a);
    if (back && (reply || back.getAttribute('data-type') !== 'arrow')) {
      return { pts: pointsOf(back).reverse(), edge: back, temp: false };
    }
    const na = nodeOf(svg, a);
    const nb = nodeOf(svg, b);
    if (!na || !nb) return undefined;
    // 中心を結ぶ線を、それぞれの枠の外側から始めて終える
    const ra = boxOf(na);
    const rb = boxOf(nb);
    const ca = { x: ra.x + ra.width / 2, y: ra.y + ra.height / 2 };
    const cb = { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 };
    const exit = (c: Point, r: typeof ra, dx: number, dy: number): Point => {
      const t = Math.min(
        dx ? r.width / 2 / Math.abs(dx) : Infinity,
        dy ? r.height / 2 / Math.abs(dy) : Infinity,
      );
      return { x: c.x + dx * t, y: c.y + dy * t };
    };
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    return {
      pts: [exit(ca, ra, dx, dy), exit(cb, rb, -dx, -dy)],
      edge: undefined,
      temp: true,
    };
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
  /**
   * 障害と回復（#180）：バッジ・止めたノード・切ったつながり。ステップの動きを書いた順に当てはめる。
   * 切ったつながりは、両端の組（順は問わない）から、切ったときに先に書いた端（× を寄せる側）へ
   */
  type World = {
    badges: Map<string, { t: string; e: boolean }>;
    down: Set<string>;
    cuts: Map<string, string>;
  };
  const newWorld = (): World => ({ badges: new Map(), down: new Set(), cuts: new Map() });
  const pairKey = (a: string, b: string) => [a, b].sort().join('\u0000');
  const downText = /^ja\b/i.test(doc.documentElement.lang || 'ja') ? '停止' : 'Down';
  const apply = (world: World, a: State | Cut) => {
    if (isCut(a)) {
      const key = pairKey(a.k[0], a.k[1]);
      if (a.u) world.cuts.delete(key);
      else world.cuts.set(key, a.k[0]);
      return;
    }
    if (a.p === 'd') world.down.add(a.s);
    if (a.p === 'u') world.down.delete(a.s);
    const text = a.p === 'd' ? (a.t ?? downText) : a.t;
    if (text === null) world.badges.delete(a.s);
    else world.badges.set(a.s, { t: text, e: a.p === 'd' || (a.p !== 'u' && Boolean(a.e)) });
  };
  /** 区間 i が届かないか：`-x`、行き先が止まっている、つながりが切れている */
  const blockedAt = (world: World, a: Move, i: number) =>
    Boolean(a.b?.[i]) ||
    world.down.has(a.m[i + 1]!) ||
    world.cuts.has(pairKey(a.m[i]!, a.m[i + 1]!));
  /** 届かないパケットが止まる位置：行き先の少し手前 */
  const stopAt = (pts: Point[]) => {
    const len = lengthOf(pts);
    return Math.max(0, len - Math.min(44, len * 0.35)) / (len || 1);
  };
  const cross = (parent: Element, at: Point, label?: string) => {
    const g = make('g', { class: 'arch-cross', transform: `translate(${at.x} ${at.y})` }, parent);
    make('path', { d: 'M-8 -8L8 8M8 -8L-8 8' }, g);
    if (label) make('text', { y: 24 }, g).textContent = label;
    return g;
  };
  /** 止めたノード・切ったつながり・バッジを描き直す（.arch-fx の中の .arch-state） */
  const paint = (svg: SVGSVGElement, world: World) => {
    svg.querySelector('.arch-state')?.remove();
    const fx = svg.querySelector('.arch-fx') ?? make('g', { class: 'arch-fx' }, svg);
    const g = make('g', { class: 'arch-state' }, fx);
    for (const n of Array.from(svg.querySelectorAll<SVGElement>('.arch-node'))) {
      n.classList.toggle('is-down', world.down.has(n.dataset.node ?? ''));
    }
    for (const e of Array.from(svg.querySelectorAll<SVGElement>('.arch-edge'))) {
      const from = e.dataset.from ?? '';
      const to = e.dataset.to ?? '';
      const side = world.cuts.get(pairKey(from, to));
      e.classList.toggle('is-cut', side !== undefined);
      if (side === undefined) continue;
      const pts = side === from ? pointsOf(e) : pointsOf(e).reverse();
      // 番号の印（線の始め）とラベル（真ん中）を避けて、切った側から 3 分の 1 あたり
      const len = lengthOf(pts);
      cross(g, pointAt(pts, Math.min(Math.max(60, len * 0.35), len * 0.5)));
    }
    for (const [id, b] of world.badges) badge(g, svg, id, b.t, b.e);
  };

  /** 今のステップに関係するノードと線を強調し、ほかを薄くする */
  const highlight = (svg: Element, step: Action[] | undefined) => {
    const nodes = new Set<string>();
    const edges = new Set<Element>();
    for (const a of step ?? []) {
      if (isState(a)) {
        nodes.add(a.s);
        continue;
      }
      if (isCut(a)) {
        a.k.forEach((id) => nodes.add(id));
        const edge = edgeOf(svg, a.k[0], a.k[1]) ?? edgeOf(svg, a.k[1], a.k[0]);
        if (edge) edges.add(edge);
        continue;
      }
      a.m.forEach((id) => nodes.add(id));
      for (let i = 0; i + 1 < a.m.length; i++) {
        const seg = segment(svg, a.m[i]!, a.m[i + 1]!, Boolean(a.r[i]));
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
  /** 説明のリスト（同じスライドの中）：今のステップを強調し、まだのステップを薄くする。まとめではすべて同じ */
  const captions = (figure: HTMLElement, stage: number, summary = false) => {
    const list = figure.closest('.mds-slide')?.querySelector('.mds-arch-captions');
    Array.from(list?.children ?? []).forEach((li, i) => {
      li.classList.toggle('is-current', !summary && i === stage - 1);
      li.classList.toggle('is-future', !summary && i >= stage);
    });
  };

  /*
   * カメラ（#109、§6.2）：図を全体で見せたときにノードの文字が 14px より小さくなる図だけ、
   * ステップに関係するノードを囲む範囲へ寄る（viewBox を変える）。寄っている間は右下にミニマップ。
   */
  type Box = { x: number; y: number; width: number; height: number };
  const boxText = (b: Box) =>
    [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10).join(' ');
  const parseBox = (text: string | null): Box => {
    const [x = 0, y = 0, width = 0, height = 0] = (text ?? '').split(/[\s,]+/).map(Number);
    return { x, y, width, height };
  };
  /** 図の全体（最初の viewBox を覚えておく） */
  const fullOf = (svg: Element): Box => {
    if (!svg.hasAttribute('data-arch-full')) {
      svg.setAttribute('data-arch-full', svg.getAttribute('viewBox') ?? '0 0 0 0');
    }
    return parseBox(svg.getAttribute('data-arch-full'));
  };
  /**
   * 全体を見せたときのノードの文字の大きさ（スライドの px）。測れたら図に覚えておく
   * （発表者ビューや印刷の複製は、まだ描かれていないので測れない。属性ごと複製される）
   */
  const labelPx = (figure: HTMLElement, svg: SVGSVGElement): number | undefined => {
    if (figure.dataset.archLabel) return Number(figure.dataset.archLabel);
    const full = fullOf(svg);
    const w = svg.clientWidth;
    const h = svg.clientHeight;
    if (!w || !h || !full.width || !full.height) return undefined;
    const px = 20 * Math.min(w / full.width, h / full.height);
    figure.dataset.archLabel = px.toFixed(1);
    return px;
  };
  /** ステップで寄る範囲。寄らないなら undefined */
  const focusOf = (figure: HTMLElement, svg: SVGSVGElement, step: Action[] | undefined) => {
    const px = labelPx(figure, svg);
    if (!step || px === undefined || px >= 14 || figure.dataset.archFocus === 'none') return;
    const full = fullOf(svg);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const a of step) {
      for (const id of isState(a) ? [a.s] : isCut(a) ? a.k : a.m) {
        const node = nodeOf(svg, id);
        if (!node) continue;
        const b = boxOf(node);
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
      }
    }
    if (!Number.isFinite(x0)) return;
    // 周りに余白（バッジ・パケットのラベル）。縦横比は図のまま。寄りすぎない（文字は 26px まで）
    const pad = 48;
    const aspect = full.width / full.height;
    let width = Math.max(x1 - x0 + pad * 2, (y1 - y0 + pad * 2) * aspect, (full.width * px) / 26);
    if (width >= full.width * 0.92) return;
    width = Math.min(width, full.width);
    const height = width / aspect;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    return {
      x: clamp((x0 + x1) / 2 - width / 2, full.x, full.x + full.width - width),
      y: clamp((y0 + y1) / 2 - height / 2, full.y, full.y + full.height - height),
      width,
      height,
    };
  };
  /** ミニマップ（構成だけの複製と、今見ている範囲の枠）。view がなければ隠す */
  const minimap = (figure: HTMLElement, svg: SVGSVGElement, view: Box | undefined) => {
    figure.classList.toggle('is-zoomed', Boolean(view));
    let mini = figure.querySelector('svg.arch-minimap');
    if (!view) return;
    if (!mini) {
      mini = make('svg', { class: 'arch-minimap', viewBox: boxText(fullOf(svg)) });
      mini.setAttribute('aria-hidden', 'true');
      for (const child of Array.from(svg.children)) {
        if (!child.classList.contains('arch-fx')) mini.append(child.cloneNode(true));
      }
      for (const e of Array.from(mini.querySelectorAll('.is-active, .is-dim, .is-flash'))) {
        e.classList.remove('is-active', 'is-dim', 'is-flash');
      }
      make('rect', { class: 'arch-minimap-view' }, mini);
      svg.after(mini);
    }
    const rect = mini.querySelector('.arch-minimap-view')!;
    rect.setAttribute('x', String(view.x));
    rect.setAttribute('y', String(view.y));
    rect.setAttribute('width', String(view.width));
    rect.setAttribute('height', String(view.height));
  };
  const setView = (figure: HTMLElement, svg: SVGSVGElement, view: Box | undefined) => {
    svg.setAttribute('viewBox', boxText(view ?? fullOf(svg)));
    minimap(figure, svg, view);
  };
  /** 今の範囲から次の範囲へ、なめらかに動かす */
  const moveView = (figure: HTMLElement, svg: SVGSVGElement, to: Box | undefined, run: number) =>
    new Promise<void>((done) => {
      const from = parseBox(svg.getAttribute('viewBox'));
      const end = to ?? fullOf(svg);
      if (boxText(from) === boxText(end)) {
        setView(figure, svg, to);
        done();
        return;
      }
      const start = win.performance.now();
      const tick = (now: number) => {
        if (runs.get(figure) !== run) return done();
        const t = Math.min(1, (now - start) / 500);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const mid = {
          x: from.x + (end.x - from.x) * e,
          y: from.y + (end.y - from.y) * e,
          width: from.width + (end.width - from.width) * e,
          height: from.height + (end.height - from.height) * e,
        };
        if (t < 1) {
          svg.setAttribute('viewBox', boxText(mid));
          minimap(figure, svg, mid);
          win.requestAnimationFrame(tick);
        } else {
          setView(figure, svg, to);
          done();
        }
      };
      win.requestAnimationFrame(tick);
    });

  /**
   * 「段」個のステップが終わった状態を、動きなしで表示する。
   * summary（一覧・PDF の既定）では、通ったすべての経路に番号を付け、1つのステップを強調せず、
   * 説明をすべて同じに見せ、図の全体を見せる（まとめの1枚。#109）
   */
  const show = (figure: HTMLElement, stage: number, summary = false) => {
    runs.set(figure, (runs.get(figure) ?? 0) + 1); // 再生中なら止める
    const svg = figure.querySelector<SVGSVGElement>('svg.mds-arch-svg');
    if (!svg) return;
    svg.querySelector('.arch-fx')?.remove();
    const fx = make('g', { class: 'arch-fx' }, svg);
    const steps = stepsOf(figure);
    const done = Math.min(stage, steps.length);
    const world = newWorld();
    const used = new Map<Element | string, number>();
    for (let k = 0; k < done; k++) {
      // 構成にない経路と届かない移動の ×は、そのステップのあいだだけ描く（まとめではすべて）
      const now = summary || k === done - 1;
      for (const a of steps[k]!) {
        if (isState(a) || isCut(a)) {
          apply(world, a);
          continue;
        }
        for (let i = 0; i + 1 < a.m.length; i++) {
          const seg = segment(svg, a.m[i]!, a.m[i + 1]!, Boolean(a.r[i]));
          if (!seg) continue;
          if (seg.temp && now) make('path', { class: 'arch-temp', d: pathOf(seg.pts) }, fx);
          const key = seg.edge ?? `${a.m[i]}>${a.m[i + 1]}`;
          const nth = used.get(key) ?? 0;
          used.set(key, nth + 1);
          mark(fx, seg.pts, k + 1, nth);
          // 届かない区間（#180）：行き先の手前に ×。その先へは進まない
          if (blockedAt(world, a, i)) {
            if (now) cross(fx, pointAt(seg.pts, lengthOf(seg.pts) * stopAt(seg.pts)), a.l);
            break;
          }
        }
      }
    }
    paint(svg, world);
    const last = done > 0 && !summary ? steps[done - 1] : undefined;
    highlight(svg, last);
    captions(figure, done, summary);
    setView(figure, svg, focusOf(figure, svg, last));
  };

  const play = async (figure: HTMLElement, stage: number) => {
    const svg = figure.querySelector<SVGSVGElement>('svg.mds-arch-svg');
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
    // カメラ：このステップのノードへ寄ってから動かす
    await moveView(figure, svg, focusOf(figure, svg, step), run);
    if (runs.get(figure) !== run) return;
    const fx = svg.querySelector('.arch-fx')!;
    // 前のステップだけの印（構成にない経路の点線・届かない移動の ×）は消してから動かす
    for (const old of Array.from(
      fx.querySelectorAll(':scope > .arch-temp, :scope > .arch-cross'),
    )) {
      old.remove();
    }
    // このステップの初めの状態（止めたノード・切ったつながり・バッジ）から、書いた順に進める
    const world = newWorld();
    for (const before of stepsOf(figure).slice(0, stage - 1)) {
      for (const a of before) if (isState(a) || isCut(a)) apply(world, a);
    }
    for (const a of step) {
      if (isState(a) || isCut(a)) {
        apply(world, a);
        paint(svg, world);
        continue;
      }
      const times = a.x ?? 1;
      for (let rep = 0; rep < times; rep++) {
        for (let i = 0; i + 1 < a.m.length; i++) {
          const seg = segment(svg, a.m[i]!, a.m[i + 1]!, Boolean(a.r[i]));
          if (!seg) continue;
          if (seg.temp) make('path', { class: 'arch-temp', d: pathOf(seg.pts) }, fx);
          const blocked = blockedAt(world, a, i);
          const packet = make('g', { class: `arch-packet${a.r[i] ? ' is-reply' : ''}` }, fx);
          make('circle', { r: 9 }, packet);
          // 届かない移動のラベルは × の横に出し、パケットには回数（1/3）だけ付ける
          const label = blocked
            ? times > 1
              ? `${rep + 1}/${times}`
              : ''
            : `${a.l ?? ''}${times > 1 ? ` ×${times}` : ''}`.trim();
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
          const stop = blocked ? stopAt(seg.pts) : 1;
          const anim = packet.animate(
            [{ offsetDistance: '0%' }, { offsetDistance: `${stop * 100}%` }],
            { duration: 600 * Math.max(0.5, stop), easing: 'ease-in-out', fill: 'forwards' },
          );
          await anim.finished.catch(() => undefined);
          packet.remove();
          if (runs.get(figure) !== run) return;
          if (blocked) {
            // 届かない（#180）：手前で × とラベルを出して消える。その先へは進まない
            const failed = cross(fx, pointAt(seg.pts, lengthOf(seg.pts) * stop), a.l);
            await new Promise((done) => win.setTimeout(done, 450));
            failed.remove();
            if (runs.get(figure) !== run) return;
            break;
          }
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
      {
        show(el: HTMLElement, stage: number, summary?: boolean): void;
        play?(el: HTMLElement, stage: number): void;
      }
    >;
  };
  (host.mdsEmbeds ??= {}).arch = {
    show,
    play: (figure, stage) => void play(figure, stage),
  };
  // 文字の大きさは、描かれているうちに測っておく（複製に属性ごと引き継ぐ）
  for (const figure of Array.from(doc.querySelectorAll<HTMLElement>('[data-embed="arch"]'))) {
    const svg = figure.querySelector<SVGSVGElement>('svg.mds-arch-svg');
    if (svg) labelPx(figure, svg);
  }
}
