import {
  applySplit,
  buildSlides,
  checkMediaFiles,
  collectMedia,
  hashString,
  parseDeck,
  planSplit,
  renderDeckHtml,
  type Diagnostic,
  type Measurement,
  type RenderOptions,
  type SlideDeck,
} from '@mds/core';
import { RUNTIME_SCRIPT } from '@mds/runtime';
import { AssetStore, noAssets } from './assets.js';
import { embeddedFontCss, FontSender, visibleText } from './fonts.js';
import { Frame, hostScript, scriptTag } from './frames.js';

/** 描いている途中で、別の資料を開いた（その描画の結果は捨てる） */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export interface RenderResult {
  /** 発表に出るスライドの数 */
  slides: number;
  diagnostics: Diagnostic[];
  /** 描くのにかかった時間（ミリ秒） */
  ms: number;
}

/**
 * エディタの文字から、プレビューを描く（#73、設計プラン §2「エディタでのデータの流れ」）。
 *
 * 1. core でパースし、スライドに分ける
 * 2. 隠した iframe（計測用。テーマの CSS とフォントがある）で原子の高さを測り、自動で分割する（CLI と同じ計算）
 * 3. HTML にして、プレビューの iframe に送る（変わったスライドだけが差し替わる）
 *
 * 計測の結果は、ページの CSS と原子の HTML のハッシュで覚えておき、変わった節だけを測り直す。
 */
export class Renderer {
  private measure: Frame;
  private preview: Frame;
  private measureFonts = new FontSender();
  private previewFonts = new FontSender();
  private measurePage: string | undefined;
  private measured = new Map<string, Measurement>();
  private sentAssets = new Set<string>();
  private assets = new AssetStore(noAssets);
  private last: { slides: SlideDeck; options: RenderOptions; html: string } | undefined;
  /** 資料を開き直すたびに増える。描画の途中で変わったら、その描画をやめる */
  private generation = 0;
  /** プレビューで S を押した・発表を Esc で終えた、など */
  onPresent?: (slide: string) => void;

  constructor(
    private previewParent: HTMLElement,
    private hiddenParent: HTMLElement,
  ) {
    this.measure = new Frame('measure', hiddenParent, { title: '計測' });
    this.preview = this.createPreview();
  }

  private createPreview(): Frame {
    const frame = new Frame('preview', this.previewParent, {
      title: 'プレビュー',
      className: 'preview-frame',
    });
    frame.onEvent = (message) => {
      if (message.type === 'present') this.onPresent?.(String(message.slide));
    };
    void frame.load(
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${scriptTag(hostScript('preview'))}</body></html>`,
    );
    return frame;
  }

  /** 別の資料を開いたとき：素材の読み先を替え、プレビューを作り直す（前の資料の素材を残さない） */
  reset(assets: AssetStore): void {
    this.assets = assets;
    this.preview.destroy();
    this.preview = this.createPreview();
    this.previewFonts.reset();
    this.sentAssets.clear();
    this.last = undefined;
    this.generation++;
  }

  async render(text: string, retry = true): Promise<RenderResult> {
    const started = performance.now();
    const generation = this.generation;
    const check = () => {
      if (generation !== this.generation) throw new Cancelled();
    };
    const deck = parseDeck(text);
    let slides = buildSlides(deck);

    // 素材：縦横を先に読んでおく（描く前にレイアウトを決めるため）
    const media = collectMedia(deck).flatMap((m) => {
      const poster = m.attrs?.values.poster;
      return typeof poster === 'string' ? [m.src, poster] : [m.src];
    });
    await this.assets.ensure([...media, ...(deck.meta.logo ? [deck.meta.logo] : [])]);
    check();
    const diagnostics = [...deck.diagnostics, ...checkMediaFiles(deck, this.assets.probe)];
    let customCss: string | undefined;
    if (deck.meta.css) {
      customCss = await this.assets.text(deck.meta.css);
      if (customCss === undefined) {
        const index = text.split('\n').findIndex((line) => /^css\s*:/.test(line));
        diagnostics.push({
          severity: 'warning',
          code: 'frontmatter/css-not-found',
          message: `CSS ファイルが見つかりません：${deck.meta.css}`,
          line: index >= 0 ? index + 1 : (deck.frontmatter?.start ?? 1),
        });
      }
    }
    const options: RenderOptions = {
      probe: this.assets.probe,
      assetUrl: this.assets.url,
      ...(customCss !== undefined ? { customCss } : {}),
    };

    // 自動分割：スライドを空にしたデッキの上で、原子の高さを測る
    const page = renderDeckHtml({ ...slides, slides: [] }, { ...options, fit: false });
    const plan = planSplit(slides);
    if (plan.jobs.length > 0) {
      await this.setMeasurePage(page);
      const css = hashString(page);
      const keys = plan.jobs.map((job) =>
        hashString(`${css}\n${job.skeleton}\n${job.atoms.join('\0')}\n${job.heads.join('\0')}`),
      );
      const missing = plan.jobs.filter((_, i) => !this.measured.has(keys[i]!));
      if (missing.length > 0) {
        const chars = visibleText(
          missing.flatMap((j) => [j.skeleton, ...j.atoms, ...j.heads]).join(' '),
        );
        const faces = await this.measureFonts.pending(chars);
        if (faces.length > 0) await this.measure.request({ type: 'fonts', faces });
        const reply = await this.measure.request<{
          id: number;
          type: string;
          results: Measurement[];
        }>({
          type: 'measure',
          jobs: missing,
        });
        let r = 0;
        plan.jobs.forEach((_, i) => {
          if (!this.measured.has(keys[i]!)) this.measured.set(keys[i]!, reply.results[r++]!);
        });
      }
      check();
      slides = applySplit(
        slides,
        plan,
        keys.map((key) => this.measured.get(key)!),
      );
    }

    // プレビュー：フォントと素材を先に渡してから、HTML を送る
    const html = renderDeckHtml(slides, {
      ...options,
      includeHidden: true,
      debug: true,
      fit: false,
    });
    // 描くときに初めて使われた素材があれば、読み込んでから描き直す（縦横がわかるように）
    const late = this.assets.takeRequested();
    if (late.length > 0 && retry) {
      await this.assets.ensure(late);
      return this.render(text, false);
    }
    const faces = await this.previewFonts.pending(visibleText(html));
    if (faces.length > 0) await this.preview.request({ type: 'fonts', faces });
    const assets = this.assets.blobs().filter(([key]) => !this.sentAssets.has(key));
    if (assets.length > 0) {
      await this.preview.request({ type: 'assets', assets });
      for (const [key] of assets) this.sentAssets.add(key);
    }
    await this.preview.request({ type: 'update', html });
    check();
    this.last = { slides, options, html };
    diagnostics.sort((a, b) => a.line - b.line);
    return {
      slides: slides.slides.filter((s) => !s.hidden).length,
      diagnostics,
      ms: performance.now() - started,
    };
  }

  /** 計測のページ（テーマ・縦横比・カスタム CSS）。変わったときだけ送る */
  private async setMeasurePage(page: string): Promise<void> {
    if (this.measurePage === page) return;
    if (this.measurePage === undefined) {
      const html = page
        .replace('<style>', '<style id="mds-deck-style">')
        .replace('</body>', `${scriptTag(hostScript('measure'))}</body>`);
      await this.measure.load(html);
    } else {
      await this.measure.request({ type: 'page', html: page });
    }
    this.measurePage = page;
  }

  /** プレビューで、いちばん大きく見えているスライド */
  async slideInView(): Promise<string> {
    const reply = await this.preview.request<{ id: number; type: string; slide: string }>({
      type: 'view',
    });
    return reply.slide;
  }

  /** プレビューで、このスライドを表示する */
  async show(slide: string): Promise<void> {
    await this.preview.request({ type: 'show', slide });
  }

  /**
   * 発表の画面の HTML。runtime で動き、Esc で親（エディタ）にメッセージを送って終える。
   * フォントは data: URL で埋め込む（発表者ビューの別ウィンドウでも同じフォントで見えるように）。
   */
  async presentHtml(slide: string): Promise<string | undefined> {
    if (!this.last) return undefined;
    const { slides, options, html } = this.last;
    const setup = `document.querySelector('.mds-deck')?.setAttribute('data-exit-message', '');
location.hash = ${JSON.stringify(`#/${encodeURIComponent(slide)}`)};`;
    return renderDeckHtml(slides, {
      ...options,
      fontCss: await embeddedFontCss(visibleText(html)),
      scripts: [setup, RUNTIME_SCRIPT, hostScript('present')],
    });
  }

  /** 発表の iframe に、素材を渡す */
  async sendPresentAssets(frame: Frame): Promise<void> {
    const assets = this.assets.blobs();
    if (assets.length > 0) await frame.request({ type: 'assets', assets });
  }
}
