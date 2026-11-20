// 案5 同じシナリオを2つの見方で：今の arch のシナリオ（data-arch-steps）から、
// シーケンス図を作って右に置き、左の構成図と同時に進める。記法は足さない（{view=both} だけ）
window.PROTO = {
  slide: 5,
  setup(P) {
    P.mount(5);
    const steps = JSON.parse(P.slide.querySelector('[data-arch-steps]').dataset.archSteps);
    const [vx, vy, vw, vh] = P.viewBox();
    const GAP = 70;
    const COL = 128;
    // 登場する順に、縦の線（ライフライン）を並べる
    const who = [];
    for (const step of steps) {
      for (const a of step) for (const id of a.m ?? []) if (!who.includes(id)) who.push(id);
    }
    const x0 = vx + vw + GAP;
    const colX = (id) => x0 + COL / 2 + who.indexOf(id) * COL;
    P.extend({ right: GAP + who.length * COL });

    // 区間（矢印）を順に並べる
    const SEG = 600;
    const rows = [];
    const bounds = [];
    let t = 400;
    steps.forEach((step, k) => {
      const start = t - 400;
      for (const a of step) {
        if (!a.m) continue;
        for (let i = 0; i + 1 < a.m.length; i++) {
          rows.push({ k, from: a.m[i], to: a.m[i + 1], reply: a.r[i], label: a.l, at: t });
          t += SEG;
        }
        t += 150;
      }
      t += 1300;
      bounds.push({ start, end: t - 400 });
    });
    const HEAD = 52;
    const rowH = Math.min(44, (vh - HEAD - 30) / rows.length);
    const rowY = (i) => vy + HEAD + 28 + i * rowH;

    // ライフラインと名前の箱
    for (const id of who) {
      const label = P.node(id).querySelector('text').textContent;
      P.make('path', {
        d: `M${colX(id)} ${vy + HEAD}V${vy + vh}`,
        stroke: 'var(--mds-border)',
        'stroke-width': 2,
        'stroke-dasharray': '5 5',
      });
      P.make('rect', {
        x: colX(id) - 56,
        y: vy + 4,
        width: 112,
        height: HEAD - 12,
        rx: 8,
        class: 'p-panel',
      });
      P.text(P.fx, colX(id), vy + 4 + (HEAD - 12) / 2, label, 'p-lane-label');
    }
    // ステップごとのまとまり（終わったステップは薄くする）
    const groups = steps.map(() => P.make('g'));
    P.onSeek = (time, s) => {
      groups.forEach((g, k) => {
        g.style.opacity = k + 1 < s ? '0.4' : '1';
      });
    };
    let lastStep = -1;
    rows.forEach((row, i) => {
      const g = groups[row.k];
      const y = rowY(i);
      const xa = colX(row.from);
      const xb = colX(row.to);
      const dir = Math.sign(xb - xa);
      if (row.k !== lastStep) {
        lastStep = row.k;
        const mark = P.make('g', { transform: `translate(${x0 - 4} ${y})` }, g);
        P.make('circle', { r: 12, fill: 'var(--mds-accent)' }, mark);
        P.text(mark, 0, 0, String(row.k + 1), '', {
          fill: 'var(--mds-bg)',
          'font-size': 14,
          'font-weight': 700,
        });
        P.during(mark, row.at, Infinity, 150);
      }
      // 矢印：送りは実線で伸ばし、応答は破線で出す
      const line = P.make(
        'path',
        {
          d: `M${xa} ${y}H${xb - dir * 10}`,
          stroke: 'var(--mds-accent)',
          'stroke-width': 2.5,
          fill: 'none',
          ...(row.reply ? { 'stroke-dasharray': '6 5' } : {}),
        },
        g,
      );
      const len = Math.abs(xb - xa);
      if (row.reply) {
        P.during(line, row.at, Infinity, SEG);
      } else {
        line.style.strokeDasharray = `${len}`;
        P.keys(line, [
          [row.at, { strokeDashoffset: `${len}` }, 'ease-in-out'],
          [row.at + SEG, { strokeDashoffset: '0' }],
        ]);
      }
      const head = P.make(
        'path',
        { d: `M${xb} ${y}l${-dir * 11} -6v12z`, fill: 'var(--mds-accent)' },
        g,
      );
      P.during(head, row.at + SEG - 100, Infinity, 100);
      if (row.label) {
        const label = P.text(g, (xa + xb) / 2, y - 13, row.label, 'p-small');
        P.during(label, row.at, Infinity, SEG);
      }
      // 左の構成図のパケットと、同じ時刻に動く
      P.packet(P.pts(row.from, row.to), {
        at: row.at,
        dur: SEG,
        cls: row.reply ? 'is-reply' : '',
        label: i === 0 || rows[i - 1].label !== row.label ? row.label : '',
      });
      P.flash(row.to, row.at + SEG);
      P.packet(
        [
          { x: xa, y },
          { x: xb, y },
        ],
        { at: row.at, dur: SEG, r: 7, cls: row.reply ? 'is-reply' : '' },
      );
    });
    for (const [k, step] of steps.entries()) {
      for (const a of step)
        if (a.s) P.badge(a.s, a.t, { at: bounds[k].start + 1500, kind: a.e ? 'error' : '' });
    }

    P.steps(
      bounds.map((b, k) => {
        const nodes = new Set();
        const edges = [];
        for (const row of rows.filter((r) => r.k === k)) {
          nodes.add(row.from);
          nodes.add(row.to);
          edges.push([row.from, row.to]);
        }
        return { ...b, nodes: [...nodes], edges };
      }),
    );
    const mid = (k) => rows.filter((r) => r.k === k).at(-1).at + 300;
    return { keys: [mid(0), mid(1), mid(2), mid(3)] };
  },
};
