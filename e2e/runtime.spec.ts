import { buildSlides, parseDeck, renderDeckHtml } from '@mds/core';
import { RUNTIME_SCRIPT } from '@mds/runtime';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** fixtures の資料を、runtime 入りの HTML にして file:// で開く。 */
async function open(page: Page, name: string, hash = '') {
  const source = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  const html = renderDeckHtml(buildSlides(parseDeck(source)), { scripts: [RUNTIME_SCRIPT] });
  const path = test.info().outputPath('deck.html');
  writeFileSync(path, html);
  await page.goto(pathToFileURL(path).href + hash);
}

const current = (page: Page) => page.locator('.mds-slide.is-current');
const hash = (page: Page) => page.evaluate(() => location.hash);

test('画面に合わせて拡大し、1枚ずつ表示する', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, '01-plain-document.md');
  await expect(page.locator('.mds-slide:visible')).toHaveCount(1);
  const box = await current(page).boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
});

test('縦横比が違う画面では、上下に帯を付けて中央に置く', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, '01-plain-document.md');
  const box = await current(page).boundingBox();
  expect(box).toEqual({ x: 0, y: 96, width: 1024, height: 576 });
});

test('キー操作でページを送り、URL に反映する', async ({ page }) => {
  await open(page, '01-plain-document.md');
  expect(await hash(page)).toBe('#/1');
  await page.keyboard.press('ArrowRight');
  expect(await hash(page)).toBe('#/2');
  await page.keyboard.press('Space');
  await page.keyboard.press('PageDown');
  expect(await hash(page)).toBe('#/4');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('ArrowLeft');
  expect(await hash(page)).toBe('#/2');
  await page.keyboard.press('End');
  expect(await hash(page)).toBe('#/8');
  await page.keyboard.press('ArrowRight');
  expect(await hash(page)).toBe('#/8');
  await page.keyboard.press('Home');
  expect(await hash(page)).toBe('#/1');
  // 数字 → Enter で指定したページへ
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  expect(await hash(page)).toBe('#/6');
  await expect(page.locator('.mds-slide').nth(5)).toHaveClass(/is-current/);
});

test('URL の #/5 で開くと5枚目から始まり、ハッシュを変えると移動する', async ({ page }) => {
  await open(page, '01-plain-document.md', '#/5');
  expect(
    await page.evaluate(
      () => (window as unknown as { mdsPlayer: { page: number } }).mdsPlayer.page,
    ),
  ).toBe(5);
  await page.evaluate(() => (location.hash = '#/3'));
  await expect(page.locator('.mds-slide').nth(2)).toHaveClass(/is-current/);
});

test('? でヘルプ、B で暗転、O で一覧を出す', async ({ page }) => {
  await open(page, '01-plain-document.md');
  await page.keyboard.press('?');
  await expect(page.locator('.mds-player-help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mds-player-help')).toBeHidden();
  await page.keyboard.press('b');
  await expect(page.locator('.mds-player-black')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.mds-player-black')).toBeHidden();
  expect(await hash(page)).toBe('#/1');
  await page.keyboard.press('o');
  await expect(page.locator('.mds-slide:visible')).toHaveCount(8);
  await page.locator('.mds-slide').nth(3).click();
  expect(await hash(page)).toBe('#/4');
  await expect(page.locator('.mds-slide:visible')).toHaveCount(1);
});

test('動画にフォーカスがあっても、→ と ← でスライドを送る（#58）', async ({ page }) => {
  await open(page, '07-media.md', '#/3');
  const video = current(page).locator('video');
  await video.focus();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('VIDEO');
  await page.keyboard.press('ArrowRight');
  expect(await hash(page)).toBe('#/4');
  // 移ったら、前のスライドの動画からフォーカスを外す
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  await current(page).locator('video').focus();
  await page.keyboard.press('ArrowLeft');
  expect(await hash(page)).toBe('#/3');
});

test('一覧で動画のスライドをクリックしても、動画にフォーカスが移らない（#58）', async ({
  page,
}) => {
  await open(page, '07-media.md');
  await page.keyboard.press('o');
  await page.locator('.mds-slide').nth(2).locator('video').click({ force: true });
  expect(await hash(page)).toBe('#/3');
  await expect(page.locator('.mds-slide:visible')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('VIDEO');
  await page.keyboard.press('ArrowRight');
  expect(await hash(page)).toBe('#/4');
});

test('YouTube の埋め込みをクリックした後も、スライドのキーが効く（#58）', async ({ page }) => {
  // 埋め込みの中身は、ネットワークを使わずにボタンだけのページで置き換える
  await page.route(/youtube|vimeo/, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<button>再生</button>' }),
  );
  await open(page, '07-media.md', '#/5');
  const frame = current(page).locator('iframe');
  await frame.contentFrame().locator('button').click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
  await page.keyboard.press('ArrowRight');
  expect(await hash(page)).toBe('#/6');
});

test('スワイプでページを送る', async ({ page }) => {
  await open(page, '01-plain-document.md');
  const swipe = (dx: number) =>
    page.evaluate((dx) => {
      const deck = document.querySelector('.mds-deck')!;
      const touch = (x: number) =>
        new Touch({ identifier: 1, target: deck, clientX: x, clientY: 300 });
      deck.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(600)] }));
      deck.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(600 + dx)] }));
    }, dx);
  await swipe(-120);
  expect(await hash(page)).toBe('#/2');
  await swipe(120);
  expect(await hash(page)).toBe('#/1');
  await swipe(-10);
  expect(await hash(page)).toBe('#/1');
});

test('段階的表示：→ で1つずつ出し、最後のステップの次は次のスライドへ。URL は #/1/2', async ({
  page,
}) => {
  await open(page, '06-steps.md');
  const hidden = () => page.locator('.mds-slide.is-current [data-step-hidden]').count();
  expect(await hidden()).toBe(2);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => location.hash)).toBe('#/1/1');
  expect(await hidden()).toBe(1);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => location.hash)).toBe('#/1/2');
  expect(await hidden()).toBe(0);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => location.hash)).toBe('#/2');
  // 戻ると、前のスライドはすべて表示した状態
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => location.hash)).toBe('#/1/2');
  expect(await hidden()).toBe(0);
});

test('段階的表示：:::steps のリストは入れ子の項目を親と一緒に出し、#/2/1 で途中から開ける', async ({
  page,
}) => {
  await open(page, '06-steps.md', '#/2/1');
  const items = page.locator('.mds-slide.is-current li');
  // 1つ目だけ表示（入れ子の項目は2つ目の親と一緒に隠れている）
  const visible = await items.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).visibility === 'visible'),
  );
  expect(visible).toEqual([true, false, false, false]);
});

test('発表者ビュー：P で開き、今と次のスライド・ノート・経過時間を出し、→ で両方が進む', async ({
  page,
}) => {
  await open(page, '02-tech-talk.md', '#/5');
  const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
  await expect(presenter.locator('.mds-pv-page')).toHaveText(/^5 \/ \d+$/);
  await expect(presenter.locator('.mds-pv-current .mds-slide')).toHaveCount(1);
  await expect(presenter.locator('.mds-pv-next .mds-slide')).toHaveCount(1);
  await expect(presenter.locator('.mds-pv-notes')).not.toHaveText('ノートはありません');
  await expect(presenter.locator('.mds-pv-elapsed')).toHaveText(/^\d\d:\d\d$/);
  // 発表者ビューで → を押すと、発表の画面も進む
  await presenter.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/5\/1$|^#\/6$/);
  await expect(presenter.locator('.mds-pv-page')).toHaveText(
    (await page.evaluate(
      () => (window as unknown as { mdsPlayer: { page: number } }).mdsPlayer.page,
    )) +
      ' / ' +
      (await page.evaluate(
        () => (window as unknown as { mdsPlayer: { total: number } }).mdsPlayer.total,
      )),
  );
  // ノートは発表の画面には出さない
  await expect(page.locator('.mds-notes').first()).toBeHidden();
});

/** 発表の画面で P を押して、発表者ビューを開く */
async function openPresenter(page: Page) {
  const [presenter] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('p')]);
  await expect(presenter.locator('.mds-pv-page')).not.toBeEmpty();
  return presenter;
}

test('発表者ビュー：Esc か P で閉じても発表は続く。発表の画面の P は開く・閉じるの切り替え（#59）', async ({
  page,
}) => {
  // キーを押した（keydown の）時点でウィンドウが閉じるので、キーを離す操作は失敗してよい
  const closeWith = (presenter: Page, key: string) =>
    Promise.all([
      presenter.waitForEvent('close'),
      presenter.keyboard.press(key).catch(() => undefined),
    ]);
  await open(page, '02-tech-talk.md', '#/3');
  let presenter = await openPresenter(page);
  await closeWith(presenter, 'Escape');
  await expect(page.locator('.mds-deck')).toHaveClass(/is-presenting/);
  expect(await hash(page)).toBe('#/3');
  presenter = await openPresenter(page);
  await closeWith(presenter, 'p');
  presenter = await openPresenter(page);
  await Promise.all([presenter.waitForEvent('close'), page.keyboard.press('p')]);
  expect(await hash(page)).toBe('#/3');
});

test('発表者ビュー：O の一覧は発表者ビューの中に出し、選ぶまで発表の画面は変えない（#59）', async ({
  page,
}) => {
  await open(page, '01-plain-document.md');
  const presenter = await openPresenter(page);
  await presenter.keyboard.press('o');
  await expect(presenter.locator('.mds-pv-overview')).toBeVisible();
  await expect(presenter.locator('.mds-pv-thumb')).toHaveCount(8);
  await expect(page.locator('.mds-deck')).not.toHaveClass(/is-overview/);
  await presenter.keyboard.press('ArrowRight');
  await presenter.keyboard.press('ArrowRight');
  await expect(presenter.locator('.mds-pv-thumb.is-selected')).toHaveAttribute('data-k', '2');
  expect(await hash(page)).toBe('#/1');
  await presenter.keyboard.press('Enter');
  await expect(presenter.locator('.mds-pv-overview')).toBeHidden();
  expect(await hash(page)).toBe('#/3');
  // Esc なら移らずに戻る。クリックでも選べる
  await presenter.keyboard.press('o');
  await presenter.keyboard.press('ArrowRight');
  await presenter.keyboard.press('Escape');
  await expect(presenter.locator('.mds-pv-overview')).toBeHidden();
  expect(await hash(page)).toBe('#/3');
  await presenter.keyboard.press('o');
  await presenter.locator('.mds-pv-thumb').nth(5).click();
  expect(await hash(page)).toBe('#/6');
  await expect(presenter.locator('.mds-pv-page')).toHaveText('6 / 8');
});

test('発表者ビュー：「現在」の枠に、発表の画面の暗転と一覧を示す（#59）', async ({ page }) => {
  await open(page, '01-plain-document.md');
  const presenter = await openPresenter(page);
  const status = presenter.locator('.mds-pv-status');
  await expect(status).toBeHidden();
  await presenter.keyboard.press('b');
  await expect(page.locator('.mds-player-black')).toBeVisible();
  await expect(presenter.locator('.mds-pv-current')).toHaveClass(/is-black/);
  await expect(status).toHaveText('暗転中');
  // 暗転中は、どのキーでも元に戻す（進まない）
  await presenter.keyboard.press('ArrowRight');
  await expect(page.locator('.mds-player-black')).toBeHidden();
  await expect(status).toBeHidden();
  expect(await hash(page)).toBe('#/1');
  await page.keyboard.press('o');
  await expect(status).toHaveText('観客の画面は一覧を表示中');
  await page.keyboard.press('Escape');
  await expect(status).toBeHidden();
});

test('発表者ビュー：? のヘルプと F の全画面は、発表者ビューの中で効く（#59）', async ({ page }) => {
  await open(page, '01-plain-document.md');
  const presenter = await openPresenter(page);
  await presenter.keyboard.press('?');
  await expect(presenter.locator('.mds-pv-help')).toBeVisible();
  await expect(page.locator('.mds-player-help')).toBeHidden();
  // ヘルプを開いているときの Esc は、ヘルプだけを閉じる
  await presenter.keyboard.press('Escape');
  await expect(presenter.locator('.mds-pv-help')).toBeHidden();
  expect(presenter.isClosed()).toBe(false);
  await presenter.keyboard.press('f');
  await expect.poll(() => presenter.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});
