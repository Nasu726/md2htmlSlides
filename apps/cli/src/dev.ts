import type { Diagnostic } from '@mdhs/core';
import { ARCH_SCRIPT, PREVIEW_SCRIPT, RUNTIME_SCRIPT } from '@mdhs/runtime';
import { createReadStream, existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { basename, dirname, extname, resolve } from 'node:path';
import { renderFile, type Rendered } from './build.js';
import { fontFileFor } from './fonts.js';
import { mathFontFileFor } from './math.js';
import { ChromiumMeasurer } from './measurer.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff2': 'font/woff2',
};

/**
 * 保存したら読み込み直す（スクロールの位置は保つ）。
 * 発表の画面では、URL の #/12 がそのまま残るので同じスライドに戻る。
 */
const LIVE_RELOAD = `(() => {
  const key = 'mds-dev-scroll';
  const y = sessionStorage.getItem(key);
  if (y !== null) {
    sessionStorage.removeItem(key);
    addEventListener('load', () => scrollTo(0, Number(y)));
  }
  const events = new EventSource('/__mds/events');
  events.addEventListener('reload', () => {
    sessionStorage.setItem(key, String(scrollY));
    location.reload();
  });
})();`;

/** 発表の画面（/present）で Esc を押したときに戻る先。runtime より前に置く（#60） */
const EXIT_TO_PREVIEW = `document.querySelector('.mds-deck')?.setAttribute('data-exit-url', '/');`;

/** 警告の一覧を、プレビューの右下に出す。 */
function diagnosticsPanel(diagnostics: Diagnostic[], file: string): string {
  const shown = diagnostics.filter((d) => d.severity !== 'info');
  if (shown.length === 0) return '';
  const esc = (text: string) =>
    text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const items = shown
    .map(
      (d) => `<li><b>${esc(file)}:${d.line}</b> ${esc(d.message)} <code>${esc(d.code)}</code></li>`,
    )
    .join('');
  return `<aside class="mds-dev-panel" role="status"><p>警告 ${shown.length} 件</p><ul>${items}</ul></aside>
<style>
.mds-dev-panel { position: fixed; right: 16px; bottom: 16px; z-index: 10; max-width: 560px; max-height: 40vh; overflow: auto;
  padding: 12px 16px; border-radius: 10px; background: #fffbeb; color: #78350f; border: 1px solid #fcd34d;
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.18); font: 13px/1.5 system-ui, sans-serif; }
.mds-dev-panel p { margin: 0 0 6px; font-weight: 700; }
.mds-dev-panel ul { margin: 0; padding-left: 1.2em; }
.mds-dev-panel code { color: #92400e; font-size: 11px; }
html.mds-presenting .mds-dev-panel { display: none; }
@media print { .mds-dev-panel { display: none; } }
</style>`;
}

export interface DevServer {
  url: string;
  /** 読み込み直した回数（テスト用） */
  readonly version: number;
  close(): Promise<void>;
}

export interface DevOptions {
  port?: number;
  /** ヘッドレス Chromium で計測して自動で分割する（既定は行う） */
  measure?: boolean;
  host?: string;
  log?: (line: string) => void;
}

/** プレビューのサーバーを起動し、資料・CSS・素材の変更を監視する（docs/design.md §13）。 */
export async function startDev(mdFile: string, options: DevOptions = {}): Promise<DevServer> {
  const file = resolve(mdFile);
  const log = options.log ?? (() => undefined);
  const name = basename(file);
  let preview!: Rendered;
  let present!: Rendered;
  let version = 0;
  const clients = new Set<ServerResponse>();

  // 自動分割のための計測。ブラウザは使い回し、編集していない節は測り直さない
  const measurer = options.measure === false ? undefined : new ChromiumMeasurer();
  const render = async () => {
    const previewOptions = {
      debug: true,
      includeHidden: true,
      scripts: [PREVIEW_SCRIPT, LIVE_RELOAD],
      fonts: 'link' as const,
    };
    preview = await renderFile(file, previewOptions, measurer);
    present = await renderFile(
      file,
      { scripts: [EXIT_TO_PREVIEW, ARCH_SCRIPT, RUNTIME_SCRIPT, LIVE_RELOAD], fonts: 'link' },
      measurer,
    );
    version++;
    const count = preview.diagnostics.filter((d) => d.severity !== 'info').length;
    const time = new Date().toLocaleTimeString();
    log(
      `${time}  ${name} を読み込みました（${present.slides.slides.length} 枚${count ? `、警告 ${count} 件` : ''}）`,
    );
  };
  await render();
  if (measurer && !(await measurer.browser())) {
    log(`注意: ${measurer.error ?? 'Chromium を起動できませんでした'}。自動分割を省きます`);
  }

  const server = createServer((req, res) => {
    let path: string;
    try {
      path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path === '/__mds/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // 同梱するフォント（分割ファイル一式。ブラウザが必要なものだけを読む）と、数式のフォント（#72）
    if (path.startsWith('/__mds/fonts/')) {
      const rest = path.slice('/__mds/fonts/'.length);
      const font = fontFileFor(rest) ?? mathFontFileFor(rest);
      if (!font) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
      createReadStream(font).pipe(res);
      return;
    }
    if (path === '/' || path === '/present') {
      const rendered = path === '/' ? preview : present;
      const html = rendered.html.replace(
        '</body>',
        `${diagnosticsPanel(rendered.diagnostics, name)}</body>`,
      );
      res.writeHead(200, { 'content-type': TYPES['.html']!, 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    // 素材：資料のフォルダの中か、資料が参照しているファイルだけを返す
    const target = preview.assets.file(path);
    if (!target || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('見つかりません');
      return;
    }
    const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    createReadStream(target).pipe(res);
  });

  // 使われているポートなら、次の番号を試す
  const host = options.host ?? '127.0.0.1';
  let port = options.port ?? 3000;
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((ok, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => {
          server.off('error', fail);
          ok();
        });
      });
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt >= 10 || options.port === 0) throw error;
      port++;
    }
  }
  const address = server.address();
  const url = `http://${host}:${typeof address === 'object' && address ? address.port : port}/`;

  // 資料のフォルダ・CSS のフォルダ・素材のフォルダを監視する
  // （ファイルではなくフォルダを監視するので、エディタの「別名で保存して置き換え」にも対応する）
  let timer: NodeJS.Timeout | undefined;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      render().then(
        () => {
          for (const client of clients) client.write('event: reload\ndata: {}\n\n');
        },
        (error: Error) => log(`読み込めませんでした：${error.message}`),
      );
    }, 60);
  };
  const watchers: FSWatcher[] = [];
  const watched = new Set<string>();
  const watchDir = (dir: string) => {
    if (watched.has(dir) || !existsSync(dir)) return;
    watched.add(dir);
    watchers.push(
      watch(dir, (_event, changed) => {
        if (!changed) return reload();
        const changedPath = resolve(dir, changed.toString());
        const relevant =
          changedPath === file ||
          changedPath === preview.cssFile ||
          preview.assets.used().some(([from]) => from === changedPath);
        if (relevant) reload();
      }),
    );
  };
  watchDir(dirname(file));
  if (preview.cssFile) watchDir(dirname(preview.cssFile));
  for (const [from] of preview.assets.used()) watchDir(dirname(from));

  return {
    url,
    get version() {
      return version;
    },
    async close() {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      // ブラウザの keep-alive の接続が切れるのを待たずに止める
      const closed = new Promise<void>((ok) => server.close(() => ok()));
      server.closeAllConnections();
      await closed;
      await measurer?.close();
    },
  };
}
