/**
 * PDF にする前の準備（#70、S5 #69）。書き出した HTML を開いたページの中で実行する
 * （CLI の `mdhs pdf` が page.evaluate で呼ぶ）。外側の変数を使わない1つの関数にしている。
 *
 * - steps が 'each' なら、ステップのあるスライドをステップの数だけ複製し、1ステップ＝1ページにする
 * - 動画は止めて、操作ボタンを外す。ポスターがあればポスター、なければ最初のフレームを出す
 * - 埋め込み動画の代わりに出すサムネイルを、先に読み込んでおく
 *
 * 戻り値はページの数（印刷するスライドの数）。
 */
export async function preparePrint(options: { steps: 'final' | 'each' }): Promise<number> {
  const doc = document;
  const deck = doc.querySelector('.mds-deck');
  if (!deck) return 0;
  const slides = Array.from(deck.querySelectorAll<HTMLElement>(':scope > .mds-slide')).filter(
    (slide) => !slide.hasAttribute('data-hidden'),
  );

  // 1. ステップごとのページ。発表用の印（data-step-hidden）は外し、
  //    印刷用の印（data-step-print-hidden）で、そのページでまだ出ていない要素を隠す
  // 埋め込みの内部ステップ（#105）：そのページのステップまでに来た段を表示する（既定は最後の段）。
  // 既定（final）では、1つのステップを強調しない「まとめ」にする（動く構成図のまとめの1枚。#109）
  type EmbedRuntime = { show(el: HTMLElement, stage: number, summary?: boolean): void };
  const embeds = (window as unknown as { mdsEmbeds?: Record<string, EmbedRuntime> }).mdsEmbeds;
  const showEmbeds = (root: ParentNode, upTo: number, summary = false) => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-substeps]'))) {
      const stage = (el.dataset.substeps ?? '')
        .split(',')
        .filter((n) => n !== '' && Number(n) <= upTo).length;
      el.dataset.stage = String(stage);
      embeds?.[el.dataset.embed ?? '']?.show(el, stage, summary);
    }
  };
  for (const slide of slides) showEmbeds(slide, Infinity, options.steps === 'final');

  let pages = slides.length;
  if (options.steps === 'each') {
    for (const slide of slides) {
      const steps = Number(slide.dataset.steps ?? 0);
      if (!steps) continue;
      for (let k = 0; k <= steps; k++) {
        const page = k === steps ? slide : (slide.cloneNode(true) as HTMLElement);
        for (const el of Array.from(page.querySelectorAll<HTMLElement>('[data-step]'))) {
          el.removeAttribute('data-step-hidden');
          el.toggleAttribute('data-step-print-hidden', Number(el.dataset.step) > k);
        }
        showEmbeds(page, k);
        if (page !== slide) {
          page.removeAttribute('id');
          slide.before(page);
        }
      }
      pages += steps;
    }
  }

  // 2. 動画：ポスターがあればポスター、なければ最初のフレーム（操作ボタンなし）
  const wait = (target: EventTarget, type: string, ms: number) =>
    new Promise<void>((done) => {
      const timer = setTimeout(done, ms);
      target.addEventListener(
        type,
        () => {
          clearTimeout(timer);
          done();
        },
        { once: true },
      );
    });
  const videos = Array.from(deck.querySelectorAll('video'));
  await Promise.all(
    videos.map(async (video) => {
      video.pause();
      video.autoplay = false;
      video.removeAttribute('autoplay');
      video.controls = false;
      video.removeAttribute('controls');
      if (video.poster) {
        video.load(); // 再生前の状態（ポスター）に戻す
        return;
      }
      video.preload = 'auto';
      if (video.readyState < 2) await wait(video, 'loadeddata', 3000);
      if (video.readyState >= 1) {
        const seeked = wait(video, 'seeked', 3000);
        video.currentTime = Math.min(0.01, video.duration || 0.01);
        await seeked;
      }
    }),
  );

  // 3. 埋め込み動画の代わりのサムネイル（読み込めなくても、黒い枠とリンクは出る）
  const thumbs = Array.from(deck.querySelectorAll<HTMLElement>('.mds-print-link'))
    .map((link) => /url\(['"]?([^'")]+)/.exec(link.style.backgroundImage)?.[1])
    .filter((url): url is string => Boolean(url));
  await Promise.all(
    thumbs.map(
      (url) =>
        new Promise<void>((done) => {
          const image = new Image();
          const timer = setTimeout(done, 3000);
          image.onload = image.onerror = () => {
            clearTimeout(timer);
            done();
          };
          image.src = url;
        }),
    ),
  );
  await doc.fonts.ready;
  return pages;
}
