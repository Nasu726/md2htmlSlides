/**
 * 資料の処理の流れ（#170）。CLI（書き出し）と Web エディタ（プレビュー）で共通にする。
 *
 * パース → 素材の確認 → 構成図を集める → カスタム CSS → コードの色分け・数式
 * → Mermaid の図 → 動く構成図の配置 → 自動分割（計測）
 *
 * 環境ごとに違う部分（ファイルの読み方、図の描き方、計測のしかた、キャッシュ）は PipelineHost で渡す。
 * 最後の描画（CLI は HTML を1つ、エディタはスライドごと）は、呼ぶ側が prepared の結果を使って行う。
 */
import {
  applySplit,
  archDiagnostics,
  buildSlides,
  checkMediaFiles,
  collectArch,
  collectMedia,
  decodePath,
  hashString,
  isLocalPath,
  normalizePath,
  parseDeck,
  planSplit,
  renderDeckHtml,
  type ArchSource,
  type CodeHighlighter,
  type Deck,
  type Diagnostic,
  type DiagramResult,
  type MathRenderer,
  type MeasureJob,
  type Measurement,
  type MediaInfo,
  type RenderOptions,
  type SlideDeck,
} from '@mdhs/core';
import { mathDiagnostics } from './math.js';
import { collectMermaid, diagramDiagnostic, normalizeCode } from './mermaid.js';

/** 配置する動く構成図（id は SVG の中の id の接頭辞） */
export interface ArchItem {
  id: string;
  diagram: ArchSource['diagram'];
}

export interface PipelineHost {
  /** 資料のフォルダからの相対パスのテキスト（`.arch`・`.mmd`・`css:`）。読めなければ undefined */
  readText(src: string): Promise<string | undefined>;
  /** 素材を調べる（あるか、縦横） */
  probe(src: string): MediaInfo | undefined;
  /** 素材の URL（書き出し先・プレビューでの） */
  assetUrl(src: string): string;
  /** 資料をパースした直後に呼ぶ（CLI：素材を登録する。エディタ：テーマの書体を決める） */
  parsed?(deck: Deck): void;
  /** 素材の縦横を先に読んでおく（エディタ：描く前にレイアウトを決めるため） */
  loadMedia?(srcs: string[]): Promise<void>;
  /** コードの色分け（資料で使っている言語の分だけ）。いらなければ undefined */
  highlighter(text: string): Promise<CodeHighlighter | undefined>;
  /** 数式。資料に数式があるときだけ呼ぶ */
  math(): Promise<{ render: MathRenderer; layoutCss: string }>;
  /** 計測と図に使う、スライドを空にしたページに足すフォントの CSS（hasMath：数式がある） */
  pageFontCss?(hasMath: boolean): string | undefined;
  /** 全面の背景の明るさ（0〜1。上に置く文字の色を選ぶ）。パスは資料のフォルダからの相対パス */
  luminance?(srcs: string[]): Promise<Map<string, number>>;
  /** Mermaid の図を描く（コード → 結果）。描けなければ undefined。ないときは図を描かない */
  mermaid?(page: string, codes: string[]): Promise<Map<string, DiagramResult> | undefined>;
  /** Mermaid の結果を差し替える（エディタ：構文エラーのとき、前に描けた図を出す）。index は図の順番 */
  mermaidResult?(index: number, result: DiagramResult): DiagramResult;
  /** 動く構成図を配置する（items と同じ順）。描けなければ undefined。ないときは配置しない */
  archs?(page: string, items: ArchItem[]): Promise<Array<DiagramResult | undefined> | undefined>;
  /** 自動分割のために測る。測れなければ undefined。ないときは分割しない */
  measure?(page: string, jobs: MeasureJob[]): Promise<Measurement[] | undefined>;
  /** 処理の区切りごとに呼ぶ（エディタ：別の資料を開いたら、ここで止める） */
  checkpoint?(): void;
}

export interface Prepared {
  deck: Deck;
  /** 自動分割した後のスライド */
  slides: SlideDeck;
  /** 描画に使う設定（色分け・数式・図・素材・カスタム CSS） */
  options: RenderOptions;
  /** 警告（行の順に並べていない。呼ぶ側が足してから並べる） */
  diagnostics: Diagnostic[];
  archSources: ArchSource[];
  /** スライドを空にしたページ（計測と図に使ったもの） */
  page: string;
  /** 資料に数式がある（数式のフォントを入れる） */
  hasMath: boolean;
}

interface DrawnEntry {
  src?: string;
  code: string;
  result: DiagramResult;
}

/** コード・ファイルの図の結果を、描画のときに引けるようにする */
function lookup(entries: DrawnEntry[]) {
  const byCode = new Map<string, DiagramResult>();
  const bySrc = new Map<string, DiagramResult>();
  for (const { src, code, result } of entries) {
    if (src !== undefined) bySrc.set(normalizePath(src), result);
    else byCode.set(normalizeCode(code), result);
  }
  return (input: { src: string } | { code: string }) =>
    'src' in input ? bySrc.get(normalizePath(input.src)) : byCode.get(normalizeCode(input.code));
}

/** 資料を読み、描画に必要なもの（分割したスライド・設定・警告）をそろえる */
export async function prepareDeck(text: string, host: PipelineHost): Promise<Prepared> {
  const deck = parseDeck(text);
  let slides = buildSlides(deck);
  host.parsed?.(deck);

  // 素材：縦横を先に読んでおく
  if (host.loadMedia) {
    const media = collectMedia(deck).flatMap((m) => {
      const poster = m.attrs?.values.poster;
      return typeof poster === 'string' ? [m.src, poster] : [m.src];
    });
    await host.loadMedia([...media, ...(deck.meta.logo ? [deck.meta.logo] : [])]);
    host.checkpoint?.();
  }
  const diagnostics = [...deck.diagnostics, ...checkMediaFiles(deck, (src) => host.probe(src))];

  // 図のファイル（`.arch`・`.mmd`）を先に読んでおく
  const files = new Map<string, string>();
  for (const m of collectMedia(deck)) {
    if ((m.kind !== 'arch' && m.kind !== 'diagram') || !isLocalPath(m.src)) continue;
    const key = normalizePath(m.src);
    if (files.has(key)) continue;
    const content = await host.readText(m.src);
    if (content !== undefined) files.set(key, content);
  }
  const readFile = (src: string) => files.get(normalizePath(src));

  // 動く構成図（#106）：書き間違い・存在しないシナリオ・1つのスライドに2つ以上
  const archSources = collectArch(slides, readFile);
  diagnostics.push(...archDiagnostics(archSources));

  // css: で指定したファイルを、デッキの中だけに効かせて埋め込む
  let customCss: string | undefined;
  if (deck.meta.css) {
    customCss = await host.readText(deck.meta.css);
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

  // 背景の明るさを測る（全面の背景の上の文字色を選ぶため）
  let probe = (src: string) => host.probe(src);
  if (host.luminance) {
    const backgrounds = collectMedia(deck)
      .filter((m) => m.attrs?.values.bg !== undefined && isLocalPath(m.src))
      .map((m) => decodePath(m.src));
    const luminance = await host.luminance(backgrounds);
    probe = (src) => {
      const info = host.probe(src);
      const value = luminance.get(src);
      return info && value !== undefined ? { ...info, luminance: value } : info;
    };
  }
  const options: RenderOptions = {
    probe,
    assetUrl: (src) => host.assetUrl(src),
    ...(customCss !== undefined ? { customCss } : {}),
  };

  // コードの色分け（#68）と数式（#72）：使うときだけ読み込む
  const highlight = await host.highlighter(text);
  if (highlight) options.highlight = highlight;
  const math = deck.math ? await host.math() : undefined;
  if (math) {
    options.math = math.render;
    options.libraryCss = math.layoutCss;
    diagnostics.push(...mathDiagnostics(deck, math.render));
  }
  host.checkpoint?.();

  // スライドを空にしたデッキ：計測と図の描画に使う（テーマ・縦横比・カスタム CSS・同じフォント）
  const fontCss = host.pageFontCss?.(math !== undefined);
  const page = renderDeckHtml(
    { ...slides, slides: [] },
    { ...options, fit: false, ...(fontCss ? { fontCss } : {}) },
  );

  // Mermaid の図（#71）：先に SVG にしておき、描画では結果を返すだけにする
  if (host.mermaid) {
    const found = collectMermaid(text, deck, readFile);
    const results =
      found.length > 0
        ? await host.mermaid(
            page,
            found.map((d) => d.code),
          )
        : undefined;
    if (results) {
      const entries: DrawnEntry[] = [];
      found.forEach((item, i) => {
        let result = results.get(item.code);
        if (!result) return;
        if ('error' in result) diagnostics.push(diagramDiagnostic(item, result.error));
        if (host.mermaidResult) result = host.mermaidResult(i, result);
        entries.push({
          ...(item.src !== undefined ? { src: item.src } : {}),
          code: item.code,
          result,
        });
      });
      options.diagram = lookup(entries);
    }
  }

  // 動く構成図（#107）：配置して SVG にしておく。説明のリストと再生のため、シナリオも渡す
  if (host.archs && archSources.length > 0) {
    const items = archSources.map((s) => ({
      id: `mds-a-${hashString(s.code)}`,
      diagram: s.diagram,
    }));
    const results = await host.archs(page, items);
    if (results) {
      const entries: DrawnEntry[] = [];
      archSources.forEach((s, i) => {
        const drawn = results[i];
        if (!drawn) return;
        const result = 'error' in drawn ? drawn : { ...drawn, scenarios: s.diagram.scenarios };
        entries.push({ ...(s.src !== undefined ? { src: s.src } : {}), code: s.code, result });
      });
      const arch = lookup(entries);
      const mermaid = options.diagram;
      options.diagram = (input) => (input.lang === 'arch' ? arch(input) : mermaid?.(input));
    }
  }
  host.checkpoint?.();

  // 自動分割（docs/design.md §4）：スライドを空にしたデッキの上で原子の高さを測り、節ごとに区切る
  if (host.measure) {
    const plan = planSplit(slides, {
      ...(options.diagram ? { diagram: options.diagram } : {}),
      ...(options.math ? { math: options.math } : {}),
    });
    if (plan.jobs.length > 0) {
      const measurements = await host.measure(page, plan.jobs);
      host.checkpoint?.();
      if (measurements) slides = applySplit(slides, plan, measurements);
    }
  }

  return { deck, slides, options, diagnostics, archSources, page, hasMath: math !== undefined };
}
