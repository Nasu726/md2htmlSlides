import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fontFileFor, fontFiles, linkedFontCss, subsetFontCss, visibleText } from './fonts.js';

describe('同梱するフォント（#67）', () => {
  it('3つの書体の分割ファイルを、パッケージの CSS から読む', () => {
    const files = fontFiles();
    const count = (family: string) => files.filter((f) => f.family === family).length;
    expect(count('MDS Noto Sans JP')).toBeGreaterThan(100);
    expect(count('MDS Inter')).toBeGreaterThan(0);
    expect(count('MDS JetBrains Mono')).toBeGreaterThan(0);
    for (const file of files) expect(existsSync(file.file), file.path).toBe(true);
    expect(fontFileFor(files[0]!.path)).toBe(files[0]!.file);
    expect(fontFileFor('@fontsource-variable/inter/../../etc/passwd')).toBeUndefined();
  });

  it('dev と計測では、分割ファイル一式を unicode-range 付きで読み込む', () => {
    const css = linkedFontCss('/__mds/fonts');
    expect(css).toContain("font-family:'MDS Noto Sans JP'");
    expect(css).toContain('url(/__mds/fonts/@fontsource-variable/noto-sans-jp/files/');
    expect(css).toMatch(/unicode-range:U\+/);
    expect(css).toContain('font-weight:100 900');
  });

  it('書き出しでは、使う文字だけに絞って埋め込む（英数字はいつも含める）', async () => {
    const { css, bytes } = await subsetFontCss('見出しの太さ');
    expect(css).toContain("font-family:'MDS Noto Sans JP'");
    expect(css).toContain("font-family:'MDS Inter'");
    expect(css).toContain('data:font/woff2;base64,');
    expect(css).toContain('U+898b'); // 見
    expect(bytes).toBeGreaterThan(1000);
    expect(bytes).toBeLessThan(80 * 1024);
  });

  it('HTML から表示される文字を取り出す（スクリプト・スタイル・タグは除く）', () => {
    const html =
      '<style>.a{content:"隠"}</style><h2 class="mds-title">見出し &amp; 本文&#x3042;&#12354;</h2><script>"隠す"</script>';
    expect(visibleText(html)).toBe('見出し & 本文ああ');
  });
});
