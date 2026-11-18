/**
 * 動く構成図（#107、docs/arch-diagram.md §5）：スライドの中の図と、説明のリスト。
 * 図の SVG とシナリオは、描く関数（RenderEnv.diagram）が返す。core は配置と説明のリストを決める。
 */
import type { Attrs } from '../attrs.js';
import type { ArchScenario } from '../arch/parse.js';
import type { Block } from '../ir.js';
import type { DiagramRenderer } from '../md/media.js';

export type ArchCaptions = 'auto' | 'side' | 'below' | 'none';

export interface ArchUse {
  /** 図の縦横比（幅 / 高さ） */
  aspect: number;
  /** 再生するシナリオ（`scenario=none` や、シナリオのない図なら undefined） */
  scenario?: ArchScenario;
  captions: ArchCaptions;
}

const decode = (src: string) => {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
};

/** ブロックの中の動く構成図（```arch か、`.arch` だけの段落）。描けなければ undefined */
export function archUse(block: Block, diagram: DiagramRenderer | undefined): ArchUse | undefined {
  let attrs: Attrs | undefined;
  let result;
  if (block.kind === 'code' && block.lang === 'arch') {
    attrs = block.attrs;
    const code = `${block.raw.split('\n').slice(1, -1).join('\n')}\n`;
    result = diagram?.({ lang: 'arch', code });
  } else {
    const media = (block.media ?? []).find(
      (m) => m.kind === 'arch' && m.attrs?.values.bg === undefined,
    );
    if (!media) return undefined;
    attrs = media.attrs;
    result = diagram?.({ lang: 'arch', src: decode(media.src) });
  }
  if (!result || 'error' in result) return undefined;
  const name = attrs?.values.scenario;
  const scenario =
    name === 'none'
      ? undefined
      : typeof name === 'string'
        ? result.scenarios?.find((s) => s.name === name)
        : result.scenarios?.[0];
  const captions = attrs?.values.captions;
  return {
    aspect: result.height > 0 ? result.width / result.height : 1.6,
    ...(scenario ? { scenario } : {}),
    captions:
      captions === 'side' || captions === 'below' || captions === 'none' ? captions : 'auto',
  };
}

/** 説明のリストを出すか（シナリオにステップがあり、captions=none でない） */
export const hasCaptions = (use: ArchUse) =>
  use.captions !== 'none' && (use.scenario?.steps.length ?? 0) > 0;

/**
 * 説明のリストを図の下に置くか（§5.4）。below の指定か、auto で図が横長（2.2:1 以上）なら下。
 * 横長の図の横に説明を置くと、図が縮んで文字が読めなくなるため
 */
export const captionsBelow = (use: ArchUse) =>
  use.captions === 'below' || (use.captions === 'auto' && use.aspect >= 2.2);

/** ステップの説明の番号付きリスト（今のステップの強調は runtime が行う。#108） */
export function archCaptionsHtml(use: ArchUse, esc: (s: string) => string): string {
  if (!hasCaptions(use)) return '';
  const items = use.scenario!.steps.map((s) => `<li>${esc(s.title)}</li>`).join('');
  return `<ol class="mds-arch-captions${captionsBelow(use) ? ' is-row' : ''}">${items}</ol>\n`;
}
