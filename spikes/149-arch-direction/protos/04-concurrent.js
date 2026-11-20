// 案4 同時に流れる：2つの流れ（[A]・[B]）を並べて流し、下のレーンに、読み書きの順番を並べる
window.PROTO = {
  slide: 4,
  setup(P) {
    P.mount(4);
    const [vx, , vw] = P.viewBox();
    const db = P.box('db');
    P.extend({ bottom: 150 });
    const [, vy2, , vh2] = P.viewBox();
    const END = 9000;

    // レーン：横が時間。左に流れの名前
    const top = vy2 + vh2 - 136;
    const L0 = vx + 110;
    const L1 = vx + vw - 10;
    const xOf = (t) => L0 + (Math.min(t, END) / END) * (L1 - L0);
    const lanes = [
      { y: top, name: 'A スマホ', cls: '' },
      { y: top + 62, name: 'B パソコン', cls: 'is-b' },
    ];
    let laneRect;
    for (const lane of lanes) {
      laneRect = P.make('rect', {
        x: vx,
        y: lane.y,
        width: vw,
        height: 52,
        rx: 8,
        class: 'p-lane',
      });
      P.text(P.fx, vx + 14, lane.y + 26, lane.name, 'p-lane-label', {
        style: 'text-anchor: start',
      });
    }
    const event = (lane, t, label) => {
      const chip = P.chip(P.fx, xOf(t), lanes[lane].y + 13, label, { cls: lanes[lane].cls });
      P.during(chip, t, Infinity, 150);
    };
    // 今の時刻の線
    const now = P.make('path', {
      d: `M${L0} ${top - 6}V${top + 120}`,
      stroke: 'var(--mds-muted)',
      'stroke-width': 2,
      'stroke-dasharray': '3 3',
    });
    P.keys(now, [
      [0, { transform: 'translateX(0px)' }],
      [END, { transform: `translateX(${L1 - L0}px)` }],
    ]);

    // 口座の残高（DB の下）
    const balance = (t1, t2, label, cls = '') => {
      const chip = P.chip(P.fx, 0, db.b + 12, label, { cls });
      chip.setAttribute('transform', `translate(${db.cx - chip.width / 2} ${db.b + 12})`);
      P.during(chip, t1, t2, t1 ? 150 : 0, 150);
    };
    balance(0, 6100, '残高 1,000円');
    balance(6100, Infinity, '残高 200円');

    const A = { labelY: 26 };
    const B = { cls: 'is-b' };
    // 1. 800円 の購入が同時に2つ届く
    P.packet(P.pts('phone', 'api'), { ...A, at: 300, dur: 700, label: '800円' });
    P.packet(P.pts('pc', 'api'), { ...B, at: 450, dur: 700, label: '800円' });
    event(0, 1000, '購入');
    event(1, 1150, '購入');
    // 2. 両方が、残高 1,000円 を読む
    P.packet(P.pts('api', 'db'), { ...A, at: 2600, dur: 600, label: '読む' });
    P.packet(P.pts('api', 'db'), { ...B, at: 2800, dur: 600, label: '読む' });
    P.packet(P.pts('db', 'api'), { ...A, at: 3500, dur: 600, cls: 'is-reply', label: '1,000円' });
    P.packet(P.pts('db', 'api'), {
      ...B,
      at: 3700,
      dur: 600,
      cls: 'is-b is-reply',
      label: '1,000円',
    });
    event(0, 3200, '読む 1,000');
    event(1, 3400, '読む 1,000');
    // 3. 両方が「足りる」と判断して、200円 を書く
    P.packet(P.pts('api', 'db'), { ...A, at: 5500, dur: 600, label: '200円' });
    P.packet(P.pts('api', 'db'), { ...B, at: 5750, dur: 600, label: '200円' });
    P.flash('db', 6100);
    P.flash('db', 6350, '#ea580c');
    event(0, 6100, '書く 200');
    event(1, 6350, '書く 200');
    // 4. 2つとも売れたのに、800円 しか引かれない
    P.packet(P.pts('api', 'phone'), { ...A, at: 7800, dur: 600, cls: 'is-reply', label: 'OK' });
    P.packet(P.pts('api', 'pc'), { ...B, at: 7950, dur: 600, cls: 'is-b is-reply', label: 'OK' });
    event(0, 8400, 'OK');
    event(1, 8550, 'OK');
    P.badge('db', '800円 足りない', { at: 8900, kind: 'error' });
    // A が読んでから書くまでのあいだに、B も読んでいた
    const gap = P.make('rect', {
      x: xOf(3200),
      y: top - 4,
      width: xOf(6100) - xOf(3200),
      height: 120,
      rx: 8,
      fill: '#fee2e2',
      stroke: '#dc2626',
      'stroke-width': 2,
      'stroke-dasharray': '6 4',
      opacity: 0.6,
    });
    laneRect.after(gap);
    P.during(gap, 8900);
    const why = P.text(
      P.fx,
      (xOf(3200) + xOf(6100)) / 2,
      top - 18,
      'A が読んでから書くまでに、B も読んだ',
      'p-note',
    );
    P.during(why, 8900);

    P.steps([
      {
        start: 0,
        end: 2400,
        nodes: ['phone', 'pc', 'api'],
        edges: [
          ['phone', 'api'],
          ['pc', 'api'],
        ],
      },
      { start: 2400, end: 5300, nodes: ['api', 'db'], edges: [['api', 'db']] },
      { start: 5300, end: 7600, nodes: ['api', 'db'], edges: [['api', 'db']] },
      {
        start: 7600,
        end: 10600,
        nodes: ['phone', 'pc', 'api', 'db'],
        edges: [
          ['phone', 'api'],
          ['pc', 'api'],
        ],
      },
    ]);
    return { keys: [800, 3550, 6400, 9600] };
  },
};
