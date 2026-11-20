// 案2 障害と回復：ノードを止める・届かない移動（タイムアウト）・つながりを切る・戻す
window.PROTO = {
  slide: 2,
  setup(P) {
    P.mount(2);
    const pay = P.box('pay');
    const toPay = P.pts('worker', 'pay');
    const DOWN = [300, 11300];
    const CUT = [7800, 11700];

    // 止まったノード：灰色にして、「停止」のバッジ
    void pay;
    P.badge('pay', '停止', { at: DOWN[0] + 100, until: DOWN[1], kind: 'error' });
    P.badge('pay', '復旧', { at: DOWN[1] + 100, kind: '' });
    P.onSeek = (t) => {
      P.node('pay').classList.toggle('p-dead', t >= DOWN[0] && t < DOWN[1]);
      P.edge('worker', 'pay').classList.toggle('p-cut', t >= CUT[0] && t < CUT[1]);
    };

    // 2. タイムアウトして、間隔を延ばしながら3回再試行する
    const stop = 0.86;
    const near = P.at(toPay, stop);
    const attempts = [
      [2700, '1回目', '1秒待つ'],
      [4100, '2回目', '2秒待つ'],
      [5700, '3回目', ''],
    ];
    attempts.forEach(([t, n, wait], i) => {
      P.packet(toPay, { at: t, dur: 700, stop, cls: 'is-error', hold: 200 });
      const cross = P.make('path', {
        d: `M${near.x - 8} ${near.y - 8}l16 16m0 -16l-16 16`,
        class: 'p-cross',
      });
      P.during(cross, t + 700, t + 1300, 1, 200);
      const note = P.text(P.fx, near.x - 20, near.y + 26, 'タイムアウト', 'p-note');
      P.during(note, t + 700, t + 1300, 1, 200);
      const next = attempts[i + 1]?.[0] ?? 6600;
      P.badge('worker', `再試行 ${n}`, { at: t, until: next, kind: 'warn' });
      if (wait) {
        const w = P.text(P.fx, P.at(toPay, 0.35).x, near.y + 26, wait, 'p-note is-muted');
        P.during(w, t + 1300, next);
      }
    });
    P.badge('worker', '3回とも失敗', { at: 6600, until: 8000, kind: 'error' });

    // 3. 予備の決済サービスに切り替える（切ったつながりの、ワーカー寄りに ×）
    const mid = P.at(toPay, 0.2);
    const cut = P.make('path', {
      d: `M${mid.x - 9} ${mid.y - 9}l18 18m0 -18l-18 18`,
      class: 'p-cross',
    });
    P.during(cut, CUT[0], CUT[1]);
    P.packet(P.pts('worker', 'pay2'), { at: 8300, dur: 700, label: '決済ジョブ' });
    P.flash('pay2', 9000);
    P.packet(P.pts('pay2', 'worker'), { at: 9300, dur: 700, cls: 'is-reply', label: 'OK' });
    P.badge('worker', '予備で成功', { at: 10000, until: 11300 });

    // 4. 元のサービスが復旧して、戻す
    P.packet(toPay, { at: 12000, dur: 700, label: '決済ジョブ' });
    P.flash('pay', 12700);
    P.packet(P.pts('pay', 'worker'), { at: 12900, dur: 700, cls: 'is-reply', label: 'OK' });

    P.steps([
      { start: 0, end: 2500, nodes: ['pay'], edges: [] },
      { start: 2500, end: 7600, nodes: ['worker', 'pay'], edges: [['worker', 'pay']] },
      { start: 7600, end: 11000, nodes: ['worker', 'pay2'], edges: [['worker', 'pay2']] },
      { start: 11000, end: 14400, nodes: ['worker', 'pay'], edges: [['worker', 'pay']] },
    ]);
    return { keys: [1600, 6900, 9700, 13300] };
  },
};
