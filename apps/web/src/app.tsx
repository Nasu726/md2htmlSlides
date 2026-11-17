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
import { createEditor, type Editor } from './editor.js';
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
const canOpenFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

let editor: Editor;
let renderer: Renderer;
let text = '';

// ---- 描画：入力はアニメーションフレームごとにまとめ、描いている間の変更は描き終わってから反映する ----
let rendering = false;
let pending = false;
function scheduleRender(): void {
  if (rendering) {
    pending = true;
    return;
  }
  rendering = true;
  requestAnimationFrame(() => {
    renderer
      .render(text)
      .then((value) => (result.value = value))
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

function onChange(next: string): void {
  text = next;
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
    editor = createEditor(editorRef.current!, {
      text: '',
      onChange,
      onSave: () => void save(),
      onPresent: () => void present(),
    });
    void start();
    const keydown = (event: KeyboardEvent) => {
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
        <section class="preview" ref={previewRef} aria-label="プレビュー" />
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
      {dragging.value && <div class="drop">ここに落とすと開きます（.md と画像・動画）</div>}
      <div class="hidden-frames" ref={hiddenRef} aria-hidden="true" />
    </div>
  );
}
