import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import { archDiagnostics, collectArch, selectScenario } from './collect.js';
import { parseArch } from './parse.js';

const fixtures = new URL('../../../../fixtures/', import.meta.url);
const orderSystem = readFileSync(new URL('assets/order-system.arch', fixtures), 'utf8');

describe('parseArch（#106）', () => {
  it('order-system.arch の構成：ノード・グループ・つながり・向き', () => {
    const { diagram, diagnostics } = parseArch(orderSystem);
    expect(diagnostics).toEqual([]);
    expect(diagram.direction).toBe('right');
    expect(diagram.groups).toEqual([{ id: 'g1', label: 'クラウド', line: 5 }]);
    expect(diagram.nodes.map((n) => [n.id, n.label, n.kind, n.group ?? '-'])).toEqual([
      ['user', 'ユーザー', 'user', '-'],
      ['web', 'Webサーバー', 'server', 'g1'],
      ['api', '注文API', 'server', 'g1'],
      ['db', '注文DB', 'database', 'g1'],
      ['queue', 'キュー', 'queue', 'g1'],
      ['worker', 'ワーカー', 'server', 'g1'],
      ['pay', '決済サービス', 'external', '-'],
    ]);
    // a -> b -> c は a -> b と b -> c に分ける
    expect(diagram.edges.map((e) => `${e.from}>${e.to}:${e.line}`)).toEqual([
      'user>web:13',
      'web>api:13',
      'api>db:14',
      'api>queue:15',
      'queue>worker:15',
      'worker>pay:16',
    ]);
  });

  it('シナリオ：移動・ラベル・コードの吹き出し・応答・繰り返し・状態・ノート', () => {
    const { diagram } = parseArch(orderSystem);
    expect(diagram.scenarios.map((s) => [s.name, s.steps.length])).toEqual([
      ['正常時', 4],
      ['決済の障害', 4],
    ]);
    const [normal, failure] = diagram.scenarios;
    expect(normal!.steps.map((s) => s.title)).toEqual([
      '注文を送る',
      '在庫を確認して保存する',
      '決済を依頼する',
      '結果を返す',
    ]);
    expect(normal!.steps[0]!.actions).toEqual([
      {
        type: 'move',
        path: ['user', 'web', 'api'],
        replies: [false, false],
        label: 'POST /orders',
        repeat: 1,
        line: 20,
      },
    ]);
    expect(normal!.steps[1]!.actions).toEqual([
      {
        type: 'move',
        path: ['api', 'db'],
        replies: [false],
        code: ['INSERT INTO orders', "VALUES (42, 'book')"],
        repeat: 1,
        line: 22,
      },
      { type: 'state', node: 'db', text: '保存済み', error: false, line: 25 },
    ]);
    expect(normal!.steps[3]!.actions.map((a) => a.type === 'move' && a.replies)).toEqual([
      [true],
      [true, true],
    ]);
    const retry = failure!.steps[2]!;
    expect(retry.actions).toEqual([
      { type: 'move', path: ['worker', 'pay'], replies: [false], repeat: 3, line: 41 },
      { type: 'state', node: 'worker', text: '失敗', error: true, line: 42 },
    ]);
    expect(retry.notes).toEqual(['リトライの間隔は指数的に延びる']);
    expect(failure!.steps[1]!.actions[1]).toMatchObject({ node: 'pay', text: '障害', error: true });
  });

  it('つながりの種類・ラベル・"…" の表示名・コメント・状態を消す', () => {
    const { diagram, diagnostics } = parseArch(
      [
        'a "Web server" [client]  # コメント',
        'b',
        'c',
        'a <-> b : HTTPS',
        'b -- c',
        'scenario s',
        '  step 戻す',
        '    c -> b',
        '    b: -',
      ].join('\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes[0]).toMatchObject({ id: 'a', label: 'Web server', kind: 'client' });
    expect(diagram.nodes[1]).toMatchObject({ id: 'b', label: 'b', kind: 'server' });
    expect(diagram.edges.map((e) => [e.type, e.label ?? '-'])).toEqual([
      ['both', 'HTTPS'],
      ['line', '-'],
    ]);
    // 向きのない線（--）は、どちら向きにも動ける。b: - は状態を消す
    expect(diagram.scenarios[0]!.steps[0]!.actions[1]).toMatchObject({ node: 'b', text: null });
  });

  it('障害と回復：止める・戻す・届かない移動・つながりを切る・戻す（#180）', () => {
    const { diagram, diagnostics } = parseArch(
      [
        'worker ワーカー',
        'pay 決済',
        'pay2 予備',
        'worker -> pay',
        'worker -> pay2',
        'scenario 障害',
        '  step 止まる',
        '    pay: down',
        '  step 再試行',
        '    worker -x pay x3 : タイムアウト',
        '  step 切り替える',
        '    worker -/- pay',
        '    worker -> pay2',
        '  step 戻す',
        '    pay: up 復旧',
        '    worker -/- pay : -',
        '    pay: down 応答なし !',
      ].join('\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(diagram.scenarios[0]!.steps.map((s) => s.actions)).toEqual([
      [{ type: 'state', node: 'pay', text: null, error: true, power: 'down', line: 8 }],
      [
        {
          type: 'move',
          path: ['worker', 'pay'],
          replies: [false],
          blocked: [true],
          label: 'タイムアウト',
          repeat: 3,
          line: 10,
        },
      ],
      [
        { type: 'cut', from: 'worker', to: 'pay', restore: false, line: 12 },
        { type: 'move', path: ['worker', 'pay2'], replies: [false], repeat: 1, line: 13 },
      ],
      [
        { type: 'state', node: 'pay', text: '復旧', error: false, power: 'up', line: 15 },
        { type: 'cut', from: 'worker', to: 'pay', restore: true, line: 16 },
        { type: 'state', node: 'pay', text: '応答なし', error: true, power: 'down', line: 17 },
      ],
    ]);
  });

  it('障害と回復の書き間違い：構成の中の -x、止まっていないノードの up、構成にない線を切る（#180）', () => {
    const { diagram, diagnostics } = parseArch(
      [
        'a',
        'b',
        'c',
        'a-x 名前に -x を含む',
        'a -> b',
        'a-x -> b',
        'a -x b',
        'scenario s',
        '  step 1',
        '    b: up',
        '    a -/- c',
        '    a -/- b : -',
        '    a -/- b : 戻す',
        '    a-x -> b',
      ].join('\n'),
    );
    expect(diagnostics.map((d) => [d.code, d.line, d.severity])).toEqual([
      ['arch/syntax', 7, 'warning'],
      ['arch/syntax', 13, 'warning'],
      ['arch/no-effect', 10, 'info'],
      ['arch/unknown-route', 11, 'warning'],
      ['arch/no-effect', 12, 'info'],
    ]);
    // 前後に空白のない -x は ID の一部（届かない移動ではない）
    expect(diagram.scenarios[0]!.steps[0]!.actions.at(-1)).toEqual({
      type: 'move',
      path: ['a-x', 'b'],
      replies: [false],
      repeat: 1,
      line: 14,
    });
  });

  it('ノードの中身：上限（max=）・足す・除く・キーと値（#181）', () => {
    const { diagram, diagnostics } = parseArch(
      [
        'api',
        'queue キュー [queue] max=3',
        'cache キャッシュ max=2',
        'api -> queue',
        'api -> cache',
        'scenario s',
        '  step 足す',
        '    queue += 注文1 注文2',
        '    cache.item:42 = 本',
        '  step 除く',
        '    queue -= 注文1',
        '    cache.item:42 = -',
      ].join('\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.map((n) => [n.id, n.label, n.kind, n.max ?? '-'])).toEqual([
      ['api', 'api', 'server', '-'],
      ['queue', 'キュー', 'queue', 3],
      ['cache', 'キャッシュ', 'server', 2],
    ]);
    expect(diagram.scenarios[0]!.steps.map((s) => s.actions)).toEqual([
      [
        { type: 'items', node: 'queue', op: 'add', items: ['注文1', '注文2'], line: 8 },
        { type: 'value', node: 'cache', key: 'item:42', value: '本', line: 9 },
      ],
      [
        { type: 'items', node: 'queue', op: 'remove', items: ['注文1'], line: 11 },
        { type: 'value', node: 'cache', key: 'item:42', value: null, line: 12 },
      ],
    ]);
  });

  it('ノードの中身の書き間違い：max の値、満杯、入っていない中身、# の名前（#181）', () => {
    const { diagnostics } = parseArch(
      [
        'a',
        'q [queue] max=0',
        'r [queue] max=2',
        'a -> q',
        'a -> r',
        'scenario s',
        '  step 1',
        '    r += x y z',
        '    r -= w',
        '    r += #1',
        '    zz += x',
      ].join('\n'),
    );
    expect(diagnostics.map((d) => [d.code, d.line, d.severity])).toEqual([
      ['arch/invalid-max', 2, 'warning'],
      ['arch/syntax', 10, 'warning'],
      ['arch/full', 8, 'info'],
      ['arch/no-effect', 9, 'info'],
      ['arch/unknown-node', 11, 'warning'],
    ]);
    expect(diagnostics[1]!.message).toContain('`#` から後はコメント');
  });

  it('書き間違い：未定義のノード、構成にない経路、使われていないノード、種類の候補、インデント', () => {
    const { diagnostics } = parseArch(
      [
        'a 入口',
        'b 出口',
        'z 余り [databse]',
        'a -> b',
        'scenario 確認',
        '  step 存在しないノード',
        '    a -> c',
        '  step 構成にない経路',
        '    b -> a',
        '     | 吹き出し',
        '   b: 半端な字下げ',
        '| 移動のない吹き出し',
      ].join('\n'),
    );
    expect(diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['arch/unknown-kind', 3],
      ['arch/indent', 11],
      ['arch/orphan-code', 12],
      ['arch/unknown-node', 7],
      ['arch/unknown-route', 9],
      ['arch/unused-node', 3],
    ]);
    expect(diagnostics[0]).toMatchObject({ found: 'databse', suggestion: 'database' });
    expect(diagnostics.find((d) => d.code === 'arch/unknown-route')!.message).toContain('b -> a');
    expect(diagnostics.find((d) => d.code === 'arch/unused-node')!.severity).toBe('info');
  });
});

describe('collectArch・archDiagnostics（#106）', () => {
  const md = readFileSync(new URL('13-arch.md', fixtures), 'utf8');
  const deck = buildSlides(parseDeck(md));
  const read = (src: string) =>
    src === './assets/order-system.arch' || src === 'assets/order-system.arch'
      ? orderSystem
      : undefined;
  const sources = collectArch(deck, read);

  it('ファイル参照とコードブロックを、スライドごとに集める', () => {
    expect(sources.map((s) => s.src ?? 'code')).toEqual([
      './assets/order-system.arch',
      './assets/order-system.arch',
      './assets/order-system.arch',
      './assets/order-system.arch',
      './assets/order-system.arch',
      'code',
      './assets/order-system.arch',
      'code',
      './assets/order-system.arch',
      'code',
      'code',
      'code',
    ]);
    // 「書き間違い」のスライドには、図が2つある
    expect(sources[7]!.slideId).toBe(sources[8]!.slideId);
    expect(new Set(sources.slice(0, 8).map((s) => s.slideId)).size).toBe(8);
    expect(sources[9]!.slideId).not.toBe(sources[8]!.slideId);
    expect(sources.map((s) => selectScenario(s)?.name ?? '-')).toEqual([
      '正常時',
      '決済の障害',
      '正常時',
      '-',
      '正常時',
      'キャッシュの確認',
      '決済の障害',
      '確認',
      '-',
      '決済の障害',
      '注文の集中',
      'キャッシュ',
    ]);
    expect(sources[5]!.diagram.direction).toBe('down');
  });

  it('fixtures/README の「書き間違い」の警告：未定義のノード、構成にない経路、存在しないシナリオ、図が2つ', () => {
    const lines = md.split('\n');
    const lineOf = (text: string, from = 0) =>
      lines.findIndex((l, i) => i >= from && l.includes(text)) + 1;
    const start = lineOf('## 書き間違い');
    const diagnostics = archDiagnostics(sources);
    expect(diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['arch/unknown-node', lineOf('    a -> c', start)],
      ['arch/unknown-route', lineOf('    b -> a', start)],
      ['arch/unknown-scenario', lineOf('存在しないシナリオ', start)],
      ['arch/multiple', lineOf('存在しないシナリオ', start)],
      // 「キューが詰まる」：上限を超えて足す（情報。#181）
      ['arch/full', lineOf('    queue += 注文7', start)],
    ]);
    expect(diagnostics[2]!.message).toContain('正常時・決済の障害');
  });

  it('ファイルの中の警告は、参照した行に、ファイル名と行を添えて出す', () => {
    const deck2 = buildSlides(parseDeck('## A\n\n![](bad.arch)\n'));
    const found = archDiagnostics(collectArch(deck2, () => 'a\na -> c\n'));
    expect(found).toEqual([
      expect.objectContaining({
        code: 'arch/unknown-node',
        line: 3,
        message: 'ノード c は定義されていません（bad.arch の 2 行目）',
      }),
    ]);
  });
});
