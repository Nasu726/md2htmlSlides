/** GitHub の画面（#147）：つなぐ・資料の一覧・新しく保存・つなぎを外す */
import {
  connectGitHub,
  disconnectGitHub,
  openGitHubFile,
  saveAsGitHub,
} from '../github-session.js';
import { github, githubBusy, githubDocs, githubError, githubOpen } from '../state.js';

export function GitHubDialog() {
  if (!githubOpen.value) return null;
  return (
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
                <li>Permissions は「Contents」の「Read and write」だけにする</li>
                <li>作ったトークンを、ここに貼る</li>
              </ol>
              <p class="muted">
                トークンはこのブラウザにだけ保存し、api.github.com
                にだけ送ります。エディタが書くのは、つないだリポジトリだけです。
                上のようにリポジトリと権限を絞っておくと、万一漏れても被害がそのリポジトリだけで済みます。
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
  );
}
