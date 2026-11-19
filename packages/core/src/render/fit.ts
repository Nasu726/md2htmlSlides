/**
 * 本文の下に残す余白（本文の高さに対する割合）。下端ぎりぎりまで文字が来ると見づらいので、
 * ここまで埋まったら縮める（#92）。自動分割の判定（SplitWeights.margin）も同じ値を使う。
 */
export const FIT_MARGIN = 0.06;

/**
 * 内容があふれたスライドを、文字を小さくして収める（最小 60%）。
 * 本文の下に margin の割合の余白が残るまで縮める（#92）。あふれた（data-overflow）かどうかは、本文の高さで見る。
 * 自動分割（docs/design.md §4）で決めた倍率（data-scale）から始める。分割の計測と、
 * 発表する環境のフォントが違ってあふれたときの、最後の手段として残している。
 * 収まらなければ data-overflow を付ける（基本の CSS が赤い点線で示す）。
 * root にスライド（`.mds-slide`）を渡すと、そのスライドだけを収める。
 */
export function fitSlides(root: ParentNode, margin: number): void {
  // スライド1枚を渡したときは、そのスライドだけを収める（エディタのプレビューで、変わったスライドだけ）
  const slides =
    root instanceof HTMLElement && root.classList.contains('mds-slide')
      ? [root]
      : Array.from(root.querySelectorAll<HTMLElement>('.mds-slide'));
  for (const slide of slides) {
    const body = slide.querySelector<HTMLElement>('.mds-body');
    // タイトルスライド（本文がない）：文字のかたまりが、スライドの上下の余白の内側に収まるまで縮める（#131）
    const block = body ? null : slide.querySelector<HTMLElement>('.mds-titleblock');
    if (block) {
      const style = getComputedStyle(slide);
      const room =
        slide.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      let fit = 1;
      block.style.setProperty('--mds-fit', '1');
      while (room > 0 && block.offsetHeight > room && fit > 0.6) {
        fit = Math.round((fit - 0.05) * 100) / 100;
        block.style.setProperty('--mds-fit', String(fit));
      }
      slide.dataset.fit = String(fit);
      if (room > 0 && block.offsetHeight > room) slide.dataset.overflow = '';
      else delete slide.dataset.overflow;
      continue;
    }
    if (!body) continue;
    let fit = Number(body.dataset.scale ?? 1);
    body.style.setProperty('--mds-fit', String(fit));
    // 測るあいだだけ、本文の高さを余白のぶん低くする。本文がスライドの残りを埋めるレイアウト
    // （stack・split など）だけ。中身の高さで決まる本文（statement・section）と、高さのない
    // （表示していない）スライドには余白を設けない
    body.style.maxHeight = '';
    const full = body.clientHeight;
    const fills = parseFloat(getComputedStyle(body).flexGrow) > 0;
    if (fills && full > 0) body.style.maxHeight = `${Math.floor(full * (1 - margin))}px`;
    while (body.scrollHeight > body.clientHeight + 1 && fit > 0.6) {
      fit = Math.round((fit - 0.05) * 100) / 100;
      body.style.setProperty('--mds-fit', String(fit));
    }
    body.style.maxHeight = '';
    slide.dataset.fit = String(fit);
    if (body.scrollHeight > body.clientHeight + 1) slide.dataset.overflow = '';
    else delete slide.dataset.overflow;
  }
}

/**
 * 書き出した HTML に埋め込むための、fitSlides のソース。
 * 同梱したフォントは読み込みに少し時間がかかるので、読み込み終わったらもう一度収め直す。
 */
export const FIT_SCRIPT = `(${fitSlides.toString()})(document, ${FIT_MARGIN});
document.fonts && document.fonts.ready.then(() => (${fitSlides.toString()})(document, ${FIT_MARGIN}));`;
