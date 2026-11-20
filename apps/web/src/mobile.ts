/**
 * スマホ（狭い画面）の表示（#154・#159。#171 で app.tsx から分けた）：編集とスライドの切り替え、
 * キーボードが出たときの高さ
 */
import { EditorView } from '@codemirror/view';
import { editor, focusCursorSlide } from './session.js';
import { keyboard, pane } from './state.js';

/** 狭い画面で、編集とスライドを切り替える。スライドにするときはキーボードを閉じ、カーソルのスライドを見せる */
export function showPane(next: 'edit' | 'preview'): void {
  pane.value = next;
  if (next === 'preview') {
    editor.view.contentDOM.blur();
    requestAnimationFrame(() => focusCursorSlide(true));
  }
}

/**
 * キーボードが出ている間も、画面の高さを見えている範囲（visualViewport）に合わせる（#154）。
 * iOS の Safari は、キーボードが出ても画面の高さを変えず、ページをずらすため。
 * 指で操作する端末だけで行う（パソコンでブラウザを拡大したときに、画面が縮まないように）
 */
export function followVisualViewport(): () => void {
  const vv = window.visualViewport;
  if (!vv || !matchMedia('(pointer: coarse)').matches) return () => undefined;
  const root = document.documentElement;
  /** 向き（幅）ごとの、いちばん高かったときの高さ。これより十分低ければ、キーボードが出ている */
  const tallest = new Map<number, number>();
  const update = () => {
    const zoomed = vv.scale > 1.05;
    const width = Math.round(vv.width * vv.scale);
    if (!zoomed) tallest.set(width, Math.max(tallest.get(width) ?? 0, vv.height));
    root.style.setProperty('--app-height', `${zoomed ? window.innerHeight : vv.height}px`);
    root.style.setProperty('--app-top', `${zoomed ? 0 : vv.offsetTop}px`);
    keyboard.value = !zoomed && vv.height < (tallest.get(width) ?? vv.height) * 0.8;
    // キーボードで高さが縮んだら、カーソルを見える位置に動かす（キーボードの裏に隠れないように。#159）
    if (keyboard.value && editor.view.hasFocus) {
      requestAnimationFrame(() => {
        const { view } = editor;
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, {
            y: 'nearest',
            yMargin: 24,
          }),
        });
      });
    }
  };
  /**
   * キーボードを閉じた（入力欄からフォーカスが外れた）ら、閉じ終わるのを待たずに高さを戻す。
   * 待つと、キーボードがあったところが空白のまま見える（#159）
   */
  const editable = (el: EventTarget | null) =>
    el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'));
  const focusout = (event: FocusEvent) => {
    if (!keyboard.value || editable(event.relatedTarget)) return;
    root.style.setProperty('--app-height', `${window.innerHeight}px`);
    root.style.setProperty('--app-top', '0px');
    keyboard.value = false;
  };
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  document.addEventListener('focusout', focusout);
  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    document.removeEventListener('focusout', focusout);
  };
}
