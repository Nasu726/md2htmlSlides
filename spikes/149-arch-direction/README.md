# 動く構成図を、Mermaid とはっきり違うものにする方向（#149）

```sh
pnpm build
node spikes/149-arch-direction/run.mjs <出力フォルダ> [案の番号,…]   # 案ごとの GIF と、2×2 の一覧（PNG）
```

- `deck.md`：7つの案のスライド。構成は今の arch で書き、本物の配置（ELK）とテーマ（clean）で描く。8・9枚目は試作用（案3 の変化の前、案6 の中の構成）
- `protos/NN-*.js`：案ごとの試作。新しい記法はまだ読めないので、図の上に動きを描く。`protos/lib.js` は共通の部分（パケット・強調・止めて進められる時間軸）
- `run.mjs`：時間軸を 0.1 秒ずつ進めてスクリーンショットを撮り、GIF と一覧にする。結果は `docs/screenshots/149/` と `result.json`

| 案 | 長さ | コマ | GIF | 一覧 |
|---|---|---|---|---|
| 1 状態を持つノード | 12.6 秒 | 127 | 151 KB | 236 KB |
| 2 障害と回復 | 14.4 秒 | 145 | 124 KB | 224 KB |
| 3 構成の変化 | 9.6 秒 | 97 | 265 KB | 220 KB |
| 4 同時に流れる | 10.6 秒 | 107 | 158 KB | 259 KB |
| 5 2つの見方 | 10.9 秒 | 110 | 140 KB | 212 KB |
| 6 中に入る | 11.8 秒 | 119 | 504 KB | 221 KB |
| 7 量を見せる | 13.0 秒 | 131 | 327 KB | 243 KB |

## 記法の案

今の arch（[仕様](../../docs/arch-diagram.md)）に足す書き方。`#` から後は説明。

### 案1 状態を持つノード

```text
queue  キュー  [queue] max=5       # 中身の数の上限（表の枠の数）

scenario 注文の集中
  step 注文が3件届き、キューに入る
    user -> api -> queue : 注文 x3
    queue += #1 #2 #3               # 中身に足す
  step ワーカーが1件取り出す。処理には時間がかかる
    queue -> worker : #1
    queue -= #1                     # 中身から除く
    worker: #1 を処理中…
  step 注文が急増して、キューが満杯になる
    user -> api -> queue : 注文 x3
    queue += #4 #5 #6               # max に達すると、表の枠が赤くなる
  step 入らない注文は 503 で断る
    api -x queue                    # 届かない移動（案2 と同じ）
    api --> user : 503
```

キーと値（`db.注文 = 3件`、`cache.item:42 = 本`）も同じ形で書ける。

### 案2 障害と回復

```text
scenario 決済の障害
  step 決済サービスが止まる
    pay: down                       # 止める（灰色と「停止」）
  step タイムアウトして、間隔を延ばしながら3回再試行する
    worker -x pay x3 : 1秒 2秒      # 届かない移動を3回。待ち時間を添える
  step 予備の決済サービスに切り替える
    worker -/- pay                  # つながりを切る
    worker -> pay2 : 決済ジョブ
    pay2 --> worker : OK
  step 元のサービスが復旧して、戻す
    pay: up                         # 戻す（切ったつながりも戻る）
    worker -> pay : 決済ジョブ
```

### 案3 構成の変化

```text
layout 今
  user ユーザー [user]
  app  アプリ（注文・決済・在庫）
  db   DB [database]
  user -> app -> db

layout 分割後
  user  ユーザー [user]
  gw    ゲートウェイ
  group サービス
    order 注文 < app                # app から分かれた
    pay   決済 < app
    stock 在庫 < app
  db    DB [database]
  user -> gw
  gw -> order
  gw -> pay
  gw -> stock
  order -> db
  pay -> db
  stock -> db

scenario 分割
  step 今の構成：1つのアプリが全部を受け持つ
    user -> app -> db
  step 機能ごとのサービスに分ける
    layout 分割後                   # 同じ ID は動き、< は分かれ、ないものは消える
  step 注文は、注文サービスだけを通る
    user -> gw -> order -> db
```

### 案4 同時に流れる

```text
scenario 二重の購入                 # スライドで {lanes} を付けると、下にレーンを出す
  step 800円 の購入が同時に2つ届く
    [A] phone -> api : 800円        # 名前の違う流れは、同時に動く
    [B] pc -> api : 800円
  step 両方が、残高 1,000円 を読む
    [A] api -> db : 読む
    [B] api -> db : 読む
    [A] db --> api : 1,000円        # 同じ名前の流れは、順に動く
    [B] db --> api : 1,000円
  step 両方が「足りる」と判断して、200円 を書く
    [A] api -> db : 200円
    [B] api -> db : 200円
    db = 残高 200円
  step 2つとも売れたのに、800円 しか引かれない
    [A] api --> phone : OK
    [B] api --> pc : OK
    db: 800円 足りない !
```

### 案5 同じシナリオを2つの見方で

記法は足さない。今のシナリオから、シーケンス図を作る。

```markdown
![注文の流れ](./order.arch){view=both}       <!-- 構成図とシーケンス図を並べる -->
![注文の流れ](./order.arch){view=sequence}   <!-- シーケンス図だけ -->
```

### 案6 中に入る

```text
api 注文API                         # 字下げした中身を持つノード（ふだんは閉じている）
  router  受付
  auth    認証
  handler 注文の処理
  repo    保存
  pub     通知の発行
  router -> auth
  router -> handler -> repo
  handler -> pub

scenario 注文の中身
  step 注文が API に届く
    user -> web -> api
  step API の中に入る
    enter api                       # 中の動きを書けば、自動で入る案もある
  step 中で、認証してから注文を保存する
    router -> auth
    auth --> router : OK
    router -> handler -> repo
    handler -> pub
  step 外に戻って、DB とキューへ
    leave
    api -> db
    api -> queue
```

### 案7 量を見せる

```text
db    商品DB [database] capacity=1200/s

scenario セール
  step ふだんの負荷（200 件/秒）
    user -> lb ~ 200/s              # 流れ（粒の帯）。lb から先は、つながりに均等に分ける
  step セールが始まり、DB があふれる（3,000 件/秒）
    user -> lb ~ 3000/s             # DB の負荷 ＝ 入る流量 ÷ capacity
  step キャッシュで、DB への読み込みを減らす
    web1 -> cache ~ 80%             # 割合で振り分ける
    web2 -> cache ~ 80%
```

## ほかのツールでできるか

| 案 | Mermaid | D2 | ほか |
|---|---|---|---|
| 1 状態 | ×（図は動かない。状態ごとに図を書き分ける） | △ steps で各ボードのラベルを書き換える（切り替わるだけ） | — |
| 2 障害 | △ classDef で赤くした静止画 | △ steps で状態を書き換えて切り替える | — |
| 3 構成の変化 | ×（2つの図を別々に描く） | △ scenarios・steps で2つの構成を切り替える（あいだの動きはない） | PowerPoint の変形（Morph）なら手作業でできる |
| 4 同時 | △ シーケンス図の `par` で、並行を静止画で描く | △ sequence_diagram で同じ | — |
| 5 2つの見方 | ×（flowchart と sequence を別々に書く。同期しない） | ×（同じ） | Ilograph は1つのモデルから複数の見方（シーケンスも）を出せる。Web のビューアで、スライドではない |
| 6 中に入る | × | △ layers とリンクで別のボードへ移る（動きはない） | Structurizr はダブルクリックで次の詳しさの図へ（C4）。Ilograph も詳しさを変えられる |
| 7 量 | △ sankey-beta で量の静止画、linkStyle で線の太さ | △ 線の太さ、`animated` で線が流れる表示 | — |
| （今の arch）パケット | △ v11 から線を流れるように見せられる（`e1@{ animate: true }`）。mermaid-flow-player（外部）は経路を順に光らせる | △ `animated` | — |

今の arch の「パケットが流れる」は、Mermaid の線のアニメーションや外部のプレイヤーで近いことができるようになってきている。

## 評価

| 案 | Mermaid との差 | 足す記法 | 発表の場面 | 実装の重さ（見積もり） |
|---|---|---|---|---|
| 1 状態 | ◎ | `+=`・`-=`・`max=` | 技術の説明（キュー・キャッシュ） | 中：パーサ、中身の表、PDF のまとめ |
| 2 障害 | ◎ | `: down`・`: up`・`-x`・`-/-` | 障害の振り返り | 小：今のバッジと移動の延長 |
| 3 構成の変化 | ◎ | `layout`・`< app` | 設計の比較 | 大：構成ごとの配置、動きの補間、PDF |
| 4 同時 | ○ | `[A]`・`[B]` | 障害の振り返り（競合） | 中：同時の再生、レーン |
| 5 2つの見方 | ◎（記法なし） | `{view=both}` | 技術の説明 | 中：シーケンス図の配置と同期 |
| 6 中に入る | ○ | 字下げ・`enter`・`leave` | 大きな構成の説明 | 中〜大：入れ子の配置、カメラの拡張 |
| 7 量 | ○ | `~ 200/s`・`capacity=` | 設計の比較（負荷） | 中：流量の計算、流れ続ける表示 |

結果は #149、判断は [設計プラン §15.1](../../docs/design.md#151-結果)（S6）と [動く構成図の仕様 §11](../../docs/arch-diagram.md#11-これから足すものm8179) に書いた。
