import { boldCss } from './bold.js';
import { cleanCss } from './clean.js';
import { darkCss } from './dark.js';

/** 最初に用意するテーマ（docs/design.md §6）。 */
export const THEMES = ['clean', 'dark', 'bold'] as const;

export type ThemeId = (typeof THEMES)[number];

export function isThemeId(value: string): value is ThemeId {
  return (THEMES as readonly string[]).includes(value);
}

/** テーマの CSS。`.theme-<id>` の中だけに効く。 */
export function themeCss(id: ThemeId): string {
  const selector = `.theme-${id}`;
  if (id === 'dark') return darkCss(selector);
  if (id === 'bold') return boldCss(selector);
  return cleanCss(selector);
}

export { BOLD_TOKENS, boldCss } from './bold.js';
export { CLEAN_TOKENS, cleanCss } from './clean.js';
export { DARK_TOKENS, darkCss } from './dark.js';
