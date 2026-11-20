/** Web エディタ：HTML を書き出す（#121） */
import { buildSingle } from '@mdhs/cli';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtures, serveEditor, slideCount } from './editor-server.js';

let origin = '';
serveEditor((value) => (origin = value));

test('HTML を書き出す：素材を埋め込んだ HTML を1つダウンロードし、ネットワークなしで開ける。枚数と見出しは mdhs build --single と同じ（#121）', async ({
  page,
  browser,
}) => {
  const name = '02-tech-talk.md';
  const cli = await buildSingle(join(fixtures, name), {
    out: join(mkdtempSync(join(tmpdir(), 'mds-web-single-')), 'cli.html'),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?src=${encodeURIComponent(`${origin}/fixtures/${name}`)}`);
  await expect(slideCount(page)).toHaveText(`${cli.slides} 枚`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'HTML を書き出す' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('02-tech-talk.html');
  await expect(page.locator('.notice')).toContainText('素材 4 個を埋め込み');
  const file = join(mkdtempSync(join(tmpdir(), 'mds-web-single-')), 'deck.html');
  await download.saveAs(file);

  // 素材のない別のフォルダで、ネットワークを遮断して開く
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (/^(file|data|blob):/.test(url)) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  const offline = await context.newPage();
  const titles = async (url: string) => {
    await offline.goto(url);
    await offline.evaluate(() => document.fonts.ready);
    return offline
      .locator('.mds-deck > .mds-slide')
      .evaluateAll((els) => els.map((el) => el.querySelector('.mds-title')?.textContent ?? ''));
  };
  const exported = await titles(pathToFileURL(file).href);
  const images = await offline
    .locator('img')
    .evaluateAll((imgs) =>
      imgs.map(
        (img) =>
          (img as HTMLImageElement).src.startsWith('data:') &&
          (img as HTMLImageElement).naturalWidth > 0,
      ),
    );
  expect(images.length).toBeGreaterThan(0);
  expect(images.every(Boolean)).toBe(true);
  const families = await offline.evaluate(() => [
    ...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)),
  ]);
  expect(families).toEqual(expect.arrayContaining(['MDS Inter', 'MDS Noto Sans JP']));
  // 発表できる（→ で次のスライド）
  await offline.keyboard.press('ArrowRight');
  expect(await offline.evaluate(() => location.hash)).toBe('#/2');
  expect(blocked).toEqual([]);
  // CLI の単一 HTML と同じ枚数・見出し
  expect(exported).toEqual(await titles(pathToFileURL(cli.file).href));
  await context.close();
});
