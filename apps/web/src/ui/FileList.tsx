/** 開いたフォルダの中の資料の一覧（パソコン） */
import { openFolderFile } from '../files.js';
import { doc, folder } from '../state.js';

export function FileList() {
  if (!folder.value) return null;
  return (
    <nav class="files" aria-label="ファイル">
      <h2>{folder.value.name}</h2>
      <ul>
        {folder.value.documents.map((path) => (
          <li key={path}>
            <button
              type="button"
              class={doc.value.path === path ? 'current' : ''}
              onClick={() => void openFolderFile(path)}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
