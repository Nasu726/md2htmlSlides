export type Severity = 'error' | 'warning' | 'info';

/** エディタの警告・CLI の `mds check` に出す指摘。 */
export interface Diagnostic {
  severity: Severity;
  /** 機械で扱うための識別子（例：'frontmatter/unknown-key'） */
  code: string;
  /** 作者向けの説明 */
  message: string;
  /** 1 から始まる、元のファイルでの行番号 */
  line: number;
  /** 修正の候補（例：'layout'）。エディタの「直す」ボタンに使う */
  suggestion?: string;
}
