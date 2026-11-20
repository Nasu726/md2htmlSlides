import { describe, expect, it } from 'vitest';
import {
  GitHubConflict,
  GitHubError,
  GitHubRepo,
  fromBase64,
  githubSource,
  parseRepo,
  toBase64,
} from './github.js';

/** GitHub の API を真似る（ファイルの中身と sha を持ち、sha が違えば保存を断る） */
function fakeGitHub(initial: Record<string, string | Uint8Array>) {
  const files = new Map<string, { body: Uint8Array; sha: string }>();
  let version = 0;
  const put = (path: string, body: string | Uint8Array) =>
    files.set(path, {
      body: typeof body === 'string' ? new TextEncoder().encode(body) : body,
      sha: `sha${++version}`,
    });
  for (const [path, body] of Object.entries(initial)) put(path, body);
  const requests: Array<{ url: string; method: string; auth: string | null }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = init.method ?? 'GET';
    requests.push({ url: url.href, method, auth: headers.get('Authorization') });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.pathname === '/repos/me/slides') return json(200, { default_branch: 'main' });
    if (url.pathname === '/repos/me/slides/git/trees/main') {
      return json(200, {
        tree: [...files].map(([path, f]) => ({ path, type: 'blob', size: f.body.length })),
      });
    }
    const path = decodeURIComponent(url.pathname.replace('/repos/me/slides/contents/', ''));
    const file = files.get(path);
    if (method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { content: string; sha?: string };
      if (file && body.sha !== file.sha) return json(409, { message: 'conflict' });
      put(
        path,
        Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)),
      );
      return json(200, { content: { sha: files.get(path)!.sha } });
    }
    if (!file) return json(404, { message: 'Not Found' });
    if (headers.get('Accept') === 'application/vnd.github.raw') return new Response(file.body);
    let binary = '';
    for (const byte of file.body) binary += String.fromCharCode(byte);
    return json(200, { content: btoa(binary), encoding: 'base64', sha: file.sha });
  };
  return { files, requests, fetcher, put };
}

const settings = { repo: 'me/slides', token: 'test-token' };

describe('GitHub に置く（#147）', () => {
  it('リポジトリの名前は owner/name。GitHub の URL を貼ってもよい', () => {
    expect(parseRepo('me/slides')).toBe('me/slides');
    expect(parseRepo('https://github.com/me/slides.git')).toBe('me/slides');
    expect(parseRepo('https://github.com/me/slides/')).toBe('me/slides');
    expect(parseRepo('slides')).toBeUndefined();
  });

  it('日本語を含む中身を base64 で行き来できる', () => {
    const text = '# 発表\n\n- 項目 😀\n'.repeat(5000);
    expect(fromBase64(toBase64(text))).toBe(text);
  });

  it('資料の一覧・読み込み・保存。リクエストは api.github.com だけで、トークンを付ける', async () => {
    const gh = fakeGitHub({ 'talks/a.md': '# A', 'talks/img/x.png': new Uint8Array([1, 2]) });
    const repo = new GitHubRepo(settings, gh.fetcher);
    expect(GitHubRepo.documents(await repo.files())).toEqual(['talks/a.md']);
    const { text, sha } = await repo.read('talks/a.md');
    expect(text).toBe('# A');
    const next = await repo.write('talks/a.md', '# A 改', sha, 'mdhs: talks/a.md を更新');
    expect(next).not.toBe(sha);
    expect((await repo.read('talks/a.md')).text).toBe('# A 改');
    for (const request of gh.requests) {
      expect(new URL(request.url).origin).toBe('https://api.github.com');
      expect(request.auth).toBe('Bearer test-token');
    }
  });

  it('読み込んだ後にほかの端末で保存されていたら、上書きせずに GitHubConflict', async () => {
    const gh = fakeGitHub({ 'a.md': '1' });
    const repo = new GitHubRepo(settings, gh.fetcher);
    const { sha } = await repo.read('a.md');
    gh.put('a.md', 'ほかの端末で保存'); // 端末 B が先に保存した
    await expect(repo.write('a.md', '端末 A', sha, 'm')).rejects.toBeInstanceOf(GitHubConflict);
    expect((await repo.read('a.md')).text).toBe('ほかの端末で保存');
    // 「上書きする」：今の sha で保存し直す
    await repo.write('a.md', '端末 A', await repo.currentSha('a.md'), 'm');
    expect((await repo.read('a.md')).text).toBe('端末 A');
  });

  it('失敗の理由を、直し方の分かる文にする', async () => {
    const repo = new GitHubRepo(settings, async () => new Response('', { status: 401 }));
    await expect(repo.files()).rejects.toThrow('トークンが正しくないか、期限が切れています');
    const offline = new GitHubRepo(settings, async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.files()).rejects.toMatchObject({
      status: 0,
    } satisfies Partial<GitHubError>);
  });

  it('素材は、資料のフォルダからの相対パスでリポジトリから読む。なければ undefined', async () => {
    const gh = fakeGitHub({ 'talks/a.md': '', 'talks/img/x.png': new Uint8Array([1, 2, 3]) });
    const source = githubSource(new GitHubRepo(settings, gh.fetcher), 'talks/a.md');
    expect((await source.read('./img/x.png'))?.size).toBe(3);
    expect(await source.read('img/none.png')).toBeUndefined();
  });
});
