/* global self, caches, fetch, URL */
/**
 * Service Worker（#73、設計プラン §9.5）。ビルドのときに、版とファイルの一覧を埋め込む（vite.config.ts）。
 *
 * - アプリの本体：入れたときに全部キャッシュし、キャッシュから返す（オフラインでも開ける）
 * - フォント：使ったものだけを、初めて読んだときにキャッシュする（日本語のフォントは大きいため）
 * - 使うときに読み込むもの（Shiki の文法・KaTeX・Mermaid）：初めて読んだときにキャッシュする
 * - それ以外（`?src=` で開く Web 上の md など）：ネットワークから読む
 */
const VERSION = '__VERSION__';
const FILES = ['__FILES__'];
const APP = `mds-app-${VERSION}`;
const FONTS = 'mds-fonts-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== APP && key !== FONTS).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith('fonts/')) {
    event.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  // 使うときに読み込むもの（Shiki の文法・KaTeX・Mermaid など）：初めて読んだときにキャッシュする
  if (path.startsWith('assets/') && !FILES.includes(path)) {
    event.respondWith(
      caches.open(APP).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  // 画面（`?src=…` 付きでも同じ index.html）とアプリのファイル
  const key = request.mode === 'navigate' ? './' : path;
  if (request.mode !== 'navigate' && !FILES.includes(key)) return;
  event.respondWith(
    caches
      .open(APP)
      .then((cache) => cache.match(new URL(key, scope).href))
      .then((hit) => hit ?? fetch(request)),
  );
});
