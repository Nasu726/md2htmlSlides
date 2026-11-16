import { describe, expect, it } from 'vitest';
import { THEMES, isThemeId } from './index.js';

describe('themes', () => {
  it('最初のテーマは clean・dark・bold の3つ', () => {
    expect(THEMES).toEqual(['clean', 'dark', 'bold']);
  });

  it('テーマ名かどうかを判定できる', () => {
    expect(isThemeId('dark')).toBe(true);
    expect(isThemeId('Dark')).toBe(false);
    expect(isThemeId('minimal')).toBe(false);
  });
});
