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
