# S4：動く構成図の配置と再生（#104）

```sh
node spikes/104-arch-layout/run.mjs <出力フォルダ>   # 配置の SVG・PNG、パケットの途中の様子、result.json
```

1. 試作のパーサで構成（ノード・入れ子のグループ・つながり）だけを読み、elkjs の layered で配置する（`elk.hierarchyHandling: INCLUDE_CHILDREN`、直角の経路）。ノードの大きさは文字数からの見積もり。
2. 配置の結果を SVG にし、ノードの重なり・グループからのはみ出し・ノードを貫く線を数える。
3. 配置の時間を Node と Chromium で測る（1回目と、2回目以降 20 回の中央値）。
4. order-system の `user -> web -> api` と `api -> queue -> worker` を1本の経路にし、SVG の円に `offset-path: path(…)` を付けて Web Animations API で動かす。途中の 40 点で、円の中心と経路上の点（`getPointAtLength`）のずれを測り、再生中のフレームの間隔を `requestAnimationFrame` で測る。

| 構成 | ノード・グループ・つながり | 重なり・はみ出し・貫通 | Node（初回 / 2回目以降） | Chromium（初回 / 2回目以降） |
|---|---|---|---|---|
| order-system（横・グループ） | 7・1・6 | 0・0・0 | 24 / 11 ms | 103 / 17 ms |
| 13-arch のコードブロック（上から下） | 4・1・3 | 0・0・0 | 15 / 10 ms | 49 / 13 ms |
| 大きめの構成（入れ子3段） | 30・9・40 | 0・0・0 | 119 / 85 ms | 220 / 76 ms |

| パケット | 経路の長さ | 経路からのずれ | フレームの間隔（平均 / 最大） |
|---|---|---|---|
| user → web → api | 247 | 0 px | 16.7 / 16.8 ms |
| api → queue → worker | 226 | 0 px | 16.7 / 16.8 ms |

結果と判断は [設計プラン §15.1](../../docs/design.md#151-結果) と #104 に書いた。
