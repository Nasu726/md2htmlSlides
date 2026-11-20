/** Web エディタ：エディタとプレビューの同期・行番号欄の目印・反映までの時間（#74） */
import { VERSION } from '@mdhs/core';
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview, serveEditor, slideCount } from './editor-server.js';

let origin = '';
serveEditor((value) => (origin = value));

/** 長いリストで自動分割される節と、見つからない画像がある資料（#74） */
const SYNC_MD = [
  '---',
  'title: 同期のテスト',
  '---',
  '',
  '## はじめに',
  '',
  '左で書くと、右に出ます。',
  '',
  '## 長いリスト',
  '',
  ...Array.from({ length: 14 }, (_, i) => `- 項目 ${i + 1}：説明の文章`),
  '',
  '## 画像',
  '',
  '![見つからない図](img/nothing.png)',
  '',
  '## まとめ',
  '',
  '- 書くことに集中する',
  '',
].join('\n');

async function openSyncDeck(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), 'mds-web-sync-'));
  const md = join(dir, 'sync.md');
  writeFileSync(md, SYNC_MD);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByTestId('file-input').setInputFiles([md]);
  await expect(page.locator('.doc-name')).toHaveText('sync.md');
}

test('行番号欄に、スライドの番号・自動の区切り・警告を出し、区切りを固定・1枚にまとめられる（#74）', async ({
  page,
}) => {
  await openSyncDeck(page);
  const markers = page.locator('.cm-slide-marker');
  const auto = page.locator('.cm-slide-marker.is-auto');
  await expect(auto).toHaveCount(1);
  await expect(auto).toHaveText(/^自動 \d+$/);
  // 自動の区切りは、長いリストの途中の項目の行（その行の上に点線）
  await expect(page.locator('.cm-line.cm-auto-break')).toHaveText(/^- 項目 \d+：/);
  await expect(page.locator('.cm-lint-marker-warning')).toHaveCount(1);
  const count = await markers.count();

  // 1枚にまとめる：節の見出しに {keep} を付ける
  await auto.click();
  await page.getByRole('menuitem', { name: /1枚にまとめる/ }).click();
  await expect(page.locator('.cm-line', { hasText: '## 長いリスト {keep}' })).toBeVisible();
  await expect(auto).toHaveCount(0);
  await expect(markers).toHaveCount(count - 1);

  // 元に戻して、ここで区切りを固定：自動の区切りの前に --- を入れる
  await page.keyboard.press('Control+z');
  await expect(auto).toHaveCount(1);
  await auto.click();
  await page.getByRole('menuitem', { name: /区切りを固定/ }).click();
  await expect(page.locator('.cm-line', { hasText: /^---$/ }).last()).toBeVisible();
  await expect(auto).toHaveCount(0);
  await expect(markers).toHaveCount(count);
});

test('プレビューは画面の外のスライドの描画を省かない。版とビルドを出す（#163・#167）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
  // 描画を省くと、iOS の Safari でスクロールした位置が上に戻る
  const visibility = await preview(page)
    .locator('.mds-slide')
    .last()
    .evaluate((slide) => getComputedStyle(slide).contentVisibility);
  expect(visibility).toBe('visible');
  // どの版で試しているかが分かるように（Service Worker のキャッシュで古い版のこともある）
  await expect(page.getByTestId('version')).toHaveText(
    new RegExp(`^v${VERSION.replace(/\./g, '\\.')}（([0-9a-f]{7}|dev)）$`),
  );

  // 新しい版が入ったら（Service Worker が入れ替わったら）知らせる。初めて入れたときは知らせない
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.locator('.notice')).toHaveCount(0);
  await page.reload();
  await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await expect(page.locator('.notice')).toContainText('新しい版を読み込みました');
  await expect(page.locator('.notice').getByRole('button', { name: '再読み込み' })).toBeVisible();
});

test('カーソルのあるスライドをプレビューで示し、スライドをクリックするとその行に移る（#74）', async ({
  page,
}) => {
  await openSyncDeck(page);
  await expect(page.locator('.cm-slide-marker.is-auto')).toHaveCount(1);
  const editing = preview(page).locator('.mds-slide[data-editing]');
  await page.locator('.cm-line', { hasText: '見つからない図' }).click();
  await expect(editing).toHaveCount(1);
  await expect(editing).toContainText('画像');
  await page.locator('.cm-line', { hasText: '左で書くと' }).click();
  await expect(editing).toContainText('はじめに');
  // プレビューの「まとめ」をクリックすると、エディタはその見出しの行に移る
  await preview(page)
    .locator('.mds-slide', { hasText: 'まとめ' })
    .click({ position: { x: 60, y: 60 } });
  await expect(page.locator('.cm-activeLine')).toHaveText('## まとめ');
});

test('打鍵からプレビューに反映されるまでの時間（50枚ほどの資料。#74）', async ({ page }) => {
  const parts = ['---\ntitle: 計測\n---'];
  for (let i = 1; i <= 46; i++) {
    parts.push(`## 節 ${i}`);
    parts.push(
      i % 5 === 0
        ? Array.from({ length: 18 }, (_, k) => `- 長いリストの項目 ${k + 1}`).join('\n')
        : `本文の段落です。${i} 番目の節の内容を説明します。\n\n- 項目 A\n- 項目 B`,
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'mds-web-bench-'));
  const md = join(dir, 'bench.md');
  writeFileSync(md, `${parts.join('\n\n')}\n`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByTestId('file-input').setInputFiles([md]);
  await expect(page.getByTestId('slide-count')).toHaveText(/^5\d 枚$/);
  await page.locator('.cm-line', { hasText: '3 番目の節' }).click();
  await page.keyboard.press('End');
  await page.evaluate(
    () => ((window as unknown as { mdsLatencies: number[] }).mdsLatencies.length = 0),
  );
  for (let i = 0; i < 20; i++) {
    await page.keyboard.type('あ');
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  const latencies = await page.evaluate(() =>
    [...(window as unknown as { mdsLatencies: number[] }).mdsLatencies].sort((a, b) => a - b),
  );
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? Infinity;
  console.log(`latency p95 ${Math.round(p95)} ms (n=${latencies.length})`);
  // 目標は p95 で 50ms（設計プラン §11.1）。CI の機械は遅いので、大きく遅くなっていないことだけを確かめる
  expect(p95).toBeLessThan(200);
});
