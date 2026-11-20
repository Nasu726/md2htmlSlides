/**
 * Web エディタ（#73）の e2e で共通に使うもの（#174 で web.spec.ts から分けた）。
 * ビルドしたアプリ（apps/web/dist）を配り、fixtures/ も `/fixtures/` から配る（`?src=` で開くため）。
 */
import { test, type Page } from '@playwright/test';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const dist = join(root, 'apps/web/dist');
export const fixtures = join(root, 'fixtures');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** テストのファイルごとに、エディタを配るサーバーを立てる。立てたら、その URL を渡す */
export function serveEditor(started: (origin: string) => void): void {
  let server: Server;
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const [base, rest] = path.startsWith('/fixtures/')
        ? [fixtures, path.slice('/fixtures/'.length)]
        : [dist, path.slice(1) || 'index.html'];
      const file = normalize(join(base, rest));
      if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    started(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
  });
  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
}

export const slideCount = (page: Page) => page.getByTestId('slide-count');
export const preview = (page: Page) => page.frameLocator('.preview-frame');
export const completions = (page: Page) => page.locator('.cm-tooltip-autocomplete li');

/** 候補を選ぶ（CodeMirror は、候補が出てから 75ms は Enter で選ばない。打ち間違いを防ぐため） */
export async function accept(page: Page) {
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
}

export const lineWith = (page: Page, text: string) => page.locator('.cm-line', { hasText: text });
