import { render } from 'preact';
import { App } from './app.js';
import './styles.css';

render(<App />, document.getElementById('app')!);

// オフラインでも使えるよう、Service Worker を入れる（ビルドしたときだけ。設計プラン §9.5）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
