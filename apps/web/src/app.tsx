import type { Diagnostic } from '@mdhs/core';
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
import { insertSnippet } from './assist.js';
import { cheatGroups, cheatSheet, type CheatItem } from './cheatsheet.js';
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
import {
  describeFailure,
  fetchMarkdown,
  nameOf,
  toSourceUrl,
  type SourceUrl,
} from './source-url.js';
import {
  GitHubConflict,
  GitHubRepo,
  githubSource,
  parseRepo,
  type GitHubSettings,
} from './github.js';
import { getItem, removeItem, setItem, type Draft, type LastDocument } from './storage.js';

/** 開いている資料。key は下書きを保存する名前 */
interface DocInfo {
  kind: 'sample' | 'draft' | 'folder' | 'file' | 'url' | 'github';
  name: string;
  key: string;
  /** フォルダ・GitHub のリポジトリの中のパス */
  path?: string;
}

interface Folder {
  name: string;
  files: Map<string, FileSystemFileHandle>;
  documents: string[];
}

interface Notice {
  text: string;
  actions?: Array<{ label: string; run: () => void }>;
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

/**
 * 狭い画面（スマホ。#154）：エディタとプレビューを1つずつ表示し、上の「編集｜スライド」で切り替える。
 * 横向きのスマホ（高さが低い）も含める。styles.css の同じ条件の @media と合わせる
 */
const NARROW = '(max-width: 700px), (max-height: 500px)';
const isNarrow = () => typeof matchMedia !== 'undefined' && matchMedia(NARROW).matches;
/** 狭い画面で表示している側 */
const pane = signal<'edit' | 'preview'>('edit');
/** 狭い画面の「≡」のメニュー */
const menuOpen = signal(false);
/** ソフトウェアキーボードが出ている（狭い画面では、下の状態の行を隠す） */
const keyboard = signal(false);

/** GitHub（#147）：つないだリポジトリ、その画面、資料の一覧（読み込む前は null） */
const github = signal<GitHubRepo | null>(null);
const githubOpen = signal(false);
const githubDocs = signal<string[] | null>(null);
const githubBusy = signal(false);
const githubError = signal('');
/** 開いている GitHub の資料の、読み込んだとき（保存したとき）の sha。保存するときに、変わっていないかを確かめる */
let githubSha: string | undefined;

/** 狭い画面で、編集とスライドを切り替える。スライドにするときはキーボードを閉じ、カーソルのスライドを見せる */
function showPane(next: 'edit' | 'preview'): void {
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
function followVisualViewport(): () => void {
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
  };
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
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
  // 狭い画面では、早見表はスライドの側に重ねて出すので、入れたら編集に戻る（#154）
  if (isNarrow()) {
    cheatOpen.value = false;
    pane.value = 'edit';
  }
  editor.view.focus();
}

/** 早見表を開く・閉じる。狭い画面では、スライドの側に重ねて出す（#154） */
function toggleCheatSheet(): void {
  cheatOpen.value = !cheatOpen.value;
  if (cheatOpen.value && isNarrow()) showPane('preview');
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
/** 描き終わるのを待っている処理（書き出し。#121） */
let idleWaiters: Array<() => void> = [];
/** 描いている途中・待っている描画があれば、すべて終わるまで待つ */
function whenRendered(): Promise<void> {
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

/** URL の md を開く。読み込めなければ、理由を知らせて false を返す */
async function openUrl(input: string): Promise<boolean> {
  let content: string;
  let source: SourceUrl | undefined;
  try {
    source = toSourceUrl(input);
    content = await fetchMarkdown(source.url);
  } catch (error) {
    notice.value = { text: describeFailure(source?.url ?? input, error) };
    return false;
  }
  folder.value = null;
  await openText(
    { kind: 'url', name: nameOf(source.url), key: `url:${source.url}` },
    content,
    urlSource(source.base),
  );
  return true;
}

// ---- GitHub のリポジトリに置く（#147、設計プラン §9.1） ----
const githubKey = (repo: GitHubRepo, path: string) => `github:${repo.settings.repo}/${path}`;

/** 開いている資料を「前回の資料」として残す（GitHub の資料は、編集しなくても起動したときに開き直す） */
function rememberLast(): void {
  const { key, name } = doc.value;
  void setItem('last', { key, name, text, time: Date.now() } satisfies LastDocument);
}

/** GitHub の画面を開く。つないでいれば、資料の一覧を読み込む */
function openGitHub(): void {
  githubOpen.value = true;
  githubError.value = '';
  if (github.value) void listGitHub(github.value);
}

async function listGitHub(repo: GitHubRepo): Promise<boolean> {
  githubBusy.value = true;
  try {
    githubDocs.value = GitHubRepo.documents(await repo.files());
    githubError.value = '';
    return true;
  } catch (error) {
    githubError.value = (error as Error).message;
    return false;
  } finally {
    githubBusy.value = false;
  }
}

/** リポジトリにつなぐ。一覧を読めたら、設定をこのブラウザに保存する */
async function connectGitHub(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const repoName = parseRepo(String(data.get('repo') ?? ''));
  const token = String(data.get('token') ?? '').trim();
  if (!repoName) {
    githubError.value = 'リポジトリは「owner/name」の形で入れてください';
    return;
  }
  const branch = String(data.get('branch') ?? '').trim();
  const settings: GitHubSettings = { repo: repoName, token, ...(branch ? { branch } : {}) };
  const repo = new GitHubRepo(settings);
  if (await listGitHub(repo)) {
    github.value = repo;
    await setItem('github', settings);
  }
}

/** つなぎを外す（トークンをこのブラウザから消す） */
function disconnectGitHub(): void {
  github.value = null;
  githubDocs.value = null;
  void removeItem('github');
  if (doc.value.kind === 'github') doc.value = { ...doc.value, kind: 'draft' };
}

async function openGitHubFile(path: string): Promise<boolean> {
  const repo = github.value;
  if (!repo) return false;
  try {
    const file = await repo.read(path);
    githubSha = file.sha;
    folder.value = null;
    githubOpen.value = false;
    await openText(
      { kind: 'github', name: path, key: githubKey(repo, path), path },
      file.text,
      githubSource(repo, path),
    );
    rememberLast();
    return true;
  } catch (error) {
    notice.value = { text: `GitHub から開けませんでした：${(error as Error).message}` };
    return false;
  }
}

/**
 * GitHub に保存する（commit する）。読み込んだ後にほかの端末で保存されていたら、上書きせずに知らせる。
 * force なら、今の GitHub の内容に上書きする
 */
async function saveToGitHub(force = false): Promise<void> {
  const repo = github.value;
  const info = doc.value;
  if (!repo || info.kind !== 'github' || !info.path) return;
  const path = info.path;
  const saving = text;
  try {
    const sha = force ? await repo.currentSha(path) : githubSha;
    githubSha = await repo.write(path, saving, sha, `mdhs: ${path} を保存`);
    if (text === saving) dirty.value = false;
    rememberLast();
    notice.value = { text: `「${path}」を GitHub（${repo.settings.repo}）に保存しました。` };
  } catch (error) {
    if (!(error instanceof GitHubConflict)) {
      notice.value = { text: `GitHub に保存できませんでした：${(error as Error).message}` };
      return;
    }
    // 書いている内容は下書きに残っているので、GitHub の内容を開いても「下書きを開く」で戻せる
    notice.value = {
      text: `「${path}」は、ほかの端末で先に保存されています。`,
      actions: [
        { label: 'GitHub の内容を開く', run: () => void openGitHubFile(path) },
        { label: '上書きする', run: () => void saveToGitHub(true) },
      ],
    };
  }
}

/** 今の資料を、リポジトリに新しいファイルとして保存する */
async function saveAsGitHub(): Promise<void> {
  const repo = github.value;
  if (!repo) return;
  const suggested = doc.value.name
    .split('/')
    .pop()!
    .replace(/(\.md)?$/i, '.md');
  const input = window.prompt('リポジトリの中のパス（例：talks/2026-12.md）', suggested);
  const path = input?.trim().replace(/^\/+/, '');
  if (!path) return;
  try {
    githubSha = await repo.write(path, text, undefined, `mdhs: ${path} を追加`);
  } catch (error) {
    githubError.value =
      error instanceof GitHubConflict
        ? `「${path}」はもうあります。別の名前にするか、一覧から開いてください`
        : (error as Error).message;
    return;
  }
  // 素材はそのまま（このあと開き直すと、リポジトリから読む）
  doc.value = { kind: 'github', name: path, key: githubKey(repo, path), path };
  dirty.value = false;
  githubOpen.value = false;
  notice.value = { text: `「${path}」を GitHub（${repo.settings.repo}）に保存しました。` };
  rememberLast();
}

function askUrl(): void {
  const value = window.prompt('Markdown の URL（GitHub・Gist の画面の URL も、そのまま使えます）');
  if (!value?.trim()) return;
  const url = new URL(value.trim(), location.href).href;
  const next = new URL(location.href);
  next.searchParams.set('src', url);
  history.replaceState(null, '', next);
  void openUrl(url);
}

// ---- 保存：フォルダを開いていれば上書き、それ以外はダウンロード ----
async function save(): Promise<void> {
  const info = doc.value;
  if (info.kind === 'github') {
    await saveToGitHub();
    return;
  }
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

// ---- 単一 HTML の書き出し（#121）：CLI の mdhs build --single と同じ HTML を1つダウンロードする ----
async function exportHtml(): Promise<void> {
  await whenRendered();
  const out = await renderer.exportHtml();
  if (!out) return;
  const name =
    doc.value.name
      .split('/')
      .pop()!
      .replace(/\.(md|markdown|txt)$/i, '') + '.html';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([out.html], { type: 'text/html' }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  const bytes = new Blob([out.html]).size;
  const size =
    bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const notes = [
    ...(out.omitted.length > 0
      ? [
          `10 MB を超える動画は埋め込まず、ポスター（なければ枠）にしました：${out.omitted.join('、')}。`,
        ]
      : []),
    ...(out.missing.length > 0
      ? [`読めなかった素材は、パスのまま残しました：${out.missing.join('、')}。`]
      : []),
  ];
  notice.value = {
    text: `「${name}」を書き出しました（${size}、素材 ${out.embedded} 個を埋め込み）。${notes.join('')}`,
  };
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
  // 狭い画面でスライドを押したとき・警告を選んだときは、編集に戻ってその行に移る（#154）
  pane.value = 'edit';
  view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
  view.focus();
  showWarnings.value = false;
}

async function start(): Promise<void> {
  const src = new URLSearchParams(location.search).get('src');
  if (src && (await openUrl(new URL(src, location.href).href))) return;
  // ?src= を読み込めなかったときも、前回の下書きか説明の資料を開く（読み込めなかった理由は残す）
  const failure = src ? notice.value : null;
  const settings = await getItem<GitHubSettings>('github');
  if (settings) github.value = new GitHubRepo(settings);
  const last = await getItem<LastDocument>('last');
  // 前回 GitHub の資料を開いていたら、GitHub から開き直す（つながらなければ、下書きを開く）
  const repo = github.value;
  if (!src && repo && last?.key.startsWith(`github:${repo.settings.repo}/`)) {
    if (await openGitHubFile(last.key.slice(`github:${repo.settings.repo}/`.length))) return;
    await openText({ kind: 'draft', name: last.name, key: last.key }, last.text, noAssets);
    notice.value = {
      text: `GitHub につながらないため、前回の下書き「${last.name}」を開きました。`,
    };
    return;
  }
  if (last && last.text !== SAMPLE) {
    await openText({ kind: 'draft', name: last.name, key: last.key }, last.text, noAssets);
    notice.value = failure ?? { text: `前回の下書き「${last.name}」を開きました。` };
    return;
  }
  await openText(doc.value, SAMPLE, noAssets);
  notice.value = failure;
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
      onCheatSheet: toggleCheatSheet,
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
    const stopViewport = followVisualViewport();
    return () => {
      stopViewport();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('dragover', dragover);
      window.removeEventListener('dragleave', dragleave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const r = result.value;
  const warnings: Diagnostic[] = r?.diagnostics.filter((d) => d.severity !== 'info') ?? [];
  return (
    <div class={`app${keyboard.value ? ' keyboard-open' : ''}`}>
      <header class="toolbar">
        <span class="brand">md2htmlSlides</span>
        <button
          type="button"
          class="narrow-only menu-button"
          aria-label="メニュー"
          aria-expanded={menuOpen.value}
          onClick={() => (menuOpen.value = !menuOpen.value)}
        >
          ≡
        </button>
        {canOpenFolder && (
          <button type="button" class="wide-only" onClick={() => void openFolder()}>
            フォルダを開く
          </button>
        )}
        <button type="button" class="wide-only" onClick={() => fileRef.current!.click()}>
          ファイルを開く
        </button>
        <button type="button" class="wide-only" onClick={askUrl}>
          URL を開く
        </button>
        <button type="button" class="wide-only" onClick={openGitHub}>
          GitHub
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
        <button type="button" class="save" onClick={() => void save()} title="Ctrl+S">
          {doc.value.kind === 'folder' || doc.value.kind === 'github' ? '保存' : 'ダウンロード'}
        </button>
        <button
          type="button"
          class="wide-only"
          onClick={() => void exportHtml()}
          title="素材を埋め込んだ HTML を1つ書き出す（ネットワークなしで開いて発表できる）"
        >
          HTML を書き出す
        </button>
        <span class="spacer" />
        {/* 狭い画面では、ここで2段目にする（#157） */}
        <span class="narrow-only row-break" />
        <div class="narrow-only pane-switch" role="group" aria-label="表示">
          <button
            type="button"
            aria-pressed={pane.value === 'edit'}
            onClick={() => showPane('edit')}
          >
            編集
          </button>
          <button
            type="button"
            aria-pressed={pane.value === 'preview'}
            onClick={() => showPane('preview')}
          >
            スライド
          </button>
        </div>
        <button
          type="button"
          class={cheatOpen.value ? 'active' : ''}
          title="Ctrl+/"
          onClick={toggleCheatSheet}
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
      {menuOpen.value && (
        <div
          class="menu narrow-only"
          role="menu"
          aria-label="メニュー"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button, a')) menuOpen.value = false;
          }}
        >
          {canOpenFolder && (
            <button type="button" role="menuitem" onClick={() => void openFolder()}>
              フォルダを開く
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => fileRef.current!.click()}>
            ファイルを開く
          </button>
          <button type="button" role="menuitem" onClick={askUrl}>
            URL を開く
          </button>
          <button type="button" role="menuitem" onClick={openGitHub}>
            GitHub
          </button>
          <button type="button" role="menuitem" onClick={() => void exportHtml()}>
            HTML を書き出す
          </button>
          <a
            role="menuitem"
            href="https://github.com/Nasu726/md2htmlSlides/blob/main/THIRD_PARTY_NOTICES.md"
            target="_blank"
            rel="noopener"
          >
            このアプリについて・ライセンス
          </a>
        </div>
      )}
      {notice.value && (
        <div class="notice" role="status">
          <span>{notice.value.text}</span>
          {notice.value.actions?.map((action) => (
            <button key={action.label} type="button" onClick={action.run}>
              {action.label}
            </button>
          ))}
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
      <main class={`workspace pane-${pane.value}${folder.value ? ' has-files' : ''}`}>
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
              <nav class="cheat-nav" aria-label="分類">
                {cheatGroups(CHEAT_ITEMS, cheatQuery.value).map(({ group, short }) => (
                  <button
                    key={group}
                    type="button"
                    title={group}
                    onClick={() =>
                      document
                        .querySelector(`.cheat-groups section[aria-label="${group}"]`)
                        ?.scrollIntoView({ block: 'start' })
                    }
                  >
                    {short}
                  </button>
                ))}
              </nav>
              <div class="cheat-groups">
                {cheatGroups(CHEAT_ITEMS, cheatQuery.value).map(({ group, items }) => (
                  <section key={group} aria-label={group}>
                    <h3>{group}</h3>
                    <ul>
                      {items.map((item) => (
                        <li key={item.code}>
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
                  </section>
                ))}
              </div>
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
        {r && <span class="muted wide-only">{Math.round(r.ms)} ms</span>}
        <span class="spacer" />
        <span class="muted wide-only">
          {doc.value.kind === 'folder'
            ? 'フォルダ'
            : doc.value.kind === 'github'
              ? `GitHub（${github.value?.settings.repo ?? ''}）`
              : doc.value.kind === 'url'
                ? 'URL（読み込みだけ）'
                : doc.value.kind === 'file'
                  ? 'ファイル（読み込みだけ）'
                  : '下書き'}
          ・自動で下書きを保存
        </span>
        <a
          class="muted wide-only"
          href="https://github.com/Nasu726/md2htmlSlides/blob/main/THIRD_PARTY_NOTICES.md"
          target="_blank"
          rel="noopener"
          data-testid="about"
        >
          このアプリについて・ライセンス
        </a>
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
      {githubOpen.value && (
        <div
          class="dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) githubOpen.value = false;
          }}
        >
          <div class="dialog" role="dialog" aria-label="GitHub">
            <header>
              <h2>GitHub のリポジトリ</h2>
              <button
                type="button"
                class="close"
                aria-label="閉じる"
                onClick={() => (githubOpen.value = false)}
              >
                ×
              </button>
            </header>
            {github.value ? (
              <>
                <p>
                  <b>{github.value.settings.repo}</b> の資料。保存すると、そのファイルを commit
                  します（どの端末からでも、同じ資料を開いて続きを編集できる）。
                </p>
                {githubDocs.value === null ? (
                  <p class="muted">{githubBusy.value ? '読み込み中…' : ''}</p>
                ) : githubDocs.value.length === 0 ? (
                  <p class="muted">.md のファイルはまだありません。</p>
                ) : (
                  <ul class="github-files" aria-label="資料">
                    {githubDocs.value.map((path) => (
                      <li key={path}>
                        <button type="button" onClick={() => void openGitHubFile(path)}>
                          {path}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {githubError.value && <p class="error">{githubError.value}</p>}
                <div class="dialog-actions">
                  <button type="button" class="primary" onClick={() => void saveAsGitHub()}>
                    今の資料を新しく保存
                  </button>
                  <span class="spacer" />
                  <button type="button" onClick={disconnectGitHub}>
                    つなぎを外す
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void connectGitHub(event.currentTarget);
                }}
              >
                <label>
                  リポジトリ
                  <input name="repo" placeholder="owner/name" required autoComplete="off" />
                </label>
                <label>
                  ブランチ（空なら既定のブランチ）
                  <input name="branch" autoComplete="off" />
                </label>
                <label>
                  トークン
                  <input name="token" type="password" required autoComplete="off" />
                </label>
                <details>
                  <summary>トークンの作り方</summary>
                  <ol>
                    <li>資料を置くリポジトリを作る（非公開でもよい）</li>
                    <li>
                      GitHub の
                      <a
                        href="https://github.com/settings/personal-access-tokens/new"
                        target="_blank"
                        rel="noopener"
                      >
                        Fine-grained token を作る画面
                      </a>
                      を開く
                    </li>
                    <li>
                      Repository access は「Only select repositories」で、そのリポジトリだけを選ぶ
                    </li>
                    <li>Permissions の「Contents」を「Read and write」にする</li>
                    <li>作ったトークンを、ここに貼る</li>
                  </ol>
                  <p class="muted">
                    トークンはこのブラウザにだけ保存し、api.github.com
                    にだけ送ります。ほかのリポジトリには書けません。
                  </p>
                </details>
                {githubError.value && <p class="error">{githubError.value}</p>}
                <div class="dialog-actions">
                  <button type="submit" class="primary" disabled={githubBusy.value}>
                    {githubBusy.value ? 'つないでいます…' : 'つなぐ'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {dragging.value && <div class="drop">ここに落とすと開きます（.md と画像・動画）</div>}
      <div class="hidden-frames" ref={hiddenRef} aria-hidden="true" />
    </div>
  );
}
