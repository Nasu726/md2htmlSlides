/** 最初に用意するテーマ（docs/design.md §6）。CSS は #16 以降で追加する。 */
export const THEMES = ['clean', 'dark', 'bold'] as const;

export type ThemeId = (typeof THEMES)[number];

export function isThemeId(value: string): value is ThemeId {
  return (THEMES as readonly string[]).includes(value);
}
