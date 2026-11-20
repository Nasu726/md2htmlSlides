/** Web エディタ：スマホ（#154・#157・#159） */
import { devices, expect, test } from '@playwright/test';
import { preview, serveEditor, slideCount } from './editor-server.js';

let origin = '';
serveEditor((value) => (origin = value));

test.describe('スマホ（#154）', () => {
  // iPhone の大きさとタッチの操作（ブラウザの種類は Chromium のまま）
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('編集とスライドを1回で切り替え、ほかの操作はメニューから。崩れず、フォーカスで拡大しない文字の大きさ', async ({
    page,
  }) => {
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/\d+ 枚/);
    // ツールバーは2段（#157）：1段目に保存、2段目に切り替え・早見表・発表。ページは横にはみ出さない
    expect((await page.locator('.toolbar').boundingBox())!.height).toBeLessThan(100);
    const top = async (name: string) =>
      (await page.getByRole('button', { name, exact: true }).boundingBox())!.y;
    expect(await top('ダウンロード')).toBeLessThan(await top('スライド'));
    expect(await top('? 早見表')).toBe(await top('スライド'));
    expect(await top('▶ 発表')).toBe(await top('スライド'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    // 入力欄の文字は 16px（iOS の Safari は、16px 未満の入力欄にフォーカスすると拡大する）。行番号は隠す
    const fontSize = await page
      .locator('.cm-scroller')
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe('16px');
    await expect(page.locator('.cm-lineNumbers')).toBeHidden();
    await expect(page.locator('.cm-slide-marker').first()).toBeVisible();

    // はじめは編集。「スライド」でプレビューだけにする
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.preview-frame')).toBeHidden();
    await page.getByRole('button', { name: 'スライド', exact: true }).click();
    await expect(page.locator('.preview-frame')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeHidden();
    // スライドを押すと、編集に戻ってその見出しの行に移る
    await preview(page)
      .locator('.mds-slide', { hasText: 'このエディタについて' })
      .click({ position: { x: 20, y: 20 } });
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.cm-activeLine')).toHaveText('## このエディタについて');

    // 開く操作などは「≡」のメニューに
    await expect(page.getByRole('button', { name: 'ファイルを開く' })).toBeHidden();
    await page.getByRole('button', { name: 'メニュー' }).click();
    await expect(page.getByRole('menuitem', { name: 'ファイルを開く' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'HTML を書き出す' }).waitFor();
    await page.getByRole('button', { name: 'メニュー' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    // 早見表はスライドの側に重ね、挿入すると編集に戻る
    await page.getByRole('button', { name: '? 早見表' }).click();
    const sheet = page.getByRole('complementary', { name: '早見表' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: '挿入' }).first().click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeVisible();
  });

  test('キーボードが出たらカーソルを見える位置に動かし、フォーカスが外れたらすぐに高さを戻す（#159）', async ({
    page,
  }) => {
    // ソフトウェアキーボードを真似る：visualViewport の高さを、window.__keyboard の分だけ低くする
    await page.addInitScript(() => {
      const w = window as unknown as { __keyboard: number };
      w.__keyboard = 0;
      const fake = new EventTarget();
      Object.defineProperties(fake, {
        width: { get: () => window.innerWidth },
        height: { get: () => window.innerHeight - w.__keyboard },
        offsetTop: { get: () => 0 },
        offsetLeft: { get: () => 0 },
        scale: { get: () => 1 },
      });
      Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    });
    const keyboard = (height: number) =>
      page.evaluate((h) => {
        (window as unknown as { __keyboard: number }).__keyboard = h;
        window.visualViewport!.dispatchEvent(new Event('resize'));
      }, height);
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/\d+ 枚/);
    const full = await page.evaluate(() => window.innerHeight);
    const appHeight = async () => (await page.locator('.app').boundingBox())!.height;

    // 画面の下のほう（キーボードが出るところ）の行をタップしてから、キーボードが出る
    const line = page.locator('.cm-line', { hasText: '書いている内容は' });
    await line.tap();
    await keyboard(320);
    expect(Math.round(await appHeight())).toBe(full - 320);
    await expect(page.locator('.status')).toBeHidden();
    // カーソルのある行は、キーボードの上（見えている範囲）にある
    await expect
      .poll(async () => (await page.locator('.cm-activeLine').boundingBox())!.y)
      .toBeLessThan(full - 320 - 20);

    // キーボードを閉じる（フォーカスが外れる）：resize を待たずに、すぐ元の高さに戻す
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    expect(Math.round(await appHeight())).toBe(full);
    await expect(page.locator('.status')).toBeVisible();
  });

  test('発表の画面はタップで「一覧」「終える」を出し、「終える」でエディタに戻る（#157）', async ({
    page,
  }) => {
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/\d+ 枚/);
    await page.getByRole('button', { name: '▶ 発表' }).tap();
    const show = page.frameLocator('.present-frame');
    const current = show.locator('.mds-slide.is-current');
    await expect(current).toBeVisible();
    const bar = show.locator('.mds-player-touch');
    await expect(bar).toBeHidden();
    // タップすると出る（数秒で消える）
    await current.tap({ position: { x: 40, y: 40 } });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: '一覧' }).tap();
    await expect(show.locator('.mds-deck')).toHaveClass(/is-overview/);
    await bar.getByRole('button', { name: '一覧' }).tap();
    await expect(show.locator('.mds-deck')).not.toHaveClass(/is-overview/);
    await bar.getByRole('button', { name: '× 終える' }).tap();
    await expect(page.locator('.present')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeVisible();
  });
});
