import { describe, expect, it } from 'vitest';
import { SERIF_FAMILY, THEMES, isThemeId, themeCss, themeFonts } from './index.js';

describe('themeCss（#66）', () => {
  it('どのテーマも、それぞれのセレクタの中だけに効き、配色が違う', () => {
    const css = Object.fromEntries(THEMES.map((id) => [id, themeCss(id)]));
    for (const id of THEMES) {
      const selectors = css[id]!.match(/^[^{}\n]+(?=\s*\{)/gm) ?? [];
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) expect(selector).toContain(`.theme-${id}`);
    }
    const bg = (id: string) => /--mds-bg:\s*([^;]+);/.exec(css[id]!)?.[1];
    // clean・bold・band・academic は白、dark は暗い、pop はクリーム色
    expect(new Set(THEMES.map(bg)).size).toBe(3);
    expect(bg('dark')).toBe('#0b1120');
    expect(bg('pop')).toBe('#fffaf0');
    const accent = (id: string) => /--mds-accent:\s*([^;]+);/.exec(css[id]!)?.[1];
    expect(new Set(THEMES.map(accent)).size).toBe(THEMES.length);
  });

  it('bold の線の色は accent に合わせて変わる', () => {
    const css = themeCss('bold');
    expect(css).toContain('--mds-strong: var(--mds-accent);');
    expect(css).toMatch(/\.layout-title:not\([^)]*\) \.mds-title \{[^}]*solid var\(--mds-strong\)/);
  });

  it('bold・band の章扉は、一面を色で塗らず、番号も付けない（#100・#114）', () => {
    // bold：見出しの下の太い線。band：左の縦の帯（スライドの 28%）
    expect(themeCss('bold')).toMatch(
      /\.layout-section:not\([^)]*\) \.mds-title \{[^}]*border-bottom: 12px solid/,
    );
    expect(themeCss('bold')).not.toMatch(/\.layout-section(:not\([^)]*\))?\s*[,{][^}]*background:/);
    expect(leftBand(themeCss('band'))).toContain('.layout-section');
    for (const id of ['bold', 'band'] as const) {
      expect(themeCss(id), id).not.toContain('counter(');
    }
  });

  it('bold・band のタイトルスライドも、一面を色で塗らない。章扉と同じ形にする（#137）', () => {
    // bold：見出しの下の太い線（A 案）。band：左の縦の帯と左揃え（A 案）
    expect(themeCss('bold')).toMatch(
      /\.layout-title:not\([^)]*\) \.mds-title \{[^}]*border-bottom: 14px solid/,
    );
    for (const id of ['bold', 'band'] as const) {
      expect(themeCss(id), id).not.toMatch(
        /\.layout-title(:not\([^)]*\))?\s*\{[^}]*background: var/,
      );
    }
    expect(leftBand(themeCss('band'))).toContain('.layout-title');
    expect(themeCss('band')).toMatch(
      /\.layout-title:not\([^)]*\) \.mds-titleblock \{[^}]*align-items: flex-start/,
    );
  });
});

/** band の左の縦の帯（スライドの 28%）を敷く規則のセレクタ */
function leftBand(css: string): string {
  const rule = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).find(([, , body]) =>
    body!.includes('linear-gradient(to right, var(--mds-band) 0 calc(var(--mds-w) * 0.28)'),
  );
  return rule?.[1] ?? '';
}

describe('読みやすさ（#131）', () => {
  it('明るいアクセントの bold・pop は、小さな文字のアクセントを少し暗くする（ほかのテーマはアクセントのまま）', () => {
    for (const id of THEMES) {
      const has = themeCss(id).includes(
        '--mds-accent-text: color-mix(in srgb, var(--mds-accent) 78%, #000);',
      );
      expect(has, id).toBe(id === 'bold' || id === 'pop');
    }
  });
});

describe('band・academic・pop（#93）', () => {
  it('band の帯の色は accent に合わせて変わる', () => {
    const css = themeCss('band');
    expect(css).toContain('--mds-band: var(--mds-accent);');
    expect(leftBand(css)).not.toBe('');
  });

  it('academic だけが見出しに明朝体を使い、その書体を読み込む', () => {
    expect(themeCss('academic')).toMatch(/--mds-font-heading: 'MDS Noto Serif JP'/);
    for (const id of THEMES) {
      expect(themeFonts(id).includes(SERIF_FAMILY), id).toBe(id === 'academic');
      expect(themeFonts(id)).toContain('MDS Noto Sans JP');
    }
  });
});

describe('themes', () => {
  it('テーマは clean・dark・bold と、#93 で足した band・academic・pop', () => {
    expect(THEMES).toEqual(['clean', 'dark', 'bold', 'band', 'academic', 'pop']);
  });

  it('テーマ名かどうかを判定できる', () => {
    expect(isThemeId('dark')).toBe(true);
    expect(isThemeId('Dark')).toBe(false);
    expect(isThemeId('minimal')).toBe(false);
  });
});
