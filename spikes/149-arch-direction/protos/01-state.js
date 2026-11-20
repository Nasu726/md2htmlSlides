// 案1 状態を持つノード：キューの中身（ジョブ）と件数が、ステップごとに変わる
window.PROTO = {
  slide: 1,
  setup(P) {
    P.mount(1);
    const q = P.box('queue');
    P.extend({ bottom: 110 });

    // キューの中身の表：枠5つ。件数は「3 / 5」
    const SLOT = 34;
    const GAP = 5;
    const N = 5;
    const pw = N * SLOT + (N - 1) * GAP + 20;
    const px = q.cx - pw / 2;
    const py = q.b + 22;
    P.make('path', { d: `M${q.cx} ${q.b + 2}V${py}`, class: 'p-slot' });
    P.make('rect', { x: px, y: py, width: pw, height: 74, rx: 10, class: 'p-panel' });
    const full = P.make('rect', {
      x: px,
      y: py,
      width: pw,
      height: 74,
      rx: 10,
      fill: '#fef2f2',
      stroke: '#dc2626',
      'stroke-width': 2.5,
    });
    const slotX = (i) => px + 10 + i * (SLOT + GAP);
    const slotY = py + 36;
    for (let i = 0; i < N; i++) {
      P.make('rect', { x: slotX(i), y: slotY, width: SLOT, height: 28, rx: 6, class: 'p-slot' });
    }
    // 件数：時刻ごとに文字を差し替える
    const counts = [
      [0, 0],
      [1200, 1],
      [1550, 2],
      [1900, 3],
      [3300, 2],
      [7000, 3],
      [7300, 4],
      [7600, 5],
    ];
    counts.forEach(([t, c], i) => {
      const next = counts[i + 1]?.[0] ?? Infinity;
      const label = P.text(P.fx, q.cx, py + 18, `${c} / ${N} 件`, 'p-small');
      if (c === N) label.setAttribute('fill', '#dc2626');
      P.during(label, t, next, 1);
    });
    P.during(full, 7600);

    // ジョブの札：届いたら空いている枠に入り、取り出されたら左に詰める
    const job = (k, slot, at, moves = [], gone = Infinity) => {
      const holder = P.make('g', { transform: `translate(${slotX(0)} ${slotY + 1})` });
      const inner = P.make('g', {}, holder);
      P.chip(inner, 0, 0, `#${k}`, { h: 26, minW: SLOT });
      const tx = (i) => ({ transform: `translateX(${i * (SLOT + GAP)}px)` });
      inner.style.transform = tx(slot).transform;
      P.during(holder, at, gone);
      let from = slot;
      const list = [[0, tx(slot)]];
      for (const [t, to] of moves) {
        list.push([t, tx(from), 'ease-in-out'], [t + 300, tx(to)]);
        from = to;
      }
      if (moves.length > 0) P.keys(inner, list);
    };

    // 1. 注文が3件届き、キューに入る
    [0, 1, 2].forEach((i) =>
      P.route(['user', 'api', 'queue'], {
        at: 200 + i * 350,
        seg: 500,
        label: i === 0 ? '注文' : '',
      }),
    );
    job(1, 0, 1200, [], 3400);
    job(2, 1, 1550, [[3600, 0]]);
    job(3, 2, 1900, [[3600, 1]]);
    // 2. ワーカーが1件取り出す。処理には時間がかかる
    P.packet(P.pts('queue', 'worker'), { at: 3300, dur: 600, label: '#1' });
    P.flash('worker', 3900);
    P.badge('worker', '#1 を処理中…', { at: 3900, kind: 'warn' });
    // 3. 注文が急増して、キューが満杯になる
    [0, 1, 2].forEach((i) => P.route(['user', 'api', 'queue'], { at: 6200 + i * 300, seg: 400 }));
    job(4, 2, 7000);
    job(5, 3, 7300);
    job(6, 4, 7600);
    P.badge('queue', '満杯', { at: 7700, kind: 'error' });
    // 4. 入らない注文は 503 で断る
    [0, 1].forEach((i) => {
      const t = 9500 + i * 260;
      P.packet(P.pts('user', 'api'), { at: t, dur: 500 });
      P.packet(P.pts('api', 'queue'), {
        at: t + 520,
        dur: 420,
        stop: 0.72,
        cls: 'is-error',
        hold: 250,
      });
      P.packet(P.pts('api', 'user'), {
        at: t + 1300,
        dur: 650,
        cls: 'is-reply is-error',
        label: i === 0 ? '503' : '',
      });
    });
    const stopAt = P.at(P.pts('api', 'queue'), 0.72);
    const cross = P.make('path', {
      d: `M${stopAt.x - 9} ${stopAt.y - 9}l18 18m0 -18l-18 18`,
      class: 'p-cross',
    });
    P.during(cross, 9950, 11300);

    P.steps([
      {
        start: 0,
        end: 3000,
        nodes: ['user', 'api', 'queue'],
        edges: [
          ['user', 'api'],
          ['api', 'queue'],
        ],
      },
      { start: 3000, end: 6000, nodes: ['queue', 'worker'], edges: [['queue', 'worker']] },
      {
        start: 6000,
        end: 9300,
        nodes: ['user', 'api', 'queue'],
        edges: [
          ['user', 'api'],
          ['api', 'queue'],
        ],
      },
      {
        start: 9300,
        end: 12600,
        nodes: ['user', 'api', 'queue'],
        edges: [
          ['user', 'api'],
          ['api', 'queue'],
        ],
      },
    ]);
    return { keys: [2900, 5800, 9200, 11150] };
  },
};
