/**
 * GitHub のリポジトリに資料を置く（#147、設計プラン §9.1）。
 * サーバーを持たず、ブラウザから GitHub の REST API（api.github.com）を直接呼ぶ。
 * トークン（fine-grained の PAT）はそのブラウザの IndexedDB にだけ置き、api.github.com にだけ送る。
 */
import { normalizePath, type AssetSource } from './assets.js';

export interface GitHubSettings {
  /** `owner/name` */
  repo: string;
  /** 空なら、リポジトリの既定のブランチ */
  branch?: string;
  token: string;
}

export interface RepoFile {
  path: string;
  size: number;
}

/** GitHub の API が失敗した。status は HTTP の状態（ネットワークの失敗は 0） */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 先にほかの端末で保存されていた（読み込んだ後に、GitHub のファイルが変わっていた） */
export class GitHubConflict extends GitHubError {}

const API = 'https://api.github.com';
const DOCUMENT = /\.(md|markdown)$/i;

/** `owner/name` の形か（GitHub の URL を貼っても読み取る） */
export function parseRepo(input: string): string | undefined {
  const value = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(value) ? value : undefined;
}

/** パスの各部分を、URL に入れられる形にする（`/` は残す） */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** UTF-8 の文字列 ⇔ base64（API はファイルの中身を base64 でやりとりする） */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
export function fromBase64(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** 失敗した理由を、作者向けの文にする */
function describe(status: number, what: string): string {
  if (status === 401) return 'トークンが正しくないか、期限が切れています';
  if (status === 403)
    return `${what}の権限がありません（トークンの「Contents」を「Read and write」にしてください。または API の回数の上限です）`;
  if (status === 404)
    return `${what}が見つかりません（リポジトリの名前と、トークンにそのリポジトリへのアクセスを与えたかを確かめてください）`;
  if (status === 0) return 'GitHub につながりません（オフラインかもしれません）';
  return `GitHub が失敗を返しました（${status}）`;
}

export class GitHubRepo {
  private resolvedBranch: string | undefined;

  constructor(
    readonly settings: GitHubSettings,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.resolvedBranch = settings.branch || undefined;
  }

  private async request(path: string, what: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(`${API}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.settings.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...init.headers,
        },
      });
    } catch {
      throw new GitHubError(describe(0, what), 0);
    }
    if (response.status === 409 || (response.status === 422 && init.method === 'PUT')) {
      throw new GitHubConflict('ほかの端末で先に保存されています', response.status);
    }
    if (!response.ok) throw new GitHubError(describe(response.status, what), response.status);
    return response;
  }

  /** 使うブランチ（指定がなければ、リポジトリの既定のブランチ） */
  async branch(): Promise<string> {
    if (!this.resolvedBranch) {
      const response = await this.request(`/repos/${this.settings.repo}`, 'リポジトリ');
      this.resolvedBranch = ((await response.json()) as { default_branch: string }).default_branch;
    }
    return this.resolvedBranch;
  }

  /** リポジトリの中のファイル（すべて。資料は documents で絞る） */
  async files(): Promise<RepoFile[]> {
    const branch = await this.branch();
    const response = await this.request(
      `/repos/${this.settings.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      'ブランチ',
    );
    const tree = (await response.json()) as {
      tree: Array<{ path: string; type: string; size?: number }>;
    };
    return tree.tree
      .filter((entry) => entry.type === 'blob')
      .map((entry) => ({ path: entry.path, size: entry.size ?? 0 }));
  }

  /** 資料（.md）のパス */
  static documents(files: RepoFile[]): string[] {
    return files
      .map((file) => file.path)
      .filter((path) => DOCUMENT.test(path))
      .sort();
  }

  /** 資料を読む。sha は、保存するときに「読み込んだ後に変わっていないか」を確かめるのに使う */
  async read(path: string): Promise<{ text: string; sha: string }> {
    const branch = await this.branch();
    const response = await this.request(
      `/repos/${this.settings.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      'ファイル',
    );
    const file = (await response.json()) as { content?: string; encoding?: string; sha: string };
    if (file.encoding === 'base64' && file.content !== undefined) {
      return { text: fromBase64(file.content), sha: file.sha };
    }
    // 1 MB を超えるファイルは、中身が入っていないので、そのまま読み直す
    const blob = await this.readBlob(path);
    return { text: (await blob?.text()) ?? '', sha: file.sha };
  }

  /** 画像・動画などを読む。なければ undefined */
  async readBlob(path: string): Promise<Blob | undefined> {
    const branch = await this.branch();
    try {
      const response = await this.request(
        `/repos/${this.settings.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
        'ファイル',
        { headers: { Accept: 'application/vnd.github.raw' } },
      );
      return await response.blob();
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return undefined;
      throw error;
    }
  }

  /**
   * 資料を保存する（commit する）。sha は読み込んだときのもの（新しいファイルなら undefined）。
   * 読み込んだ後にほかの端末で保存されていたら GitHubConflict。新しい sha を返す
   */
  async write(
    path: string,
    text: string,
    sha: string | undefined,
    message: string,
  ): Promise<string> {
    const branch = await this.branch();
    const response = await this.request(
      `/repos/${this.settings.repo}/contents/${encodePath(path)}`,
      'ファイル',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: toBase64(text), branch, ...(sha ? { sha } : {}) }),
      },
    );
    return ((await response.json()) as { content: { sha: string } }).content.sha;
  }

  /** 今の GitHub のファイルの sha（なければ undefined）。「上書きする」ときに使う */
  async currentSha(path: string): Promise<string | undefined> {
    try {
      return (await this.read(path)).sha;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return undefined;
      throw error;
    }
  }
}

/** GitHub の資料の素材：資料のフォルダからの相対パスを、リポジトリから読む（非公開のリポジトリでも） */
export function githubSource(repo: GitHubRepo, mdPath: string): AssetSource {
  const dir = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/') + 1) : '';
  return {
    read: (path) => repo.readBlob(normalizePath(dir + path)),
  };
}
