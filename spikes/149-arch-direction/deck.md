---
title: 動く構成図の方向（#149 の試作）
theme: clean
titleSlide: false
---

<!--
  #149 の試作。構成は今の arch で書き、本物の配置（ELK）とテーマで描く。
  ステップの中の新しい動き（状態・障害・構成の変化など）は、まだ記法を読めないので、
  protos/ の試作のスクリプトが図の上に描く。記法の案は README.md にある。
-->

## 案1 状態を持つノード：注文が集中してキューが詰まる

```arch {captions=below}
direction: right

user   ユーザー  [user]
api    注文API
queue  キュー    [queue]
worker ワーカー
db     注文DB    [database]

user -> api -> queue -> worker -> db

scenario 注文の集中
  step 注文が3件届き、キューに入る
  step ワーカーが1件取り出す。処理には時間がかかる
  step 注文が急増して、キューが満杯になる
  step 入らない注文は 503 で断る
```

## 案2 障害と回復：決済サービスが止まる

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
  step タイムアウトして、間隔を延ばしながら3回再試行する
  step 予備の決済サービスに切り替える
  step 元のサービスが復旧して、戻す
```

## 案3 構成の変化：モノリスをサービスに分ける

```arch {captions=below}
direction: right

user  ユーザー  [user]
gw    ゲートウェイ
group サービス
  order 注文
  pay   決済
  stock 在庫
db    DB        [database]

user -> gw
gw -> order
gw -> pay
gw -> stock
order -> db
pay -> db
stock -> db

scenario 分割
  step 今の構成：1つのアプリが全部を受け持つ
  step 機能ごとのサービスに分ける
  step 注文は、注文サービスだけを通る
```

## 案4 同時に流れる：二重の購入

```arch {captions=below}
direction: right

phone スマホ     [client]
pc    パソコン   [client]
api   決済API
db    口座DB     [database]

phone -> api
pc -> api
api -> db

scenario 二重の購入
  step 残高 1,000円 の口座に、800円 の購入が同時に2つ届く
  step 両方が、残高 1,000円 を読む
  step 両方が「足りる」と判断して、200円 を書く
  step 2つとも売れたのに、800円 しか引かれない
```

## 案5 同じシナリオを2つの見方で：構成図とシーケンス図

<!-- この案は記法を足さないので、シナリオは今の arch の動きで書く。右のシーケンス図は、試作がこの動きから作る -->

```arch {captions=below}
direction: down

user ユーザー     [user]
web  Webサーバー
api  注文API
db   注文DB       [database]
pay  決済サービス [external]

user -> web -> api
api -> db
api -> pay

scenario 注文
  step 注文を送る
    user -> web -> api : POST /orders
  step 注文を保存する
    api -> db : INSERT
    db --> api
  step 決済する
    api -> pay : 請求
    pay --> api : OK
  step 結果を返す
    api --> web --> user : 201 Created
```

## 案6 中に入る：API の中を見る

```arch {captions=below}
direction: right

user  ユーザー [user]
web   Webサーバー
api   注文API
db    注文DB   [database]
queue キュー   [queue]

user -> web -> api
api -> db
api -> queue

scenario 注文の中身
  step 注文が API に届く
  step API の中に入る
  step 中で、認証してから注文を保存する
  step 外に戻って、DB とキューへ
```

## 案7 量を見せる：セールの負荷

```arch {captions=below}
direction: right

user  ユーザー       [user]
lb    ロードバランサ
web1  Web 1
web2  Web 2
cache キャッシュ     [storage]
db    商品DB         [database]

user -> lb
lb -> web1
lb -> web2
web1 -> cache
web2 -> cache
web1 -> db
web2 -> db

scenario セール
  step ふだんの負荷（200 件/秒）
  step セールが始まり、DB があふれる（3,000 件/秒）
  step キャッシュで、DB への読み込みを減らす
```

## 試作用：変化の前（案3）

```arch {captions=none}
direction: right

user ユーザー [user]
app  アプリ（注文・決済・在庫）
db   DB [database]

user -> app -> db
```

## 試作用：API の中（案6）

```arch {captions=none}
direction: right

router  受付
auth    認証
handler 注文の処理
repo    保存
pub     通知の発行

router -> auth
router -> handler
handler -> repo
handler -> pub
```
