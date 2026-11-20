/**
 * 動く構成図（#107、docs/arch-diagram.md §5）：スライドの中の図と、説明のリスト。
 * 図の SVG とシナリオは、描く関数（RenderEnv.diagram）が返す。core は配置と説明のリストを決める。
 */
import type { Attrs } from '../attrs.js';
import type { ArchScenario } from '../arch/parse.js';
import type { Block } from '../ir.js';
import { decodePath } from '../media.js';
import type { DiagramRenderer, DiagramResult } from '../md/media.js';

export type ArchCaptions = 'auto' | 'side' | 'below' | 'none';

export interface ArchUse {
  /** 図の縦横比（幅 / 高さ） */
  aspect: number;
  /** 再生するシナリオ（`scenario=none` や、シナリオのない図なら undefined） */
  scenario?: ArchScenario;
  captions: ArchCaptions;
}

/** ブロックの中の動く構成図（```arch か、`.arch` だけの段落）。描けなければ undefined */
export function archUse(block: Block, diagram: DiagramRenderer | undefined): ArchUse | undefined {
  let attrs: Attrs | undefined;
  let result;
  if (block.kind === 'code' && block.lang === 'arch') {
    attrs = block.attrs;
    const code = `${block.raw.split('\n').slice(1, -1).join('\n')}\n`;
    result = diagram?.({ lang: 'arch', code });
  } else {
    const media = (block.media ?? []).find(
      (m) => m.kind === 'arch' && m.attrs?.values.bg === undefined,
    );
    if (!media) return undefined;
    attrs = media.attrs;
    result = diagram?.({ lang: 'arch', src: decodePath(media.src) });
  }
  if (!result || 'error' in result) return undefined;
  const scenario = selectArchScenario(result.scenarios, attrs);
  const captions = attrs?.values.captions;
  const viewed = archView(result, attrs) as { width: number; height: number };
  return {
    aspect: viewed.height > 0 ? viewed.width / viewed.height : 1.6,
    ...(scenario ? { scenario } : {}),
    captions:
      captions === 'side' || captions === 'below' || captions === 'none' ? captions : 'auto',
  };
}

/**
 * 見せ方（#182、`view=`）：`both` は構成図とシーケンス図を1つの SVG に並べ、`sequence` はシーケンス図だけ。
 * シーケンス図は renderArch がシナリオごとに描いておく（result.sequences）。並べ方は、全体の縦横比が
 * 2:1 に近いほう（横に並べるか、下に置くか）
 */
export function archView(result: DiagramResult, attrs: Attrs | undefined): DiagramResult {
  const view = attrs?.values.view;
  if ('error' in result || (view !== 'both' && view !== 'sequence')) return result;
  const scenario = selectArchScenario(result.scenarios, attrs);
  const seq = scenario ? result.sequences?.[scenario.name] : undefined;
  if (!seq) return result;
  const head = result.svg.slice(0, result.svg.indexOf('>') + 1);
  const inner = result.svg.slice(head.length, result.svg.lastIndexOf('</svg>'));
  const [x = 0, y = 0, w = 0, h = 0] = (/viewBox="([^"]*)"/.exec(head)?.[1] ?? '')
    .split(/\s+/)
    .map(Number);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const svg = (box: number[], body: string) =>
    `${head.replace(/viewBox="[^"]*"/, `viewBox="${box.map(r1).join(' ')}"`)}${body}</svg>`;
  const group = (tx: number, ty: number) =>
    `<g class="arch-seq" transform="translate(${r1(tx)} ${r1(ty)})">${seq.body}</g>`;
  if (view === 'sequence') {
    return {
      ...result,
      svg: svg([0, 0, seq.width, seq.height], group(0, 0)),
      ...size(seq.width, seq.height),
    };
  }
  const GAP = 48;
  const side = { W: w + GAP + seq.width, H: Math.max(h, seq.height) };
  const below = { W: Math.max(w, seq.width), H: h + GAP + seq.height };
  const off = (a: { W: number; H: number }) => Math.abs(Math.log(a.W / a.H / 2));
  if (off(side) <= off(below)) {
    const top = y - (side.H - h) / 2;
    return {
      ...result,
      svg: svg(
        [x, top, side.W, side.H],
        inner + group(x + w + GAP, top + (side.H - seq.height) / 2),
      ),
      ...size(side.W, side.H),
    };
  }
  const left = x - (below.W - w) / 2;
  return {
    ...result,
    svg: svg(
      [left, y, below.W, below.H],
      inner + group(left + (below.W - seq.width) / 2, y + h + GAP),
    ),
    ...size(below.W, below.H),
  };
}
const size = (width: number, height: number) => ({ width, height });

/** 説明のリストを出すか（シナリオにステップがあり、captions=none でない） */
export const hasCaptions = (use: ArchUse) =>
  use.captions !== 'none' && (use.scenario?.steps.length ?? 0) > 0;

/**
 * 説明のリストを図の下に置くか（§5.4）。below の指定か、auto で図が横長（2.2:1 以上）なら下。
 * 横長の図の横に説明を置くと、図が縮んで文字が読めなくなるため
 */
export const captionsBelow = (use: ArchUse) =>
  use.captions === 'below' || (use.captions === 'auto' && use.aspect >= 2.2);

/** ステップの説明の番号付きリスト（今のステップの強調は runtime が行う。#108） */
export function archCaptionsHtml(use: ArchUse, esc: (s: string) => string): string {
  if (!hasCaptions(use)) return '';
  const items = use.scenario!.steps.map((s) => `<li>${esc(s.title)}</li>`).join('');
  return `<ol class="mds-arch-captions${captionsBelow(use) ? ' is-row' : ''}">${items}</ol>\n`;
}

/** 再生するシナリオを選ぶ（`scenario=` がなければ最初のもの。`none` なら再生しない） */
export function selectArchScenario(
  scenarios: ArchScenario[] | undefined,
  attrs: Attrs | undefined,
): ArchScenario | undefined {
  const name = attrs?.values.scenario;
  if (name === 'none') return undefined;
  if (typeof name === 'string') return scenarios?.find((s) => s.name === name);
  return scenarios?.[0];
}

/**
 * 図の要素に付ける、再生（#108）のための属性。シナリオのステップの数だけ内部ステップを取り、
 * ステップごとの動き（移動・状態のバッジ）を JSON で持たせる（runtime が読む）。
 * 移動 `{m, r, b?, l?, c?, x?}`（b は届かない区間、#180）、状態 `{s, t, e?, p?}`（p は止める `d`・
 * 戻す `u`）、つながりを切る `{k: [a, b], u?}`（u は戻す）、ノードの中身 `{q, a | d}`（足す・除く）と
 * キーと値 `{v, n, t}`（n はキー、t が null なら消す。#181）、構成を切り替える `{y}`（空なら最初の構成。#183）
 */
export function archEmbedAttrs(
  scenario: ArchScenario | undefined,
  esc: (s: string) => string,
  attrs?: Attrs,
): string {
  if (!scenario || scenario.steps.length === 0) return '';
  // カメラ（#109、§6.2）を使わない。シーケンス図と並べるとき（#182）も使わない
  const view = attrs?.values.view;
  const focus =
    attrs?.values.focus === 'none' || view === 'both' || view === 'sequence'
      ? ' data-arch-focus="none"'
      : '';
  const steps = scenario.steps.map((step) =>
    step.actions.map((a) => {
      if (a.type === 'move') {
        return {
          m: a.path,
          r: a.replies,
          ...(a.blocked ? { b: a.blocked } : {}),
          ...(a.label ? { l: a.label } : {}),
          ...(a.code ? { c: a.code } : {}),
          ...(a.repeat > 1 ? { x: a.repeat } : {}),
        };
      }
      if (a.type === 'cut') return { k: [a.from, a.to], ...(a.restore ? { u: 1 } : {}) };
      if (a.type === 'items') return { q: a.node, [a.op === 'add' ? 'a' : 'd']: a.items };
      if (a.type === 'value') return { v: a.node, n: a.key, t: a.value };
      if (a.type === 'layout') return { y: a.name ?? '' };
      return {
        s: a.node,
        t: a.text,
        ...(a.error ? { e: 1 } : {}),
        ...(a.power ? { p: a.power === 'down' ? 'd' : 'u' } : {}),
      };
    }),
  );
  return ` data-embed="arch" data-mds-substeps="${scenario.steps.length}" data-arch-steps="${esc(JSON.stringify(steps))}"${focus}`;
}

/** ステップの発表者ノート（`note:`）を、スライドのノートに足す HTML */
export function archNotesHtml(use: ArchUse | undefined, esc: (s: string) => string): string {
  const steps = use?.scenario?.steps ?? [];
  return steps
    .map((step, i) =>
      step.notes.length > 0
        ? `<p>ステップ ${i + 1}（${esc(step.title)}）：${step.notes.map(esc).join(' ')}</p>\n`
        : '',
    )
    .join('');
}
