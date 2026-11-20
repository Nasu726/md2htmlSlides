/** 画面の上のお知らせ（操作のボタンを付けられる） */
import { notice } from '../state.js';

export function NoticeBar() {
  if (!notice.value) return null;
  return (
    <div class="notice" role="status">
      <span>{notice.value.text}</span>
      {notice.value.actions?.map((action) => (
        <button key={action.label} type="button" onClick={action.run}>
          {action.label}
        </button>
      ))}
      <button type="button" class="close" aria-label="閉じる" onClick={() => (notice.value = null)}>
        ×
      </button>
    </div>
  );
}
