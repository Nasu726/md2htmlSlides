/**
 * 編集している資料（#171 で app.tsx から分けた）：エディタとプレビュー、描画の予約、下書きの自動保存、
 * カーソルとプレビューの同期、資料を開く
 */
import { AssetStore, type AssetSource } from './assets.js';
import type { Editor } from './editor.js';
import { Cancelled, type Renderer } from './renderer.js';
import { setSlides, setWarnings, slideAt, slideStart } from './slide-gutter.js';
import { dirty, doc, notice, pane, result, showWarnings, type DocInfo } from './state.js';
import { getItem, setItem, type Draft, type LastDocument } from './storage.js';

export let editor: Editor;
export let renderer: Renderer;
export let text = '';

/** エディタとプレビューをつなぐ（画面を作ったときに1回） */
export function attach(nextEditor: Editor, nextRenderer: Renderer): void {
  editor = nextEditor;
  renderer = nextRenderer;
}

// ---- 描画：入力はアニメーションフレームごとにまとめ、描いている間の変更は描き終わってから反映する ----
let rendering = false;
let pending = false;
/** まだプレビューに反映していない、最初の打鍵の時刻 */
let changedAt: number | undefined;
/** 打鍵からプレビューに反映されるまでの時間（ミリ秒。設計プラン §11.1。e2e と計測で読む） */
const latencies: number[] = [];
(window as unknown as { mdsLatencies: number[] }).mdsLatencies = latencies;
/** 描き終わるのを待っている処理（書き出し。#121） */
let idleWaiters: Array<() => void> = [];
/** 描いている途中・待っている描画があれば、すべて終わるまで待つ */
export function whenRendered(): Promise<void> {
  if (!rendering && !pending) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}
function scheduleRender(): void {
  if (rendering) {
    pending = true;
    return;
  }
  rendering = true;
  const since = changedAt;
  changedAt = undefined;
  requestAnimationFrame(() => {
    renderer
      .render(text)
      .then((value) => {
        result.value = value;
        if (since !== undefined) {
          latencies.push(performance.now() - since);
          if (latencies.length > 200) latencies.shift();
        }
        // 行番号欄の目印と警告を、描いた結果に合わせる（#74）
        setSlides(editor.view, value.map);
        setWarnings(editor.view, value.diagnostics);
        focusCursorSlide(true);
      })
      .catch((error: unknown) => {
        if (error instanceof Cancelled) return; // 別の資料を開いた
        console.error(error);
        notice.value = { text: `描画できませんでした：${String(error)}` };
      })
      .finally(() => {
        rendering = false;
        if (pending) {
          pending = false;
          scheduleRender();
        } else {
          const waiters = idleWaiters;
          idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
  });
}

// ---- 下書きの自動保存 ----
let saveTimer = 0;
function scheduleDraft(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const { key, name } = doc.value;
    const time = Date.now();
    void setItem(`draft:${key}`, { text, time } satisfies Draft);
    void setItem('last', { key, name, text, time } satisfies LastDocument);
  }, 400);
}

// ---- カーソルとプレビューの同期（#74、設計プラン §9.2） ----
let cursorLine = 1;
let focusedSlide = -1;
let focusQueued = false;
/** カーソルのあるスライドを、プレビューで見せる（スライドが変わったときだけ動かす） */
export function focusCursorSlide(force = false): void {
  if (focusQueued) return;
  focusQueued = true;
  requestAnimationFrame(() => {
    focusQueued = false;
    const index = slideAt(editor.view, cursorLine);
    if (index < 0 || (index === focusedSlide && !force)) return;
    focusedSlide = index;
    void renderer.focus(index);
  });
}

export function onCursor(line: number): void {
  cursorLine = line;
  focusCursorSlide();
}

/** プレビューでスライドをクリックした・行番号欄の番号を押した：その行に移る */
export function jumpToSlide(index: number): void {
  const line = slideStart(editor.view, index);
  if (line !== undefined) jumpTo(line);
}

export function onChange(next: string): void {
  text = next;
  changedAt ??= performance.now();
  dirty.value = true;
  scheduleRender();
  scheduleDraft();
}

/** 資料を開く。前に保存していない下書きがあれば、戻せるようにする */
export async function openText(info: DocInfo, content: string, source: AssetSource): Promise<void> {
  renderer.reset(new AssetStore(source));
  doc.value = info;
  text = content;
  editor.setText(content);
  dirty.value = false;
  notice.value = null;
  scheduleRender();
  if (info.kind === 'sample' || info.kind === 'draft') return;
  const draft = await getItem<Draft>(`draft:${info.key}`);
  if (draft && draft.text !== content && doc.value.key === info.key) {
    notice.value = {
      text: `「${info.name}」には、保存していない下書きがあります（${new Date(draft.time).toLocaleString()}）。`,
      actions: [
        {
          label: '下書きを開く',
          run: () => {
            text = draft.text;
            editor.setText(draft.text);
            dirty.value = true;
            notice.value = null;
            scheduleRender();
          },
        },
      ],
    };
  }
}

/** 行番号欄でスライドの番号を押した：プレビューでそのスライドを見せる */
export function showSlide(index: number): void {
  focusedSlide = index;
  void renderer.focus(index);
}

/** 開いている資料を「前回の資料」として残す（GitHub の資料は、編集しなくても起動したときに開き直す） */
export function rememberLast(): void {
  const { key, name } = doc.value;
  void setItem('last', { key, name, text, time: Date.now() } satisfies LastDocument);
}

export function jumpTo(line: number): void {
  const view = editor.view;
  const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
  // 狭い画面でスライドを押したとき・警告を選んだときは、編集に戻ってその行に移る（#154）
  pane.value = 'edit';
  view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
  view.focus();
  showWarnings.value = false;
}
