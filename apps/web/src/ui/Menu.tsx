/** スマホの「≡」のメニュー（#154） */
import { askUrl, exportHtml, openFolder } from '../files.js';
import { openGitHub } from '../github-session.js';
import { canOpenFolder, menuOpen, VERSION_LABEL } from '../state.js';
import { pickFiles } from './Toolbar.js';

export function Menu() {
  if (!menuOpen.value) return null;
  return (
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
      <button type="button" role="menuitem" onClick={pickFiles}>
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
      <p class="menu-version">{VERSION_LABEL}</p>
    </div>
  );
}
