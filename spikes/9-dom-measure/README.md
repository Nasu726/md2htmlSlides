# S1：DOM での計測の速さと安定性（#9）

```sh
pnpm build
node spikes/9-dom-measure/bench.mjs spikes/9-dom-measure        # result.json を書き出す
node spikes/9-dom-measure/chart.mjs spikes/9-dom-measure out.png  # グラフにする
```

| 計測すること | 方法 |
|---|---|
| まとめて計測する時間 | `fixtures/03-long-lecture.md` のブロック（82 個）をくり返して 50〜400 個にし、HTML の挿入から高さの読み取りまでを測る |
| 幅を変えたときの時間 | 200 ブロックを置いたまま、本文の幅（全幅・3/5・1/2・2/5・1/3）を変えて読み直す |
| 1ブロックの差し替え | 200 ブロックのうち 1 個だけ中身を変えて読み直す |
| 安定性 | 新しいページで5回測り、高さが一致するか |
| フォント | Web フォント（IPA P ゴシック）の読み込み前と後で高さが変わるか（読み込み前は WenQuanYi Zen Hei で描かれる） |

結果と判断は [設計プラン §15.1](../../docs/design.md#151-結果) に書いた。
