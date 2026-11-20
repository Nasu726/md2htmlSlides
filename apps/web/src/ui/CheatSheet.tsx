/** 早見表（#75・#99）：書き方を探して、カーソルの位置に入れる */
import { insertSnippet } from '../assist.js';
import { cheatGroups, cheatSheet, type CheatItem } from '../cheatsheet.js';
import { showPane } from '../mobile.js';
import { editor } from '../session.js';
import { cheatOpen, cheatQuery, isNarrow, pane } from '../state.js';

const CHEAT_ITEMS: CheatItem[] = cheatSheet();
/** 早見表の項目を、カーソルの位置（選んでいる範囲）に入れる */
function insertCheat(item: CheatItem): void {
  const { from, to } = editor.view.state.selection.main;
  insertSnippet(editor.view, item.snippet, from, to);
  // 狭い画面では、早見表はスライドの側に重ねて出すので、入れたら編集に戻る（#154）
  if (isNarrow()) {
    cheatOpen.value = false;
    pane.value = 'edit';
  }
  editor.view.focus();
}

/** 早見表を開く・閉じる。狭い画面では、スライドの側に重ねて出す（#154） */
export function toggleCheatSheet(): void {
  cheatOpen.value = !cheatOpen.value;
  if (cheatOpen.value && isNarrow()) showPane('preview');
}

export function CheatSheet() {
  if (!cheatOpen.value) return null;
  return (
    <aside class="cheatsheet" aria-label="早見表">
      <header>
        <h2>早見表</h2>
        <button
          type="button"
          class="close"
          aria-label="閉じる"
          onClick={() => (cheatOpen.value = false)}
        >
          ×
        </button>
      </header>
      <input
        type="search"
        placeholder="探す（例：横・背景・段階）"
        value={cheatQuery.value}
        onInput={(event) => (cheatQuery.value = event.currentTarget.value)}
      />
      <nav class="cheat-nav" aria-label="分類">
        {cheatGroups(CHEAT_ITEMS, cheatQuery.value).map(({ group, short }) => (
          <button
            key={group}
            type="button"
            title={group}
            onClick={() =>
              document
                .querySelector(`.cheat-groups section[aria-label="${group}"]`)
                ?.scrollIntoView({ block: 'start' })
            }
          >
            {short}
          </button>
        ))}
      </nav>
      <div class="cheat-groups">
        {cheatGroups(CHEAT_ITEMS, cheatQuery.value).map(({ group, items }) => (
          <section key={group} aria-label={group}>
            <h3>{group}</h3>
            <ul>
              {items.map((item) => (
                <li key={item.code}>
                  <div>
                    <b>{item.label}</b>
                    <code>{item.code}</code>
                  </div>
                  <button type="button" onClick={() => insertCheat(item)}>
                    挿入
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p class="muted">項目を選ぶと、カーソルの位置に入れる</p>
    </aside>
  );
}
