---
title: 図・数式・コードの埋め込みテスト
theme: dark
titleSlide: false
---

## Mermaid：フローチャート

```mermaid
flowchart LR
  MD[Markdown] --> Parse[パース] --> Split[分割] --> Layout[レイアウト] --> Render[描画]
  Render --> Present[発表]
  Render --> PDF[PDF]
```

## Mermaid：シーケンス図

```mermaid
sequenceDiagram
  participant E as エディタ
  participant P as プレビュー
  E->>P: 変更された IR
  P->>P: 計測・分割・描画
  P-->>E: スライドの対応表と警告
```

## Mermaid：文章と並べる

処理の流れを図で示す。

- 入力は Markdown だけ
- 出力は HTML と PDF

```mermaid
flowchart TD
  A[入力] --> B{収まる?}
  B -- はい --> C[1枚]
  B -- いいえ --> D[分割]
```

## Mermaid：ファイルを参照する

![処理の流れ](./assets/flow.mmd)

## Mermaid：構文エラー

```mermaid
flowchart LR
  A --> 
  B -->> C
```

スライドにはエラーの枠を表示し、エディタには行番号付きで警告する。

## Mermaid：とても大きな図

```mermaid
flowchart LR
  A1 --> A2 --> A3 --> A4 --> A5 --> A6 --> A7 --> A8 --> A9 --> A10
  B1 --> B2 --> B3 --> B4 --> B5 --> B6 --> B7 --> B8 --> B9 --> B10
  C1 --> C2 --> C3 --> C4 --> C5 --> C6 --> C7 --> C8 --> C9 --> C10
  A5 --> B5 --> C5
  A10 --> C10
```

図は領域に合わせて縮小する。分割はしない。

## 数式（M3）

二次方程式 $ax^2 + bx + c = 0$ の解は次のとおり。

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

## コード：いくつかの言語

```python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```rust
fn main() {
    let v: Vec<u32> = (1..=10).filter(|x| x % 2 == 0).collect();
    println!("{:?}", v);
}
```

## コード：言語名なし

```
言語名のないコードブロックは、ハイライトせずに等幅で表示する。
```

## コード：知らない言語名

```unknownlang
ハイライトできない言語名は、警告を出さずに等幅で表示する。
```

## コード：とても長いコード

```ts
// 1枚に収まらない長さのコードは、空行の位置で分割する。
import { readFile } from "node:fs/promises";

type Slide = { id: string; html: string };

export async function loadDeck(path: string) {
  const text = await readFile(path, "utf8");
  return parse(text);
}

function parse(text: string): Slide[] {
  const slides: Slide[] = [];
  let current: string[] = [];
  let index = 0;

  for (const line of text.split("\n")) {
    if (line.trim() === "---") {
      slides.push({ id: `s${index++}`, html: current.join("\n") });
      current = [];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    slides.push({ id: `s${index++}`, html: current.join("\n") });
  }

  return slides;
}

export function countSlides(slides: Slide[]) {
  return slides.length;
}

export function findSlide(slides: Slide[], id: string) {
  return slides.find((slide) => slide.id === id);
}

export function firstSlide(slides: Slide[]) {
  return slides[0];
}

export function lastSlide(slides: Slide[]) {
  return slides[slides.length - 1];
}
```

## 動く構成図（M4）

小さな構成図をコードブロックに直接書く例。詳しいテストは `13-arch.md` にある。

```arch
browser ブラウザ [client]
api     API      [server]

browser -> api

scenario 呼び出し
  step リクエストを送る
    browser -> api : GET /items
  step 結果を返す
    api --> browser : 200 OK
```
