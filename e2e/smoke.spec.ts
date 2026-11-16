import { expect, test } from '@playwright/test';

// ブラウザでのテストが動くことだけを確かめる。スライドの表示のテストは #16 以降で追加する。
test('ブラウザで日本語の HTML を表示できる', async ({ page }) => {
  await page.setContent(
    '<!doctype html><html lang="ja"><body><h1>md2htmlSlides</h1><p>日本語の表示</p></body></html>',
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('md2htmlSlides');
  await expect(page.getByText('日本語の表示')).toBeVisible();
});
