// 分割の重み。initial は設計プラン §4.2・§4.3 の初期値。
export const WEIGHTS = {
  initial: {
    beforeHeading: 0, // 小見出しの直前
    block: 10, // ブロックとブロックの間
    listItem: 30, // リストの項目の間
    tableRow: 60, // 表の行の間
    orphan: 50, // リスト・表の片方に1つだけが残るとき
    page: 40, // 1枚増えるごと
    fill: 100, // 最後以外のページの余白：fill·(1 − 充填率)²
    last: 150, // 最後のページが lastMin 未満のとき
    lastMin: 0.3,
    shrink: 300, // 縮小：shrink·(1 − 倍率)
    minScale: 0.85,
  },
  // 調整後：数行だけの最後のページを避けるときに限って、80% までの縮小を認める
  // （85% までは初期値と同じコスト、85% より下は重いコスト）
  tuned: {
    beforeHeading: 0,
    block: 10,
    listItem: 30,
    tableRow: 60,
    orphan: 50,
    page: 40,
    fill: 100,
    last: 400,
    lastMin: 0.35,
    shrink: 300,
    deepShrink: 2000,
    softMinScale: 0.85,
    minScale: 0.8,
  },
};
