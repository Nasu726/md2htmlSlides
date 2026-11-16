# S3：日本語の見出しの改行（#11）

```sh
pnpm build
node spikes/11-ja-typography/compare.mjs <出力フォルダ>   # result.json と grid.png を書き出す
```

| 方法 | CSS | 対応しているブラウザ |
|---|---|---|
| A. auto-phrase | `word-break: auto-phrase` | Chromium・Edge |
| B. auto-phrase なし | `word-break: normal` | Firefox・Safari の今の動き（Chromium で再現） |
| C. BudouX | 文節の切れ目に `<wbr>`、`word-break: keep-all` | すべて |

fixtures のすべての資料から、日本語を含む 12 文字以上の見出しを集め、本文の幅（全幅・3/5・1/2・2/5）で表示する。改行の位置が BudouX の文節の切れ目でも空白の前後でもなければ「文節の途中での改行」と数える。

結果と判断は [設計プラン §15.1](../../docs/design.md#151-結果) に書いた。
