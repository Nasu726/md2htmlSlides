/** ツールバー（パソコンは1段、スマホは2段。#154・#157） */
import { createRef } from 'preact';
import { askUrl, exportHtml, openFiles, openFolder, save } from '../files.js';
import { openGitHub } from '../github-session.js';
import { showPane } from '../mobile.js';
import { present } from '../present.js';
import { canOpenFolder, cheatOpen, dirty, doc, menuOpen, pane } from '../state.js';
import { toggleCheatSheet } from './CheatSheet.js';

/** ファイルを選ぶ欄（見えない）。ツールバーとメニューの「ファイルを開く」で開く */
const fileInput = createRef<HTMLInputElement>();
export const pickFiles = () => fileInput.current?.click();

export function Toolbar() {
  return (
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
      <button type="button" class="wide-only" onClick={pickFiles}>
        ファイルを開く
      </button>
      <button type="button" class="wide-only" onClick={askUrl}>
        URL を開く
      </button>
      <button type="button" class="wide-only" onClick={openGitHub}>
        GitHub
      </button>
      <input
        ref={fileInput}
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
        <button type="button" aria-pressed={pane.value === 'edit'} onClick={() => showPane('edit')}>
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
  );
}
