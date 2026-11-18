/**
 * `?src=URL`・「URL から開く」で受け取った URL を、読み込める URL に直す（#90）。
 *
 * GitHub の画面の URL（`github.com/…/blob/…`）は HTML を返し、CORS も許していないので、
 * ブラウザからは読めない。本文を返し CORS を許している raw の URL に読み替える。
 */
export interface SourceUrl {
  /** md を読み込む URL */
  url: string;
  /** 画像などの相対パスの基準 */
  base: string;
}

/** GitHub のフォルダ・リポジトリの URL など、md ファイルを指していない URL */
export class NotAFileUrl extends Error {}

export function toSourceUrl(input: string): SourceUrl {
  const url = new URL(input);
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    // /{owner}/{repo}/blob/{ref}/{path} と /{owner}/{repo}/raw/{ref}/{path}
    // （ブランチ名に / が入ることがあるが、raw の URL でも同じ並びなので、分けずにそのまま渡す）
    const match = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
    if (match) {
      const raw = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
      return { url: raw, base: raw };
    }
    throw new NotAFileUrl(
      'GitHub のフォルダかリポジトリの URL です。開きたい md ファイルを GitHub で開き、その画面の URL を入れてください。',
    );
  }
  if (url.hostname === 'gist.github.com') {
    // /{user}/{id}：最初のファイルを読む。相対パスは同じ gist のファイル
    const match = /^\/([^/]+)\/([0-9a-f]+)\/?$/i.exec(url.pathname);
    if (match) {
      const raw = `https://gist.githubusercontent.com/${match[1]}/${match[2]}/raw`;
      return { url: raw, base: `${raw}/` };
    }
  }
  url.hash = '';
  return { url: url.href, base: url.href };
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** md ではなく、Web ページ（HTML）が返った */
export class HtmlResponse extends Error {}

/** 読み込めなかった理由と、どうすればよいか */
export function describeFailure(url: string, cause: unknown): string {
  if (cause instanceof NotAFileUrl) return cause.message;
  if (cause instanceof HttpError) {
    if (cause.status === 404) {
      return `見つかりませんでした（404）：${url}。URL と、リポジトリが公開されているかを確かめてください（非公開のリポジトリは読み込めません）。`;
    }
    return `読み込めませんでした（${cause.status}）：${url}`;
  }
  if (cause instanceof HtmlResponse) {
    return `Markdown ではなく Web ページ（HTML）が返りました：${url}。ファイルの中身そのものを返す URL（GitHub なら raw）を入れてください。`;
  }
  // fetch が投げる TypeError は、ネットワークに届かないか、そのサイトが CORS で読み込みを許していないとき
  return `読み込めませんでした：${url}。そのサイトが、ほかのサイトからの読み込みを許していない（CORS）か、ネットワークにつながっていません（GitHub・Gist の URL はそのまま使えます）。`;
}

/** md を読み込む。HTML の画面が返ったら（md ではないので）失敗にする */
export async function fetchMarkdown(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new HttpError(response.status);
  const type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (type.includes('text/html') && /^\s*<(!doctype html|html)[\s>]/i.test(text)) {
    throw new HtmlResponse();
  }
  return text;
}

/** 開いた資料の名前（ダウンロードで保存するときのファイル名） */
export function nameOf(url: string): string {
  const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  return /\.(md|markdown|txt)$/i.test(last) ? last : 'slides.md';
}
