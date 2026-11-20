import { render } from 'preact';
import { App, showUpdateNotice } from './app.js';
import './styles.css';

render(<App />, document.getElementById('app')!);

// オフラインでも使えるよう、Service Worker を入れる（ビルドしたときだけ。設計プラン §9.5）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // 新しい版が入ったら知らせる（#167）。初めて入れたとき（それまで Service Worker がなかった）は知らせない
  const updating = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating) showUpdateNotice();
  });
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
