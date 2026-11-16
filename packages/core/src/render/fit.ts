/**
 * 内容があふれたスライドを、文字を小さくして収める（最小 60%）。
 * 自動分割（docs/design.md §4）で決めた倍率（data-scale）から始める。分割の計測と、
 * 発表する環境のフォントが違ってあふれたときの、最後の手段として残している。
 * 収まらなければ data-overflow を付ける（基本の CSS が赤い点線で示す）。
 */
export function fitSlides(root: ParentNode = document): void {
  for (const slide of Array.from(root.querySelectorAll<HTMLElement>('.mds-slide'))) {
    const body = slide.querySelector<HTMLElement>('.mds-body');
    if (!body) continue;
    let fit = Number(body.dataset.scale ?? 1);
    body.style.setProperty('--mds-fit', String(fit));
    while (body.scrollHeight > body.clientHeight + 1 && fit > 0.6) {
      fit = Math.round((fit - 0.05) * 100) / 100;
      body.style.setProperty('--mds-fit', String(fit));
    }
    slide.dataset.fit = String(fit);
    if (body.scrollHeight > body.clientHeight + 1) slide.dataset.overflow = '';
    else delete slide.dataset.overflow;
  }
}

/** 書き出した HTML に埋め込むための、fitSlides のソース。 */
export const FIT_SCRIPT = `(${fitSlides.toString()})(document);`;
