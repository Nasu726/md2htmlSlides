# 同梱しているもののライセンス

md2htmlSlides 本体は [MIT License](./LICENSE)。ここでは、書き出した HTML・エディタ（Web アプリ）・CLI に含まれる、ほかの人が作ったフォントとライブラリを、ライセンスと一緒に挙げる。

すべての依存（間接的なものを含む）は、リポジトリで `pnpm licenses list --prod` を実行すると一覧できる。

## 書き出した HTML に入るもの

`mdhs build`・`mdhs pdf`・エディタの「HTML を書き出す」で作る HTML には、次のものが入る。HTML の `<style>` の先頭にも、同じ表記をコメントで入れている。

| 名前 | 何に使うか | ライセンス | 著作権 |
|---|---|---|---|
| [Inter](https://github.com/rsms/inter) | 欧文の文字 | [SIL Open Font License 1.1](https://openfontlicense.org/) | Copyright 2016 The Inter Project Authors |
| [Noto Sans JP](https://github.com/notofonts/noto-cjk) | 日本語の文字 | SIL Open Font License 1.1 | Copyright Google Inc. |
| [Noto Serif JP](https://github.com/notofonts/noto-cjk) | academic テーマの見出し | SIL Open Font License 1.1 | Copyright Google Inc. |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | コード | SIL Open Font License 1.1 | Copyright 2020 The JetBrains Mono Project Authors |
| [KaTeX](https://github.com/KaTeX/KaTeX) の CSS とフォント | 数式（数式があるときだけ） | MIT | Copyright (c) 2013-2020 Khan Academy and other contributors |

- フォントは [Fontsource](https://fontsource.org/)（`@fontsource-variable/…`）の可変フォントを使い、書き出すときに、スライドで使う文字だけに絞り、名前を「MDS Inter」などに変えている。どのフォントも、名前を変えてはいけない予約名（Reserved Font Name）はない。
- Mermaid の図・コードの色分け（Shiki）・数式（KaTeX）は、描いた結果（SVG・HTML）だけが入る。ライブラリそのものは入らない。
- 発表用の runtime は md2htmlSlides 本体（MIT）。

## エディタ（Web アプリ）に入るもの

[エディタ](https://nasu726.github.io/md2htmlSlides/) には、上のフォントに加えて、次のライブラリが入る（バージョンは `pnpm-lock.yaml` のとおり）。

| 名前 | 何に使うか | ライセンス |
|---|---|---|
| [CodeMirror 6](https://codemirror.net/)・[Lezer](https://lezer.codemirror.net/) | エディタ | MIT |
| [Preact](https://preactjs.com/)・[@preact/signals](https://github.com/preactjs/signals) | 画面 | MIT |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Markdown を読む | MIT |
| [yaml](https://github.com/eemeli/yaml) | フロントマターを読む | ISC |
| [BudouX](https://github.com/google/budoux) | 見出しを文節で改行する | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| [Shiki](https://github.com/shikijs/shiki) | コードの色分け | MIT（言語の文法は、それぞれの作者のライセンス。Shiki に同梱のもの） |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 数式 | MIT |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 図（図があるときだけ読み込む） | MIT。Mermaid に入っている D3（ISC）・DOMPurify（MPL-2.0 または Apache-2.0）なども、それぞれのライセンス |
| [elkjs](https://github.com/kieler/elkjs) | 動く構成図の配置（図があるときだけ読み込む） | [Eclipse Public License 2.0](https://www.eclipse.org/legal/epl-2.0/)（または GPL-3.0-or-later）。変更せずに使っている。ソースは https://github.com/kieler/elkjs |

## CLI が使うもの

CLI（`mdhs`）は、上のものに加えて、次のものを使う。CLI の中で動くだけで、書き出した HTML には入らない。

| 名前 | 何に使うか | ライセンス |
|---|---|---|
| [Playwright](https://github.com/microsoft/playwright)（Chromium） | 計測・図の描画・PDF | Apache License 2.0（Chromium はそれぞれのライセンス） |
| [subset-font](https://github.com/papandreou/subset-font) | フォントを使う文字だけに絞る | BSD-3-Clause |
