---
title: Markdown スライドの自動レイアウト
subtitle: 分割とレイアウトを同時に決める動的計画法
author:
  - name: 山田 太郎
    affiliation: ○○大学 情報学部
  - name: 佐藤 花子
    affiliation: △△株式会社 研究開発部
  - name: 鈴木 一郎
    affiliation: ○○大学 情報学部
date: 2026-12-05
event: 第15回 文書処理研究会
logo: ./assets/logo.svg
theme: clean
lang: ja
---

<!--
  ::maketitle を文書の先頭以外に置くケース。
  1枚目は ::maketitle より前に書いた導入のスライド（冒頭の一言）になる。
  ::maketitle があるので、先頭に自動のタイトルスライドは作らない。
-->

{layout=statement}

> スライドの区切りを考える時間を、内容を考える時間に。

::::maketitle {variant=left}
![](./assets/cover.jpg){bg=right}

資料: https://example.com/slides/auto-layout

:::notes
3人の共同研究であることを最初に伝える。所属の番号の説明は不要。
:::
::::

## 背景

スライド作成では、内容を考えるより、区切りや配置の調整に時間がかかることが多い。

## 提案手法

節ごとに、区切り位置とレイアウトの組み合わせを動的計画法で選ぶ。

## まとめ

- 区切りとレイアウトを同時に決める
- 編集の影響を節の中にとどめる

::maketitle
