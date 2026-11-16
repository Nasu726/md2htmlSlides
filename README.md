# md2htmlSlides

Markdown を書くだけで、区切り・配置・デザインが自動で整った HTML スライドを作り、そのまま発表できるアプリ（趣味の個人開発・開発中）。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [仕様書（What / Why）](docs/requirements.md) | 何を、なぜ作るか |
| [設計プラン](docs/design.md) | どう作るか。未決事項への回答、生成パイプライン、自動分割・自動レイアウト、スライドショー、ロードマップ |
| [構文仕様 v0.1](docs/syntax.md) | スライド用 Markdown の書き方 |
| [サンプル資料](examples/demo.md) | 構文を一通り使った例 |
| [テスト用の資料](fixtures/README.md) | 観点ごとのテスト用 Markdown と、期待する結果 |
| [開発の進め方](CONTRIBUTING.md) | issue・ブランチ・PR の決まり |

## 使い方（開発中）

```sh
pnpm install && pnpm build
node apps/cli/dist/bin.js dev deck.md            # プレビュー（保存するたびに反映）
node apps/cli/dist/bin.js build deck.md -o dist  # dist/index.html を書き出す
```

| 画面 | 内容 |
|---|---|
| プレビュー `http://127.0.0.1:3000/` | スライドを縦に並べて表示する。収まらないスライドには赤い点線、警告は右下に一覧で出す |
| 発表の画面 `http://127.0.0.1:3000/present` | 書き出した HTML と同じ。→ / ← で送り、F で全画面、? でキー操作の一覧 |

書き出した `dist/` は、`index.html` をブラウザで開くだけで発表できる（`file://` でも動く）。`build` はヘッドレス Chromium で開いて、収まらないスライドを確かめる（Chromium がなければ確認を省く。`npx playwright install chromium` で入れられる）。

## 開発

必要なもの：Node.js 22 以上、pnpm（`corepack enable` で使えるようになる）

| コマンド | 内容 |
|---|---|
| `pnpm install` | 依存関係を入れる |
| `pnpm build` | 型チェックとビルド（TypeScript） |
| `pnpm test` | 単体テスト（Vitest） |
| `pnpm test:e2e` | ブラウザでのテスト（Playwright）。初回は `pnpm exec playwright install chromium` |
| `pnpm lint` | ESLint と Prettier の確認 |
| `pnpm format` | Prettier で整形する |

| ディレクトリ | 内容 |
|---|---|
| `packages/core` | パース・分割・レイアウト・描画（DOM に依存しない） |
| `packages/runtime` | 発表用のプレイヤー |
| `packages/themes` | テーマ（clean / dark / bold） |
| `apps/cli` | コマンドライン `mds` |
| `e2e/` | ブラウザでのテスト |
