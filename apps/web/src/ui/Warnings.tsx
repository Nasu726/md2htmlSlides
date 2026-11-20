/** 警告の一覧（行を押すと、その行に移る） */
import { jumpTo } from '../session.js';
import { result, showWarnings, warningsOf } from '../state.js';

export function Warnings() {
  const warnings = warningsOf(result.value);
  if (!(showWarnings.value && warnings.length > 0)) return null;
  return (
    <div class="warnings" role="dialog" aria-label="警告">
      <ul>
        {warnings.map((d, i) => (
          <li key={i}>
            <button type="button" onClick={() => jumpTo(d.line)}>
              <b>{d.line} 行</b> {d.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
