import { cleanCss } from './clean.js';

/** 最初に用意するテーマ（docs/design.md §6）。 */
export const THEMES = ['clean', 'dark', 'bold'] as const;

export type ThemeId = (typeof THEMES)[number];

export function isThemeId(value: string): value is ThemeId {
  return (THEMES as readonly string[]).includes(value);
}

/**
 * テーマの CSS。`.theme-<id>` の中だけに効く。
 * dark と bold は M3 で作るので、それまでは clean のトークンを使う。
 */
export function themeCss(id: ThemeId): string {
  return cleanCss(`.theme-${id}`);
}

export { CLEAN_TOKENS, cleanCss } from './clean.js';
