/**
 * 発表：エディタの上に全画面で出し、Esc（スマホは「終える」）でプレビューの同じスライドに戻る
 * （#171 で app.tsx から分けた）
 */
import { Frame } from './frames.js';
import { editor, renderer } from './session.js';

let presenting = false;
export async function present(slide?: string): Promise<void> {
  if (presenting) return;
  presenting = true;
  const overlay = document.createElement('div');
  overlay.className = 'present';
  document.body.append(overlay);
  // 全画面は、クリックやキーの直後にしか頼めないので、先に頼む
  void overlay.requestFullscreen?.().catch(() => undefined);
  const close = (frame?: Frame, at?: string) => {
    presenting = false;
    frame?.destroy();
    overlay.remove();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (at) void renderer.show(at);
    editor.view.focus();
  };
  const start = slide ?? (await renderer.slideInView());
  const html = await renderer.presentHtml(start);
  if (!html) return close();
  const frame = new Frame('present', overlay, {
    sandbox: 'allow-scripts allow-popups allow-modals',
    allow: 'fullscreen',
    title: '発表',
    className: 'present-frame',
  });
  frame.onEvent = (message) => {
    if (message.type === 'mds:exit') close(frame, String(message.slide));
  };
  await frame.load(html);
  // キーが発表の画面に届くよう、読み込んだらすぐにフォーカスを移す（素材は後から届く）
  frame.iframe.focus();
  await renderer.sendPresentAssets(frame);
}
