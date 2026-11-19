/**
 * `mdhs dev` のプレビュー（`/`）で動くスクリプト（#60）。
 *
 * - スライドを、1枚がウィンドウに収まる大きさに拡大・縮小する（印刷には効かせない）
 * - S キーか右上のボタンで、画面に見えているスライドから発表（`/present`）を始める
 * - 発表を Esc で終えて戻ってきたとき（`/#/<スライドのID>`）は、そのスライドを表示する
 *
 * runtime と同じく、外側の変数を使わない1つの関数にして、文字列にして埋め込む。
 */
export function startPreview(doc: Document): void {
  const deck = doc.querySelector<HTMLElement>('.mds-deck');
  const win = doc.defaultView;
  if (!deck || !win || deck.hasAttribute('data-preview')) return;
  const slides = Array.from(deck.querySelectorAll<HTMLElement>(':scope > .mds-slide'));
  if (slides.length === 0) return;
  deck.setAttribute('data-preview', '');
  const ja = (doc.documentElement.lang || 'ja').toLowerCase().startsWith('ja');

  const style = doc.createElement('style');
  style.textContent = `
@media screen {
  .mds-deck[data-preview] > .mds-slide { zoom: var(--mds-preview-zoom, 1); }
  /* スクロールの位置は、スライドの枠（大きさが変わらない）に合わせて保つ。中の文字に合わせると、
     フォントを読み込んで文字が動いたときに、画面がずれてしまう */
  .mds-deck[data-preview] > .mds-slide * { overflow-anchor: none; }
  .mds-preview-start {
    position: fixed;
    top: 12px;
    right: 16px;
    z-index: 10;
    padding: 6px 14px;
    border: 0;
    border-radius: 8px;
    background: #0f172a;
    color: #fff;
    font: 600 14px/1.4 system-ui, sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
  }
  .mds-preview-start:hover { background: #1e293b; }
}
@media print { .mds-preview-start { display: none; } }
`;
  doc.head.append(style);

  // 論理キャンバスの大きさ（--mds-w / --mds-h）。なければ1枚目の大きさ
  const css = win.getComputedStyle(deck);
  const width = parseFloat(css.getPropertyValue('--mds-w')) || slides[0]!.offsetWidth;
  const height = parseFloat(css.getPropertyValue('--mds-h')) || slides[0]!.offsetHeight;
  const fit = () => {
    // 左右に 24px、上下に 32px の余白を残して、1枚がウィンドウに収まる倍率（スクロールバーは除く）
    const view = doc.documentElement;
    const zoom = Math.min((view.clientWidth - 48) / width, (view.clientHeight - 64) / height);
    deck.style.setProperty('--mds-preview-zoom', String(Math.max(0.1, zoom)));
  };

  /** 画面にいちばん大きく見えているスライド */
  const slideInView = () => {
    const viewHeight = doc.documentElement.clientHeight;
    let best = slides[0]!;
    let bestVisible = -Infinity;
    for (const slide of slides) {
      const rect = slide.getBoundingClientRect();
      const visible = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
      if (visible > bestVisible) {
        best = slide;
        bestVisible = visible;
      }
    }
    return best;
  };

  // 発表に出るスライド（{hidden} は出ない）
  const shown = slides.filter((slide) => !slide.hasAttribute('data-hidden'));
  const start = () => {
    const k = slides.indexOf(slideInView());
    // 隠したスライドが見えているときは、次の（なければ前の）発表に出るスライドから始める
    const slide =
      slides.slice(k).find((s) => shown.includes(s)) ??
      slides
        .slice(0, k)
        .reverse()
        .find((s) => shown.includes(s));
    if (!slide) return;
    const id = slide.dataset.id;
    win.location.href = `/present#/${id ? encodeURIComponent(id) : shown.indexOf(slide) + 1}`;
  };

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'mds-preview-start';
  button.textContent = ja ? '▶ 発表（S）' : '▶ Present (S)';
  button.addEventListener('click', start);
  doc.body.append(button);
  doc.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as Element | null;
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      start();
    }
  });

  fit();
  // 大きさを変えても、見ていたスライドを画面に残す
  win.addEventListener('resize', () => {
    const anchor = slideInView();
    fit();
    anchor.scrollIntoView({ block: 'center' });
  });

  // 発表から戻ってきたときは、そのスライドを表示する。
  // 保存して読み込み直したときにまた飛ばないように、URL からは消す
  const match = /^#\/(.+)$/.exec(win.location.hash);
  if (match) {
    const value = decodeURIComponent(match[1]!);
    const target =
      slides.find((slide) => slide.dataset.id === value) ??
      (/^\d+$/.test(value) ? shown[Number(value) - 1] : undefined);
    target?.scrollIntoView({ block: 'center' });
    win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  }
}
