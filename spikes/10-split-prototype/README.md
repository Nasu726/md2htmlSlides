# S2：自動分割の試作（#10）

```sh
pnpm build
node spikes/10-split-prototype/run.mjs <出力フォルダ> initial   # 設計プランの初期値
node spikes/10-split-prototype/run.mjs <出力フォルダ> tuned     # 調整後
```

| ファイル | 内容 |
|---|---|
| `split.mjs` | 原子に分ける・区切りのペナルティ・節ごとの動的計画法・スライドに戻す（DOM に依存しない） |
| `weights.mjs` | 重み（initial と tuned） |
| `run.mjs` | ヘッドレス Chromium で原子の高さを測り、分割して描画し、スライドの一覧と評価の数字を出す |
| `summary-*.json` | 評価の数字 |

試作に入れていないもの：コードの行での分割、レイアウトの候補（2段組など）、段階的表示（`. . .`）の範囲。

結果と判断は [設計プラン §15.1](../../docs/design.md#151-結果) に書いた。
