---
title: 動く構成図テスト
theme: clean
titleSlide: false
---

<!--
  動く構成図（docs/arch-diagram.md）の表示・再生・警告を確かめる。
  期待する結果は fixtures/README.md にある。
-->

## ファイル参照（正常時）

![注文処理の構成](./assets/order-system.arch){scenario=正常時}

## ファイル参照（決済の障害）

![注文処理の構成](./assets/order-system.arch){scenario=決済の障害}

## シナリオを省略（最初のシナリオ）

![注文処理の構成](./assets/order-system.arch)

## 動きのない構成図

![注文処理の構成](./assets/order-system.arch){scenario=none captions=none}

## 説明を図の横に出す（指定）

![注文処理の構成](./assets/order-system.arch){scenario=正常時 captions=side}

## コードブロックに直接書く（上から下）

```arch
direction: down

client ブラウザ [client]
group バックエンド
  app  アプリ [server]
  cache キャッシュ [storage]
  db   DB [database]

client -> app
app -> cache
app -> db

scenario キャッシュの確認
  step キャッシュを見る
    client -> app -> cache : GET user:42
    cache: なし
  step DB から読んでキャッシュに入れる
    app -> db
    app -> cache : SET user:42
    cache: あり
  step 結果を返す
    app --> client : 200 OK
```

## 段階表示と組み合わせる

最初に問題を見せる。

. . .

![注文処理の構成](./assets/order-system.arch){scenario=決済の障害 captions=none}

. . .

リトライで解決しない障害には、タイムアウトと通知が必要。

## 書き間違い

```arch
a 入口
b 出口

a -> b

scenario 確認
  step 存在しないノード
    a -> c
  step 構成にない経路
    b -> a
```

![注文処理の構成](./assets/order-system.arch){scenario=存在しないシナリオ}

## 障害と回復

```arch {captions=below}
direction: right

user   ユーザー     [user]
api    注文API
worker ワーカー
pay    決済サービス [external]
pay2   予備の決済   [external]

user -> api -> worker
worker -> pay : 決済の依頼
worker -> pay2 : 決済の依頼

scenario 決済の障害
  step 決済サービスが止まる
    pay: down
  step タイムアウトして、3回再試行する
    worker -x pay x3 : タイムアウト
    worker: 3回とも失敗 !
  step 予備の決済サービスに切り替える
    worker -/- pay
    worker: -
    worker -> pay2 : 決済ジョブ
    pay2 --> worker : OK
  step 元のサービスが復旧して、戻す
    pay: up 復旧
    worker -/- pay : -
    worker -> pay : 決済ジョブ
    pay --> worker : OK
```

## キューが詰まる

```arch {captions=below}
direction: right

user   ユーザー [user]
api    注文API
queue  キュー   [queue] max=5
worker ワーカー
db     注文DB   [database]

user -> api -> queue -> worker -> db

scenario 注文の集中
  step 注文が3件届き、キューに入る
    user -> api -> queue : 注文 x3
    queue += 注文1 注文2 注文3
  step ワーカーが1件取り出す。処理には時間がかかる
    queue -> worker : 注文1
    queue -= 注文1
    worker: 注文1 を処理中
  step 注文が急増して、キューが満杯になる
    user -> api -> queue : 注文 x3
    queue += 注文4 注文5 注文6
  step 入らない注文は 503 で断る
    user -> api -x queue : 満杯
    queue += 注文7
    api --> user : 503
```

## キャッシュのヒットとミス

```arch {captions=below}
direction: right

user  ユーザー   [user]
api   商品API
cache キャッシュ [storage]
db    商品DB     [database]

user -> api
api -> cache
api -> db

scenario キャッシュ
  step 1回目：キャッシュにない
    user -> api -> cache : GET item:42
    cache: ミス !
  step DB から読み、キャッシュに入れる
    api -> db : SELECT
    db --> api : 本
    api -> cache : SET
    cache.item:42 = 本
    cache: -
  step 2回目：キャッシュから返す
    user -> api -> cache : GET item:42
    cache: ヒット
    cache --> api --> user : 本
  step 60秒で期限が切れる
    cache.item:42 = -
    cache: 期限切れ
```
