import { academicCss } from './academic.js';
import { bandCss } from './band.js';
import { boldCss } from './bold.js';
import { cleanCss } from './clean.js';
import { darkCss } from './dark.js';
import { BUNDLED_FONTS, SERIF_FAMILY } from './fonts.js';
import { popCss } from './pop.js';

/** テーマ（docs/design.md §6）。最初の3つと、#93 で足した3つ */
export const THEMES = ['clean', 'dark', 'bold', 'band', 'academic', 'pop'] as const;

export type ThemeId = (typeof THEMES)[number];

export function isThemeId(value: string): value is ThemeId {
  return (THEMES as readonly string[]).includes(value);
}

/** テーマの CSS。`.theme-<id>` の中だけに効く。 */
export function themeCss(id: ThemeId): string {
  const selector = `.theme-${id}`;
  switch (id) {
    case 'dark':
      return darkCss(selector);
    case 'bold':
      return boldCss(selector);
    case 'band':
      return bandCss(selector);
    case 'academic':
      return academicCss(selector);
    case 'pop':
      return popCss(selector);
    default:
      return cleanCss(selector);
  }
}

/**
 * テーマが使う、同梱した書体の名前。明朝体（Noto Serif JP）は academic だけが使うので、
 * ほかのテーマでは読み込まず、書き出しにも入れない（#93）
 */
export function themeFonts(id: ThemeId): string[] {
  return BUNDLED_FONTS.map((font) => font.family).filter(
    (family) => family !== SERIF_FAMILY || id === 'academic',
  );
}

export { ACADEMIC_TOKENS, academicCss } from './academic.js';
export { BAND_TOKENS, bandCss } from './band.js';
export { BOLD_TOKENS, boldCss } from './bold.js';
export { CLEAN_TOKENS, cleanCss } from './clean.js';
export { DARK_TOKENS, darkCss } from './dark.js';
export {
  BUNDLED_FONTS,
  FONT_MONO,
  FONT_SANS,
  FONT_SERIF,
  SERIF_FAMILY,
  type BundledFont,
} from './fonts.js';
export { POP_TOKENS, popCss } from './pop.js';
