/** 画面の下の状態の行（枚数・警告・資料の種類・版） */
import { doc, github, result, showWarnings, VERSION_LABEL, warningsOf } from '../state.js';

export function StatusBar() {
  const r = result.value;
  const warnings = warningsOf(r);
  return (
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
      <span class="muted wide-only" data-testid="version">
        {VERSION_LABEL}
      </span>
    </footer>
  );
}
