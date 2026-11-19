import { VERSION } from '@mds/core';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { build, buildSingle, formatDiagnostic, sizeText } from './build.js';
import { startDev } from './dev.js';
import { pdf } from './pdf.js';

export {
  build,
  buildSingle,
  checkOverflow,
  formatDiagnostic,
  renderFile,
  type BuildResult,
  type SingleResult,
} from './build.js';
export { ChromiumMeasurer } from './measurer.js';
export { createAssets, type Assets } from './assets.js';
export { startDev, type DevServer } from './dev.js';
export { codeHighlighter, codeLanguages } from '@mds/embeds/highlight';
export { pdf, type PdfOptions, type PdfResult } from './pdf.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const HELP = `mds — Markdown から HTML スライドを作る

使い方:
  mds build <file.md> [-o <dir>]   静的な HTML を書き出す（既定の書き出し先は dist/）
        --no-measure               ヘッドレス Chromium での計測（自動分割と確認）を省く
        --single                   素材を埋め込んだ HTML を1つだけ書き出す（-o はファイル。
                                   既定は資料と同じ名前の .html）
        --video-limit <MB>         --single で、これより大きい動画は埋め込まない（既定は 10）
  mds pdf <file.md> [-o <file.pdf>]  PDF を書き出す（1スライド＝1ページ。既定は資料と同じ名前の .pdf）
        --steps                    段階的表示をステップごとのページにする（pdf: { steps: each } と同じ）
  mds dev <file.md> [-p <port>]    プレビューを開き、保存するたびに反映する（既定のポートは 3000）
        --host <host>              待ち受けるアドレス（既定は 127.0.0.1）
  mds --version                    バージョンを表示する
  mds --help                       このヘルプを表示する
`;

/** 入出力の口（テストで差し替える）。 */
export interface Io {
  out(text: string): void;
  err(text: string): void;
}

const defaultIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

/** ヘルプ・バージョン・不明なコマンドを扱う（副作用を持たない）。build と dev は main で扱う。 */
export function run(argv: readonly string[]): RunResult {
  const [command] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    return { code: 0, stdout: HELP, stderr: '' };
  }
  if (command === '--version' || command === '-v') {
    return { code: 0, stdout: `${VERSION}\n`, stderr: '' };
  }
  return { code: 1, stdout: '', stderr: `不明なコマンド: ${command}\n\n${HELP}` };
}

/** コマンドを実行して、終了コードを返す。dev はサーバーを止めるまで戻らない。 */
export async function main(argv: readonly string[], io: Io = defaultIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'build' && command !== 'dev' && command !== 'pdf') {
    const result = run(argv);
    io.out(result.stdout);
    io.err(result.stderr);
    return result.code;
  }

  let args: ReturnType<typeof parseCommand>;
  try {
    args = parseCommand(rest);
  } catch (error) {
    io.err(`mds ${command}: ${(error as Error).message}\n\n${HELP}`);
    return 1;
  }
  const file = args.positionals[0];
  if (!file) {
    io.err(`mds ${command}: Markdown のファイルを指定してください\n\n${HELP}`);
    return 1;
  }
  if (!existsSync(file)) {
    io.err(`mds ${command}: ファイルが見つかりません: ${file}\n`);
    return 1;
  }

  if (command === 'build' && args.values.single) {
    const started = performance.now();
    const limit = args.values['video-limit'];
    const videoLimit = limit === undefined ? undefined : Number(limit);
    if (videoLimit !== undefined && !(videoLimit >= 0)) {
      io.err(`mds build: --video-limit の値が正しくありません: ${limit}\n`);
      return 1;
    }
    const out = args.values.out ?? file.replace(/\.(md|markdown)$/i, '') + '.html';
    const result = await buildSingle(file, {
      out,
      measure: !args.values['no-measure'],
      ...(videoLimit !== undefined ? { videoLimit } : {}),
    });
    for (const diagnostic of result.diagnostics) io.err(`${formatDiagnostic(file, diagnostic)}\n`);
    if (result.measureError) io.err(`注意: ${result.measureError}。確認を省きました\n`);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    io.out(
      `✓ ${out}（${result.slides} 枚、${sizeText(result.bytes)}、素材 ${result.embedded.length} 個を埋め込み、${seconds} 秒）\n`,
    );
    const large = result.embedded.filter((e) => e.bytes >= 512 * 1024).slice(0, 3);
    if (large.length > 0) {
      io.out(`  大きい素材: ${large.map((e) => `${e.src}（${sizeText(e.bytes)}）`).join('、')}\n`);
    }
    return 0;
  }

  if (command === 'build') {
    const started = performance.now();
    const result = await build(file, {
      outDir: args.values.out ?? 'dist',
      measure: !args.values['no-measure'],
    });
    for (const diagnostic of result.diagnostics) io.err(`${formatDiagnostic(file, diagnostic)}\n`);
    if (result.measureError) io.err(`注意: ${result.measureError}。確認を省きました\n`);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const shown = relative(process.cwd(), result.index);
    const path = shown && !shown.startsWith('..') ? shown : result.index;
    io.out(`✓ ${path}（${result.slides} 枚、素材 ${result.assets} 個、${seconds} 秒）\n`);
    return 0;
  }

  if (command === 'pdf') {
    const started = performance.now();
    const out = args.values.out ?? file.replace(/\.(md|markdown)$/i, '') + '.pdf';
    const result = await pdf(file, {
      out,
      measure: !args.values['no-measure'],
      ...(args.values.steps ? { steps: true } : {}),
    });
    for (const diagnostic of result.diagnostics) io.err(`${formatDiagnostic(file, diagnostic)}\n`);
    if (result.error) {
      io.err(`mds pdf: ${result.error}\n`);
      return 1;
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const size = (result.bytes / 1024 / 1024).toFixed(1);
    io.out(`✓ ${out}（${result.pages} ページ、${size} MB、${seconds} 秒）\n`);
    return 0;
  }

  const port = args.values.port === undefined ? 3000 : Number(args.values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.err(`mds dev: ポートの番号が正しくありません: ${args.values.port}\n`);
    return 1;
  }
  const server = await startDev(file, {
    port,
    measure: !args.values['no-measure'],
    ...(args.values.host ? { host: args.values.host } : {}),
    log: (line) => io.out(`${line}\n`),
  });
  io.out(`プレビュー: ${server.url}\n発表の画面: ${server.url}present\n（Ctrl+C で止める）\n`);
  await new Promise<void>((done) => {
    const stop = () => void server.close().then(done);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

function parseCommand(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      'no-measure': { type: 'boolean' },
      single: { type: 'boolean' },
      'video-limit': { type: 'string' },
      steps: { type: 'boolean' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
    },
  });
}
