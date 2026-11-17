import type { MeasureJob, Measurement } from '@mds/core';

/** iframe の役目：計測・プレビュー・発表 */
export type FrameMode = 'measure' | 'preview' | 'present';

/**
 * 隔離した iframe（`sandbox="allow-scripts"`、オリジンは不透明。設計プラン §9.4）の中で動くスクリプト（#73）。
 * エディタとは postMessage だけでやりとりする。文字列にして srcdoc に埋め込むので、
 * 外側の変数を使わない1つの関数にする（measureJobs と fitSlides は、同じく文字列にして引数で渡す）。
 *
 * - フォント：エディタが読み込んだデータで FontFace を作る（iframe からは Service Worker のキャッシュを使えないため）
 * - 素材（画像・動画）：エディタが渡した Blob から、この iframe の中で URL を作る。HTML の中の
 *   `data:text/plain,mds-asset=…` を、その URL に置き換える
 * - 計測：core の measureJobs で測る
 * - プレビュー：スライドの HTML を受け取り、変わったスライドだけを差し替える（動画や図はそのまま動き続ける）
 */
export function frameHost(
  mode: FrameMode,
  measureJobs: (jobs: MeasureJob[]) => Measurement[],
  fitSlides: (root?: ParentNode) => void,
  renderMermaid: (input: { codes: string[]; ids: string[] }) => Promise<unknown[]>,
): void {
  const doc = document;
  const win = window;
  const send = (message: object) => win.parent.postMessage(message, '*');
  const urls = new Map<string, string>();
  const fonts = new Set<string>();
  const ASSET = /data:text\/plain,mds-asset=([A-Za-z0-9%._~-]+)/g;
  const resolve = (text: string) =>
    text.replace(ASSET, (whole, key: string) => urls.get(key) ?? whole);

  type Slide = HTMLElement & { mdsHtml?: string };
  const deckOf = () => doc.querySelector<HTMLElement>('.mds-deck');
  const slidesOf = () => Array.from(deckOf()?.querySelectorAll<Slide>(':scope > .mds-slide') ?? []);

  /** 画面にいちばん大きく見えているスライド（プレビュー） */
  const slideInView = (): Slide | undefined => {
    const height = doc.documentElement.clientHeight;
    let best: Slide | undefined;
    let bestVisible = -Infinity;
    for (const slide of slidesOf()) {
      const rect = slide.getBoundingClientRect();
      const visible = Math.min(rect.bottom, height) - Math.max(rect.top, 0);
      if (visible > bestVisible) {
        best = slide;
        bestVisible = visible;
      }
    }
    return best;
  };
  /** 発表で、このスライド（隠したスライドなら次のスライド）を指す値 */
  const slideRef = (slide: Slide | undefined) => {
    const slides = slidesOf();
    const shown = slides.filter((s) => !s.hasAttribute('data-hidden'));
    const k = slide ? slides.indexOf(slide) : 0;
    const target = slides.slice(Math.max(0, k)).find((s) => shown.includes(s)) ?? shown.at(-1);
    if (!target) return '1';
    return target.dataset.id ?? String(shown.indexOf(target) + 1);
  };

  /** スライド1枚がプレビューの幅に収まる倍率 */
  const fitZoom = () => {
    const deck = deckOf();
    if (!deck) return;
    const width = parseFloat(getComputedStyle(deck).getPropertyValue('--mds-w')) || 1280;
    const zoom = Math.max(0.1, (doc.documentElement.clientWidth - 32) / width);
    deck.style.setProperty('--mds-preview-zoom', String(zoom));
  };

  /** 受け取った HTML で、スタイルとスライドを差し替える。変わっていないスライドはそのまま残す */
  const update = (html: string) => {
    const next = new DOMParser().parseFromString(resolve(html), 'text/html');
    doc.documentElement.lang = next.documentElement.lang;
    const style =
      doc.getElementById('mds-deck-style') ?? doc.head.appendChild(doc.createElement('style'));
    style.id = 'mds-deck-style';
    const css = Array.from(next.head.querySelectorAll('style'), (s) => s.textContent).join('\n');
    if (style.textContent !== css) style.textContent = css;
    const nextDeck = next.querySelector<HTMLElement>('.mds-deck');
    let deck = deckOf();
    if (!nextDeck) return;
    if (!deck) {
      deck = doc.createElement('main');
      doc.body.prepend(deck);
    }
    const zoom = deck.style.getPropertyValue('--mds-preview-zoom');
    for (const attr of Array.from(deck.attributes)) deck.removeAttribute(attr.name);
    for (const attr of Array.from(nextDeck.attributes)) deck.setAttribute(attr.name, attr.value);
    if (zoom) deck.style.setProperty('--mds-preview-zoom', zoom);
    deck.setAttribute('data-preview', '');

    // 見ていたスライドを、同じ位置に残す
    const anchor = slideInView();
    const anchorIndex = anchor ? slidesOf().indexOf(anchor) : -1;
    const anchorTop = anchor?.getBoundingClientRect().top ?? 0;

    const old = new Map<string, Slide[]>();
    for (const slide of slidesOf()) {
      const list = old.get(slide.mdsHtml ?? '') ?? [];
      list.push(slide);
      old.set(slide.mdsHtml ?? '', list);
    }
    const changed: Slide[] = [];
    const nodes = Array.from(nextDeck.children, (child): Element => {
      if (!child.classList.contains('mds-slide')) return doc.importNode(child, true);
      const key = child.outerHTML;
      const reuse = old.get(key)?.shift();
      if (reuse) return reuse;
      const node = doc.importNode(child, true) as Slide;
      node.mdsHtml = key;
      changed.push(node);
      return node;
    });
    deck.replaceChildren(...nodes);
    fitZoom();
    if (changed.length > 0) fitSlides(doc);
    const slides = slidesOf();
    const target = slides[Math.min(anchorIndex, slides.length - 1)];
    if (target && anchorIndex >= 0) {
      doc.scrollingElement!.scrollTop += target.getBoundingClientRect().top - anchorTop;
    }
  };

  /** 発表：HTML の中の素材の印を、この iframe で作った URL に置き換える */
  const resolveDom = () => {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[src], [poster], [style]'))) {
      for (const name of ['src', 'poster', 'style']) {
        const value = el.getAttribute(name);
        if (value?.includes('data:text/plain,mds-asset=')) el.setAttribute(name, resolve(value));
      }
      if (el instanceof HTMLVideoElement && el.src.startsWith('blob:')) el.load();
    }
  };

  type Message =
    | {
        id: number;
        type: 'fonts';
        faces: Array<{
          url: string;
          family: string;
          weight: string;
          style?: string;
          range: string;
          data: ArrayBuffer;
        }>;
      }
    | { id: number; type: 'assets'; assets: Array<[string, Blob]> }
    | { id: number; type: 'script'; name: string; code: string }
    | { id: number; type: 'diagrams'; codes: string[]; ids: string[] }
    | { id: number; type: 'measure'; jobs: MeasureJob[] }
    | { id: number; type: 'page'; html: string }
    | { id: number; type: 'update'; html: string }
    | { id: number; type: 'show'; slide: string }
    | { id: number; type: 'view' };

  const handle = async (m: Message): Promise<object | undefined> => {
    switch (m.type) {
      case 'fonts': {
        const loads: Array<Promise<unknown>> = [];
        for (const face of m.faces) {
          if (fonts.has(face.url)) continue;
          fonts.add(face.url);
          const font = new FontFace(face.family, face.data, {
            weight: face.weight,
            style: face.style ?? 'normal',
            unicodeRange: face.range,
            display: 'block',
          });
          doc.fonts.add(font);
          loads.push(font.load().catch(() => undefined));
        }
        await Promise.all(loads);
        if (mode === 'preview' && loads.length > 0) fitSlides(doc);
        return { type: 'done' };
      }
      case 'assets':
        for (const [key, blob] of m.assets) {
          if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
        }
        if (mode === 'present') resolveDom();
        return { type: 'done' };
      case 'measure':
        return { type: 'measured', results: measureJobs(m.jobs) };
      case 'script': {
        // ライブラリ（Mermaid など）を、使うときに1回だけ読み込む
        if (!doc.querySelector(`script[data-name="${m.name}"]`)) {
          const script = doc.createElement('script');
          script.dataset.name = m.name;
          script.textContent = m.code;
          doc.head.append(script);
        }
        return { type: 'done' };
      }
      case 'diagrams':
        return { type: 'diagrams', results: await renderMermaid({ codes: m.codes, ids: m.ids }) };
      case 'page': {
        // 計測のページ：テーマ・縦横比・カスタム CSS を差し替える（フォントは読み込んだまま）
        const next = new DOMParser().parseFromString(m.html, 'text/html');
        const style = doc.getElementById('mds-deck-style')!;
        style.textContent = Array.from(
          next.head.querySelectorAll('style'),
          (s) => s.textContent,
        ).join('\n');
        const deck = deckOf()!;
        const nextDeck = next.querySelector('.mds-deck')!;
        for (const attr of Array.from(deck.attributes)) deck.removeAttribute(attr.name);
        for (const attr of Array.from(nextDeck.attributes))
          deck.setAttribute(attr.name, attr.value);
        return { type: 'done' };
      }
      case 'update':
        update(m.html);
        return { type: 'done', slide: slideRef(slideInView()) };
      case 'show': {
        const slide =
          slidesOf().find((s) => s.dataset.id === m.slide) ?? slidesOf()[Number(m.slide) - 1];
        slide?.scrollIntoView({ block: 'center' });
        return { type: 'done' };
      }
      case 'view':
        return { type: 'view', slide: slideRef(slideInView()) };
    }
  };

  win.addEventListener('message', (event) => {
    if (event.source !== win.parent) return;
    const message = event.data as Message;
    void handle(message).then((reply) => {
      if (reply) send({ ...reply, id: message.id });
    });
  });

  if (mode === 'preview') {
    const style = doc.createElement('style');
    style.textContent = `
html { background: #e2e8f0; }
body { margin: 0; }
.mds-deck[data-preview] { padding: 16px 0; gap: 16px; }
.mds-deck[data-preview] > .mds-slide { zoom: var(--mds-preview-zoom, 1); }
.mds-deck[data-preview] > .mds-slide * { overflow-anchor: none; }
`;
    doc.head.append(style);
    win.addEventListener('resize', fitZoom);
    // S で、見えているスライドから発表を始める（mds dev のプレビューと同じ。#60）
    doc.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        send({ type: 'present', slide: slideRef(slideInView()) });
      }
    });
  }
  send({ type: 'ready', mode });
}
