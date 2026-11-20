/*
 * #149 の試作の共通部分。書き出した資料（deck.html）のページに入れて使う（run.mjs が入れる）。
 *
 * 試作は、図の上に描く1本の時間軸（ミリ秒）として作る。動きはすべて Web Animations API で、
 * 一時停止したまま作り、seek(t) でその時刻の様子にする（スクリーンショットを毎回同じにするため）。
 * ノードの強調（is-active・is-dim）と説明のリストは、ステップの区切りで切り替える。
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const style = document.createElement('style');
  style.textContent = `
    .mds-arch-svg *, .mds-arch-captions li { transition: none !important; }
    .proto-fx text { text-anchor: middle; dominant-baseline: central; }
    .p-packet circle { fill: var(--mds-accent); stroke: var(--mds-bg); stroke-width: 3; }
    .p-packet.is-reply circle { fill: var(--mds-bg); stroke: var(--mds-accent); stroke-width: 3; stroke-dasharray: 4 3; }
    .p-packet.is-b circle { fill: #ea580c; }
    .p-packet.is-b.is-reply circle { fill: var(--mds-bg); stroke: #ea580c; }
    .p-chip.is-b rect { fill: #ffedd5; stroke: #ea580c; }
    .p-lane { fill: color-mix(in srgb, var(--mds-surface) 70%, var(--mds-bg)); }
    .p-lane-label { fill: var(--mds-fg); font-size: 15px; font-weight: 700; }
    .p-packet.is-error circle { fill: #dc2626; }
    .p-packet.is-ok circle { fill: #16a34a; }
    .p-label { fill: var(--mds-fg); font-size: 15px; font-weight: 700; paint-order: stroke; stroke: var(--mds-bg); stroke-width: 5px; }
    .p-small { fill: var(--mds-muted); font-size: 14px; font-weight: 600; }
    .p-panel { fill: var(--mds-bg); stroke: var(--mds-border); stroke-width: 1.5; }
    .p-chip rect { fill: color-mix(in srgb, var(--mds-accent) 14%, var(--mds-bg)); stroke: var(--mds-accent); stroke-width: 1.5; }
    .p-chip text { fill: var(--mds-fg); font-size: 14px; font-weight: 700; }
    .p-chip.is-error rect { fill: #fee2e2; stroke: #dc2626; }
    .p-slot { fill: none; stroke: var(--mds-border); stroke-width: 1.5; stroke-dasharray: 4 3; }
    .p-badge rect { fill: #16a34a; }
    .p-badge.is-error rect { fill: #dc2626; }
    .p-badge.is-warn rect { fill: #d97706; }
    .p-badge text { fill: #fff; font-size: 13px; font-weight: 700; }
    .p-cross { stroke: #dc2626; stroke-width: 5; stroke-linecap: round; fill: none; }
    .p-dead .shape { fill: color-mix(in srgb, var(--mds-muted) 18%, var(--mds-bg)) !important; stroke: var(--mds-muted) !important; }
    .p-dead text { fill: var(--mds-muted) !important; }
    .p-hot .shape { fill: #fee2e2 !important; stroke: #dc2626 !important; }
    .arch-edge.p-cut path { stroke: #dc2626 !important; stroke-dasharray: 9 7; opacity: 0.7; }
    .arch-edge.p-cut .arch-head { fill: #dc2626 !important; opacity: 0.7; }
    .p-note { fill: #dc2626; font-size: 14px; font-weight: 700; paint-order: stroke; stroke: var(--mds-bg); stroke-width: 5px; }
    .p-note.is-muted { fill: var(--mds-muted); }
    .p-note.is-ok { fill: #16a34a; }
  `;
  document.head.append(style);

  const P = {};
  window.P = P;
  let svg;
  let slide;
  let fx;
  const anims = [];
  let steps = [];

  P.make = (name, attrs = {}, parent = fx) => {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    parent?.append(el);
    return el;
  };
  P.text = (parent, x, y, str, cls = 'p-label', attrs = {}) => {
    const t = P.make('text', { x, y, ...(cls ? { class: cls } : {}), ...attrs }, parent);
    t.textContent = str;
    return t;
  };

  /** n 枚目のスライドの図を使う */
  P.mount = (n) => {
    slide = document.querySelectorAll('.mds-deck > .mds-slide')[n - 1];
    svg = slide.querySelector('svg.mds-arch-svg');
    fx = P.make('g', { class: 'proto-fx' }, svg);
    P.svg = svg;
    P.slide = slide;
    P.fx = fx;
    return svg;
  };
  P.node = (id) => svg.querySelector(`.arch-node[data-node="${id}"]`);
  P.box = (id, from = svg) => {
    const n = from.querySelector(`.arch-node[data-node="${id}"]`);
    const [x, y, w, h] = n.getAttribute('data-box').split(' ').map(Number);
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
  };
  P.edge = (a, b) => svg.querySelector(`.arch-edge[data-from="${a}"][data-to="${b}"]`);
  P.ptsOf = (edge) => {
    const nums = edge
      .querySelector('path')
      .getAttribute('d')
      .match(/-?[\d.]+/g)
      .map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    return pts;
  };
  /** 区間 a → b の経路（線がなければ、逆向きの線をたどる） */
  P.pts = (a, b) => {
    const fwd = P.edge(a, b);
    if (fwd) return P.ptsOf(fwd);
    const back = P.edge(b, a);
    if (back) return P.ptsOf(back).reverse();
    throw new Error(`経路がない：${a} → ${b}`);
  };
  P.d = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  P.len = (pts) =>
    pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  /** 折れ線の始めから割合 f の位置 */
  P.at = (pts, f) => {
    let dist = P.len(pts) * f;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist <= l || i + 2 === pts.length) {
        const t = l ? Math.min(1, dist / l) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      dist -= l;
    }
    return pts.at(-1);
  };

  P.viewBox = (vb) => {
    if (vb) svg.setAttribute('viewBox', vb.join(' '));
    return svg.getAttribute('viewBox').split(/\s+/).map(Number);
  };
  /** 図のまわりに場所を足す（状態の表などを置くため）。図の枠の縦横比（--mds-ar）も合わせる */
  P.extend = ({ top = 0, right = 0, bottom = 0, left = 0 }) => {
    const [x, y, w, h] = P.viewBox();
    P.viewBox([x - left, y - top, w + left + right, h + top + bottom]);
    svg.parentElement.style.setProperty(
      '--mds-ar',
      String((w + left + right) / (h + top + bottom)),
    );
  };

  /**
   * 時刻の決まった値の変化を、1つの動きにする（同じ要素・同じ性質の動きを2つ作ると、
   * 後の動きの「始まる前の値」が前の動きを上書きするため）。
   * list は [時刻, 値, 次までの easing?] の並び。最初の時刻より前は最初の値、最後より後は最後の値
   */
  P.keys = (el, list) => {
    // 時刻は前より小さくしない（短い区間に溶かしを詰めたときなど）
    let last = 0;
    const sorted = list.map(([t, value, easing]) => {
      last = Math.max(last, t);
      return [last, value, easing];
    });
    const T = Math.max(1, last);
    const frames = [];
    if (sorted[0][0] > 0) frames.push({ ...sorted[0][1], offset: 0 });
    for (const [t, value, easing] of sorted) {
      frames.push({ ...value, offset: Math.min(1, t / T), ...(easing ? { easing } : {}) });
    }
    const a = el.animate(frames, { duration: T, fill: 'both' });
    a.pause();
    a.currentTime = 0;
    anims.push(a);
    return a;
  };

  /** 一時停止した動きを作る。at から dur ミリ秒（くり返す動きに使う） */
  P.anim = (el, keyframes, opts = {}) => {
    const { at = 0, dur = 300, easing = 'linear', iterations = 1, iterationStart = 0 } = opts;
    const a = el.animate(keyframes, {
      delay: at,
      duration: dur,
      easing,
      fill: 'both',
      iterations,
      iterationStart,
    });
    a.pause();
    a.currentTime = 0;
    anims.push(a);
    return a;
  };
  /** t1 から t2 のあいだだけ見せる（前後は短く溶かす） */
  P.during = (el, t1, t2 = Infinity, fadeIn = 200, fadeOut = fadeIn) => {
    const list =
      t1 > 0
        ? [
            [t1, { opacity: 0 }],
            [t1 + fadeIn, { opacity: 1 }],
          ]
        : [[0, { opacity: 1 }]];
    if (t2 !== Infinity) list.push([t2 - fadeOut, { opacity: 1 }], [t2, { opacity: 0 }]);
    P.keys(el, list);
    return el;
  };

  /**
   * パケット：経路 pts に沿って at から dur で動く。
   * stop（0〜1）で途中で止めて消える（届かない）。keep なら着いたあとも残す
   */
  P.packet = (pts, opts = {}) => {
    const { at = 0, dur = 600, cls = '', label, stop = 1, keep = false, r = 9, hold = 0 } = opts;
    const g = P.make('g', { class: `p-packet ${cls}` }, opts.parent ?? fx);
    P.make('circle', { r }, g);
    if (label) P.text(g, 0, opts.labelY ?? -21, label);
    g.style.offsetPath = `path('${P.d(pts)}')`;
    g.style.offsetRotate = '0deg';
    P.keys(g, [
      [at, { offsetDistance: '0%' }, 'ease-in-out'],
      [at + dur, { offsetDistance: `${stop * 100}%` }],
    ]);
    P.during(g, at, keep ? Infinity : at + dur + hold + 150, 1, 150);
    return g;
  };
  /** ノードの列 ids を順にたどる。1区間 seg ミリ秒。終わる時刻を返す */
  P.route = (ids, opts = {}) => {
    const { at = 0, seg = 600, ...rest } = opts;
    let t = at;
    for (let i = 0; i + 1 < ids.length; i++) {
      P.packet(P.pts(ids[i], ids[i + 1]), { ...rest, at: t, dur: seg });
      P.flash(ids[i + 1], t + seg);
      t += seg;
    }
    return t;
  };
  /** 着いたノードを光らせる */
  P.flash = (id, at, color = 'var(--mds-accent)') => {
    const b = P.box(id);
    const ring = P.make('rect', {
      x: b.x - 4,
      y: b.y - 4,
      width: b.w + 8,
      height: b.h + 8,
      rx: 14,
      fill: 'none',
      stroke: color,
      'stroke-width': 4,
    });
    P.keys(ring, [
      [at, { opacity: 0 }],
      [at + 1, { opacity: 0.9 }],
      [at + 400, { opacity: 0 }],
    ]);
  };
  /** ノードの右上のバッジ（今の arch と同じ形） */
  P.badge = (id, label, { at = 0, until = Infinity, kind = '' } = {}) => {
    const b = P.box(id);
    const g = P.make('g', { class: `p-badge${kind ? ` is-${kind}` : ''}` });
    const rect = P.make('rect', { height: 22, rx: 11 }, g);
    const t = P.text(g, 0, 11, label, '');
    const w = Math.max(44, t.getComputedTextLength() + 18);
    rect.setAttribute('width', w);
    t.setAttribute('x', w / 2);
    g.setAttribute('transform', `translate(${b.r - w + 8} ${b.y - 14})`);
    P.during(g, at, until);
    return g;
  };
  /** 角丸の札（チップ）。左上 x, y */
  P.chip = (parent, x, y, label, { cls = '', h = 26, minW = 0 } = {}) => {
    const g = P.make('g', { class: `p-chip ${cls}`, transform: `translate(${x} ${y})` }, parent);
    const rect = P.make('rect', { height: h, rx: 6 }, g);
    const t = P.text(g, 0, h / 2, label, '');
    const w = Math.max(minW, t.getComputedTextLength() + 16);
    rect.setAttribute('width', w);
    t.setAttribute('x', w / 2);
    g.width = w;
    return g;
  };

  /** ステップの区切り：{ start, end, nodes, edges }（強調するノードと線） */
  P.steps = (list) => {
    steps = list;
  };
  const mark = (s) => {
    const step = steps[s - 1];
    const on = Boolean(step && (step.nodes || step.edges));
    const nodes = new Set(step?.nodes ?? []);
    const edges = new Set((step?.edges ?? []).map(([a, b]) => P.edge(a, b) ?? P.edge(b, a)));
    for (const n of svg.querySelectorAll('.arch-node')) {
      n.classList.toggle('is-active', on && nodes.has(n.dataset.node));
      n.classList.toggle('is-dim', on && !nodes.has(n.dataset.node));
    }
    for (const e of svg.querySelectorAll('.arch-edge')) {
      e.classList.toggle('is-active', on && edges.has(e));
      e.classList.toggle('is-dim', on && !edges.has(e));
    }
    const list = slide.querySelector('.mds-arch-captions');
    Array.from(list?.children ?? []).forEach((li, i) => {
      li.classList.toggle('is-current', i === s - 1);
      li.classList.toggle('is-future', i >= s);
    });
  };
  /** 時刻 t の様子にする */
  P.seek = (t) => {
    let s = 0;
    steps.forEach((step, i) => {
      if (t >= step.start) s = i + 1;
    });
    mark(s);
    for (const a of anims) a.currentTime = t;
    P.onSeek?.(t, s);
  };
  P.end = () => steps.at(-1)?.end ?? 0;
})();
