/** Web エディタ：GitHub に保存（#147） */
import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, preview, serveEditor, slideCount } from './editor-server.js';

let origin = '';
serveEditor((value) => (origin = value));

/**
 * GitHub の API を真似る（#147）。ファイルの中身と sha を持ち、sha が違えば保存を断る。
 * 2つの端末（ブラウザのコンテキスト）から、同じリポジトリとして使う
 */
function fakeGitHubApi(initial: Record<string, string | Buffer>) {
  const files = new Map<string, { body: Buffer; sha: string }>();
  let version = 0;
  const put = (path: string, body: string | Buffer) =>
    files.set(path, { body: Buffer.from(body), sha: `sha${++version}` });
  for (const [path, body] of Object.entries(initial)) put(path, body);
  const cors = { 'access-control-allow-origin': '*' };
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        headers: {
          ...cors,
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, PUT',
        },
      });
    }
    if (request.headers()['authorization'] !== 'Bearer test-token') {
      return route.fulfill({ status: 401, headers: cors });
    }
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, json: body, headers: cors });
    if (url.pathname === '/repos/me/slides') return json(200, { default_branch: 'main' });
    if (url.pathname === '/repos/me/slides/git/trees/main') {
      return json(200, {
        tree: [...files].map(([path, f]) => ({ path, type: 'blob', size: f.body.length })),
      });
    }
    const path = decodeURIComponent(url.pathname.replace('/repos/me/slides/contents/', ''));
    const file = files.get(path);
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { content: string; sha?: string };
      if (file && body.sha !== file.sha) return json(409, { message: 'conflict' });
      put(path, Buffer.from(body.content, 'base64'));
      return json(200, { content: { sha: files.get(path)!.sha } });
    }
    if (!file) return json(404, { message: 'Not Found' });
    if (request.headers()['accept'] === 'application/vnd.github.raw') {
      return route.fulfill({ body: file.body, headers: cors });
    }
    return json(200, { content: file.body.toString('base64'), encoding: 'base64', sha: file.sha });
  };
  return { files, put, handler, text: (path: string) => files.get(path)?.body.toString('utf8') };
}

test('GitHub に保存：端末 A で保存した内容を端末 B で開ける。先に保存されていたら上書きせずに知らせる（#147）', async ({
  browser,
}) => {
  const api = fakeGitHubApi({
    'talks/deck.md': '---\ntitle: GitHub の資料\n---\n\n## はじめ\n\n![図](img/sq.png)\n',
    'talks/img/sq.png': readFileSync(join(fixtures, 'assets/square.png')),
    'README.md': '# 資料の置き場',
  });
  /** 端末：GitHub の API は真似たものに向け、トークンを付けたリクエストがどこに行くかを記録する */
  const device = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('https://api.github.com/**', api.handler);
    const page = await context.newPage();
    const hosts = new Set<string>();
    page.on('request', (request) => {
      if (request.headers()['authorization']) hosts.add(new URL(request.url()).host);
    });
    await page.goto(origin);
    await expect(slideCount(page)).toHaveText(/^\d+ 枚$/);
    return { context, page, hosts };
  };
  const connectAndOpen = async (page: Page) => {
    await page.getByRole('button', { name: 'GitHub' }).click();
    const dialog = page.getByRole('dialog', { name: 'GitHub' });
    await dialog.getByLabel('リポジトリ').fill('https://github.com/me/slides');
    await dialog.getByLabel('トークン').fill('test-token');
    await dialog.getByRole('button', { name: 'つなぐ' }).click();
    // 一覧は .md だけ
    await expect(dialog.getByRole('list', { name: '資料' }).getByRole('button')).toHaveText([
      'README.md',
      'talks/deck.md',
    ]);
    await dialog.getByRole('button', { name: 'talks/deck.md' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.doc-name')).toContainText('talks/deck.md');
  };
  const append = async (page: Page, line: string) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n${line}\n`);
  };

  // 端末 A：つないで開く。相対パスの画像も、リポジトリから読む
  const a = await device();
  await connectAndOpen(a.page);
  await expect(preview(a.page).locator('.mds-slide .mds-title').last()).toHaveText('はじめ');
  await expect
    .poll(() =>
      preview(a.page)
        .locator('.mds-media img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await append(a.page, '- 端末 A で書いた');
  await a.page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(a.page.locator('.notice')).toContainText('GitHub（me/slides）に保存しました');
  await expect(a.page.locator('.dirty')).toHaveCount(0);
  expect(api.text('talks/deck.md')).toContain('- 端末 A で書いた');

  // 端末 B：開くと、端末 A の内容になっている。書いて保存する
  const b = await device();
  await connectAndOpen(b.page);
  await expect(b.page.locator('.cm-content')).toContainText('- 端末 A で書いた');
  await append(b.page, '- 端末 B で書いた');
  await b.page.keyboard.press('Control+s');
  await expect(b.page.locator('.notice')).toContainText('保存しました');
  // 端末 A：B の保存を知らずに保存すると、上書きせずに知らせる。「上書きする」を選ぶと保存する
  await append(a.page, '- 端末 A でもう一度');
  await a.page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(a.page.locator('.notice')).toContainText('ほかの端末で先に保存されています');
  expect(api.text('talks/deck.md')).toContain('- 端末 B で書いた');
  await a.page.getByRole('button', { name: '上書きする' }).click();
  await expect(a.page.locator('.notice')).toContainText('保存しました');
  expect(api.text('talks/deck.md')).toContain('- 端末 A でもう一度');
  expect(api.text('talks/deck.md')).not.toContain('- 端末 B で書いた');

  // 端末 B：開き直すと、GitHub から最新を開く（つなぎはこのブラウザに残っている）
  await b.page.reload();
  await expect(b.page.locator('.cm-content')).toContainText('- 端末 A でもう一度');
  await expect(b.page.locator('.status')).toContainText('GitHub（me/slides）');

  // トークンを付けたリクエストは、api.github.com にだけ行く
  expect([...a.hosts, ...b.hosts].every((host) => host === 'api.github.com')).toBe(true);
  await a.context.close();
  await b.context.close();
});
