// 案6 中に入る：ノード（api）に寄ると、そのノードが広がって中の構成が見える。中でもパケットが流れる。
// 中の構成は試作用のスライド（9枚目）の図を複製する（記法では、ノードの下に字下げして書く案）
window.PROTO = {
  slide: 6,
  setup(P) {
    P.mount(6);
    const inner = document
      .querySelectorAll('.mds-deck > .mds-slide')[8]
      .querySelector('svg.mds-arch-svg');
    P.extend({ top: 24, bottom: 24 });
    const V0 = P.viewBox();
    const [, , vw, vh] = V0;
    const A = P.box('api');
    const [ix, iy, iw, ih] = inner.getAttribute('viewBox').split(/\s+/).map(Number);

    // 寄った先の範囲と、広がったノードの枠
    const H1 = vh * 0.62;
    const W1 = H1 * (vw / vh);
    const V1 = [A.cx - W1 / 2, A.cy - H1 / 2, W1, H1];
    const panel = { x: V1[0] + W1 * 0.03, y: V1[1] + H1 * 0.05, w: W1 * 0.94, h: H1 * 0.9 };
    const titleH = panel.h * 0.16;
    const s = Math.min((panel.w * 0.96) / iw, (panel.h - titleH) / ih);
    const inX = panel.x + (panel.w - iw * s) / 2 - ix * s;
    const inY = panel.y + titleH + (panel.h - titleH - ih * s) / 2 - iy * s;

    const box = P.make('rect', {
      rx: 12,
      fill: 'var(--mds-bg)',
      stroke: 'var(--mds-accent)',
      'stroke-width': 2.5,
    });
    const title = P.text(
      P.fx,
      panel.x + 16 * (W1 / vw),
      panel.y + titleH / 2,
      '注文API の中',
      'p-lane-label',
      {
        style: `text-anchor: start; font-size: ${20 * (W1 / vw)}px`,
      },
    );
    const content = P.make('g', { transform: `translate(${inX} ${inY}) scale(${s})` });
    for (const el of inner.querySelectorAll('.arch-edge, .arch-edge-label, .arch-node')) {
      content.append(el.cloneNode(true));
    }

    const Z = [2800, 4300, 8800, 10000];
    const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    const progress = (t) => {
      if (t <= Z[0] || t >= Z[3]) return 0;
      if (t < Z[1]) return ease((t - Z[0]) / (Z[1] - Z[0]));
      if (t <= Z[2]) return 1;
      return 1 - ease((t - Z[2]) / (Z[3] - Z[2]));
    };
    const lerp = (a, b, u) => a + (b - a) * u;
    P.onSeek = (t) => {
      const u = progress(t);
      P.viewBox(V0.map((v, i) => lerp(v, V1[i], u)));
      // 今のカメラ（#109）と同じく、寄っている間は図の枠で切る
      P.svg.style.overflow = u > 0 ? 'hidden' : '';
      box.setAttribute('x', lerp(A.x, panel.x, u));
      box.setAttribute('y', lerp(A.y, panel.y, u));
      box.setAttribute('width', lerp(A.w, panel.w, u));
      box.setAttribute('height', lerp(A.h, panel.h, u));
      box.style.opacity = u > 0 ? '1' : '0';
      const show = Math.max(0, (u - 0.75) / 0.25);
      title.style.opacity = String(show);
      content.style.opacity = String(show);
    };

    // 1. 注文が API に届く
    P.route(['user', 'web', 'api'], { at: 300, seg: 600, label: 'POST /orders' });
    // 3. 中で、認証してから注文を保存する
    const innerPts = (a, b) =>
      P.ptsOf(content.querySelector(`.arch-edge[data-from="${a}"][data-to="${b}"]`));
    const go = (a, b, at, opts = {}) =>
      P.packet(opts.reply ? innerPts(b, a).reverse() : innerPts(a, b), {
        at,
        dur: 600,
        parent: content,
        cls: opts.reply ? 'is-reply' : '',
        label: opts.label,
      });
    go('router', 'auth', 5200, { label: 'トークン' });
    go('auth', 'router', 5900, { reply: true, label: 'OK' });
    go('router', 'handler', 6600);
    go('handler', 'repo', 7200, { label: '注文' });
    go('handler', 'pub', 7200, { label: 'イベント' });
    // 4. 外に戻って、DB とキューへ
    P.packet(P.pts('api', 'db'), { at: 10200, dur: 600, label: 'INSERT' });
    P.packet(P.pts('api', 'queue'), { at: 10200, dur: 600, label: '通知' });
    P.flash('db', 10800);
    P.flash('queue', 10800);

    P.steps([
      {
        start: 0,
        end: 2600,
        nodes: ['user', 'web', 'api'],
        edges: [
          ['user', 'web'],
          ['web', 'api'],
        ],
      },
      { start: 2600, end: 5000 },
      { start: 5000, end: 8600 },
      {
        start: 8600,
        end: 11800,
        nodes: ['api', 'db', 'queue'],
        edges: [
          ['api', 'db'],
          ['api', 'queue'],
        ],
      },
    ]);
    return { keys: [1300, 3600, 7500, 10500] };
  },
};
