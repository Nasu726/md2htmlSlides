import type { Diagnostic } from '@mds/core';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  AssetStore,
  fileListSource,
  folderSource,
  noAssets,
  urlSource,
  type AssetSource,
} from './assets.js';
import { cheatSheet, insertSnippet, type CheatItem } from './assist.js';
import { createEditor, type Editor } from './editor.js';
import {
  fixBreak,
  keepSection,
  setSlides,
  setWarnings,
  slideAt,
  slideInfoAt,
  slideStart,
} from './slide-gutter.js';
import { Frame } from './frames.js';
import { Cancelled, Renderer, type RenderResult } from './renderer.js';
import { SAMPLE } from './sample.js';
import { getItem, setItem, type Draft, type LastDocument } from './storage.js';

/** 開いている資料。key は下書きを保存する名前 */
interface DocInfo {
  kind: 'sample' | 'draft' | 'folder' | 'file' | 'url';
  name: string;
  key: string;
  /** フォルダの中のパス（フォルダを開いたとき） */
  path?: string;
}

interface Folder {
  name: string;
  files: Map<string, FileSystemFileHandle>;
  documents: string[];
}

interface Notice {
  text: string;
  action?: { label: string; run: () => void };
}

const doc = signal<DocInfo>({ kind: 'sample', name: 'はじめに.md', key: 'sample' });
const dirty = signal(false);
const folder = signal<Folder | null>(null);
const result = signal<RenderResult | null>(null);
const notice = signal<Notice | null>(null);
const showWarnings = signal(false);
const dragging = signal(false);
/** 自動で区切られた位置のメニュー（#74） */
const breakMenu = signal<{ line: number; x: number; y: number } | null>(null);
/** 早見表のパネル（#75）と、その検索の文字 */
const cheatOpen = signal(false);
const cheatQuery = signal('');
const CHEAT_ITEMS: CheatItem[] = cheatSheet();
/** ファイルを選んだ・落としたときの、一緒に選んだファイルの名前（`![](` の候補） */
let pickedFiles: string[] = [];

/** `![](` の候補：資料のフォルダからの相対パス */
function assetCandidates(): string[] {
  const current = folder.value;
  if (current && doc.value.path) {
    const dir = doc.value.path.includes('/')
      ? doc.value.path.slice(0, doc.value.path.lastIndexOf('/') + 1)
      : '';
    return [...current.files.keys()]
      .filter((path) => path.startsWith(dir) && path !== doc.value.path)
      .map((path) => path.slice(dir.length));
  }
  return pickedFiles;
}

/** 早見表の項目を、カーソルの位置（選んでいる範囲）に入れる */
function insertCheat(item: CheatItem): void {
  const { from, to } = editor.view.state.selection.main;
  insertSnippet(editor.view, item.snippet, from, to);
  editor.view.focus();
}
const canOpenFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

let editor: Editor;
let renderer: Renderer;
let text = '';

// ---- 描画：入力はアニメーションフレームごとにまとめ、描いている間の変更は描き終わってから反映する ----
let rendering = false;
let pending = false;
/** まだプレビューに反映していない、最初の打鍵の時刻 */
let changedAt: number | undefined;
/** 打鍵からプレビューに反映されるまでの時間（ミリ秒。設計プラン §11.1。e2e と計測で読む） */
const latencies: number[] = [];
(window as unknown as { mdsLatencies: number[] }).mdsLatencies = latencies;
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
function focusCursorSlide(force = false): void {
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

function onCursor(line: number): void {
  cursorLine = line;
  focusCursorSlide();
}

/** プレビューでスライドをクリックした・行番号欄の番号を押した：その行に移る */
function jumpToSlide(index: number): void {
  const line = slideStart(editor.view, index);
  if (line !== undefined) jumpTo(line);
}

function onChange(next: string): void {
  text = next;
  changedAt ??= performance.now();
  dirty.value = true;
  scheduleRender();
  scheduleDraft();
}

/** 資料を開く。前に保存していない下書きがあれば、戻せるようにする */
async function openText(info: DocInfo, content: string, source: AssetSource): Promise<void> {
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
      action: {
        label: '下書きを開く',
        run: () => {
          text = draft.text;
          editor.setText(draft.text);
          dirty.value = true;
          notice.value = null;
          scheduleRender();
        },
      },
    };
  }
}

// ---- ファイルを開く（設計プラン §9.1） ----
async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Map<string, FileSystemFileHandle>,
  depth: number,
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    if (handle.kind === 'file') out.set(prefix + name, handle as FileSystemFileHandle);
    else if (depth < 6)
      await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`, out, depth + 1);
  }
}

async function openFolder(): Promise<void> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker!({ mode: 'readwrite' });
  } catch {
    return; // 選ぶのをやめた
  }
  const files = new Map<string, FileSystemFileHandle>();
  await walk(dir, '', files, 0);
  const documents = [...files.keys()].filter((path) => /\.(md|markdown)$/i.test(path)).sort();
  folder.value = { name: dir.name, files, documents };
  if (documents.length === 0) {
    notice.value = { text: `「${dir.name}」には Markdown のファイルがありません。` };
    return;
  }
  await openFolderFile(documents[0]!);
}

async function openFolderFile(path: string): Promise<void> {
  const current = folder.value;
  const handle = current?.files.get(path);
  if (!current || !handle) return;
  const content = await (await handle.getFile()).text();
  await openText(
    { kind: 'folder', name: path, key: `folder:${current.name}/${path}`, path },
    content,
    folderSource(current.files, path),
  );
}

async function openFiles(files: File[]): Promise<void> {
  const md = files.find((file) => /\.(md|markdown|txt)$/i.test(file.name));
  if (!md) {
    notice.value = { text: 'Markdown のファイル（.md）を選んでください。' };
    return;
  }
  folder.value = null;
  pickedFiles = files.filter((file) => file !== md).map((file) => file.name);
  await openText(
    { kind: 'file', name: md.name, key: `file:${md.name}` },
    await md.text(),
    fileListSource(files),
  );
}

async function openUrl(url: string): Promise<void> {
  let content: string;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    content = await response.text();
  } catch (error) {
    notice.value = { text: `読み込めませんでした：${url}（${String(error)}）` };
    return;
  }
  folder.value = null;
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'slides.md');
  await openText({ kind: 'url', name, key: `url:${url}` }, content, urlSource(url));
}

function askUrl(): void {
  const value = window.prompt('Markdown の URL（GitHub の raw など）');
  if (!value) return;
  const url = new URL(value, location.href).href;
  const next = new URL(location.href);
  next.searchParams.set('src', url);
  history.replaceState(null, '', next);
  void openUrl(url);
}

// ---- 保存：フォルダを開いていれば上書き、それ以外はダウンロード ----
async function save(): Promise<void> {
  const info = doc.value;
  const handle =
    info.kind === 'folder' && info.path ? folder.value?.files.get(info.path) : undefined;
  if (handle) {
    try {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      dirty.value = false;
      notice.value = { text: `「${info.name}」を保存しました。` };
    } catch (error) {
      notice.value = { text: `保存できませんでした：${String(error)}` };
    }
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  link.download = info.name
    .split('/')
    .pop()!
    .replace(/\.(markdown|txt)$/i, '')
    .replace(/(\.md)?$/i, '.md');
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  dirty.value = false;
}

// ---- 発表：エディタの上に全画面で出し、Esc でプレビューの同じスライドに戻る ----
let presenting = false;
async function present(slide?: string): Promise<void> {
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

function jumpTo(line: number): void {
  const view = editor.view;
  const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
  view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
  view.focus();
  showWarnings.value = false;
}

async function start(): Promise<void> {
  const src = new URLSearchParams(location.search).get('src');
  if (src) {
    await openUrl(new URL(src, location.href).href);
    return;
  }
  const last = await getItem<LastDocument>('last');
  if (last && last.text !== SAMPLE) {
    await openText({ kind: 'draft', name: last.name, key: last.key }, last.text, noAssets);
    notice.value = { text: `前回の下書き「${last.name}」を開きました。` };
    return;
  }
  await openText(doc.value, SAMPLE, noAssets);
}

// ---- 画面 ----
export function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    renderer = new Renderer(previewRef.current!, hiddenRef.current!);
    renderer.onPresent = (slide) => void present(slide);
    renderer.onJump = jumpToSlide;
    editor = createEditor(editorRef.current!, {
      text: '',
      onChange,
      onSave: () => void save(),
      onPresent: () => void present(),
      onCursor,
      onCheatSheet: () => (cheatOpen.value = !cheatOpen.value),
      assist: {
        files: assetCandidates,
        layoutAt: (line) => slideInfoAt(editor.view, line)?.layout,
      },
      gutter: {
        onAutoBreak: (line, rect) => (breakMenu.value = { line, x: rect.right + 4, y: rect.top }),
        onSlide: (index) => {
          focusedSlide = index;
          void renderer.focus(index);
        },
      },
    });
    void start();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') breakMenu.value = null;
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void save();
      }
    };
    const dragover = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      dragging.value = true;
    };
    const dragleave = (event: DragEvent) => {
      if (event.relatedTarget === null) dragging.value = false;
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      dragging.value = false;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) void openFiles(files);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('dragover', dragover);
    window.addEventListener('dragleave', dragleave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('dragover', dragover);
      window.removeEventListener('dragleave', dragleave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const r = result.value;
  const warnings: Diagnostic[] = r?.diagnostics.filter((d) => d.severity !== 'info') ?? [];
  return (
    <div class="app">
      <header class="toolbar">
        <span class="brand">md2htmlSlides</span>
        {canOpenFolder && (
          <button type="button" onClick={() => void openFolder()}>
            フォルダを開く
          </button>
        )}
        <button type="button" onClick={() => fileRef.current!.click()}>
          ファイルを開く
        </button>
        <button type="button" onClick={askUrl}>
          URL を開く
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown,image/*,video/*,.css"
          hidden
          data-testid="file-input"
          onChange={(event) => {
            const input = event.currentTarget;
            const files = Array.from(input.files ?? []);
            input.value = '';
            if (files.length > 0) void openFiles(files);
          }}
        />
        <span class="doc-name" title={doc.value.name}>
          {doc.value.name}
          {dirty.value && (
            <span class="dirty" aria-label="保存していない変更があります">
              {' '}
              ●
            </span>
          )}
        </span>
        <button type="button" onClick={() => void save()} title="Ctrl+S">
          {doc.value.kind === 'folder' ? '保存' : 'ダウンロード'}
        </button>
        <span class="spacer" />
        <button
          type="button"
          class={cheatOpen.value ? 'active' : ''}
          title="Ctrl+/"
          onClick={() => (cheatOpen.value = !cheatOpen.value)}
        >
          ? 早見表
        </button>
        <button
          type="button"
          class="primary"
          onClick={() => void present()}
          title="F5（プレビューでは S）"
        >
          ▶ 発表
        </button>
      </header>
      {notice.value && (
        <div class="notice" role="status">
          <span>{notice.value.text}</span>
          {notice.value.action && (
            <button type="button" onClick={notice.value.action.run}>
              {notice.value.action.label}
            </button>
          )}
          <button
            type="button"
            class="close"
            aria-label="閉じる"
            onClick={() => (notice.value = null)}
          >
            ×
          </button>
        </div>
      )}
      <main class={`workspace${folder.value ? ' has-files' : ''}`}>
        {folder.value && (
          <nav class="files" aria-label="ファイル">
            <h2>{folder.value.name}</h2>
            <ul>
              {folder.value.documents.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    class={doc.value.path === path ? 'current' : ''}
                    onClick={() => void openFolderFile(path)}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <section class="editor" ref={editorRef} aria-label="エディタ" />
        <section class="preview" ref={previewRef} aria-label="プレビュー">
          {cheatOpen.value && (
            <aside class="cheatsheet" aria-label="早見表">
              <header>
                <h2>早見表</h2>
                <button
                  type="button"
                  class="close"
                  aria-label="閉じる"
                  onClick={() => (cheatOpen.value = false)}
                >
                  ×
                </button>
              </header>
              <input
                type="search"
                placeholder="探す（例：横・背景・段階）"
                value={cheatQuery.value}
                onInput={(event) => (cheatQuery.value = event.currentTarget.value)}
              />
              <ul>
                {CHEAT_ITEMS.filter((item) => {
                  const q = cheatQuery.value.trim();
                  return (
                    !q || item.label.includes(q) || item.code.includes(q) || item.group.includes(q)
                  );
                }).map((item, i) => (
                  <li key={i}>
                    <div>
                      <b>{item.label}</b>
                      <code>{item.code}</code>
                    </div>
                    <button type="button" onClick={() => insertCheat(item)}>
                      挿入
                    </button>
                  </li>
                ))}
              </ul>
              <p class="muted">項目を選ぶと、カーソルの位置に入れる</p>
            </aside>
          )}
        </section>
      </main>
      <footer class="status">
        <span data-testid="slide-count">{r ? `${r.slides} 枚` : '描画中…'}</span>
        <button
          type="button"
          class={warnings.length > 0 ? 'warn' : ''}
          onClick={() => (showWarnings.value = !showWarnings.value)}
          disabled={warnings.length === 0}
        >
          警告 {warnings.length} 件
        </button>
        {r && <span class="muted">{Math.round(r.ms)} ms</span>}
        <span class="spacer" />
        <span class="muted">
          {doc.value.kind === 'folder'
            ? 'フォルダ'
            : doc.value.kind === 'url'
              ? 'URL（読み込みだけ）'
              : doc.value.kind === 'file'
                ? 'ファイル（読み込みだけ）'
                : '下書き'}
          ・自動で下書きを保存
        </span>
      </footer>
      {showWarnings.value && warnings.length > 0 && (
        <div class="warnings" role="dialog" aria-label="警告">
          <ul>
            {warnings.map((d, i) => (
              <li key={i}>
                <button type="button" onClick={() => jumpTo(d.line)}>
                  <b>{d.line} 行</b> {d.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {breakMenu.value && (
        <div
          class="break-menu"
          role="menu"
          style={{ left: `${breakMenu.value.x}px`, top: `${breakMenu.value.y}px` }}
        >
          <p>自動で区切られた位置</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              fixBreak(editor.view, breakMenu.value!.line);
              breakMenu.value = null;
            }}
          >
            ここで区切りを固定（<code>---</code> を入れる）
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              keepSection(editor.view, breakMenu.value!.line);
              breakMenu.value = null;
            }}
          >
            1枚にまとめる（<code>{'{keep}'}</code> を付ける）
          </button>
          <button type="button" class="cancel" onClick={() => (breakMenu.value = null)}>
            閉じる
          </button>
        </div>
      )}
      {dragging.value && <div class="drop">ここに落とすと開きます（.md と画像・動画）</div>}
      <div class="hidden-frames" ref={hiddenRef} aria-hidden="true" />
    </div>
  );
}
