// 案7 量を見せる：流量（件/秒）で線の太さと流れる粒の数を変え、DB の負荷（容量に対する割合）を出す。
// 記法では入口の流量と振り分けの割合だけを書き、先の線と DB の負荷は計算する案
window.PROTO = {
  slide: 7,
  setup(P) {
    P.mount(7);
    const S = [
      [0, 4000],
      [4000, 8500],
      [8500, 13000],
    ];
    const CAP = 1200;
    // ステップごとの流量
    const rates = {
      'user>lb': [200, 3000, 3000],
      'lb>web1': [100, 1500, 1500],
      'lb>web2': [100, 1500, 1500],
      'web1>db': [100, 1500, 300],
      'web2>db': [100, 1500, 300],
      'web1>cache': [0, 0, 1200],
      'web2>cache': [0, 0, 1200],
    };
    const width = (r) => 2 + (r / 3000) * 14;
    const fmt = (n) => `${n.toLocaleString('en-US')}/秒`;
    const dbLoad = [0, 1, 2].map((k) => rates['web1>db'][k] + rates['web2>db'][k]);

    for (const [key, list] of Object.entries(rates)) {
      const [a, b] = key.split('>');
      const edge = P.edge(a, b);
      const pts = P.ptsOf(edge);
      const path = edge.querySelector('path');
      const hot = (k) => b === 'db' && dbLoad[k] > CAP;
      // 線の太さと色：ステップの初めに 0.6 秒で変える
      const frames = [];
      list.forEach((r, k) => {
        const style = {
          strokeWidth: String(width(r)),
          stroke: hot(k) ? '#dc2626' : r > 0 ? 'var(--mds-accent)' : 'var(--mds-border)',
        };
        if (k > 0) frames.push([S[k][0], frames.at(-1)[1], 'ease-in-out']);
        frames.push([S[k][0] + 600, style]);
      });
      P.keys(path, frames);
      edge.querySelectorAll('.arch-head').forEach((h) => (h.style.fill = 'var(--mds-muted)'));
      // 流れる粒：流量に比例した数を、ずらして回す
      list.forEach((r, k) => {
        if (r === 0) return;
        const n = Math.max(1, Math.min(10, Math.round(r / 150)));
        for (let i = 0; i < n; i++) {
          const dot = P.make('circle', { r: 3.5 + width(r) * 0.18, class: 'p-dot' });
          dot.setAttribute('fill', hot(k) ? '#dc2626' : 'var(--mds-accent)');
          dot.style.offsetPath = `path('${P.d(pts)}')`;
          dot.style.offsetRotate = '0deg';
          P.anim(dot, [{ offsetDistance: '0%' }, { offsetDistance: '100%' }], {
            dur: 1400,
            iterations: Infinity,
            iterationStart: i / n,
          });
          P.during(dot, S[k][0] + 300, S[k][1], 300);
        }
      });
      // 流量の数字（入口だけ。DB は下に合計を出す）
      if (a === 'user') {
        const at = P.at(pts, 0.5);
        list.forEach((r, k) => {
          if (r === 0) return;
          const label = P.text(
            P.fx,
            at.x,
            at.y - width(r) / 2 - 12,
            fmt(r),
            hot(k) ? 'p-note' : 'p-label',
          );
          P.during(label, S[k][0] + 300, S[k][1], 300);
        });
      }
    }

    // DB の負荷のゲージ（容量 1,200/秒 に対する割合）
    const db = P.box('db');
    const gx = db.cx - 60;
    const gy = db.b + 14;
    P.make('rect', { x: gx, y: gy, width: 120, height: 12, rx: 6, fill: 'var(--mds-border)' });
    const bar = P.make('rect', { x: gx, y: gy, width: 120, height: 12, rx: 6 });
    bar.style.transformBox = 'fill-box';
    bar.style.transformOrigin = 'left center';
    const frames = [];
    dbLoad.forEach((load, k) => {
      const v = Math.min(1, load / CAP);
      const style = { transform: `scaleX(${v})`, fill: load > CAP ? '#dc2626' : '#16a34a' };
      if (k > 0) frames.push([S[k][0], frames.at(-1)[1], 'ease-in-out']);
      frames.push([S[k][0] + 600, style]);
      const pct = P.text(
        P.fx,
        db.cx,
        gy + 30,
        `${fmt(load)}・負荷 ${Math.round((load / CAP) * 100)}%`,
        load > CAP ? 'p-note' : 'p-small',
      );
      P.during(pct, S[k][0] + 300, S[k][1], 300);
    });
    P.keys(bar, frames);
    P.badge('db', 'あふれる', { at: S[1][0] + 600, until: S[1][1], kind: 'error' });
    P.badge('cache', 'ヒット 80%', { at: S[2][0] + 600 });
    P.onSeek = (t) => {
      P.node('db').classList.toggle('p-hot', t >= S[1][0] + 600 && t < S[1][1]);
    };

    P.steps(S.map(([start, end]) => ({ start, end })));
    return { keys: [2500, 4400, 7000, 11500] };
  },
};
