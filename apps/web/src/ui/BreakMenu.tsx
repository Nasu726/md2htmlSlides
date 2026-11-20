/** 自動で区切られた位置のメニュー（#74）：区切りを固定する・1枚にまとめる */
import { editor } from '../session.js';
import { fixBreak, keepSection } from '../slide-gutter.js';
import { breakMenu } from '../state.js';

export function BreakMenu() {
  if (!breakMenu.value) return null;
  return (
    <div
      class="break-menu"
      role="menu"
      style={{ left: `${breakMenu.value.x}px`, top: `${breakMenu.value.y}px` }}
    >
      <p>自動で区切られた位置</p>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          fixBreak(editor.view, breakMenu.value!.line);
          breakMenu.value = null;
        }}
      >
        ここで区切りを固定（<code>---</code> を入れる）
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          keepSection(editor.view, breakMenu.value!.line);
          breakMenu.value = null;
        }}
      >
        1枚にまとめる（<code>{'{keep}'}</code> を付ける）
      </button>
      <button type="button" class="cancel" onClick={() => (breakMenu.value = null)}>
        閉じる
      </button>
    </div>
  );
}
