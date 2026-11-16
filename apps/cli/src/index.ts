import { VERSION } from '@mds/core';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const HELP = `mds — Markdown から HTML スライドを作る

使い方:
  mds build <file.md> [-o <dir>]   静的な HTML を書き出す（#20 で実装）
  mds dev <file.md>                プレビューを開き、変更を自動で反映する（#20 で実装）
  mds --version                    バージョンを表示する
  mds --help                       このヘルプを表示する
`;

/** 引数を受け取り、終了コードと出力を返す（テストしやすいように副作用を持たない）。 */
export function run(argv: readonly string[]): RunResult {
  const [command] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    return { code: 0, stdout: HELP, stderr: '' };
  }
  if (command === '--version' || command === '-v') {
    return { code: 0, stdout: `${VERSION}\n`, stderr: '' };
  }
  if (command === 'build' || command === 'dev') {
    return { code: 1, stdout: '', stderr: `mds ${command}: まだ実装されていません（#20）\n` };
  }
  return { code: 1, stdout: '', stderr: `不明なコマンド: ${command}\n\n${HELP}` };
}
