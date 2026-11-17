/**
 * Web エディタ（#73、設計プラン §9）のビルド設定。
 *
 * - 同梱するフォント（#67 と同じ fontsource の分割ファイル）を `fonts/` に置き、一覧を
 *   `virtual:mds-fonts` から読めるようにする。プレビューの iframe には、エディタが読み込んだ
 *   フォントのデータを渡す（隔離した iframe からは Service Worker のキャッシュを使えないため）
 * - オフラインでも使えるよう、Service Worker（`sw.js`）を書き出す（§9.5）
 * - GitHub Pages のどの場所に置いても動くよう、パスは相対にする（base: './'）
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** テーマが使う書体（@mds/themes の BUNDLED_FONTS と同じ） */
const FONT_PACKAGES = [
  { family: 'MDS Inter', package: '@fontsource-variable/inter' },
  { family: 'MDS Noto Sans JP', package: '@fontsource-variable/noto-sans-jp' },
  { family: 'MDS JetBrains Mono', package: '@fontsource-variable/jetbrains-mono' },
];

interface FontFile {
  family: string;
  weight: string;
  range: string;
  /** 公開する場所（`fonts/inter/files/….woff2`） */
  url: string;
  file: string;
}

function fontFiles(): FontFile[] {
  return FONT_PACKAGES.flatMap(({ family, package: pkg }) => {
    const cssFile = require.resolve(`${pkg}/wght.css`);
    const css = readFileSync(cssFile, 'utf8');
    return Array.from(css.matchAll(/@font-face\s*\{([^}]*)\}/g), (m): FontFile | undefined => {
      const body = m[1]!;
      if (/font-style:\s*italic/.test(body)) return undefined;
      const path = /url\(\.\/([^)]+\.woff2)\)/.exec(body)?.[1];
      if (!path) return undefined;
      return {
        family,
        weight: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '100 900',
        range: /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'U+0-10FFFF',
        url: `fonts/${pkg.replace(/^@fontsource-variable\//, '')}/${path}`,
        file: join(dirname(cssFile), path),
      };
    }).filter((face): face is FontFile => face !== undefined);
  });
}

/** フォントの一覧（virtual:mds-fonts）と、フォントのファイル */
function mdsFonts(): Plugin {
  const id = 'virtual:mds-fonts';
  const files = fontFiles();
  return {
    name: 'mds-fonts',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loaded) {
      if (loaded !== `\0${id}`) return undefined;
      const faces = files.map(({ family, weight, range, url }) => ({ family, weight, range, url }));
      return `export default ${JSON.stringify(faces)};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''));
        const face = files.find((f) => f.url === path);
        if (!face) return next();
        res.setHeader('content-type', 'font/woff2');
        res.end(readFileSync(face.file));
      });
    },
    generateBundle() {
      for (const face of files) {
        this.emitFile({ type: 'asset', fileName: face.url, source: readFileSync(face.file) });
      }
    },
  };
}

/**
 * Service Worker を書き出す。アプリの本体は最初に全部キャッシュし、フォントは使ったものだけを
 * キャッシュする。キャッシュの名前はファイルの一覧から作るので、ビルドし直すと入れ替わる。
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mds-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? walk(path) : [path];
        });
      const files = walk(outDir)
        .map((path) => relative(outDir, path).split('\\').join('/'))
        .filter((path) => !path.startsWith('fonts/') && path !== 'sw.js')
        .sort();
      const hash = createHash('sha256');
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)));
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync(src('./src/sw.js'), 'utf8');
      writeFileSync(
        join(outDir, 'sw.js'),
        template
          .replace("'__VERSION__'", JSON.stringify(version))
          .replace("['__FILES__']", JSON.stringify(['./', ...files])),
      );
    },
  };
}

/**
 * BudouX（見出しの文節改行）は、ブラウザでは linkedom を使わない版（dom-browser.js）を使う。
 * package.json の browser フィールドで差し替える指定だが、ここでは効かないので、自分で差し替える
 */
function budouxBrowser(): Plugin {
  return {
    name: 'mds-budoux-browser',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './dom.js' && importer && /[\\/]budoux[\\/]module[\\/]/.test(importer)) {
        return join(dirname(importer), 'dom-browser.js');
      }
      return undefined;
    },
  };
}

export default defineConfig({
  base: './',
  resolve: {
    // ビルドせずに、各パッケージのソースを直接読む（tsc の出力を待たずに済む）
    alias: {
      '@mds/core': src('../../packages/core/src/index.ts'),
      '@mds/runtime': src('../../packages/runtime/src/index.ts'),
      '@mds/themes': src('../../packages/themes/src/index.ts'),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [budouxBrowser(), mdsFonts(), serviceWorker()],
});
