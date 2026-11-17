import { build, startDev, type DevServer } from '@mds/cli';
import { expect, test } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));

test('mds build で書き出した HTML を file:// で開くと、素材付きで発表できる', async ({ page }) => {
  const out = test.info().outputPath('dist');
  const result = await build(join(fixtures, '02-tech-talk.md'), { outDir: out, measure: false });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(pathToFileURL(result.index).href);
  await expect(page.locator('.mds-slide.is-current')).toHaveAttribute('data-kind', 'title');
  // ロゴと背景の画像を、書き出し先のフォルダから読めている
  const logo = page.locator('.mds-logo');
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  const photo = page.locator('.mds-slide.is-current .mds-media img');
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => location.hash)).toBe('#/2');
});

test('mds build は計測して自動で分割し、fixtures の目安の枚数に収める', async () => {
  const cases: Array<[string, number, number]> = [
    ['01-plain-document', 12, 17],
    ['03-long-lecture', 30, 40],
    ['04-layouts', 20, 21],
    ['05-overrides', 15, 15],
  ];
  for (const [name, min, max] of cases) {
    const result = await build(join(fixtures, `${name}.md`), {
      outDir: test.info().outputPath(name),
    });
    expect(result.measureError).toBeUndefined();
    expect(result.slides, name).toBeGreaterThanOrEqual(min);
    expect(result.slides, name).toBeLessThanOrEqual(max);
    expect(
      result.diagnostics.filter((d) => d.code === 'slide/overflow'),
      name,
    ).toEqual([]);
  }
});

test.describe('mds dev', () => {
  let server: DevServer | undefined;
  test.afterEach(async () => {
    await server?.close();
  });

  test('ファイルを保存すると、プレビューが更新される', async ({ page }) => {
    const root = mkdtempSync(join(tmpdir(), 'mds-dev-'));
    cpSync(join(fixtures, '01-plain-document.md'), join(root, 'deck.md'));
    server = await startDev(join(root, 'deck.md'), { port: 0 });
    await page.goto(server.url);
    const second = page.locator('.mds-slide').nth(1).locator('.mds-title');
    const before = await second.textContent();
    const source = readFileSync(join(root, 'deck.md'), 'utf8');
    writeFileSync(join(root, 'deck.md'), source.replace(before!, '保存したら変わった見出し'));
    await expect(second).toHaveText('保存したら変わった見出し');
  });

  test('保存して発表の画面が読み込み直されても、発表者ビューをつなぎ直す（#59）', async ({
    page,
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'mds-dev-'));
    cpSync(join(fixtures, '01-plain-document.md'), join(root, 'deck.md'));
    server = await startDev(join(root, 'deck.md'), { port: 0, measure: false });
    await page.goto(`${server.url}present#/2`);
    const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
    const pageText = presenter.locator('.mds-pv-page');
    await expect(pageText).toHaveText(/^2 \/ \d+$/);
    const total = Number((await pageText.textContent())!.split(' / ')[1]);
    const source = readFileSync(join(root, 'deck.md'), 'utf8');
    writeFileSync(join(root, 'deck.md'), `${source}\n\n## 足したスライド\n\n本文\n`);
    // 読み込み直した発表の画面が、同じ発表者ビューを書き直す
    await expect(pageText).toHaveText(`2 / ${total + 1}`);
    await page.keyboard.press('ArrowRight');
    await expect(pageText).toHaveText(`3 / ${total + 1}`);
    expect(presenter.isClosed()).toBe(false);
  });
});
