/**
 * 発表用のプレイヤー（docs/design.md §8）。
 *
 * 書き出した HTML にそのまま埋め込めるように、外側の変数を使わない1つの関数にしている
 * （`startPlayer.toString()` を `<script>` に入れる）。`file://` で開いても動くように、
 * モジュールの読み込みや fetch は使わない。
 *
 * - 1280×720 の論理キャンバスを `transform: scale()` で画面に合わせる（余白は帯）
 * - キー操作・プレゼンリモコン（PageUp / PageDown）・スワイプ
 * - URL `#/12`（12枚目）。`#/見出しのID` でも移動できる
 * - 段階的表示と発表者ビューは M2
 */
export function startPlayer(doc: Document): void {
  const deck = doc.querySelector<HTMLElement>('.mds-deck');
  const win = doc.defaultView;
  if (!deck || !win || deck.hasAttribute('data-player')) return;
  const slides = Array.from(deck.querySelectorAll<HTMLElement>(':scope > .mds-slide')).filter(
    (slide) => !slide.hasAttribute('data-hidden'),
  );
  if (slides.length === 0) return;
  deck.setAttribute('data-player', '');

  const ja = (doc.documentElement.lang || 'ja').toLowerCase().startsWith('ja');
  const text = ja
    ? {
        help: 'キー操作',
        close: 'Esc か ? で閉じる',
        keys: [
          ['→ / Space / PageDown / Enter', '次へ'],
          ['← / PageUp / Backspace', '前へ'],
          ['Home / End', '最初 / 最後'],
          ['数字 → Enter（または G）', '指定したページへ'],
          ['O', '一覧表示'],
          ['F', '全画面'],
          ['B / .', '画面を暗くする'],
          ['?', 'このヘルプ'],
        ],
        slide: 'スライド',
      }
    : {
        help: 'Keyboard shortcuts',
        close: 'Press Esc or ? to close',
        keys: [
          ['→ / Space / PageDown / Enter', 'Next'],
          ['← / PageUp / Backspace', 'Previous'],
          ['Home / End', 'First / last'],
          ['Number → Enter (or G)', 'Go to page'],
          ['O', 'Overview'],
          ['F', 'Fullscreen'],
          ['B / .', 'Black screen'],
          ['?', 'This help'],
        ],
        slide: 'Slide',
      };

  // 発表用の見た目。印刷では使わない（screen だけ）
  const style = doc.createElement('style');
  style.textContent = `
@media screen {
  html.mds-presenting, html.mds-presenting body { height: 100%; margin: 0; overflow: hidden; background: #000; }
  .mds-deck.is-presenting { position: fixed; inset: 0; display: block; padding: 0; }
  .mds-deck.is-presenting > .mds-slide {
    position: absolute;
    left: 50%;
    top: 50%;
    margin: 0;
    box-shadow: none;
    transform: translate(-50%, -50%) scale(var(--mds-scale, 1));
    visibility: hidden;
  }
  .mds-deck.is-presenting > .mds-slide.is-current { visibility: visible; }
  .mds-deck.is-presenting.is-idle { cursor: none; }
  .mds-deck.is-overview {
    flex-flow: row wrap;
    justify-content: center;
    align-items: flex-start;
    gap: 20px;
    padding: 28px;
  }
  .mds-deck.is-overview > .mds-slide { zoom: 0.22; cursor: pointer; }
  .mds-deck.is-overview > .mds-slide.is-current { outline: 14px solid var(--mds-accent); outline-offset: 6px; }
  .mds-deck:not(.is-presenting) > .mds-player-progress { display: none; }
}
@media print { .mds-player-progress, .mds-player-layer, .mds-player-jump { display: none !important; } }
.mds-player-progress {
  position: fixed;
  left: 0;
  bottom: 0;
  z-index: 2;
  height: 4px;
  width: calc(var(--mds-progress, 0) * 100%);
  background: var(--mds-accent);
  transition: width 0.2s ease;
}
.mds-player-layer { position: fixed; inset: 0; z-index: 3; }
.mds-player-layer[hidden], .mds-player-jump[hidden] { display: none; }
.mds-player-black { background: #000; }
.mds-player-help {
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.55);
  font-family: var(--mds-font-body, sans-serif);
}
.mds-player-help > div {
  zoom: var(--mds-ui-scale, 1);
  min-width: 360px;
  padding: 24px 32px;
  border-radius: 14px;
  background: #fff;
  color: #0f172a;
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.35);
}
.mds-player-help h2 { margin: 0 0 12px; font-size: 20px; }
.mds-player-help table { border-collapse: collapse; font-size: 15px; }
.mds-player-help td { padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
.mds-player-help td:first-child { padding-right: 28px; font-family: ui-monospace, monospace; color: #475569; }
.mds-player-help p { margin: 12px 0 0; font-size: 13px; color: #64748b; }
.mds-player-jump {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 3;
  padding: 6px 14px;
  border-radius: 8px;
  background: rgb(15 23 42 / 0.85);
  color: #fff;
  font: 600 22px/1.4 ui-monospace, monospace;
  zoom: var(--mds-ui-scale, 1);
}
.mds-player-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
`;
  doc.head.append(style);

  const make = (className: string, hidden = true) => {
    const el = doc.createElement('div');
    el.className = className;
    el.hidden = hidden;
    deck.append(el);
    return el;
  };
  const progress = make('mds-player-progress', false);
  const black = make('mds-player-layer mds-player-black');
  const help = make('mds-player-layer mds-player-help');
  const jump = make('mds-player-jump');
  const live = make('mds-player-sr', false);
  live.setAttribute('aria-live', 'polite');
  help.setAttribute('role', 'dialog');
  help.setAttribute('aria-label', text.help);
  const box = doc.createElement('div');
  const title = doc.createElement('h2');
  title.textContent = text.help;
  const table = doc.createElement('table');
  for (const [key, action] of text.keys) {
    const row = table.insertRow();
    row.insertCell().textContent = key!;
    row.insertCell().textContent = action!;
  }
  const note = doc.createElement('p');
  note.textContent = text.close;
  box.append(title, table, note);
  help.append(box);

  // 論理キャンバスの大きさ（--mds-w / --mds-h）。なければ1枚目の大きさ
  const css = win.getComputedStyle(deck);
  const width = parseFloat(css.getPropertyValue('--mds-w')) || slides[0]!.offsetWidth;
  const height = parseFloat(css.getPropertyValue('--mds-h')) || slides[0]!.offsetHeight;
  const fit = () => {
    const scale = Math.min(win.innerWidth / width, win.innerHeight / height);
    deck.style.setProperty('--mds-scale', String(scale));
    // ヘルプなどの操作画面は、大きな画面では一緒に大きくする（小さくはしない）
    deck.style.setProperty('--mds-ui-scale', String(Math.max(1, scale)));
  };

  let index = -1;
  let overview = false;
  let digits = '';
  let digitsTimer = 0;

  const pageFromHash = (): number | undefined => {
    const m = /^#\/([^/]+)/.exec(win.location.hash);
    if (!m) return undefined;
    const value = decodeURIComponent(m[1]!);
    if (/^\d+$/.test(value)) return Number(value) - 1;
    const found = slides.findIndex((slide) => slide.dataset.id === value || slide.id === value);
    return found >= 0 ? found : undefined;
  };

  const writeHash = () => {
    const hash = `#/${index + 1}`;
    if (win.location.hash === hash) return;
    // <base href> があっても同じ文書のままにするため、今の URL から組み立てる
    const url = win.location.href.split('#')[0] + hash;
    try {
      win.history.replaceState(win.history.state, '', url);
    } catch {
      win.location.replace(url);
    }
  };

  const playMedia = (slide: HTMLElement, play: boolean) => {
    for (const video of Array.from(slide.querySelectorAll('video'))) {
      if (!play) video.pause();
      else if (video.autoplay) void video.play().catch(() => undefined);
    }
  };

  const go = (target: number) => {
    const next = Math.max(0, Math.min(slides.length - 1, target));
    if (next !== index) {
      const previous = slides[index];
      if (previous) playMedia(previous, false);
      index = next;
      slides.forEach((slide, k) => {
        const current = k === index;
        slide.classList.toggle('is-current', current);
        if (overview) return;
        slide.inert = !current;
        slide.setAttribute('aria-hidden', String(!current));
      });
      playMedia(slides[index]!, true);
      const heading = slides[index]!.querySelector('.mds-title')?.textContent?.trim();
      live.textContent = `${text.slide} ${index + 1} / ${slides.length}${heading ? `：${heading}` : ''}`;
    }
    progress.style.setProperty('--mds-progress', String((index + 1) / slides.length));
    writeHash();
  };

  const setOverview = (on: boolean) => {
    overview = on;
    deck.classList.toggle('is-presenting', !on);
    deck.classList.toggle('is-overview', on);
    doc.documentElement.classList.toggle('mds-presenting', !on);
    slides.forEach((slide, k) => {
      const hidden = !on && k !== index;
      slide.inert = hidden;
      slide.setAttribute('aria-hidden', String(hidden));
    });
    if (on) slides[index]?.scrollIntoView({ block: 'center' });
  };

  const toggleFullscreen = () => {
    if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => undefined);
    else void doc.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const showJump = () => {
    jump.hidden = digits === '';
    jump.textContent = digits;
    win.clearTimeout(digitsTimer);
    if (digits) {
      digitsTimer = win.setTimeout(() => {
        digits = '';
        jump.hidden = true;
      }, 2500);
    }
  };

  doc.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as Element | null;
    if (
      target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    ) {
      return;
    }
    const key = event.key;
    // 動画の操作中は、リモコンのキーだけを受け取る
    if (target?.closest('video, audio') && key !== 'PageDown' && key !== 'PageUp') return;
    let handled = true;

    if (!help.hidden) {
      if (key === 'Escape' || key === '?') help.hidden = true;
    } else if (!black.hidden) {
      // 暗転中は、どのキーでも元に戻す
      black.hidden = true;
    } else if (/^[0-9]$/.test(key)) {
      digits = (digits + key).slice(-4);
      showJump();
    } else if ((key === 'Enter' || key === 'g' || key === 'G') && digits) {
      go(Number(digits) - 1);
      digits = '';
      showJump();
      if (overview) setOverview(false);
    } else if (
      key === 'ArrowRight' ||
      key === 'ArrowDown' ||
      key === 'PageDown' ||
      key === 'Enter'
    ) {
      go(index + 1);
    } else if (key === ' ') {
      go(index + (event.shiftKey ? -1 : 1));
    } else if (
      key === 'ArrowLeft' ||
      key === 'ArrowUp' ||
      key === 'PageUp' ||
      key === 'Backspace'
    ) {
      go(index - 1);
    } else if (key === 'Home') {
      go(0);
    } else if (key === 'End') {
      go(slides.length - 1);
    } else if (key === 'f' || key === 'F') {
      toggleFullscreen();
    } else if (key === 'b' || key === 'B' || key === '.') {
      black.hidden = false;
    } else if (key === '?') {
      help.hidden = false;
    } else if (key === 'o' || key === 'O') {
      setOverview(!overview);
    } else if (key === 'Escape' && overview) {
      setOverview(false);
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  });

  // 一覧表示では、クリックしたスライドへ移動する
  deck.addEventListener('click', (event) => {
    if (!overview) return;
    const slide = (event.target as Element).closest<HTMLElement>('.mds-slide');
    const k = slide ? slides.indexOf(slide) : -1;
    if (k < 0) return;
    go(k);
    setOverview(false);
  });
  help.addEventListener('click', () => (help.hidden = true));
  black.addEventListener('click', () => (black.hidden = true));

  // スワイプ（横方向に 40px 以上）
  let touch: { x: number; y: number } | undefined;
  deck.addEventListener(
    'touchstart',
    (event) => {
      const t = event.touches[0];
      touch = event.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : undefined;
    },
    { passive: true },
  );
  deck.addEventListener(
    'touchend',
    (event) => {
      const t = event.changedTouches[0];
      if (!touch || !t || overview) return;
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = undefined;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
    },
    { passive: true },
  );

  // しばらくマウスを動かさなければ、ポインタを隠す
  let idleTimer = 0;
  doc.addEventListener('mousemove', () => {
    deck.classList.remove('is-idle');
    win.clearTimeout(idleTimer);
    idleTimer = win.setTimeout(() => deck.classList.add('is-idle'), 2500);
  });

  win.addEventListener('resize', fit);
  win.addEventListener('hashchange', () => {
    const page = pageFromHash();
    if (page !== undefined) go(page);
  });

  fit();
  setOverview(false);
  slides.forEach((slide) => playMedia(slide, false));
  go(pageFromHash() ?? 0);

  // ほかのスクリプト（発表者ビュー・テスト）から操作できるようにする
  Object.assign(win, {
    mdsPlayer: {
      go: (page: number) => go(page - 1),
      next: () => go(index + 1),
      prev: () => go(index - 1),
      get page() {
        return index + 1;
      },
      get total() {
        return slides.length;
      },
    },
  });
}
