# S5：PDF での再現性（#69）

```sh
pnpm build
node spikes/69-pdf-fidelity/run.mjs <出力フォルダ>   # PDF・ページの画像・result.json を書き出す
```

必要なもの：poppler-utils（`pdftoppm`・`pdftotext`・`pdfinfo`・`pdffonts`）。

1. fixtures の資料（02・04・06・07・08）を `mds build` で書き出す。
2. ヘッドレス Chromium で開き、試作の印刷用 CSS を足して `page.pdf()` で PDF にする。印刷用 CSS の中身：
   - 1スライド＝1ページ（ページの大きさはスライドと同じ）、余白なし
   - 段階的表示はすべて表示する
   - 影は付けない
3. `pdf.steps: each` の試作として、ステップのあるスライドをステップの数だけ複製した PDF も作る。
4. PDF の各ページを `pdftoppm` で 96 dpi（1280×720）の画像にし、画面（最後のステップまで表示）のスクリーンショットと比べる。違いの数え方は2つ：
   - そのまま比べる
   - 周り1画素に近い色があれば同じとみなす（文字の縁のにじみ方の違いを除く）
5. `pdftotext` で文字を取り出せるか、`pdffonts` でフォントが埋め込まれているかを確かめる。

結果と判断は [設計プラン §15.1](../../docs/design.md#151-結果) と #69 に書いた。
