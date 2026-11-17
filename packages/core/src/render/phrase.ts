import { loadDefaultJapaneseParser } from 'budoux';

type Parser = ReturnType<typeof loadDefaultJapaneseParser>;
let parser: Parser | undefined;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
const unescape = (text: string) => text.replace(/&(?:amp|lt|gt|quot);/g, (e) => ENTITIES[e]!);
const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * 見出しの HTML の文字の部分に、BudouX で文節の切れ目に `<wbr>` を入れる（設計プラン §5.5）。
 * `word-break: keep-all` と組み合わせると、どのブラウザでも PDF でも文節の切れ目で改行される。
 * `lang` が日本語のときだけ行う。`<code>` と数式（KaTeX の `.katex`）の中と、日本語を含まない部分には入れない。
 */
export function phraseBreaks(html: string, lang: string): string {
  if (!/^ja(?:-|$)/i.test(lang)) return html;
  let code = 0;
  // 数式の中の span の深さ（0 なら数式の外）
  let math = 0;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<code\b/i.test(part)) code++;
        else if (/^<\/code>/i.test(part)) code--;
        else if (math > 0 && /^<span\b/i.test(part)) math++;
        else if (math > 0 && /^<\/span>/i.test(part)) math--;
        else if (/^<span class="katex(?:-display)?"/.test(part)) math = 1;
        return part;
      }
      if (code > 0 || math > 0 || !/[぀-ヿ㐀-鿿]/.test(part)) return part;
      parser ??= loadDefaultJapaneseParser();
      return parser.parse(unescape(part)).map(escape).join('<wbr>');
    })
    .join('');
}
