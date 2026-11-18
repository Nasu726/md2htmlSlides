import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeFailure,
  fetchMarkdown,
  HtmlResponse,
  HttpError,
  nameOf,
  NotAFileUrl,
  toSourceUrl,
} from './source-url.js';

describe('URL から開く（#90）', () => {
  it('GitHub の画面の URL（blob・raw）を、raw.githubusercontent.com に読み替える', () => {
    const raw = 'https://raw.githubusercontent.com/o/r/main/docs/slides.md';
    for (const input of [
      'https://github.com/o/r/blob/main/docs/slides.md',
      'https://github.com/o/r/blob/main/docs/slides.md?plain=1#L10',
      'https://github.com/o/r/raw/main/docs/slides.md',
      'https://www.github.com/o/r/blob/main/docs/slides.md',
    ]) {
      expect(toSourceUrl(input)).toEqual({ url: raw, base: raw });
    }
  });

  it('ブランチ名に / があっても、そのまま並べる（raw の URL も同じ並び）', () => {
    expect(toSourceUrl('https://github.com/o/r/blob/feature/x/a%20b.md').url).toBe(
      'https://raw.githubusercontent.com/o/r/feature/x/a%20b.md',
    );
  });

  it('画像などの相対パスは、読み替えた raw の URL を基準にする', () => {
    const { base } = toSourceUrl('https://github.com/o/r/blob/main/docs/slides.md');
    expect(new URL('img/a.png', base).href).toBe(
      'https://raw.githubusercontent.com/o/r/main/docs/img/a.png',
    );
  });

  it('Gist の画面の URL は、最初のファイルを読み、相対パスは同じ Gist のファイルにする', () => {
    const { url, base } = toSourceUrl('https://gist.github.com/someone/0123abcd#file-slides-md');
    expect(url).toBe('https://gist.githubusercontent.com/someone/0123abcd/raw');
    expect(new URL('logo.png', base).href).toBe(
      'https://gist.githubusercontent.com/someone/0123abcd/raw/logo.png',
    );
  });

  it('GitHub のフォルダ・リポジトリの URL は、md ファイルの URL を入れるよう伝える', () => {
    for (const input of ['https://github.com/o/r', 'https://github.com/o/r/tree/main/docs']) {
      expect(() => toSourceUrl(input)).toThrow(NotAFileUrl);
    }
  });

  it('ほかの URL は、そのまま（# より後ろは除く）', () => {
    const raw = 'https://raw.githubusercontent.com/o/r/main/a.md';
    expect(toSourceUrl(raw)).toEqual({ url: raw, base: raw });
    expect(toSourceUrl('https://example.com/a.md?v=1#top').url).toBe(
      'https://example.com/a.md?v=1',
    );
  });

  it('保存するときの名前は URL の最後。md でなければ slides.md', () => {
    expect(nameOf('https://raw.githubusercontent.com/o/r/main/%E8%AC%9B%E7%BE%A9.md')).toBe(
      '講義.md',
    );
    expect(nameOf('https://gist.githubusercontent.com/someone/0123abcd/raw')).toBe('slides.md');
  });

  it('失敗の理由ごとに、どうすればよいかを伝える', () => {
    const url = 'https://example.com/a.md';
    expect(describeFailure(url, new HttpError(404))).toContain('公開されているか');
    expect(describeFailure(url, new HtmlResponse())).toContain('Web ページ（HTML）');
    expect(describeFailure(url, new TypeError('Failed to fetch'))).toContain('CORS');
  });
});

describe('md を読み込む（#90）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stub = (body: string, init: ResponseInit) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, init)),
    );

  it('本文を返す。見つからなければ HttpError', async () => {
    stub('# a', { headers: { 'content-type': 'text/plain' } });
    await expect(fetchMarkdown('https://example.com/a.md')).resolves.toBe('# a');
    stub('Not Found', { status: 404 });
    await expect(fetchMarkdown('https://example.com/a.md')).rejects.toBeInstanceOf(HttpError);
  });

  it('Web ページ（HTML）が返ったら、md ではないので失敗にする', async () => {
    stub('<!DOCTYPE html><html><body>GitHub</body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    await expect(fetchMarkdown('https://example.com/a')).rejects.toBeInstanceOf(HtmlResponse);
    // HTML と名乗っていても、md の本文なら読む（設定の誤ったサーバー）
    stub('# 見出し\n\n<b>強調</b>', { headers: { 'content-type': 'text/html' } });
    await expect(fetchMarkdown('https://example.com/a.md')).resolves.toContain('# 見出し');
  });
});
