/**
 * Mermaid の図を描く（#71、設計プラン §7.2）。CLI が、テーマの CSS とフォントを読み込んだページに
 * Mermaid（mermaid.min.js）を入れてから、page.evaluate で呼ぶ。外側の変数を使わない1つの関数にしている。
 *
 * 配色はデッキの CSS 変数（--mds-bg・--mds-fg・--mds-accent など）から作るので、テーマと accent: に合う。
 * 書き出した HTML には SVG だけを入れ、Mermaid は含めない。
 */
export async function renderMermaid(input: {
  codes: string[];
  ids: string[];
}): Promise<Array<{ svg: string; width: number; height: number } | { error: string }>> {
  const mermaid = (window as unknown as { mermaid: MermaidApi }).mermaid;
  const deck = document.querySelector<HTMLElement>('.mds-deck') ?? document.body;
  const css = getComputedStyle(deck);
  // CSS の色を、Mermaid が読める #rrggbb にする（rgb(… / …) の書き方は読めないため）
  const probe = document.createElement('span');
  document.body.append(probe);
  // 半透明の色は、地の色（最初は白、地の色を読んだ後はその色）と混ぜて不透明にする
  let bgRgb = [255, 255, 255];
  const hex = (name: string, fallback: string) => {
    probe.style.color = '';
    probe.style.color = css.getPropertyValue(name).trim() || fallback;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(probe).color);
    if (!m) return fallback;
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    const mix = (c: string, i: number) =>
      Math.round(Number(c) * alpha + (bgRgb[i] ?? 255) * (1 - alpha));
    return `#${[m[1]!, m[2]!, m[3]!].map((c, i) => mix(c, i).toString(16).padStart(2, '0')).join('')}`;
  };
  const bg = hex('--mds-bg', '#ffffff');
  bgRgb = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  const fg = hex('--mds-fg', '#0f172a');
  const muted = hex('--mds-muted', '#64748b');
  const accent = hex('--mds-accent', '#2563eb');
  const surface = hex('--mds-surface', '#f1f5f9');
  const border = hex('--mds-border', '#e2e8f0');
  probe.remove();
  const dark = (bgRgb[0]! * 0.2126 + bgRgb[1]! * 0.7152 + bgRgb[2]! * 0.0722) / 255 < 0.5;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: dark,
    fontFamily: css.getPropertyValue('--mds-font-body').trim() || 'sans-serif',
    // 図は枠に合わせて縮めるので、文字は既定（16px）より大きく描いておき、ノードの間隔に対して
    // 文字を相対的に大きくする（スライドの上で読める大きさにするため）
    fontSize: 22,
    themeVariables: {
      darkMode: dark,
      background: bg,
      fontFamily: css.getPropertyValue('--mds-font-body').trim() || 'sans-serif',
      fontSize: '22px',
      primaryColor: surface,
      primaryTextColor: fg,
      primaryBorderColor: accent,
      secondaryColor: surface,
      secondaryTextColor: fg,
      secondaryBorderColor: border,
      tertiaryColor: bg,
      tertiaryTextColor: fg,
      tertiaryBorderColor: border,
      mainBkg: surface,
      nodeBorder: accent,
      lineColor: muted,
      textColor: fg,
      titleColor: fg,
      edgeLabelBackground: bg,
      clusterBkg: bg,
      clusterBorder: border,
      noteBkgColor: surface,
      noteTextColor: fg,
      noteBorderColor: border,
      actorBkg: surface,
      actorBorder: accent,
      actorTextColor: fg,
      actorLineColor: muted,
      signalColor: fg,
      signalTextColor: fg,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: border,
      labelTextColor: fg,
      loopTextColor: fg,
      activationBkgColor: surface,
      activationBorderColor: accent,
      sequenceNumberColor: bg,
    },
  });

  const results: Array<{ svg: string; width: number; height: number } | { error: string }> = [];
  for (const [i, code] of input.codes.entries()) {
    const id = input.ids[i]!;
    try {
      await mermaid.parse(code);
      const { svg } = await mermaid.render(id, code);
      const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
      results.push({ svg, width: Number(box?.[1] ?? 0), height: Number(box?.[2] ?? 0) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ error: message });
      // 失敗したときに Mermaid が残す要素を消す
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  }
  return results;
}

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  parse(code: string): Promise<unknown>;
  render(id: string, code: string): Promise<{ svg: string }>;
}
