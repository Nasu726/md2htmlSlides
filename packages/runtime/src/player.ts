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
          ['P', '発表者ビューを開く・閉じる'],
          ['?', 'このヘルプ'],
        ],
        pvKeys: [
          ['→ / Space / PageDown / Enter', '次へ'],
          ['← / PageUp / Backspace', '前へ'],
          ['数字 → Enter（または G）', '指定したページへ'],
          ['O', '一覧（選ぶまで観客の画面は変わらない）'],
          ['B / .', '観客の画面を暗くする'],
          ['F', 'このウィンドウを全画面'],
          ['P / Esc', '発表者ビューを閉じる（発表は続く）'],
          ['?', 'このヘルプ'],
        ],
        pvHint: '? でキー操作',
        pvPick: 'スライドを選ぶ：矢印で選んで Enter（クリックでも可）。Esc で戻る',
        pvBlack: '暗転中',
        pvOverview: '観客の画面は一覧を表示中',
        pvHelp: '観客の画面はヘルプを表示中',
        slide: 'スライド',
        presenter: '発表者ビュー',
        now: '現在（観客の画面）',
        next: '次',
        nextStep: '次（このスライドの続き）',
        notes: 'ノート',
        noNotes: 'ノートはありません',
        elapsed: '経過',
        clock: '時刻',
        end: '最後のスライドです',
        exit: ['Esc', 'スライドショーを終える（プレビューに戻る）'],
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
          ['P', 'Open / close presenter view'],
          ['?', 'This help'],
        ],
        pvKeys: [
          ['→ / Space / PageDown / Enter', 'Next'],
          ['← / PageUp / Backspace', 'Previous'],
          ['Number → Enter (or G)', 'Go to page'],
          ['O', 'Overview (audience view stays until you pick)'],
          ['B / .', 'Black out the audience view'],
          ['F', 'Fullscreen this window'],
          ['P / Esc', 'Close presenter view (the show goes on)'],
          ['?', 'This help'],
        ],
        pvHint: 'Press ? for shortcuts',
        pvPick: 'Pick a slide: arrows then Enter (or click). Esc to go back',
        pvBlack: 'Black screen',
        pvOverview: 'Audience sees the overview',
        pvHelp: 'Audience sees the help',
        slide: 'Slide',
        presenter: 'Presenter view',
        now: 'Current (audience view)',
        next: 'Next',
        nextStep: 'Next (same slide)',
        notes: 'Notes',
        noNotes: 'No notes',
        elapsed: 'Elapsed',
        clock: 'Clock',
        end: 'This is the last slide',
        exit: ['Esc', 'End the slideshow (back to preview)'],
      };
  // スライドショーを終えて戻る先（mds dev のプレビュー）。書き出した HTML にはないので、
  // そのときは Esc で終える動きもない（#60）
  const exitUrl = deck.dataset.exitUrl;

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
  /* 一覧では、クリックを中身（動画など）に渡さず、スライドを選ぶだけにする */
  .mds-deck.is-overview > .mds-slide > * { pointer-events: none; }
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
  /* 操作画面は OS のフォントで出す（同梱するフォントは、スライドで使う文字だけに絞るため） */
  font-family: system-ui, sans-serif;
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
  for (const [key, action] of exitUrl ? [...text.keys, text.exit] : text.keys) {
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
  let step = 0;
  let overview = false;
  let digits = '';
  let digitsTimer = 0;

  // URL：#/12（12枚目）、#/12/2（12枚目の2ステップ目）、#/見出しのID
  const pageFromHash = (): [number, number] | undefined => {
    const m = /^#\/([^/]+)(?:\/(\d+))?/.exec(win.location.hash);
    if (!m) return undefined;
    const value = decodeURIComponent(m[1]!);
    const at = Number(m[2] ?? 0);
    if (/^\d+$/.test(value)) return [Number(value) - 1, at];
    const found = slides.findIndex((slide) => slide.dataset.id === value || slide.id === value);
    return found >= 0 ? [found, at] : undefined;
  };

  const writeHash = () => {
    const hash = `#/${index + 1}${step > 0 ? `/${step}` : ''}`;
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

  // 段階的表示：今のステップより後の要素を隠す（構文仕様 §5）
  const stepsOf = (k: number) => Number(slides[k]?.dataset.steps ?? 0);
  const showSteps = (slide: HTMLElement, upTo: number) => {
    for (const el of Array.from(slide.querySelectorAll<HTMLElement>('[data-step]'))) {
      el.toggleAttribute('data-step-hidden', Number(el.dataset.step) > upTo);
    }
  };

  const go = (target: number, targetStep = 0) => {
    const next = Math.max(0, Math.min(slides.length - 1, target));
    step = Math.max(0, Math.min(stepsOf(next), targetStep));
    const slide = slides[next]!;
    const entering = next !== index;
    // 別のスライドに移るときは、ステップの効果を止めて一瞬で切り替える
    // （隠す要素が表示されてから消えたり、表示する要素がスライドの表示に遅れて出たりするのを防ぐ）
    if (entering) slide.setAttribute('data-no-anim', '');
    showSteps(slide, overview ? Infinity : step); // 同じスライドの中ではフェードで出す
    if (entering) {
      const previous = slides[index];
      if (previous) playMedia(previous, false);
      // 前のスライドの動画などに残ったフォーカスを外す（#58）
      const active = doc.activeElement;
      if (active instanceof win.HTMLElement && active !== deck && deck.contains(active)) {
        active.blur();
      }
      index = next;
      slides.forEach((s, k) => {
        const current = k === index;
        s.classList.toggle('is-current', current);
        if (overview) return;
        s.inert = !current;
        s.setAttribute('aria-hidden', String(!current));
      });
      playMedia(slide, true);
      const heading = slide.querySelector('.mds-title')?.textContent?.trim();
      live.textContent = `${text.slide} ${index + 1} / ${slides.length}${heading ? `：${heading}` : ''}`;
      void slide.offsetWidth; // ここまでの変更を、効果なしで反映する
      slide.removeAttribute('data-no-anim');
    }
    progress.style.setProperty('--mds-progress', String((index + 1) / slides.length));
    writeHash();
    updatePresenter();
  };

  /** 次のステップ。最後のステップなら次のスライドへ */
  const forward = () => (step < stepsOf(index) ? go(index, step + 1) : go(index + 1, 0));
  /** 前のステップ。最初なら前のスライドを、すべて表示した状態で */
  const back = () => {
    if (step > 0) go(index, step - 1);
    else if (index > 0) go(index - 1, stepsOf(index - 1));
  };

  const setOverview = (on: boolean) => {
    overview = on;
    // 一覧ではすべてのステップを表示する
    slides.forEach((slide, k) => showSteps(slide, on ? Infinity : k === index ? step : 0));
    deck.classList.toggle('is-presenting', !on);
    deck.classList.toggle('is-overview', on);
    doc.documentElement.classList.toggle('mds-presenting', !on);
    slides.forEach((slide, k) => {
      const hidden = !on && k !== index;
      slide.inert = hidden;
      slide.setAttribute('aria-hidden', String(hidden));
    });
    if (on) slides[index]?.scrollIntoView({ block: 'center' });
    updatePresenterStatus();
  };

  // 暗転とヘルプ。発表者ビューの「現在」の枠にも、観客の画面の状態を示す
  const setBlack = (on: boolean) => {
    black.hidden = !on;
    updatePresenterStatus();
  };
  const setHelp = (on: boolean) => {
    help.hidden = !on;
    updatePresenterStatus();
  };

  /** キーを押したウィンドウを全画面にする（発表者ビューで押せば発表者ビューだけ） */
  const toggleFullscreen = (target: Document = doc) => {
    if (target.fullscreenElement) void target.exitFullscreen().catch(() => undefined);
    else void target.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  // 数字の入力は、キーを押したウィンドウの右下（発表者ビューなら上の帯）に出す
  let jumpBox: HTMLElement = jump;
  const showJump = (box: HTMLElement = jumpBox) => {
    if (box !== jumpBox) {
      jumpBox.hidden = true;
      jumpBox = box;
    }
    box.hidden = digits === '';
    box.textContent = digits;
    win.clearTimeout(digitsTimer);
    if (digits) {
      digitsTimer = win.setTimeout(() => {
        digits = '';
        box.hidden = true;
      }, 2500);
    }
  };
  /** 数字 → Enter（または G）でのページ指定。扱ったら true */
  const digitKey = (key: string, box: HTMLElement, jumpTo: (k: number) => void): boolean => {
    if (/^[0-9]$/.test(key)) {
      digits = (digits + key).slice(-4);
      showJump(box);
      return true;
    }
    if ((key === 'Enter' || key === 'g' || key === 'G') && digits) {
      const k = Number(digits) - 1;
      digits = '';
      showJump(box);
      jumpTo(k);
      return true;
    }
    return false;
  };
  /** どちらのウィンドウでも同じ意味のキー（ページ送り・ページ指定・暗転）。扱ったら true */
  const navKey = (key: string, shift: boolean, box: HTMLElement): boolean => {
    if (
      digitKey(key, box, (k) => {
        go(k);
        if (overview) setOverview(false);
      })
    ) {
      return true;
    }
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === 'Enter') {
      forward();
    } else if (key === ' ') {
      if (shift) back();
      else forward();
    } else if (
      key === 'ArrowLeft' ||
      key === 'ArrowUp' ||
      key === 'PageUp' ||
      key === 'Backspace'
    ) {
      back();
    } else if (key === 'Home') {
      go(0);
    } else if (key === 'End') {
      go(slides.length - 1);
    } else if (key === 'b' || key === 'B' || key === '.') {
      setBlack(true);
    } else {
      return false;
    }
    return true;
  };
  /** 入力欄などで押したキーと、修飾キー付きのキーは扱わない */
  const ignoreKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return true;
    const target = event.target as Element | null;
    return Boolean(
      target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
    );
  };

  // 発表者ビュー（設計プラン §8.4）：今のスライド・次・ノート・経過時間・時刻・ステップ。
  // 空のウィンドウを開いて、この文書から中身を書く（file:// でも同じ文書として扱える）。
  // 「現在」の枠には、いつも観客が見ているものを出す。発表者ビューで押したキーは、
  // ページ送りと暗転のほかは発表者ビューの中で完結させる（#59）
  let presenter: Window | null = null;
  let presenterStart = 0;
  let presenterTimer = 0;
  let pvOverview = false;
  let pvSelected = 0;
  const PV_KEY = 'mds-presenter-start';
  const PV_THUMB = 240; // 発表者ビューの一覧の、スライド1枚の幅（px）
  const two = (n: number) => String(n).padStart(2, '0');
  const pvOpen = (): boolean => presenter !== null && !presenter.closed;
  /** 開いている発表者ビューの開始時刻を覚えておき、読み込み直したときにつなぎ直す */
  const remember = (start: number | undefined) => {
    try {
      if (start === undefined) win.sessionStorage.removeItem(PV_KEY);
      else win.sessionStorage.setItem(PV_KEY, String(start));
    } catch {
      // 保存できない環境では、つなぎ直さない
    }
  };
  const remembered = (): number | undefined => {
    try {
      const value = win.sessionStorage.getItem(PV_KEY);
      return value ? Number(value) : undefined;
    } catch {
      return undefined;
    }
  };
  const plainDeckClass = () => deck.className.replace(/\bis-(presenting|overview|idle)\b/g, '');
  const cloneSlide = (pdoc: Document, k: number, upTo: number) => {
    const clone = pdoc.importNode(slides[k]!, true) as HTMLElement;
    clone.classList.remove('is-current');
    clone.removeAttribute('inert');
    clone.removeAttribute('aria-hidden');
    for (const el of Array.from(clone.querySelectorAll<HTMLElement>('[data-step]'))) {
      el.toggleAttribute('data-step-hidden', Number(el.dataset.step) > upTo);
    }
    for (const video of Array.from(clone.querySelectorAll('video'))) {
      video.muted = true;
      video.autoplay = false;
      video.removeAttribute('autoplay');
    }
    return clone;
  };
  const placeSlide = (frame: HTMLElement, clone: HTMLElement | undefined) => {
    frame.replaceChildren();
    if (!clone) return;
    // 枠が空のうちに大きさを測る（スライドを入れると、その大きさに引っ張られるため）
    const scale = Math.min(frame.clientWidth / width, frame.clientHeight / height);
    const holder = frame.ownerDocument.createElement('div');
    holder.className = plainDeckClass();
    holder.setAttribute('style', deck.getAttribute('style') ?? '');
    holder.append(clone);
    frame.append(holder);
    clone.style.zoom = String(scale > 0 ? scale : 0.5);
  };
  const tickPresenter = () => {
    if (!presenter || presenter.closed) return;
    const pdoc = presenter.document;
    const seconds = Math.floor((Date.now() - presenterStart) / 1000);
    const now = new Date();
    const set = (sel: string, value: string) => {
      const el = pdoc.querySelector(sel);
      if (el) el.textContent = value;
    };
    set('.mds-pv-elapsed', `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`);
    set('.mds-pv-clock', `${two(now.getHours())}:${two(now.getMinutes())}`);
  };
  const updatePresenter = () => {
    if (!presenter || presenter.closed) return;
    const pdoc = presenter.document;
    const steps = stepsOf(index);
    const set = (sel: string, value: string) => {
      const el = pdoc.querySelector(sel);
      if (el) el.textContent = value;
    };
    set('.mds-pv-page', `${index + 1} / ${slides.length}`);
    set('.mds-pv-step', steps > 0 ? `${step} / ${steps}` : '—');
    placeSlide(
      pdoc.querySelector<HTMLElement>('.mds-pv-current .mds-pv-frame')!,
      cloneSlide(pdoc, index, step),
    );
    // 次：このスライドにステップが残っていれば次のステップ、なければ次のスライド
    const nextFrame = pdoc.querySelector<HTMLElement>('.mds-pv-next .mds-pv-frame')!;
    const nextLabel = pdoc.querySelector('.mds-pv-next .mds-pv-label')!;
    if (step < steps) {
      nextLabel.textContent = text.nextStep;
      placeSlide(nextFrame, cloneSlide(pdoc, index, step + 1));
    } else if (index + 1 < slides.length) {
      nextLabel.textContent = text.next;
      placeSlide(nextFrame, cloneSlide(pdoc, index + 1, 0));
    } else {
      nextLabel.textContent = text.end;
      placeSlide(nextFrame, undefined);
    }
    const notes = slides[index]!.querySelector('.mds-notes');
    const box = pdoc.querySelector<HTMLElement>('.mds-pv-notes')!;
    box.innerHTML = notes ? notes.innerHTML : `<p class="mds-pv-empty">${text.noNotes}</p>`;
    tickPresenter();
    updatePresenterStatus();
  };
  /** 「現在」の枠に、観客の画面の状態（暗転・一覧・ヘルプ）を示す */
  const updatePresenterStatus = () => {
    if (!presenter || !pvOpen()) return;
    const pane = presenter.document.querySelector<HTMLElement>('.mds-pv-current');
    const badge = pane?.querySelector<HTMLElement>('.mds-pv-status');
    if (!pane || !badge) return;
    const status = !black.hidden
      ? text.pvBlack
      : overview
        ? text.pvOverview
        : !help.hidden
          ? text.pvHelp
          : '';
    pane.classList.toggle('is-black', !black.hidden);
    badge.textContent = status;
    badge.hidden = status === '';
  };

  // 発表者ビューの中の一覧。選ぶまで観客の画面は変えない
  const pvItems = () =>
    presenter ? Array.from(presenter.document.querySelectorAll<HTMLElement>('.mds-pv-thumb')) : [];
  const selectPv = (k: number) => {
    const items = pvItems();
    pvSelected = Math.max(0, Math.min(items.length - 1, k));
    items.forEach((item, i) => item.classList.toggle('is-selected', i === pvSelected));
    items[pvSelected]?.scrollIntoView({ block: 'nearest' });
  };
  const showPvOverview = (on: boolean) => {
    if (!presenter) return;
    const pdoc = presenter.document;
    const layer = pdoc.querySelector<HTMLElement>('.mds-pv-overview');
    const grid = layer?.querySelector<HTMLElement>('.mds-pv-grid');
    if (!layer || !grid) return;
    pvOverview = on;
    layer.hidden = !on;
    grid.replaceChildren();
    if (!on) return;
    slides.forEach((_, k) => {
      const item = pdoc.createElement('div');
      item.className = 'mds-pv-thumb';
      item.dataset.k = String(k);
      const holder = pdoc.createElement('div');
      holder.className = plainDeckClass();
      holder.setAttribute('style', deck.getAttribute('style') ?? '');
      const clone = cloneSlide(pdoc, k, Infinity);
      clone.style.zoom = String(PV_THUMB / width);
      for (const video of Array.from(clone.querySelectorAll('video'))) video.preload = 'none';
      holder.append(clone);
      const num = pdoc.createElement('span');
      num.className = 'mds-pv-num';
      num.textContent = String(k + 1);
      item.append(holder, num);
      grid.append(item);
    });
    selectPv(index);
  };
  const pickPv = (k: number) => {
    showPvOverview(false);
    go(k);
  };
  /** 発表者ビューの一覧でのキー。扱ったら true */
  const pvOverviewKey = (key: string, box: HTMLElement): boolean => {
    const items = pvItems();
    // 1行に並ぶ枚数（↑ ↓ で1行ずつ動かす）
    const top = items[0]?.offsetTop ?? 0;
    let columns = 0;
    while (columns < items.length && items[columns]!.offsetTop === top) columns++;
    columns = Math.max(1, columns);
    if (digitKey(key, box, pickPv)) return true;
    if (key === 'Escape' || key === 'o' || key === 'O') showPvOverview(false);
    else if (key === 'Enter' || key === ' ') pickPv(pvSelected);
    else if (key === 'ArrowRight') selectPv(pvSelected + 1);
    else if (key === 'ArrowLeft') selectPv(pvSelected - 1);
    else if (key === 'ArrowDown') selectPv(pvSelected + columns);
    else if (key === 'ArrowUp') selectPv(pvSelected - columns);
    else if (key === 'Home') selectPv(0);
    else if (key === 'End') selectPv(items.length - 1);
    else return false;
    return true;
  };
  /** スライドショーを終えて、プレビューの同じスライドに戻る。発表者ビューも閉じる（#60） */
  const exitShow = () => {
    if (!exitUrl) return;
    closePresenter();
    const id = slides[index]?.dataset.id;
    win.location.href = `${exitUrl}#/${id ? encodeURIComponent(id) : index + 1}`;
  };
  /** 発表者ビューを閉じる。発表（このウィンドウ）は続ける */
  const closePresenter = () => {
    const opened = presenter;
    presenter = null;
    pvOverview = false;
    remember(undefined);
    win.clearInterval(presenterTimer);
    if (opened && !opened.closed) opened.close();
    win.focus();
  };
  const togglePresenter = () => (pvOpen() ? closePresenter() : openPresenter());
  /**
   * 発表者ビューを開く。resume を渡すと、読み込み直す前から開いていた発表者ビューを
   * 同じ名前のウィンドウとして探し、経過時間を引き継いで書き直す。
   */
  const openPresenter = (resume?: number) => {
    if (presenter && pvOpen()) {
      presenter.focus();
      return;
    }
    const opened = win.open('', 'mds-presenter', 'width=1280,height=800');
    if (!opened) {
      remember(undefined); // ポップアップを止められている
      return;
    }
    let pdoc: Document;
    try {
      pdoc = opened.document;
    } catch {
      // file:// で読み込み直したときなど、前の発表者ビューに触れないときは閉じる
      opened.close();
      remember(undefined);
      return;
    }
    presenter = opened;
    pvOverview = false;
    presenterStart = resume ?? Date.now();
    remember(presenterStart);
    pdoc.open();
    // 発表の画面のタブを閉じたら、発表者ビューも閉じる
    pdoc.write(
      `<!doctype html><html lang="${doc.documentElement.lang}"><head><meta charset="utf-8"><title>${text.presenter}</title></head><body><script>if (!window.mdsWatch) window.mdsWatch = setInterval(function () { if (!opener || opener.closed) close(); }, 1000);</script></body></html>`,
    );
    pdoc.close();
    for (const el of Array.from(doc.querySelectorAll('style')))
      pdoc.head.append(pdoc.importNode(el, true));
    const css = pdoc.createElement('style');
    css.textContent = `
html, body { height: 100%; margin: 0; background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; }
.mds-pv { box-sizing: border-box; height: 100vh; display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr); gap: 14px; padding: 16px; }
.mds-pv-bar { grid-column: 1 / -1; display: flex; gap: 28px; align-items: baseline; font-size: 15px; color: #94a3b8; }
.mds-pv-bar b { margin-left: 8px; font-size: 30px; color: #f8fafc; font-variant-numeric: tabular-nums; }
.mds-pv-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.mds-pv-current { grid-row: 2 / 4; }
.mds-pv-label { font-size: 13px; letter-spacing: 0.04em; color: #94a3b8; }
.mds-pv-frame { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.mds-pv-frame > .mds-deck { display: block; padding: 0; background: none; }
.mds-pv-frame .mds-slide { box-shadow: 0 4px 24px rgb(0 0 0 / 0.45); }
.mds-pv-notes { flex: 1; min-height: 0; overflow: auto; padding: 14px 18px; border-radius: 10px;
  background: #1e293b; font-size: 22px; line-height: 1.6; }
.mds-pv-notes > :first-child { margin-top: 0; }
.mds-pv-empty { color: #64748b; }
.mds-pv-bar .mds-pv-jump { margin-left: auto; padding: 0 10px; border-radius: 6px; background: #334155; }
.mds-pv-bar .mds-pv-jump[hidden] { display: none; }
.mds-pv-hint { margin-left: auto; font-size: 13px; }
.mds-pv-jump:not([hidden]) + .mds-pv-hint { margin-left: 0; }
.mds-pv-status { margin-left: 10px; padding: 1px 8px; border-radius: 999px; background: #f59e0b; color: #0f172a;
  font-weight: 700; letter-spacing: 0; }
.mds-pv-status[hidden] { display: none; }
.mds-pv-current.is-black .mds-pv-frame .mds-slide { filter: brightness(0); }
.mds-pv-layer { position: fixed; inset: 0; z-index: 5; background: rgb(15 23 42 / 0.97); }
.mds-pv-layer[hidden] { display: none; }
.mds-pv-overview { overflow: auto; padding: 16px 20px; background: #0f172a; }
.mds-pv-pick { margin: 0 0 14px; font-size: 15px; color: #94a3b8; }
.mds-pv-grid { display: flex; flex-wrap: wrap; gap: 16px; }
.mds-pv-thumb { position: relative; cursor: pointer; border-radius: 3px; outline: 4px solid transparent; outline-offset: 3px; }
.mds-pv-thumb > .mds-deck { display: block; padding: 0; background: none; pointer-events: none; }
.mds-pv-thumb.is-selected { outline-color: #38bdf8; }
.mds-pv-num { position: absolute; left: 6px; bottom: 4px; padding: 0 6px; border-radius: 4px; background: rgb(15 23 42 / 0.8);
  color: #f8fafc; font-size: 12px; }
.mds-pv-help { display: grid; place-items: center; background: rgb(15 23 42 / 0.75); }
.mds-pv-help > div { min-width: 380px; padding: 24px 32px; border-radius: 14px; background: #fff; color: #0f172a; }
.mds-pv-help h2 { margin: 0 0 12px; font-size: 20px; }
.mds-pv-help table { border-collapse: collapse; font-size: 15px; }
.mds-pv-help td { padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
.mds-pv-help td:first-child { padding-right: 28px; font-family: ui-monospace, monospace; color: #475569; }
.mds-pv-help p { margin: 12px 0 0; font-size: 13px; color: #64748b; }`;
    pdoc.head.append(css);
    const keyRows = text.pvKeys.map(
      ([key, action]) => `<tr><td>${key}</td><td>${action}</td></tr>`,
    );
    pdoc.body.innerHTML = `<div class="mds-pv">
<div class="mds-pv-bar"><span>${text.slide}<b class="mds-pv-page"></b></span><span>Step<b class="mds-pv-step"></b></span>
<span>${text.elapsed}<b class="mds-pv-elapsed">00:00</b></span><span>${text.clock}<b class="mds-pv-clock"></b></span>
<b class="mds-pv-jump" hidden></b><span class="mds-pv-hint">${text.pvHint}</span></div>
<div class="mds-pv-pane mds-pv-current"><div class="mds-pv-label">${text.now}<span class="mds-pv-status" hidden></span></div><div class="mds-pv-frame"></div></div>
<div class="mds-pv-pane mds-pv-next"><div class="mds-pv-label"></div><div class="mds-pv-frame"></div></div>
<div class="mds-pv-pane"><div class="mds-pv-label">${text.notes}</div><div class="mds-pv-notes"></div></div>
</div>
<div class="mds-pv-layer mds-pv-overview" hidden><p class="mds-pv-pick">${text.pvPick}</p><div class="mds-pv-grid"></div></div>
<div class="mds-pv-layer mds-pv-help" role="dialog" aria-label="${text.help}" hidden><div><h2>${text.help}</h2>
<table>${keyRows.join('')}</table><p>${text.close}</p></div></div>`;
    pdoc.addEventListener('keydown', onPresenterKey);
    pdoc.addEventListener('click', onPresenterClick);
    opened.addEventListener('resize', updatePresenter);
    // 発表者ビューのウィンドウを閉じたら、読み込み直してもつなぎ直さない
    opened.addEventListener('pagehide', () => {
      if (presenter !== opened) return;
      presenter = null;
      pvOverview = false;
      remember(undefined);
    });
    win.clearInterval(presenterTimer);
    presenterTimer = win.setInterval(() => {
      if (!presenter || presenter.closed) win.clearInterval(presenterTimer);
      else tickPresenter();
    }, 1000);
    updatePresenter();
  };

  /** 発表の画面（観客の画面）で押したキー */
  const onKey = (event: KeyboardEvent) => {
    if (ignoreKey(event)) return;
    // 動画にフォーカスがあっても、スライドのキーを優先する（#58）。
    // 受け取ったキーは既定の動作を止めるので、動画のシーク・再生の切り替えとは重ならない
    const key = event.key;
    let handled = true;
    if (!help.hidden) {
      if (key === 'Escape' || key === '?') setHelp(false);
    } else if (!black.hidden) {
      setBlack(false); // 暗転中は、どのキーでも元に戻す
    } else if (key === 'p' || key === 'P') {
      togglePresenter();
    } else if (key === '?') {
      setHelp(true);
    } else if (key === 'o' || key === 'O') {
      setOverview(!overview);
    } else if (key === 'Escape' && overview) {
      setOverview(false);
    } else if (key === 'Escape' && exitUrl) {
      exitShow();
    } else if (key === 'f' || key === 'F') {
      toggleFullscreen();
    } else {
      handled = navKey(key, event.shiftKey, jump);
    }
    if (handled) event.preventDefault();
  };
  doc.addEventListener('keydown', onKey);

  /** 発表者ビューで押したキー。ページ送りと暗転のほかは、発表者ビューの中で完結させる */
  const onPresenterKey = (event: KeyboardEvent) => {
    if (!presenter || ignoreKey(event)) return;
    const pdoc = presenter.document;
    const box = pdoc.querySelector<HTMLElement>('.mds-pv-jump');
    const pvHelp = pdoc.querySelector<HTMLElement>('.mds-pv-help');
    if (!box || !pvHelp) return;
    const key = event.key;
    let handled = true;
    if (!pvHelp.hidden) {
      if (key === 'Escape' || key === '?') pvHelp.hidden = true;
    } else if (pvOverview) {
      handled = pvOverviewKey(key, box);
    } else if (!black.hidden) {
      setBlack(false);
    } else if (key === 'p' || key === 'P' || key === 'Escape') {
      closePresenter();
    } else if (key === '?') {
      pvHelp.hidden = false;
    } else if (key === 'o' || key === 'O') {
      showPvOverview(true);
    } else if (key === 'f' || key === 'F') {
      toggleFullscreen(pdoc);
    } else {
      handled = navKey(key, event.shiftKey, box);
    }
    if (handled) event.preventDefault();
  };
  const onPresenterClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const thumb = target?.closest?.<HTMLElement>('.mds-pv-thumb');
    const pvHelp = target?.closest?.<HTMLElement>('.mds-pv-help');
    if (thumb) pickPv(Number(thumb.dataset.k));
    else if (pvHelp) pvHelp.hidden = true;
  };

  // 一覧表示では、クリックしたスライドへ移動する
  deck.addEventListener('click', (event) => {
    if (!overview) return;
    const slide = (event.target as Element).closest<HTMLElement>('.mds-slide');
    const k = slide ? slides.indexOf(slide) : -1;
    if (k < 0) return;
    go(k);
    setOverview(false);
  });
  // YouTube・Vimeo の埋め込みをクリックすると、キーが埋め込みの中に送られてしまう。
  // クリックそのものは埋め込みに届けたまま、フォーカスだけをスライドに戻す（#58）
  win.addEventListener('blur', () => {
    win.setTimeout(() => {
      const active = doc.activeElement;
      if (active instanceof win.HTMLIFrameElement && active.closest('.mds-media')) {
        active.blur();
        win.focus();
      }
    }, 0);
  });
  help.addEventListener('click', () => setHelp(false));
  black.addEventListener('click', () => setBlack(false));

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
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) forward();
        else back();
      }
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
    if (page !== undefined) go(page[0], page[1]);
  });

  fit();
  setOverview(false);
  slides.forEach((slide) => playMedia(slide, false));
  const start = pageFromHash() ?? [0, 0];
  go(start[0], start[1]);
  // mds dev で保存して読み込み直したときは、開いていた発表者ビューをつなぎ直す
  const resume = remembered();
  if (resume !== undefined) openPresenter(resume);

  // ほかのスクリプト（発表者ビュー・テスト）から操作できるようにする
  Object.assign(win, {
    mdsPlayer: {
      go: (page: number) => go(page - 1),
      next: forward,
      prev: back,
      get page() {
        return index + 1;
      },
      get step() {
        return step;
      },
      get total() {
        return slides.length;
      },
    },
  });
}
