// S4：動く構成図の配置（ELK）と再生（offset-path）を確かめる（issue #104、設計プラン §15）
//
// 1. 構成（ノード・入れ子のグループ・つながり）を elkjs の layered で配置し、SVG にする
// 2. 配置の時間を Node と Chromium で測る（初回と2回目以降）。大きめの構成（30ノード）も測る
// 3. パケットを CSS の offset-path と Web Animations API で経路に沿って動かし、
//    経路からのずれ・フレームの間隔・途中の様子（スクリーンショット）を確かめる
//
// 使い方: node spikes/104-arch-layout/run.mjs [出力フォルダ]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const elkPath = createRequire(join(repo, 'packages/embeds/package.json')).resolve(
  'elkjs/lib/elk.bundled.js',
);
const ELK = require(elkPath);
const out = process.argv[2] ?? fileURLToPath(new URL('./result/', import.meta.url));
mkdirSync(out, { recursive: true });

// ---- 構成だけを読む、試作のパーサ（シナリオは読まない） ----
function parse(text) {
  const nodes = [];
  const groups = [];
  const edges = [];
  let direction = 'right';
  const stack = [{ indent: -1, group: null }];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = /^ */.exec(line)[0].length;
    const t = line.trim();
    if (/^scenario\b/.test(t)) break;
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).group;
    let m;
    if ((m = /^direction:\s*(\w+)/.exec(t))) direction = m[1];
    else if ((m = /^group\s+(.+)$/.exec(t))) {
      const g = { id: `g${groups.length}`, label: m[1], parent };
      groups.push(g);
      stack.push({ indent, group: g });
    } else if (/(<->|->|--)/.test(t)) {
      const ids = t.replace(/\s*:.*$/, '').split(/\s*(?:<->|->|--)\s*/);
      for (let i = 0; i + 1 < ids.length; i++) edges.push({ from: ids[i], to: ids[i + 1] });
    } else if ((m = /^([\w-]+)(?:\s+(.+?))?(?:\s+\[(\w+)\])?$/.exec(t))) {
      nodes.push({ id: m[1], label: m[2] ?? m[1], kind: m[3] ?? 'server', parent });
    }
  }
  return { nodes, groups, edges, direction };
}

/** 文字の幅の見積もり（18px。和文は 1em、欧文は 0.6em） */
const textWidth = (s) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 18 : 10.5), 0);

function elkGraph(arch) {
  const node = (n) => ({
    id: n.id,
    width: Math.max(120, textWidth(n.label) + 44),
    height: n.kind === 'database' ? 72 : 60,
  });
  const childrenOf = (parent) => [
    ...arch.groups
      .filter((g) => g.parent === parent)
      .map((g) => ({
        id: g.id,
        layoutOptions: { 'elk.padding': '[top=40,left=18,bottom=18,right=18]' },
        children: childrenOf(g),
      })),
    ...arch.nodes.filter((n) => n.parent === parent).map(node),
  ];
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': arch.direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.spacing.nodeNode': '28',
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeEdge': '12',
      'elk.padding': '[top=12,left=12,bottom=12,right=12]',
    },
    children: childrenOf(null),
    edges: arch.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
}

/** 配置の結果を、絶対座標の箱と経路にする */
function absolute(laid) {
  const boxes = new Map();
  const walk = (n, ox, oy) => {
    const x = ox + (n.x ?? 0);
    const y = oy + (n.y ?? 0);
    boxes.set(n.id, { x, y, w: n.width, h: n.height });
    for (const c of n.children ?? []) walk(c, x, y);
  };
  walk(laid, 0, 0);
  const paths = new Map();
  const visit = (n) => {
    for (const e of n.edges ?? []) {
      // INCLUDE_CHILDREN の経路は、e.container（共通の親）からの相対座標
      const base = boxes.get(e.container ?? n.id) ?? { x: 0, y: 0 };
      const pts = e.sections.flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
      paths.set(
        e.id,
        pts.map((p) => ({ x: base.x + p.x, y: base.y + p.y })),
      );
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(laid);
  return { boxes, paths, width: laid.width, height: laid.height };
}

const d = (pts) =>
  pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

function svg(arch, abs) {
  const parts = [];
  for (const g of arch.groups) {
    const b = abs.boxes.get(g.id);
    parts.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="6 4"/>` +
        `<text x="${b.x + 14}" y="${b.y + 26}" font-size="16" fill="#64748b">${g.label}</text>`,
    );
  }
  arch.edges.forEach((e, i) =>
    parts.push(
      `<path id="e${i}" d="${d(abs.paths.get(`e${i}`))}" fill="none" stroke="#94a3b8" stroke-width="2.5" marker-end="url(#arrow)"/>`,
    ),
  );
  for (const n of arch.nodes) {
    const b = abs.boxes.get(n.id);
    const dash = n.kind === 'external' ? ' stroke-dasharray="7 5"' : '';
    const shape =
      n.kind === 'database'
        ? `<path d="M ${b.x} ${b.y + 10} a ${b.w / 2} 10 0 0 0 ${b.w} 0 v ${b.h - 20} a ${b.w / 2} 10 0 0 1 ${-b.w} 0 z M ${b.x} ${b.y + 10} a ${b.w / 2} 10 0 0 1 ${b.w} 0" fill="#fff" stroke="#2563eb" stroke-width="2"/>`
        : `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${n.kind === 'user' ? 30 : 10}" fill="#fff" stroke="#2563eb" stroke-width="2"${dash}/>`;
    parts.push(
      `<g id="n-${n.id}">${shape}<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 6}" text-anchor="middle" font-size="18" fill="#0f172a">${n.label}</text></g>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${abs.width} ${abs.height}" width="${abs.width}" height="${abs.height}" font-family="'Noto Sans JP', sans-serif">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#94a3b8"/></marker></defs>
${parts.join('\n')}</svg>`;
}

/** 重なりの検査：ノード同士・グループの外にはみ出すノード・ノードを貫く線 */
function check(arch, abs) {
  const inside = (p, b, m = 0) =>
    p.x > b.x + m && p.x < b.x + b.w - m && p.y > b.y + m && p.y < b.y + b.h - m;
  const overlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  let nodeOverlaps = 0;
  let outsideGroup = 0;
  let edgeThroughNode = 0;
  const ns = arch.nodes.map((n) => ({ n, b: abs.boxes.get(n.id) }));
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) if (overlap(ns[i].b, ns[j].b)) nodeOverlaps++;
    for (let g = ns[i].n.parent; g; g = g.parent) {
      const gb = abs.boxes.get(g.id);
      const b = ns[i].b;
      if (b.x < gb.x || b.y < gb.y || b.x + b.w > gb.x + gb.w || b.y + b.h > gb.y + gb.h) {
        outsideGroup++;
      }
    }
  }
  arch.edges.forEach((e, i) => {
    const pts = abs.paths.get(`e${i}`);
    for (const { n, b } of ns) {
      if (n.id === e.from || n.id === e.to) continue;
      // 線分を細かく区切って、ノードの内側（余白 2px）を通るか
      for (let k = 0; k + 1 < pts.length; k++) {
        for (let t = 0; t <= 1; t += 0.05) {
          const p = {
            x: pts[k].x + (pts[k + 1].x - pts[k].x) * t,
            y: pts[k].y + (pts[k + 1].y - pts[k].y) * t,
          };
          if (inside(p, b, 2)) {
            edgeThroughNode++;
            return;
          }
        }
      }
    }
  });
  return { nodeOverlaps, outsideGroup, edgeThroughNode };
}

/** 大きめの構成（30ノード・3段の入れ子・40本のつながり）。時間を測るため */
function bigArch() {
  const lines = ['direction: right'];
  for (let g = 0; g < 3; g++) {
    lines.push(`group 層${g}`);
    for (let s = 0; s < 2; s++) {
      lines.push(`  group 区画${g}-${s}`);
      for (let n = 0; n < 5; n++) lines.push(`    n${g}${s}${n} ノード${g}${s}${n}`);
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = `n${i % 3}${i % 2}${i % 5}`;
    const b = `n${(i + 1) % 3}${(i + 3) % 2}${(i * 7) % 5}`;
    if (a !== b) lines.push(`${a} -> ${b}`);
  }
  return lines.join('\n');
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timeNode(arch, runs = 20) {
  const elk = new ELK();
  const t0 = performance.now();
  await elk.layout(elkGraph(arch));
  const first = performance.now() - t0;
  const rest = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await elk.layout(elkGraph(arch));
    rest.push(performance.now() - t);
  }
  return { first: Math.round(first * 10) / 10, median: Math.round(median(rest) * 10) / 10 };
}

const cases = [
  {
    name: 'order-system（横・グループ）',
    file: 'right',
    text: readFileSync(join(repo, 'fixtures/assets/order-system.arch'), 'utf8'),
  },
  {
    name: '13-arch のコードブロック（上から下）',
    file: 'down',
    text: /```arch\n([\s\S]*?)```/.exec(readFileSync(join(repo, 'fixtures/13-arch.md'), 'utf8'))[1],
  },
  { name: '大きめの構成（30ノード・入れ子3段）', file: 'big', text: bigArch() },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const result = {
  elk: { version: JSON.parse(readFileSync(join(elkPath, '../../package.json'), 'utf8')).version },
  cases: [],
};

for (const c of cases) {
  const arch = parse(c.text);
  const laid = await new ELK().layout(elkGraph(arch));
  const abs = absolute(laid);
  const node = await timeNode(arch);
  // Chromium の中で配置の時間を測る（エディタのプレビューと同じ条件）
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: elkPath });
  const browserMs = await page.evaluate(
    async (graph) => {
      const elk = new ELK();
      const times = [];
      for (let i = 0; i < 21; i++) {
        const t = performance.now();
        await elk.layout(JSON.parse(graph));
        times.push(performance.now() - t);
      }
      const rest = times.slice(1).sort((a, b) => a - b);
      const r = (x) => Math.round(x * 10) / 10;
      return { first: r(times[0]), median: r(rest[Math.floor(rest.length / 2)]) };
    },
    JSON.stringify(elkGraph(arch)),
  );
  const svgText = svg(arch, abs);
  writeFileSync(join(out, `layout-${c.file}.svg`), svgText);
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#fff">${svgText}</body></html>`,
  );
  await page.locator('svg').screenshot({ path: join(out, `layout-${c.file}.png`) });
  result.cases.push({
    name: c.name,
    nodes: arch.nodes.length,
    groups: arch.groups.length,
    edges: arch.edges.length,
    size: [Math.round(abs.width), Math.round(abs.height)],
    nodeMs: node,
    browserMs,
    ...check(arch, abs),
  });
  console.log(c.name, JSON.stringify(result.cases.at(-1)));

  if (c.file !== 'right') continue;
  // ---- パケット：user -> web -> api と api -> queue -> worker（それぞれ2区間） ----
  const route = (ids) => {
    const pts = [];
    for (let i = 0; i + 1 < ids.length; i++) {
      const k = arch.edges.findIndex((e) => e.from === ids[i] && e.to === ids[i + 1]);
      const seg = abs.paths.get(`e${k}`);
      pts.push(...(pts.length ? seg.slice(1) : seg));
    }
    return d(pts);
  };
  const routes = [route(['user', 'web', 'api']), route(['api', 'queue', 'worker'])];
  result.motion = await page.evaluate(async (routes) => {
    const svg = document.querySelector('svg');
    const ns = 'http://www.w3.org/2000/svg';
    const results = [];
    for (const r of routes) {
      const ref = document.createElementNS(ns, 'path');
      ref.setAttribute('d', r);
      svg.append(ref);
      const total = ref.getTotalLength();
      const packet = document.createElementNS(ns, 'circle');
      packet.setAttribute('r', '10');
      packet.setAttribute('fill', '#2563eb');
      packet.style.offsetPath = `path('${r}')`;
      packet.style.offsetRotate = '0deg';
      svg.append(packet);
      const duration = 1200; // 2区間 × 0.6秒
      const anim = packet.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], {
        duration,
        easing: 'linear',
        fill: 'forwards',
      });
      // 経路からのずれ：途中の 40 点で、パケットの中心と経路上の点を比べる
      anim.pause();
      let maxError = 0;
      const ctm = svg.getScreenCTM();
      for (let i = 0; i <= 40; i++) {
        anim.currentTime = (duration * i) / 40;
        const box = packet.getBoundingClientRect();
        const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const p = ref.getPointAtLength((total * i) / 40);
        const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
        maxError = Math.max(maxError, Math.hypot(c.x - q.x, c.y - q.y));
      }
      // フレームの間隔：再生して requestAnimationFrame で測る
      anim.currentTime = 0;
      anim.play();
      const frames = [];
      await new Promise((resolve) => {
        const tick = (t) => {
          frames.push(t);
          if (anim.playState === 'finished') resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const gaps = frames.slice(1).map((t, i) => t - frames[i]);
      const r1 = (x) => Math.round(x * 10) / 10;
      results.push({
        length: Math.round(total),
        maxErrorPx: r1(maxError),
        frames: frames.length,
        meanGapMs: r1(gaps.reduce((a, b) => a + b, 0) / gaps.length),
        maxGapMs: r1(Math.max(...gaps)),
      });
      packet.remove();
      ref.remove();
    }
    return results;
  }, routes);
  console.log('motion', JSON.stringify(result.motion));

  // 途中の様子：5つの時点でパケットを止めて撮る
  await page.evaluate((r) => {
    const svg = document.querySelector('svg');
    const packet = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    packet.setAttribute('r', '11');
    packet.setAttribute('fill', '#2563eb');
    packet.style.offsetPath = `path('${r}')`;
    svg.append(packet);
    window.anim = packet.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], {
      duration: 1200,
      fill: 'forwards',
    });
    window.anim.pause();
  }, routes[0]);
  for (const [i, t] of [0, 0.25, 0.5, 0.75, 1].entries()) {
    await page.evaluate((t) => (window.anim.currentTime = 1200 * t), t);
    await page.locator('svg').screenshot({ path: join(out, `packet-${i}.png`) });
  }
}

writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 1));
await browser.close();
