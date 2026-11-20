/**
 * 動く構成図を、ELK で配置して SVG にする（#107、docs/arch-diagram.md §6・§8、S4 #104）。
 *
 * CLI は計測の Chromium で、エディタはプレビューの iframe で呼ぶ（どちらもテーマの CSS と
 * 同梱のフォントがあるページ）。ページには先に elkjs（elk.bundled.js。グローバルの ELK）を入れておく。
 * renderMermaid と同じく、外側の変数を使わない1つの関数にしている（文字列にして iframe に渡す）。
 *
 * - ノードの大きさは、本文のフォントで表示名の幅を測って決める
 * - 色は SVG に書かず、クラスを付けて基本の CSS（テーマの変数）で塗る。テーマと accent: に合う
 * - 再生（#108）のため、ノードに data-node、つながりに data-from・data-to を付ける
 * - 書き出した HTML には SVG だけが入る（配置エンジンは入れない）
 */
export interface ArchRenderInput {
  /** SVG の中の ID（矢印の印）を、資料の中で重ならないようにする接頭辞 */
  id: string;
  diagram: {
    direction: 'right' | 'down';
    nodes: Array<{ id: string; label: string; kind: string; group?: string; max?: number }>;
    groups: Array<{ id: string; label: string; parent?: string }>;
    edges: Array<{ from: string; to: string; type: string; label?: string }>;
    /** シナリオ（ノードの中身の表の大きさを決めるため。#181） */
    scenarios?: Array<{
      steps: Array<{
        actions: Array<{
          type: string;
          node?: string;
          op?: string;
          items?: string[];
          key?: string;
          value?: string | null;
        }>;
      }>;
    }>;
  };
}

export async function renderArch(input: {
  items: ArchRenderInput[];
}): Promise<Array<{ svg: string; width: number; height: number } | { error: string }>> {
  type ElkNode = {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    children?: ElkNode[];
    edges?: ElkEdge[];
    layoutOptions?: Record<string, string>;
    labels?: Array<{ text: string; x?: number; y?: number; width: number; height: number }>;
  };
  type Point = { x: number; y: number };
  type ElkEdge = {
    id: string;
    sources: string[];
    targets: string[];
    container?: string;
    sections?: Array<{ startPoint: Point; endPoint: Point; bendPoints?: Point[] }>;
    labels?: Array<{ text: string; x?: number; y?: number; width: number; height: number }>;
  };
  const ELK = (window as unknown as { ELK?: new () => { layout(g: ElkNode): Promise<ElkNode> } })
    .ELK;
  if (!ELK) return input.items.map(() => ({ error: '配置エンジン（ELK）を読み込めません' }));
  const elk = new ELK();
  const deck = document.querySelector<HTMLElement>('.mds-deck') ?? document.body;
  const family = getComputedStyle(deck).getPropertyValue('--mds-font-body').trim() || 'sans-serif';
  const ctx = document.createElement('canvas').getContext('2d')!;
  const textWidth = (text: string, size: number, weight = 500) => {
    ctx.font = `${weight} ${size}px ${family}`;
    return ctx.measureText(text).width;
  };
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const r1 = (n: number) => Math.round(n * 10) / 10;

  // 文字の大きさ（SVG の座標で）。図は枠に合わせて縮むので、大きめに描いておく
  const FONT = 20;
  const GROUP_FONT = 16;
  const LABEL_FONT = 15;
  const ICON = 30;
  const CHIP_FONT = 14;

  const results: Array<{ svg: string; width: number; height: number } | { error: string }> = [];
  for (const { id, diagram } of input.items) {
    try {
      const sizes = new Map<string, { w: number; h: number; icon: number }>();
      for (const n of diagram.nodes) {
        const icon = n.kind === 'user' || n.kind === 'storage' ? ICON : 0;
        const extra = n.kind === 'queue' ? 24 : 0;
        const w = Math.max(116, Math.ceil(textWidth(n.label, FONT) + 36 + icon + extra));
        const h = n.kind === 'database' ? 78 : n.kind === 'client' ? 66 : 58;
        sizes.set(n.id, { w, h, icon });
      }
      /*
       * ノードの中身の表（#181）：上限（max）か、シナリオで同時に入る数だけ札の枠を取り、キーと値は1行ずつ。
       * 表は ELK のノードの外のラベルにして、配置に場所を取らせる（右向きの図はノードの下、下向きは右）
       */
      const tables = new Map<
        string,
        { w: number; h: number; slots: number; perRow: number; chipW: number }
      >();
      {
        const most = new Map<string, number>();
        const names = new Map<string, Set<string>>();
        const keys = new Map<string, Map<string, Set<string>>>();
        const maxOf = new Map(diagram.nodes.map((n) => [n.id, n.max]));
        for (const sc of diagram.scenarios ?? []) {
          const held = new Map<string, string[]>();
          for (const st of sc.steps) {
            for (const a of st.actions) {
              if (a.type === 'items' && a.node && a.items) {
                const list = held.get(a.node) ?? [];
                held.set(a.node, list);
                const seen = names.get(a.node) ?? new Set();
                names.set(a.node, seen);
                const max = maxOf.get(a.node);
                for (const item of a.items) {
                  seen.add(item);
                  if (a.op === 'add') {
                    if (max === undefined || list.length < max) list.push(item);
                  } else if (list.includes(item)) list.splice(list.indexOf(item), 1);
                }
                most.set(a.node, Math.max(most.get(a.node) ?? 0, list.length));
              }
              if (a.type === 'value' && a.node && a.key) {
                const kv = keys.get(a.node) ?? new Map<string, Set<string>>();
                keys.set(a.node, kv);
                const values = kv.get(a.key) ?? new Set<string>();
                kv.set(a.key, values);
                if (a.value) values.add(a.value);
              }
            }
          }
        }
        for (const n of diagram.nodes) {
          const slots = n.max ?? most.get(n.id) ?? 0;
          const kv = keys.get(n.id);
          if (!slots && !kv?.size) continue;
          const chipW = Math.max(
            36,
            ...[...(names.get(n.id) ?? [])].map((t) =>
              Math.ceil(textWidth(t, CHIP_FONT, 700) + 16),
            ),
          );
          // 札はノードの幅に近い幅で折り返す（表が横に広がると、図全体が縮んで文字が小さくなるため）
          const limit = Math.max(sizes.get(n.id)!.w + 80, 2 * (chipW + 6));
          const perRow = Math.max(1, Math.min(slots || 1, Math.floor((limit + 6) / (chipW + 6))));
          const rows = slots ? Math.ceil(slots / perRow) : 0;
          const chipsW = slots ? perRow * chipW + (perRow - 1) * 6 : 0;
          let keyW = 0;
          let valW = 0;
          for (const [key, values] of kv ?? []) {
            keyW = Math.max(keyW, textWidth(key, CHIP_FONT, 600));
            for (const v of values) valW = Math.max(valW, textWidth(v, CHIP_FONT, 700));
          }
          const kvW = kv?.size ? Math.ceil(keyW + 24 + valW) : 0;
          const w = Math.max(chipsW, kvW, 80) + 20;
          const h = 8 + (slots ? 24 + rows * 32 : 0) + (kv?.size ? kv.size * 24 + 4 : 0) + 4;
          tables.set(n.id, { w, h, slots, perRow, chipW });
        }
      }
      const tableLabel = (id: string) => {
        const t = tables.get(id);
        if (!t) return {};
        return {
          labels: [{ text: 'table', width: t.w, height: t.h }],
          layoutOptions: {
            'elk.nodeLabels.placement':
              diagram.direction === 'down'
                ? 'OUTSIDE V_CENTER H_RIGHT'
                : 'OUTSIDE V_BOTTOM H_CENTER',
            'elk.spacing.labelNode': '12',
          },
        };
      };

      const childrenOf = (parent: string | undefined): ElkNode[] => [
        ...diagram.groups
          .filter((g) => g.parent === parent)
          .map((g) => ({
            id: g.id,
            layoutOptions: { 'elk.padding': '[top=46,left=20,bottom=20,right=20]' },
            children: childrenOf(g.id),
          })),
        ...diagram.nodes
          .filter((n) => n.group === parent)
          .map((n) => ({
            id: n.id,
            width: sizes.get(n.id)!.w,
            height: sizes.get(n.id)!.h,
            ...tableLabel(n.id),
          })),
      ];
      const known = new Set(diagram.nodes.map((n) => n.id));
      const edges = diagram.edges.filter((e) => known.has(e.from) && known.has(e.to));
      const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': diagram.direction === 'down' ? 'DOWN' : 'RIGHT',
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.spacing.nodeNodeBetweenLayers': '60',
          'elk.spacing.nodeNode': '30',
          'elk.spacing.edgeNode': '20',
          'elk.spacing.edgeEdge': '14',
          'elk.spacing.edgeLabel': '6',
          'elk.edgeLabels.placement': 'CENTER',
          'elk.padding': '[top=8,left=8,bottom=8,right=8]',
        },
        children: childrenOf(undefined),
        edges: edges.map((e, i) => ({
          id: `e${i}`,
          sources: [e.from],
          targets: [e.to],
          labels: e.label
            ? [{ text: e.label, width: Math.ceil(textWidth(e.label, LABEL_FONT) + 14), height: 24 }]
            : [],
        })),
      };
      const laid = await elk.layout(graph);

      // 絶対座標（ELK の座標は親からの相対）
      const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
      const tableAt = new Map<string, { x: number; y: number }>();
      const walk = (n: ElkNode, ox: number, oy: number) => {
        const x = ox + (n.x ?? 0);
        const y = oy + (n.y ?? 0);
        boxes.set(n.id, { x, y, w: n.width ?? 0, h: n.height ?? 0 });
        const label = n.labels?.[0];
        if (tables.has(n.id) && label?.x !== undefined && label.y !== undefined) {
          tableAt.set(n.id, { x: x + label.x, y: y + label.y });
        }
        for (const c of n.children ?? []) walk(c, x, y);
      };
      walk(laid, 0, 0);
      const routes = new Map<string, { points: Point[]; label?: { x: number; y: number } }>();
      const visit = (n: ElkNode) => {
        for (const e of n.edges ?? []) {
          // INCLUDE_CHILDREN の経路は、e.container（共通の親）からの相対座標
          const base = boxes.get(e.container ?? n.id) ?? { x: 0, y: 0 };
          const points = (e.sections ?? []).flatMap((s) => [
            s.startPoint,
            ...(s.bendPoints ?? []),
            s.endPoint,
          ]);
          const label = e.labels?.[0];
          routes.set(e.id, {
            points: points.map((p) => ({ x: base.x + p.x, y: base.y + p.y })),
            ...(label && label.x !== undefined && label.y !== undefined
              ? { label: { x: base.x + label.x, y: base.y + label.y } }
              : {}),
          });
        }
        for (const c of n.children ?? []) visit(c);
      };
      visit(laid);

      const pathOf = (points: Point[]) =>
        points.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`).join(' ');
      const parts: string[] = [];
      // グループ（外側から）
      for (const g of diagram.groups) {
        const b = boxes.get(g.id)!;
        parts.push(
          `<g class="arch-group" data-group="${esc(g.id)}"><rect class="shape" x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="14"/></g>`,
        );
      }
      // 矢印の先：線の端に直接描く（marker の ID は、同じ図を何枚かのスライドに置くと重なり、
      // 隠れたスライドの印を参照して消えてしまうため）
      const head = (tip: Point, from: Point) => {
        const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
        const ux = (tip.x - from.x) / len;
        const uy = (tip.y - from.y) / len;
        const bx = tip.x - ux * 11;
        const by = tip.y - uy * 11;
        return `<path class="arch-head" d="M${r1(tip.x)} ${r1(tip.y)}L${r1(bx - uy * 6)} ${r1(by + ux * 6)}L${r1(bx + uy * 6)} ${r1(by - ux * 6)}z"/>`;
      };
      // つながり
      edges.forEach((e, i) => {
        const route = routes.get(`e${i}`);
        if (!route || route.points.length < 2) return;
        const pts = route.points;
        const heads =
          e.type === 'line'
            ? ''
            : head(pts.at(-1)!, pts.at(-2)!) + (e.type === 'both' ? head(pts[0]!, pts[1]!) : '');
        parts.push(
          `<g class="arch-edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-type="${esc(e.type)}"><path d="${pathOf(pts)}"/>${heads}</g>`,
        );
      });
      edges.forEach((e, i) => {
        const at = routes.get(`e${i}`)?.label;
        if (!e.label || !at) return;
        const w = Math.ceil(textWidth(e.label, LABEL_FONT) + 14);
        parts.push(
          `<g class="arch-edge-label"><rect x="${r1(at.x)}" y="${r1(at.y)}" width="${w}" height="24" rx="6"/><text x="${r1(at.x + w / 2)}" y="${r1(at.y + 12)}">${esc(e.label)}</text></g>`,
        );
      });
      // グループの名前：線の上に、地の色を敷いて描く（S4：線が名前の上を通ることがあるため）
      for (const g of diagram.groups) {
        const b = boxes.get(g.id)!;
        const w = Math.ceil(textWidth(g.label, GROUP_FONT, 600) + 16);
        parts.push(
          `<g class="arch-group-label"><rect x="${r1(b.x + 10)}" y="${r1(b.y + 10)}" width="${w}" height="26" rx="6"/><text x="${r1(b.x + 18)}" y="${r1(b.y + 23)}">${esc(g.label)}</text></g>`,
        );
      }
      // ノードの中身の表の場所（data-table）と、札の並べ方（data-chips：枠の数・1行の数・札の幅）
      const tableAttrs = (id: string, max: number | undefined) => {
        const t = tables.get(id);
        const at = tableAt.get(id);
        if (!t || !at) return '';
        return ` data-table="${r1(at.x)} ${r1(at.y)} ${r1(t.w)} ${r1(t.h)}" data-chips="${t.slots} ${t.perRow} ${t.chipW}"${max !== undefined ? ` data-max="${max}"` : ''}`;
      };
      // ノード
      for (const n of diagram.nodes) {
        const b = boxes.get(n.id)!;
        const { icon } = sizes.get(n.id)!;
        const { x, y, w, h } = b;
        const cy = y + h / 2;
        let shape: string;
        let decor = '';
        switch (n.kind) {
          case 'database':
            shape = `<path class="shape" d="M${r1(x)} ${r1(y + 10)}a${r1(w / 2)} 10 0 0 0 ${r1(w)} 0v${r1(h - 20)}a${r1(w / 2)} 10 0 0 1 ${r1(-w)} 0z"/>`;
            decor = `<path class="rim" d="M${r1(x)} ${r1(y + 10)}a${r1(w / 2)} 10 0 0 1 ${r1(w)} 0"/>`;
            break;
          case 'user':
            shape = `<rect class="shape" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(h / 2)}"/>`;
            decor = `<circle class="icon" cx="${r1(x + 26)}" cy="${r1(cy - 6)}" r="6"/><path class="icon" d="M${r1(x + 15)} ${r1(cy + 13)}a11 9 0 0 1 22 0z"/>`;
            break;
          case 'client':
            shape = `<rect class="shape" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="8"/>`;
            decor = `<path class="rim" d="M${r1(x)} ${r1(y + 15)}H${r1(x + w)}"/><circle class="dot" cx="${r1(x + 10)}" cy="${r1(y + 8)}" r="2.5"/><circle class="dot" cx="${r1(x + 18)}" cy="${r1(y + 8)}" r="2.5"/><circle class="dot" cx="${r1(x + 26)}" cy="${r1(y + 8)}" r="2.5"/>`;
            break;
          case 'queue':
            shape = `<rect class="shape" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="8"/>`;
            decor = [10, 16, 22]
              .map(
                (d) => `<path class="rim" d="M${r1(x + w - d)} ${r1(y + 14)}V${r1(y + h - 14)}"/>`,
              )
              .join('');
            break;
          case 'storage':
            shape = `<rect class="shape" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="8"/>`;
            decor = `<path class="icon-line" d="M${r1(x + 16)} ${r1(cy - 12)}h12l6 6v18h-18z M${r1(x + 28)} ${r1(cy - 12)}v6h6"/>`;
            break;
          default:
            shape = `<rect class="shape" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="10"/>`;
        }
        const ty = n.kind === 'client' ? cy + 7 : n.kind === 'database' ? cy + 5 : cy;
        const tx = x + icon + (w - icon - (n.kind === 'queue' ? 24 : 0)) / 2;
        parts.push(
          `<g class="arch-node kind-${esc(n.kind)}" data-node="${esc(n.id)}" data-box="${r1(x)} ${r1(y)} ${r1(w)} ${r1(h)}"${tableAttrs(n.id, n.max)}>${shape}${decor}<text x="${r1(tx)}" y="${r1(ty)}">${esc(n.label)}</text></g>`,
        );
      }

      const width = Math.ceil(laid.width ?? 0);
      const height = Math.ceil(laid.height ?? 0);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" class="mds-arch-svg" viewBox="-4 -4 ${width + 8} ${height + 8}" data-arch="${esc(id)}">` +
        parts.join('') +
        '</svg>';
      results.push({ svg, width: width + 8, height: height + 8 });
    } catch (error) {
      results.push({ error: String(error) });
    }
  }
  return results;
}
