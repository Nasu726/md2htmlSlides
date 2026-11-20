/** Web エディタ：入力の補助（サジェスト・挿入メニュー・構文ヒント・修正の候補・早見表。#75） */
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accept, completions, lineWith, serveEditor } from './editor-server.js';

let origin = '';
serveEditor((value) => (origin = value));

const TALK_MD = [
  '---',
  'title: CI のビルド時間を 1/10 にした話',
  'theme: dark',
  '---',
  '',
  '::maketitle',
  '',
  '## やったこと',
  '',
  ':::steps',
  '- 影響を受けるパッケージだけをビルドする',
  ':::',
  '',
  '## Before / After {lyout=split}',
  '',
  '文章',
  '',
  '## 結果',
  '',
].join('\n');

async function openTalk(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), 'mds-web-assist-'));
  const md = join(dir, 'talk.md');
  writeFileSync(md, TALK_MD);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByTestId('file-input').setInputFiles([md]);
  await expect(page.locator('.doc-name')).toHaveText('talk.md');
  await expect(page.locator('.cm-slide-marker')).toHaveCount(4);
}

test('サジェスト：layout= の値・場所に合う属性・フロントマター・コンテナ（#75）', async ({
  page,
}) => {
  await openTalk(page);
  // layout= の値：説明と、このスライドの今のレイアウト
  await lineWith(page, '## 結果').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' {layout=');
  await expect(page.locator('.cm-tooltip-autocomplete completion-section')).toHaveText(
    /^layout の値・このスライドは今 \w+$/,
  );
  await expect(completions(page).filter({ hasText: 'split' })).toContainText(
    '文章とメディアを左右に',
  );
  await page.keyboard.type('spl');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('split');
  await accept(page);
  await expect(lineWith(page, '## 結果')).toHaveText('## 結果 {layout=split');
  await page.keyboard.type('}');

  // 見出しの { には、スライドに付けるキー（keep）が出て、画像の属性（bg）は出ない
  await page.keyboard.press('Enter');
  await page.keyboard.type('\n## 次 {');
  await expect(completions(page).filter({ hasText: /^keep/ })).toHaveCount(1);
  await expect(completions(page).filter({ hasText: /^bg/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // 画像の直後の { には、bg が出る
  await page.keyboard.type('}\n\n![](a.png){');
  await expect(completions(page).filter({ hasText: /^bg/ })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // 行頭の ::: はコンテナ名。選ぶと閉じる ::: まで入れる
  await page.keyboard.type('}\n\n:::ro');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText(
    '中身を横に並べる',
  );
  await accept(page);
  await expect(lineWith(page, ':::row')).toHaveCount(1);
  await expect(page.locator('.cm-line', { hasText: /^:::$/ })).toHaveCount(2);
});

test('サジェスト：Tab でも候補を入れる。出ていないときの Tab は字下げ（#98）', async ({ page }) => {
  await openTalk(page);
  await lineWith(page, '## 結果').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' {layout=spl');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('split');
  await page.waitForTimeout(150); // 候補が出てから 75ms は選ばない（打ち間違いを防ぐ）
  await page.keyboard.press('Tab');
  await expect(lineWith(page, '## 結果')).toHaveText('## 結果 {layout=split');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  // サジェストがなければ、Tab は字下げ・Shift+Tab は字下げの解除
  await page.keyboard.type('}\n\n- 項目');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(lineWith(page, '- 項目')).toHaveText(/^\s+- 項目$/);
  await page.keyboard.press('Shift+Tab');
  await expect(lineWith(page, '- 項目')).toHaveText('- 項目');
});

test('動く構成図：```arch の中の候補と、書き間違いの警告（#106）', async ({ page }) => {
  await openTalk(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n## 構成図\n\n```arch\nweb Webサーバー [ser');
  // [ の後は、ノードの種類
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('server');
  await accept(page);
  await page.keyboard.type(']\ndb DB [database]\nweb -> ');
  // 矢印の後は、定義したノードの ID
  await expect(completions(page).filter({ hasText: /^db/ })).toHaveCount(1);
  await page.keyboard.type('db\nscenario 例\n  st');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('step');
  await page.keyboard.press('Escape');
  await page.keyboard.type('ep 読む\n    db: ');
  // 状態の後は、止める・戻す（#180）
  await expect(completions(page)).toHaveText([/^down/, /^up/]);
  await page.keyboard.press('Escape');
  await page.keyboard.type('down\n    web -');
  // ID の後の - は、動きの記号（届かない移動・つながりを切る）
  await expect(completions(page).filter({ hasText: /^-x/ })).toHaveCount(1);
  await expect(completions(page).filter({ hasText: /^-\/-/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.type('x db\n    db -> cache\n```');
  // 未定義のノード（cache）を警告する
  await page.getByRole('button', { name: /^警告 \d+ 件$/ }).click();
  await expect(page.locator('.warnings')).toContainText('ノード cache は定義されていません');
});

test('サジェスト：フロントマターのキーを選ぶと、続けて値の候補が出る（#75）', async ({ page }) => {
  await openTalk(page);
  await lineWith(page, 'theme: dark').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('aspe');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('aspect');
  await accept(page);
  // キーを選ぶと、続けて値の候補が出る
  await expect(lineWith(page, 'aspect:')).toHaveText('aspect: ');
  await expect(completions(page)).toHaveCount(3);
  await expect(completions(page).filter({ hasText: '16:9' })).toContainText('既定');
});

test('挿入メニュー（空の行で /）・構文ヒント・修正の候補・早見表（#75）', async ({ page }) => {
  await openTalk(page);
  // 修正の候補：{lyout=split} → 「layout」に直す
  await page.locator('.cm-lint-marker').first().hover();
  await page.getByRole('button', { name: '「layout」に直す' }).click();
  await expect(lineWith(page, '## Before / After')).toHaveText('## Before / After {layout=split}');
  await expect(page.getByRole('button', { name: /警告/ })).toHaveText('警告 0 件');

  // 構文ヒント：:::steps にカーソルを合わせる
  await lineWith(page, ':::steps').hover({ position: { x: 20, y: 5 } });
  await expect(page.locator('.cm-syntax-hint')).toContainText(':::steps — 中身を1つずつ表示する');

  // 挿入メニュー：空の行で / → 「横に並べる」
  await lineWith(page, '## 結果').click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n\n/');
  await expect(page.locator('.cm-tooltip-autocomplete completion-section')).toHaveText('挿入する');
  await accept(page);
  await expect(lineWith(page, ':::row')).toHaveCount(1);

  // 早見表：Ctrl+/ で開き、探して入れる
  await page.keyboard.press('Control+/');
  const sheet = page.getByRole('complementary', { name: '早見表' });
  await expect(sheet).toBeVisible();
  // 役割ごとの分類の見出しの下にまとまる（#99）
  await expect(sheet.locator('h3')).toHaveText([
    'スライドの区切りと構成',
    '並べ方',
    '段階表示',
    '画像・動画',
    '背景',
    '図・数式・コード',
    '発表者ノート',
    '資料全体の設定（フロントマター）',
  ]);
  await sheet
    .getByRole('navigation', { name: '分類' })
    .getByRole('button', { name: '背景' })
    .click();
  await expect(sheet.locator('h3', { hasText: '背景' })).toBeInViewport();
  // 切り替え効果（#110）：スライドの {transition=fade} と、フロントマターの transition:
  await sheet.getByRole('searchbox').fill('切り替え');
  await expect(sheet.locator('h3')).toHaveText([
    'スライドの区切りと構成',
    '資料全体の設定（フロントマター）',
  ]);
  await expect(sheet).toContainText('{transition=fade}');
  await expect(sheet).toContainText('transition:');
  await sheet.getByRole('searchbox').fill('ノート');
  await expect(sheet.locator('h3')).toHaveText(['発表者ノート']);
  await sheet.getByRole('button', { name: '挿入' }).first().click();
  await expect(lineWith(page, ':::notes')).toHaveCount(1);

  // Esc で閉じて、そのまま書ける（#164）
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.keyboard.type('Esc で閉じた');
  await expect(lineWith(page, 'Esc で閉じた')).toHaveCount(1);
  // 検索欄にいるときも閉じる
  await page.keyboard.press('Control+/');
  await sheet.getByRole('searchbox').fill('背景');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  // 補完の候補が出ているときの Esc は、候補だけを閉じる
  await page.keyboard.press('Control+/');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.type('\n\n/');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});
