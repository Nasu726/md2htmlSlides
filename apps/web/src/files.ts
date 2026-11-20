/**
 * 資料を開く・保存する・書き出す（設計プラン §9.1。#171 で app.tsx から分けた）
 */
import { fileListSource, folderSource, noAssets, urlSource } from './assets.js';
import {
  describeFailure,
  fetchMarkdown,
  nameOf,
  toSourceUrl,
  type SourceUrl,
} from './source-url.js';
import { GitHubRepo, type GitHubSettings } from './github.js';
import { openGitHubFile, saveToGitHub } from './github-session.js';
import { SAMPLE } from './sample.js';
import { dirty, doc, folder, github, notice } from './state.js';
import { openText, renderer, text, whenRendered } from './session.js';
import { getItem, type LastDocument } from './storage.js';

/** ファイルを選んだ・落としたときの、一緒に選んだファイルの名前（`![](` の候補） */
let pickedFiles: string[] = [];

/** `![](` の候補：資料のフォルダからの相対パス */
export function assetCandidates(): string[] {
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

export async function openFolder(): Promise<void> {
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

export async function openFolderFile(path: string): Promise<void> {
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

export async function openFiles(files: File[]): Promise<void> {
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

export function askUrl(): void {
  const value = window.prompt('Markdown の URL（GitHub・Gist の画面の URL も、そのまま使えます）');
  if (!value?.trim()) return;
  const url = new URL(value.trim(), location.href).href;
  const next = new URL(location.href);
  next.searchParams.set('src', url);
  history.replaceState(null, '', next);
  void openUrl(url);
}

// ---- 保存：フォルダを開いていれば上書き、それ以外はダウンロード ----
export async function save(): Promise<void> {
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
export async function exportHtml(): Promise<void> {
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

export async function start(): Promise<void> {
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
