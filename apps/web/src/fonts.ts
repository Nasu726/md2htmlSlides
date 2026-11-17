import faces from 'virtual:mds-fonts';

/**
 * 同梱するフォント（#67）を、エディタで読み込んで iframe に渡す（#73）。
 *
 * 隔離した iframe（オリジンは不透明）は、Service Worker のキャッシュを使えず、ほかのオリジンの
 * フォントには CORS が要る。そこで、エディタ（アプリと同じオリジン）がフォントのファイルを読み、
 * そのデータを iframe に送って FontFace にする。読むのは、スライドの文字が入っている分割ファイルだけ
 * （ブラウザが unicode-range で選ぶのと同じ）。オフラインでも、読んだことのあるファイルは使える。
 */
export interface WebFontFace {
  family: string;
  weight: string;
  /** 斜体（KaTeX の KaTeX_Math など）。なければ normal */
  style?: string;
  range: string;
  url: string;
}

interface Face extends WebFontFace {
  ranges: Array<[number, number]>;
}

const FACES: Face[] = faces.map((face) => ({
  ...face,
  ranges: face.range.split(',').map((part): [number, number] => {
    const [from, to] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(from!, 16), parseInt(to ?? from!, 16)];
  }),
}));

/** 英数字と記号（ページ番号などに使うので、いつも読み込む） */
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');

/** 文字ごとの、その文字を持つ分割ファイル（打鍵のたびに全部を調べないよう、覚えておく） */
const byPoint = new Map<number, number[]>();
const facesOfPoint = (cp: number) => {
  let found = byPoint.get(cp);
  if (!found) {
    found = [];
    FACES.forEach((face, i) => {
      if (face.ranges.some(([a, b]) => cp >= a && cp <= b)) found!.push(i);
    });
    byPoint.set(cp, found);
  }
  return found;
};

/** この文字を描くのに要る分割ファイル */
export function facesFor(text: string): WebFontFace[] {
  const indices = new Set<number>();
  for (const c of new Set(text + ASCII)) {
    for (const i of facesOfPoint(c.codePointAt(0)!)) indices.add(i);
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((i) => {
      const { family, weight, range, url } = FACES[i]!;
      return { family, weight, range, url };
    });
}

const buffers = new Map<string, Promise<ArrayBuffer>>();

/** フォントのファイルを読む（一度読んだものは使い回す） */
export function fontData(face: WebFontFace): Promise<ArrayBuffer> {
  let data = buffers.get(face.url);
  if (!data) {
    data = fetch(new URL(face.url, document.baseURI)).then((response) => {
      if (!response.ok) throw new Error(`${face.url}: ${response.status}`);
      return response.arrayBuffer();
    });
    data.catch(() => buffers.delete(face.url));
    buffers.set(face.url, data);
  }
  return data;
}

/** iframe ごとに、まだ送っていないフォントだけを送るための記録 */
export class FontSender {
  private sent = new Set<string>();

  /** 送るもの（まだ送っていないフォントのデータ） */
  async pending(wanted: WebFontFace[]) {
    const faces = wanted.filter((face) => !this.sent.has(face.url));
    const loaded = await Promise.all(
      faces.map(async (face) => {
        try {
          return { ...face, data: await fontData(face) };
        } catch {
          return undefined; // 読めないフォントは飛ばす（OS のフォントで描く）
        }
      }),
    );
    const ready = loaded.filter((face) => face !== undefined);
    for (const face of ready) this.sent.add(face.url);
    return ready;
  }

  reset(): void {
    this.sent.clear();
  }
}

/** 発表用：フォントを data: URL の @font-face にする（発表者ビューの別ウィンドウでも効くように） */
export async function embeddedFontCss(faces: WebFontFace[]): Promise<string> {
  const rules = await Promise.all(
    faces.map(async (face) => {
      try {
        const url = await new Promise<string>((resolve, reject) => {
          void fontData(face).then((data) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(new Blob([data], { type: 'font/woff2' }));
          }, reject);
        });
        return `@font-face{font-family:'${face.family}';font-style:${face.style ?? 'normal'};font-display:block;font-weight:${face.weight};src:url(${url}) format('woff2');unicode-range:${face.range};}`;
      } catch {
        return '';
      }
    }),
  );
  return rules.filter(Boolean).join('\n');
}

export { visibleText } from '@mds/embeds';
