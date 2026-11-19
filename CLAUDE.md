# AI エージェント向けの指示

このリポジトリで作業する AI エージェントは、[CONTRIBUTING.md](./CONTRIBUTING.md) の進め方に従う。特に次の点を守る。

## 進め方

- 作業を始める前に、対応する issue があるか確認する。なければ先に issue を立てる（テンプレートを使う）。
- ブランチ名は `<種類>/<issue番号>-<英語の短い説明>`（例：`feature/13-parser-ir`）。実行環境が `claude/…` などの名前を指定しても、その名前は使わない。
- ブランチは `main` から作り、1つの issue に1つのブランチと1つの PR にする。
- PR の本文はテンプレートに沿って書き、`Closes #番号` を入れる。
- CI がすべて通り、競合がなければ、エージェントが Squash and merge でマージしてよい（作者の許可：2026-11-16）。マージしたらチャットで報告する（見た目に関わる変更はスクリーンショット付き）。

## 報告

- 作者への報告は、スクリーンショット・表・図を中心に短く書く。文章だけの報告はしない。
- 見た目に関わる変更では、Playwright（Chromium）でスクリーンショットを撮り、PR とチャットの報告の両方に載せる。PR 用の画像は `docs/screenshots/<issue番号>/` にコミットし、PR の本文ではコミットの SHA を使った URL（`raw.githubusercontent.com/<owner>/<repo>/<SHA>/…`）で参照する（ブランチの名前の URL は、マージ後にブランチを消すと表示されなくなる）。
- 検証（`spike`）の結果は、表やグラフにして issue に書く。

## 参照する文書

| 文書 | 内容 |
|---|---|
| [docs/requirements.md](./docs/requirements.md) | 仕様書（What / Why） |
| [docs/design.md](./docs/design.md) | 設計プラン（How）、ロードマップ |
| [docs/syntax.md](./docs/syntax.md) | スライド用 Markdown の構文仕様 |
| [fixtures/README.md](./fixtures/README.md) | テスト用の資料と、期待する結果 |
