import type { MeasureJob, Measurement } from '@mdhs/core';

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
  fitSlides: (root: ParentNode) => void,
  renderMermaid: (input: { codes: string[]; ids: string[] }) => Promise<unknown[]>,
  renderArch: (input: { items: unknown[] }) => Promise<unknown[]>,
): void {
  const doc = document;
  const win = window;
  const send = (message: object) => win.parent.postMessage(message, '*');
  const urls = new Map<string, string>();
  const fonts = new Set<string>();
  const ASSET = /data:text\/plain,mds-asset=([A-Za-z0-9%._~-]+)/g;
  const resolve = (text: string) =>
    text.replace(ASSET, (whole, key: string) => urls.get(key) ?? whole);

  type Slide = HTMLElement & { mdsKey?: string };
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

  /** ページの部分（スタイル・言語・デッキの属性）を差し替える */
  const applyHead = (html: string) => {
    const next = new DOMParser().parseFromString(html, 'text/html');
    doc.documentElement.lang = next.documentElement.lang;
    const style =
      doc.getElementById('mds-deck-style') ?? doc.head.appendChild(doc.createElement('style'));
    style.id = 'mds-deck-style';
    const css = Array.from(next.head.querySelectorAll('style'), (s) => s.textContent).join('\n');
    if (style.textContent !== css) style.textContent = css;
    const nextDeck = next.querySelector<HTMLElement>('.mds-deck');
    if (!nextDeck) return;
    let deck = deckOf();
    if (!deck) {
      deck = doc.createElement('main');
      doc.body.prepend(deck);
    }
    const zoom = deck.style.getPropertyValue('--mds-preview-zoom');
    for (const attr of Array.from(deck.attributes)) deck.removeAttribute(attr.name);
    for (const attr of Array.from(nextDeck.attributes)) deck.setAttribute(attr.name, attr.value);
    if (zoom) deck.style.setProperty('--mds-preview-zoom', zoom);
    deck.setAttribute('data-preview', '');
  };

  /** スライドの HTML のハッシュから、プレビューにあるスライドを引く */
  const byKey = new Map<string, Slide>();

  /**
   * スライドを並べ直す。order はスライドのキー（HTML のハッシュ）の順、slides は新しいスライドの HTML だけ。
   * 変わっていないスライドは DOM をそのまま残す（再生中の動画や描いた図が動き続ける。設計プラン §11.2）
   */
  const update = (head: string | null, order: string[], slides: Array<[string, string]>) => {
    if (head !== null) applyHead(head);
    const deck = deckOf();
    if (!deck) return;
    // 見ていたスライドを、同じ位置に残す
    const anchor = slideInView();
    const before = slidesOf();
    const anchorIndex = anchor ? before.indexOf(anchor) : -1;
    const anchorTop = anchor?.getBoundingClientRect().top ?? 0;

    const created: Slide[] = [];
    if (slides.length > 0) {
      const template = doc.createElement('template');
      template.innerHTML = resolve(slides.map(([, html]) => html).join(''));
      const nodes = Array.from(template.content.children) as Slide[];
      slides.forEach(([key], i) => {
        const node = nodes[i];
        if (!node) return;
        node.mdsKey = key;
        byKey.set(key, node);
        created.push(node);
      });
    }
    const next = order.map((key) => byKey.get(key)).filter((node): node is Slide => !!node);
    const same = next.length === before.length && next.every((node, i) => node === before[i]);
    if (!same) {
      // 変わったところだけを入れ替える（全部を入れ直すと、全部のスライドのレイアウトをやり直すことになる）
      const wanted = new Set<Element>(next);
      let child = deck.firstElementChild;
      const skipStale = () => {
        while (child && !wanted.has(child)) {
          const stale = child;
          child = child.nextElementSibling;
          stale.remove();
        }
      };
      for (const node of next) {
        skipStale();
        if (child === node) {
          child = child.nextElementSibling;
          continue;
        }
        deck.insertBefore(node, child);
      }
      skipStale();
    }
    const keep = new Set(order);
    for (const key of [...byKey.keys()]) if (!keep.has(key)) byKey.delete(key);
    fitZoom();
    for (const node of created) fitSlides(node);
    const target = next[Math.min(anchorIndex, next.length - 1)];
    if (target && anchorIndex >= 0 && !same) {
      doc.scrollingElement!.scrollTop += target.getBoundingClientRect().top - anchorTop;
    }
  };

  /** エディタのカーソルがあるスライドに印を付け、見えていなければ見えるところまで動かす（#74） */
  const focusSlide = (index: number) => {
    const slides = slidesOf();
    for (const [i, slide] of slides.entries()) slide.toggleAttribute('data-editing', i === index);
    const slide = slides[index];
    if (!slide) return;
    const rect = slide.getBoundingClientRect();
    const height = doc.documentElement.clientHeight;
    if (rect.top < 0 || rect.bottom > height) slide.scrollIntoView({ block: 'nearest' });
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
    | { id: number; type: 'archs'; items: unknown[] }
    | { id: number; type: 'measure'; jobs: MeasureJob[] }
    | { id: number; type: 'page'; html: string }
    | {
        id: number;
        type: 'update';
        head: string | null;
        order: string[];
        slides: Array<[string, string]>;
      }
    | { id: number; type: 'focus'; index: number }
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
      case 'archs':
        // 動く構成図（#107）：ELK で配置して SVG にする
        return { type: 'archs', results: await renderArch({ items: m.items }) };
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
        update(m.head, m.order, m.slides);
        return { type: 'done' };
      case 'focus':
        focusSlide(m.index);
        return { type: 'done' };
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
/*
 * 画面の外のスライドの描画は省かない（content-visibility: auto を使わない）。iOS の Safari では、
 * 描画を省いている間のスライドの高さが zoom で縮める前の大きさになり、スライドが画面に出入りするたびに
 * 上の高さが変わって、スクロールした位置が上に戻っていた（#163・#167）。省かなくても、
 * 50枚ほどの資料で打鍵から反映までの時間は変わらない（p95 で 26〜34 ms）
 */
.mds-deck[data-preview] > .mds-slide { cursor: pointer; }
/* エディタのカーソルがあるスライド（#74） */
.mds-deck[data-preview] > .mds-slide[data-editing] { outline: 4px solid #2563eb; outline-offset: 3px; }
`;
    doc.head.append(style);
    win.addEventListener('resize', fitZoom);
    // スライドをクリックすると、エディタの対応する行に移る（#74）。リンクや動画の操作は除く
    doc.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      if (target?.closest('a, video, audio, button, input, summary')) return;
      const slide = target?.closest<Slide>('.mds-deck > .mds-slide');
      if (!slide) return;
      send({ type: 'jump', index: slidesOf().indexOf(slide) });
    });
    // S で、見えているスライドから発表を始める（mdhs dev のプレビューと同じ。#60）
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
