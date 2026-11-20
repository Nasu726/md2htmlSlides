// 案3 構成の変化：2つの構成（変化の前・後）のあいだを、動きでつなぐ。
// 同じ ID のノード（user・db）は位置を動かし、app は order・pay・stock に分かれる（`< app`）
window.PROTO = {
  slide: 3,
  setup(P) {
    const after = P.mount(3);
    const before = document
      .querySelectorAll('.mds-deck > .mds-slide')[7]
      .querySelector('svg.mds-arch-svg');
    const [ax, ay, aw, ah] = P.viewBox();
    const [bx, by, bw, bh] = before.getAttribute('viewBox').split(/\s+/).map(Number);
    // 変化の前の図を、後の図の真ん中に置く
    const ox = ax + aw / 2 - (bx + bw / 2);
    const oy = ay + ah / 2 - (by + bh / 2);
    const was = (id) => {
      const b = P.box(id, before);
      return { ...b, cx: b.cx + ox, cy: b.cy + oy };
    };
    const M0 = 3300;
    const M1 = 5300;
    const translate = (dx, dy, s = 1) => ({
      transform: `translate(${dx}px, ${dy}px) scale(${s})`,
    });

    // 変化の前だけにあるもの（app と、前のつながり）を複製して重ねる
    const old = P.make('g', { transform: `translate(${ox} ${oy})` });
    P.fx.before(old);
    for (const el of before.querySelectorAll('.arch-edge, .arch-node[data-node="app"]')) {
      old.append(el.cloneNode(true));
    }
    const oldApp = old.querySelector('.arch-node');
    P.during(oldApp, 0, M0 + 1300, 0, 1200);
    for (const e of old.querySelectorAll('.arch-edge')) P.during(e, 0, M0 + 300, 0, 300);

    // 両方にあるノード：前の位置から後の位置へ動く
    for (const id of ['user', 'db']) {
      const node = P.node(id);
      node.style.transformBox = 'fill-box';
      node.style.transformOrigin = 'center';
      const now = P.box(id);
      const from = was(id);
      P.keys(node, [
        [M0, translate(from.cx - now.cx, from.cy - now.cy), 'ease-in-out'],
        [M1, translate(0, 0)],
      ]);
    }
    // app から分かれるノード：app の位置から、小さく出て広がる
    const app = was('app');
    ['stock', 'pay', 'order'].forEach((id, i) => {
      const node = P.node(id);
      node.style.transformBox = 'fill-box';
      node.style.transformOrigin = 'center';
      const now = P.box(id);
      const t0 = M0 + 100;
      const fan = (i - 1) * 26;
      P.keys(node, [
        [t0, translate(app.cx - now.cx + fan * 2, app.cy - now.cy + fan, 0.6), 'ease-in-out'],
        [M1, translate(0, 0)],
      ]);
      P.during(node, t0, Infinity, 500);
    });
    // 新しく出てくるもの：ゲートウェイ、グループ、後のつながり
    const gw = P.node('gw');
    gw.style.transformBox = 'fill-box';
    gw.style.transformOrigin = 'center';
    P.keys(gw, [
      [M0 + 900, { transform: 'scale(0.6)' }, 'ease-out'],
      [M1, { transform: 'scale(1)' }],
    ]);
    P.during(gw, M0 + 900, Infinity, 500);
    for (const el of after.querySelectorAll('.arch-group, .arch-group-label')) {
      P.during(el, M0 + 1000, Infinity, 700);
    }
    for (const el of after.querySelectorAll('.arch-edge, .arch-edge-label')) {
      if (el.closest('.proto-fx') || old.contains(el)) continue;
      P.during(el, M1 - 300, Infinity, 600);
    }

    // 1. 今の構成：1つのアプリが全部を受け持つ
    const oldPts = (from, to) =>
      P.ptsOf(old.querySelector(`.arch-edge[data-from="${from}"][data-to="${to}"]`)).map((p) => ({
        x: p.x + ox,
        y: p.y + oy,
      }));
    P.packet(oldPts('user', 'app'), { at: 400, dur: 600, label: '注文' });
    P.packet(oldPts('app', 'db'), { at: 1000, dur: 600 });
    // 3. 注文は、注文サービスだけを通る
    P.route(['user', 'gw', 'order', 'db'], { at: 6700, seg: 600, label: '注文' });

    P.steps([
      { start: 0, end: 3000 },
      { start: 3000, end: 6400 },
      {
        start: 6400,
        end: 9600,
        nodes: ['user', 'gw', 'order', 'db'],
        edges: [
          ['user', 'gw'],
          ['gw', 'order'],
          ['order', 'db'],
        ],
      },
    ]);
    return { keys: [1300, 4300, 5900, 7900] };
  },
};
