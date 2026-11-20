/**
 * GitHub のリポジトリに置く（#147、設計プラン §9.1。#171 で app.tsx から分けた）：つなぐ・一覧・開く・保存
 */
import {
  GitHubConflict,
  GitHubRepo,
  githubSource,
  parseRepo,
  type GitHubSettings,
} from './github.js';
import { openText, rememberLast, text } from './session.js';
import {
  dirty,
  doc,
  folder,
  github,
  githubBusy,
  githubDocs,
  githubError,
  githubOpen,
  notice,
} from './state.js';
import { removeItem, setItem } from './storage.js';

/** 開いている GitHub の資料の、読み込んだとき（保存したとき）の sha。保存するときに、変わっていないかを確かめる */
let githubSha: string | undefined;

// ---- GitHub のリポジトリに置く（#147、設計プラン §9.1） ----
const githubKey = (repo: GitHubRepo, path: string) => `github:${repo.settings.repo}/${path}`;

/** GitHub の画面を開く。つないでいれば、資料の一覧を読み込む */
export function openGitHub(): void {
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
export async function connectGitHub(form: HTMLFormElement): Promise<void> {
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
export function disconnectGitHub(): void {
  github.value = null;
  githubDocs.value = null;
  void removeItem('github');
  if (doc.value.kind === 'github') doc.value = { ...doc.value, kind: 'draft' };
}

export async function openGitHubFile(path: string): Promise<boolean> {
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
export async function saveToGitHub(force = false): Promise<void> {
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
export async function saveAsGitHub(): Promise<void> {
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
