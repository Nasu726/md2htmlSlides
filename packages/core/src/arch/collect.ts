import type { Diagnostic } from '../diagnostics.js';
import type { Attrs } from '../attrs.js';
import type { Block } from '../ir.js';
import { decodePath, isLocalPath } from '../media.js';
import type { SlideDeck } from '../slides.js';
import { parseArch, type ArchDiagram, type ArchDiagnostic } from './parse.js';

/**
 * スライドの中の動く構成図（```` ```arch ```` と `![](x.arch)`）を集める（#106）。
 * ファイルの読み方は環境で違うので、読む関数を受け取る。
 */
export interface ArchSource {
  /** 置いてあるスライドの ID */
  slideId: string;
  /** md の中の行（コードブロックなら ``` の行、ファイル参照ならその行） */
  line: number;
  /** ファイル参照のときのパス（資料のフォルダから） */
  src?: string;
  /** 構成図のソース */
  code: string;
  attrs?: Attrs;
  diagram: ArchDiagram;
  /** 構成図のソースの中の行の警告 */
  diagnostics: ArchDiagnostic[];
}

/** コードブロックの中身（最初と最後の囲みの行を除く） */
const fenceContent = (raw: string) => `${raw.split('\n').slice(1, -1).join('\n')}\n`;

export function collectArch(
  deck: SlideDeck,
  read: (src: string) => string | undefined,
): ArchSource[] {
  const out: ArchSource[] = [];
  for (const slide of deck.slides) {
    const visit = (blocks: Block[]) => {
      for (const block of blocks) {
        if (block.kind === 'code' && block.lang === 'arch') {
          const code = fenceContent(block.raw);
          out.push({
            slideId: slide.id,
            line: block.src.start,
            code,
            ...(block.attrs ? { attrs: block.attrs } : {}),
            ...parseArch(code),
          });
        }
        for (const media of block.media ?? []) {
          if (media.kind !== 'arch' || !isLocalPath(media.src)) continue;
          const src = decodePath(media.src);
          const code = read(src);
          if (code === undefined) continue; // 見つからないファイルは、メディアの警告に任せる
          out.push({
            slideId: slide.id,
            line: media.line,
            src,
            code,
            ...(media.attrs ? { attrs: media.attrs } : {}),
            ...parseArch(code),
          });
        }
        if (block.children) visit(block.children);
      }
    };
    visit(slide.blocks);
  }
  return out;
}

/** 再生するシナリオ（`scenario=` がなければ最初のもの。`none` なら再生しない） */
export function selectScenario(source: ArchSource) {
  const name = source.attrs?.values.scenario;
  if (name === 'none') return undefined;
  if (typeof name === 'string') return source.diagram.scenarios.find((s) => s.name === name);
  return source.diagram.scenarios[0];
}

/**
 * 動く構成図の警告を、md の行の警告にする。
 * - 構成図の中の警告：コードブロックなら md の行に直し、ファイル参照ならファイル名と行を添える
 * - 存在しないシナリオ、1つのスライドに2つ以上の図（§5.3）
 */
export function archDiagnostics(sources: ArchSource[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const perSlide = new Map<string, number>();
  for (const source of sources) {
    for (const d of source.diagnostics) {
      out.push({
        severity: d.severity,
        code: d.code,
        message: source.src ? `${d.message}（${source.src} の ${d.line} 行目）` : d.message,
        line: source.src ? source.line : source.line + d.line,
        ...(!source.src && d.suggestion ? { suggestion: d.suggestion } : {}),
        ...(!source.src && d.found ? { found: d.found } : {}),
      });
    }
    const name = source.attrs?.values.scenario;
    if (typeof name === 'string' && name !== 'none' && !selectScenario(source)) {
      const names = source.diagram.scenarios.map((s) => s.name);
      out.push({
        severity: 'warning',
        code: 'arch/unknown-scenario',
        message: `シナリオ「${name}」はありません${names.length > 0 ? `（${names.join('・')}）` : '（シナリオが書かれていません）'}`,
        line: source.line,
      });
    }
    const count = (perSlide.get(source.slideId) ?? 0) + 1;
    perSlide.set(source.slideId, count);
    if (count === 2) {
      out.push({
        severity: 'warning',
        code: 'arch/multiple',
        message: '1つのスライドに置ける動く構成図は1つまでです。スライドを分けてください',
        line: source.line,
      });
    }
  }
  return out;
}
