import { closest } from '../suggest.js';

/**
 * 動く構成図のパーサ（docs/arch-diagram.md §3・§4・§8、#106）。
 *
 * 行単位で読み、インデント（半角スペース2つ）で入れ子を読む。すべての要素に行番号（1 から。
 * 構成図のソースの中の行）を持たせ、書き間違いは警告にする。配置と描画は @mdhs/embeds が行う。
 */

export const ARCH_NODE_KINDS = [
  'user',
  'client',
  'server',
  'database',
  'queue',
  'storage',
  'external',
] as const;
export type ArchNodeKind = (typeof ARCH_NODE_KINDS)[number];

/** ノードの種類の説明（エディタのサジェストと早見表。§3.1） */
export const ARCH_KIND_SUMMARIES: Readonly<Record<ArchNodeKind, string>> = {
  user: '人（アイコン付き）',
  client: 'ブラウザ・アプリ',
  server: 'サーバー（角丸の四角、既定）',
  database: 'データベース（円柱）',
  queue: 'キュー（区切り線の入った四角）',
  storage: 'ファイル置き場（アイコン付き）',
  external: '外部サービス（破線の枠）',
};

/** 行頭に書くキーワード（エディタのサジェスト。scenario：シナリオの中で使うものか） */
export const ARCH_KEYWORDS: ReadonlyArray<{
  name: string;
  insert: string;
  summary: string;
  scenario: boolean;
}> = [
  {
    name: 'group',
    insert: 'group ',
    summary: 'グループ（中のノードは字下げして書く）',
    scenario: false,
  },
  {
    name: 'direction',
    insert: 'direction: ',
    summary: '向き（right：左から右、down：上から下）',
    scenario: false,
  },
  {
    name: 'scenario',
    insert: 'scenario ',
    summary: 'シナリオ（正常時・障害時など）',
    scenario: false,
  },
  {
    name: 'layout',
    insert: 'layout ',
    summary: '別の構成（下に字下げして、構成を全部書く）',
    scenario: false,
  },
  { name: 'step', insert: 'step ', summary: 'ステップ（発表の1ステップになる）', scenario: true },
  {
    name: 'layout',
    insert: 'layout ',
    summary: 'このステップで構成を切り替える（`layout -` で最初の構成）',
    scenario: true,
  },
  { name: 'note', insert: 'note: ', summary: 'このステップの発表者ノート', scenario: true },
];

export interface ArchNode {
  id: string;
  label: string;
  kind: ArchNodeKind;
  /** 入っているグループ（いちばん内側）の ID */
  group?: string;
  /** 中身の数の上限（`max=5`、#181） */
  max?: number;
  /** 別の構成のこのノードから分かれた（`order 注文 < app`、#183） */
  from?: string;
  line: number;
}

export interface ArchGroup {
  /** 自動で付ける ID（`g1`・`g2`…） */
  id: string;
  label: string;
  parent?: string;
  line: number;
}

/** つながり：`->`（矢印）・`<->`（両方向）・`--`（向きなし） */
export interface ArchEdge {
  from: string;
  to: string;
  type: 'arrow' | 'both' | 'line';
  label?: string;
  line: number;
}

/** パケットの移動（`a -> b -> c : ラベル x3`、応答は `-->`、届かないのは `-x`） */
export interface ArchMove {
  type: 'move';
  path: string[];
  /** 区間ごとの「応答か」（`-->`）。長さは path.length - 1 */
  replies: boolean[];
  /** 区間ごとの「届かないか」（`-x`、#180）。届かない区間があるときだけ持つ */
  blocked?: boolean[];
  label?: string;
  /** コードの吹き出し（次の行からの `| …`） */
  code?: string[];
  /** 繰り返す回数（`x3`） */
  repeat: number;
  line: number;
}

/**
 * 状態のバッジ（`b: 処理中`・`b: 障害 !`・`b: -`）。
 * `b: down`・`b: up` はノードを止める・戻す（#180）。down の文言がなければ、runtime が「停止」を出す
 */
export interface ArchState {
  type: 'state';
  node: string;
  /** null は「消す」 */
  text: string | null;
  error: boolean;
  /** 止める（`down`）・戻す（`up`）。止めたノードは灰色になり、届く移動も届かなくなる */
  power?: 'down' | 'up';
  line: number;
}

/** つながりを切る（`a -/- b`）・戻す（`a -/- b : -`）（#180）。切った線を通る移動は届かない */
export interface ArchCut {
  type: 'cut';
  from: string;
  to: string;
  restore: boolean;
  line: number;
}

/** ノードの中身に足す（`queue += 注文1 注文2`）・除く（`queue -= 注文1`）（#181） */
export interface ArchItems {
  type: 'items';
  node: string;
  op: 'add' | 'remove';
  items: string[];
  line: number;
}

/** ノードのキーと値（`db.注文 = 3件`、`db.注文 = -` で消す）（#181） */
export interface ArchValue {
  type: 'value';
  node: string;
  key: string;
  /** null は「消す」 */
  value: string | null;
  line: number;
}

/** 構成を切り替える（`layout 分割後`、`layout -` で最初の構成。#183）。name が null なら最初の構成 */
export interface ArchLayoutSwitch {
  type: 'layout';
  name: string | null;
  line: number;
}

export type ArchAction = ArchMove | ArchState | ArchCut | ArchItems | ArchValue | ArchLayoutSwitch;

export interface ArchStep {
  title: string;
  actions: ArchAction[];
  /** 発表者ノート（`note: …`） */
  notes: string[];
  line: number;
}

export interface ArchScenario {
  name: string;
  steps: ArchStep[];
  line: number;
}

/** 別の構成（`layout 分割後` の下に字下げして書く、#183）。字下げしない構成が最初の構成 */
export interface ArchLayout {
  name: string;
  nodes: ArchNode[];
  groups: ArchGroup[];
  edges: ArchEdge[];
  line: number;
}

export interface ArchDiagram {
  direction: 'right' | 'down';
  nodes: ArchNode[];
  groups: ArchGroup[];
  edges: ArchEdge[];
  /** 別の構成（#183）。あるときだけ持つ */
  layouts?: ArchLayout[];
  scenarios: ArchScenario[];
}

export interface ArchDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** 構成図のソースの中の行（1 から） */
  line: number;
  suggestion?: string;
  found?: string;
}

const ID = /^[A-Za-z0-9_-]+$/;
/** つながり・動きの記号（長いものから） */
const ARROWS = /\s*(<->|-->|->|--)\s*/;
/** 動きの記号。届かない移動 `-x` は前後に空白が要る（ID に `-` と `x` を使えるため。#180） */
const MOVE_ARROWS = /\s*(<->|-->|->|--|(?<=\s)-x(?=\s))\s*/;
/** つながりを切る・戻す：`a -/- b`・`a -/- b : -`（#180） */
const CUT = /^([A-Za-z0-9_-]+)\s*-\/-\s*([A-Za-z0-9_-]+)\s*(?::\s*(.*))?$/;

/** `"…"` で囲んだ文字列を外す */
const unquote = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

/** 行末のコメント（`#` から）を外す。`"…"` の中の `#` はコメントにしない */
function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === '#' && !quoted && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

/** `a -> b : ラベル` を、経路とラベルに分ける（ID に `:` は使えないので、最初の `:` で分ける） */
function splitLabel(text: string): [string, string | undefined] {
  const at = text.indexOf(':');
  if (at < 0) return [text.trim(), undefined];
  const label = text.slice(at + 1).trim();
  return [text.slice(0, at).trim(), label || undefined];
}

export function parseArch(source: string): {
  diagram: ArchDiagram;
  diagnostics: ArchDiagnostic[];
} {
  const diagram: ArchDiagram = {
    direction: 'right',
    nodes: [],
    groups: [],
    edges: [],
    scenarios: [],
  };
  const diagnostics: ArchDiagnostic[] = [];
  const warn = (line: number, code: string, message: string, extra: Partial<ArchDiagnostic> = {}) =>
    diagnostics.push({ severity: 'warning', code, message, line, ...extra });

  // 構成：開いているグループ（インデントの深さと ID）
  const groups: Array<{ indent: number; id: string }> = [];
  // 構成を書く先：最初の構成（diagram）か、別の構成（layout の下。字下げは 2 つ分ずらして読む。#183）
  let target: { nodes: ArchNode[]; groups: ArchGroup[]; edges: ArchEdge[] } = diagram;
  let layout: ArchLayout | undefined;
  let offset = 0;
  let scenario: ArchScenario | undefined;
  let step: { step: ArchStep; indent: number } | undefined;
  let lastMove: { move: ArchMove; indent: number } | undefined;

  const parseEdges = (text: string, line: number) => {
    const [path, label] = splitLabel(text);
    const parts = path.split(ARROWS);
    // parts：[id, 記号, id, 記号, id, …]
    for (let k = 0; k + 2 < parts.length; k += 2) {
      const from = parts[k]!.trim();
      const arrow = parts[k + 1]!;
      const to = parts[k + 2]!.trim();
      if (!ID.test(from) || !ID.test(to)) {
        warn(line, 'arch/syntax', `つながりを読めません：${text}`);
        return;
      }
      if (arrow === '-->') {
        warn(
          line,
          'arch/syntax',
          '`-->`（応答）はシナリオの中で使います。構成では `->` か `--` です',
          { found: '-->', suggestion: '->' },
        );
      }
      target.edges.push({
        from,
        to,
        type: arrow === '<->' ? 'both' : arrow === '--' ? 'line' : 'arrow',
        ...(label ? { label } : {}),
        line,
      });
    }
  };

  const parseStructureLine = (text: string, indent: number, line: number) => {
    while (groups.length > 0 && indent <= groups.at(-1)!.indent) groups.pop();
    const parent = groups.at(-1)?.id;
    if (parent === undefined && indent > 0) {
      warn(line, 'arch/indent', 'グループの中でないのに、字下げされています');
    }
    const direction = /^direction\s*:\s*(\S+)$/.exec(text);
    if (direction) {
      if (direction[1] === 'right' || direction[1] === 'down') diagram.direction = direction[1];
      else {
        const suggestion = closest(direction[1]!, ['right', 'down']);
        warn(line, 'arch/invalid-direction', '`direction` は right か down です', {
          found: direction[1]!,
          ...(suggestion ? { suggestion } : {}),
        });
      }
      return;
    }
    if (/^[A-Za-z0-9_-]+(?:\s+-x\s|\s*-\/-)/.test(text)) {
      warn(
        line,
        'arch/syntax',
        '`-x`（届かない移動）と `-/-`（つながりを切る）は、シナリオの中で使います',
      );
      return;
    }
    const group = /^group\s+(.+)$/.exec(text);
    if (group) {
      const prefix = layout ? `l${diagram.layouts!.length}-` : '';
      const id = `${prefix}g${target.groups.length + 1}`;
      target.groups.push({ id, label: unquote(group[1]!), ...(parent ? { parent } : {}), line });
      groups.push({ indent, id });
      return;
    }
    if (ARROWS.test(text)) {
      parseEdges(text, line);
      return;
    }
    // 中身の数の上限（行末の `max=5`、#181）
    // 行末の指定：`max=5`（#181）と `< app`（別の構成のノードから分かれた、#183）。順は問わない
    let max: number | undefined;
    let from: string | undefined;
    let nodeText = text;
    for (;;) {
      const maxText = /\s+max=(\S*)$/.exec(nodeText);
      if (maxText) {
        nodeText = nodeText.slice(0, maxText.index);
        const n = Number(maxText[1]);
        if (Number.isInteger(n) && n >= 1 && n <= 20) max = n;
        else {
          warn(line, 'arch/invalid-max', '`max=` は 1〜20 の整数で書きます', {
            found: maxText[1]!,
          });
        }
        continue;
      }
      const fromText = /\s+<\s*([A-Za-z0-9_-]+)$/.exec(nodeText);
      if (fromText) {
        nodeText = nodeText.slice(0, fromText.index);
        from = fromText[1]!;
        continue;
      }
      break;
    }
    // ノード：<ID> <表示名> [<種類>]
    const node = /^([^\s[\]]+)(?:\s+(.*?))?(?:\s*\[([^\]]*)\])?$/.exec(nodeText);
    if (!node || !ID.test(node[1]!)) {
      warn(line, 'arch/syntax', `読めない行です：${text}`);
      return;
    }
    const id = node[1]!;
    if (target.nodes.some((n) => n.id === id)) {
      warn(line, 'arch/duplicate-node', `ノード ${id} が2回定義されています`);
      return;
    }
    let kind: ArchNodeKind = 'server';
    const kindText = node[3]?.trim();
    if (kindText) {
      if ((ARCH_NODE_KINDS as readonly string[]).includes(kindText)) {
        kind = kindText as ArchNodeKind;
      } else {
        const suggestion = closest(kindText, ARCH_NODE_KINDS);
        warn(
          line,
          'arch/unknown-kind',
          `ノードの種類 ${kindText} はありません（${ARCH_NODE_KINDS.join('・')}）`,
          { found: kindText, ...(suggestion ? { suggestion } : {}) },
        );
      }
    }
    const label = node[2] ? unquote(node[2].replace(/\s+/g, ' ')) : id;
    target.nodes.push({
      id,
      label: label || id,
      kind,
      ...(parent ? { group: parent } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(from !== undefined ? { from } : {}),
      line,
    });
  };

  const parseScenarioLine = (text: string, indent: number, line: number) => {
    const stepHead = /^step\s+(.+)$/.exec(text);
    if (stepHead) {
      if (indent === 0) warn(line, 'arch/indent', '`step` は `scenario` の下に字下げして書きます');
      const s: ArchStep = { title: unquote(stepHead[1]!), actions: [], notes: [], line };
      scenario!.steps.push(s);
      step = { step: s, indent };
      return;
    }
    if (!step || indent <= step.indent) {
      warn(
        line,
        'arch/syntax',
        step
          ? `動きは \`step\` の下に字下げして書きます：${text}`
          : `シナリオの中では、まず \`step <説明>\` を書きます：${text}`,
      );
      return;
    }
    const note = /^note\s*:\s*(.*)$/.exec(text);
    if (note) {
      step.step.notes.push(note[1]!);
      return;
    }
    // 構成を切り替える（#183）：`layout 分割後`・`layout -`（最初の構成）
    const switchTo = /^layout\s+(.+)$/.exec(text);
    if (switchTo) {
      const name = unquote(switchTo[1]!);
      step.step.actions.push({ type: 'layout', name: name === '-' ? null : name, line });
      return;
    }
    // ノードの中身（#181）：`queue += 注文1 注文2`・`queue -= 注文1`・`db.注文 = 3件`
    const items = /^([A-Za-z0-9_-]+)\s*(\+=|-=)\s*(.*)$/.exec(text);
    if (items) {
      const names = items[3]!.split(/\s+/).filter(Boolean);
      if (names.length === 0) {
        warn(
          line,
          'arch/syntax',
          `${items[2] === '+=' ? '足す' : '除く'}中身を書きます（\`#\` から後はコメントになるので、中身の名前には使えません）`,
        );
        return;
      }
      step.step.actions.push({
        type: 'items',
        node: items[1]!,
        op: items[2] === '+=' ? 'add' : 'remove',
        items: names,
        line,
      });
      return;
    }
    const value = /^([A-Za-z0-9_-]+)\.([^\s=]+)\s*=\s*(.*)$/.exec(text);
    if (value) {
      const v = value[3]!.trim();
      step.step.actions.push({
        type: 'value',
        node: value[1]!,
        key: value[2]!,
        value: v === '-' || v === '' ? null : v,
        line,
      });
      return;
    }
    const cut = CUT.exec(text);
    if (cut) {
      const rest = cut[3]?.trim();
      if (rest !== undefined && rest !== '-') {
        warn(
          line,
          'arch/syntax',
          `切ったつながりを戻すときは \`${cut[1]} -/- ${cut[2]} : -\` と書きます`,
        );
        return;
      }
      step.step.actions.push({
        type: 'cut',
        from: cut[1]!,
        to: cut[2]!,
        restore: rest === '-',
        line,
      });
      return;
    }
    if (MOVE_ARROWS.test(text)) {
      const [pathText, label] = splitLabel(text);
      const times = /\s+x(\d+)$/.exec(pathText);
      const path = times ? pathText.slice(0, times.index) : pathText;
      const repeat = times ? Math.max(1, Math.min(20, Number(times[1]))) : 1;
      const parts = path.split(MOVE_ARROWS);
      const ids = parts.filter((_, k) => k % 2 === 0).map((s) => s.trim());
      const arrows = parts.filter((_, k) => k % 2 === 1);
      if (ids.length < 2 || ids.some((id) => !ID.test(id)) || arrows.includes('<->')) {
        warn(line, 'arch/syntax', `移動を読めません：${text}`);
        return;
      }
      const blocked = arrows.map((a) => a === '-x');
      const move: ArchMove = {
        type: 'move',
        path: ids,
        replies: arrows.map((a) => a === '-->'),
        ...(blocked.some(Boolean) ? { blocked } : {}),
        ...(label ? { label } : {}),
        repeat,
        line,
      };
      step.step.actions.push(move);
      lastMove = { move, indent };
      return;
    }
    const state = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(text);
    if (state) {
      const value = state[2]!.trim();
      const error = /\s*!$/.test(value);
      const stateText = value.replace(/\s*!$/, '');
      // 止める・戻す（#180）：`b: down 応答なし`・`b: up 復旧`
      const power = /^(down|up)(?:\s+(.+))?$/.exec(stateText);
      if (power) {
        const down = power[1] === 'down';
        step.step.actions.push({
          type: 'state',
          node: state[1]!,
          text: power[2]?.trim() ?? null,
          error: down,
          power: down ? 'down' : 'up',
          line,
        });
        return;
      }
      step.step.actions.push({
        type: 'state',
        node: state[1]!,
        text: stateText === '-' || stateText === '' ? null : stateText,
        error,
        line,
      });
      return;
    }
    warn(line, 'arch/syntax', `読めない行です：${text}`);
  };

  source.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.includes('\t')) {
      warn(line, 'arch/indent', 'タブは使えません。インデントは半角スペース2つで書いてください');
    }
    const expanded = raw.replace(/\t/g, '  ');
    const indent = /^ */.exec(expanded)![0].length;
    const body = expanded.trim();

    // コードの吹き出し（`| …`）：直前の移動に付ける。コメントは外さない
    if (body.startsWith('|')) {
      if (lastMove && indent > lastMove.indent) {
        (lastMove.move.code ??= []).push(body.replace(/^\|\s?/, ''));
      } else {
        warn(
          line,
          'arch/orphan-code',
          '`|` の吹き出しは、移動（a -> b）の次の行に、深く字下げして書きます',
        );
      }
      return;
    }
    lastMove = undefined;
    const text = stripComment(body);
    if (!text) return;
    if (indent % 2 !== 0) {
      warn(line, 'arch/indent', 'インデントは半角スペース2つ単位で書いてください');
    }

    const scenarioHead = /^scenario\s+(.+)$/.exec(text);
    if (scenarioHead) {
      if (indent !== 0) warn(line, 'arch/indent', '`scenario` は行頭に書きます');
      scenario = { name: unquote(scenarioHead[1]!), steps: [], line };
      diagram.scenarios.push(scenario);
      step = undefined;
      return;
    }
    if (scenario) {
      parseScenarioLine(text, indent, line);
      return;
    }
    // 別の構成（#183）：`layout 名前` の下に、字下げして構成を全部書く
    const layoutHead = /^layout\s+(.+)$/.exec(text);
    if (layoutHead && indent === 0) {
      layout = { name: unquote(layoutHead[1]!), nodes: [], groups: [], edges: [], line };
      (diagram.layouts ??= []).push(layout);
      target = layout;
      offset = 2;
      groups.length = 0;
      return;
    }
    if (layout && indent === 0) {
      layout = undefined;
      target = diagram;
      offset = 0;
      groups.length = 0;
    }
    parseStructureLine(text, indent - offset, line);
  });

  checkReferences(diagram, diagnostics);
  return { diagram, diagnostics };
}

/**
 * 参照の検査：未定義のノード、構成にない経路、使われていないノード。
 * 移動 `a -> b` は、構成に a→b・a↔b・a—b のどれかがあればよい。応答 `b --> a` は、向きを問わない。
 */
function checkReferences(diagram: ArchDiagram, diagnostics: ArchDiagnostic[]): void {
  // 構成（最初の構成と、別の構成。#183）。シナリオでは、そのときの構成で参照を確かめる
  type Structure = { name: string | null; nodes: ArchNode[]; edges: ArchEdge[] };
  const structures: Structure[] = [
    { name: null, nodes: diagram.nodes, edges: diagram.edges },
    ...(diagram.layouts ?? []).map((l) => ({ name: l.name, nodes: l.nodes, edges: l.edges })),
  ];
  const allIds = new Set(structures.flatMap((st) => st.nodes.map((n) => n.id)));
  let cur = structures[0]!;
  let ids = new Set(cur.nodes.map((n) => n.id));
  const use = (st: Structure) => {
    cur = st;
    ids = new Set(st.nodes.map((n) => n.id));
  };
  const used = new Set<string>();
  const unknown = (id: string, line: number) => {
    if (ids.has(id)) return false;
    diagnostics.push({
      severity: 'warning',
      code: 'arch/unknown-node',
      message: allIds.has(id)
        ? `ノード ${id} は、今の構成（${cur.name ?? '最初の構成'}）にはありません`
        : `ノード ${id} は定義されていません`,
      line,
      found: id,
    });
    return true;
  };
  for (const st of structures) {
    use(st);
    for (const e of st.edges) {
      used.add(e.from).add(e.to);
      unknown(e.from, e.line);
      unknown(e.to, e.line);
    }
    for (const n of st.nodes) {
      if (n.from === undefined) continue;
      used.add(n.from).add(n.id);
      if (!allIds.has(n.from)) {
        diagnostics.push({
          severity: 'warning',
          code: 'arch/unknown-node',
          message: `分かれる元のノード ${n.from} は、どの構成にもありません`,
          line: n.line,
          found: n.from,
        });
      }
    }
  }
  use(structures[0]!);
  const connected = (a: string, b: string, reply: boolean) =>
    cur.edges.some(
      (e) =>
        (e.from === a && e.to === b) ||
        ((reply || e.type !== 'arrow') && e.from === b && e.to === a),
    );
  const noEffect = (message: string, line: number) =>
    diagnostics.push({ severity: 'info', code: 'arch/no-effect', message, line });
  for (const s of diagram.scenarios) {
    // 止めたノードと切ったつながり（シナリオの中で、書いた順にたどる。#180）
    const down = new Set<string>();
    const cuts = new Set<string>();
    // ノードの中身（#181）
    const held = new Map<string, string[]>();
    const maxOf = new Map<string, number | undefined>();
    for (const st of structures) {
      for (const n of st.nodes) if (!maxOf.has(n.id)) maxOf.set(n.id, n.max);
    }
    use(structures[0]!);
    for (const st of s.steps) {
      for (const action of st.actions) {
        if (action.type === 'layout') {
          const next = structures.find((x) => x.name === action.name);
          if (next) use(next);
          else {
            diagnostics.push({
              severity: 'warning',
              code: 'arch/unknown-layout',
              message: `構成 ${action.name} はありません（${structures
                .slice(1)
                .map((x) => x.name)
                .join('・')}）`,
              line: action.line,
            });
          }
          continue;
        }
        if (action.type === 'state') {
          used.add(action.node);
          unknown(action.node, action.line);
          if (action.power === 'down') down.add(action.node);
          if (action.power === 'up' && !down.delete(action.node)) {
            noEffect(
              `ノード ${action.node} は止まっていません（\`${action.node}: down\` の後に書きます）`,
              action.line,
            );
          }
          continue;
        }
        if (action.type === 'value') {
          used.add(action.node);
          unknown(action.node, action.line);
          continue;
        }
        if (action.type === 'items') {
          used.add(action.node);
          if (unknown(action.node, action.line)) continue;
          const list = held.get(action.node) ?? [];
          held.set(action.node, list);
          const max = maxOf.get(action.node);
          for (const item of action.items) {
            if (action.op === 'add') {
              if (max !== undefined && list.length >= max) {
                diagnostics.push({
                  severity: 'info',
                  code: 'arch/full',
                  message: `ノード ${action.node} は満杯です（max=${max}）。${item} は入らず、× で消えます`,
                  line: action.line,
                });
              } else list.push(item);
            } else {
              const at = list.indexOf(item);
              if (at >= 0) list.splice(at, 1);
              else noEffect(`ノード ${action.node} に ${item} は入っていません`, action.line);
            }
          }
          continue;
        }
        if (action.type === 'cut') {
          const { from: a, to: b } = action;
          used.add(a).add(b);
          const missing = [unknown(a, action.line), unknown(b, action.line)].some(Boolean);
          const key = [a, b].sort().join('\u0000');
          if (!missing && !connected(a, b, true)) {
            diagnostics.push({
              severity: 'warning',
              code: 'arch/unknown-route',
              message: `構成にないつながりは切れません：${a} -/- ${b}`,
              line: action.line,
            });
          } else if (action.restore && !cuts.delete(key)) {
            noEffect(`つながり ${a} -/- ${b} は切られていません`, action.line);
          } else if (!action.restore) {
            cuts.add(key);
          }
          continue;
        }
        for (let k = 0; k + 1 < action.path.length; k++) {
          const a = action.path[k]!;
          const b = action.path[k + 1]!;
          used.add(a).add(b);
          const missing = [unknown(a, action.line), unknown(b, action.line)].some(Boolean);
          if (missing) continue;
          if (!connected(a, b, action.replies[k]!)) {
            diagnostics.push({
              severity: 'warning',
              code: 'arch/unknown-route',
              message: `構成にない経路です：${a} ${action.replies[k] ? '-->' : '->'} ${b}（点線で仮に描きます）`,
              line: action.line,
            });
          }
        }
      }
    }
  }
  for (const n of structures.flatMap((st) => st.nodes)) {
    if (!used.has(n.id)) {
      diagnostics.push({
        severity: 'info',
        code: 'arch/unused-node',
        message: `ノード ${n.id} はどこにもつながっていません`,
        line: n.line,
      });
    }
  }
}
