/* ----------------------------------------------------------------------
 * cards.js
 * 卡牌 / 抽卡 (Gacha) 系统。
 *
 * 重要设计说明：由于旋转方向(顺时针/逆时针)始终由玩家自由选择，
 *   - "60°" 与 "300°" 实际上是同一件事的两种说法（互为相反方向，
 *     一张 60° 卡配合方向选择就能同时达到 60°/300° 两种效果）；
 *   - "120°" 与 "240°" 同理；
 *   - 只有 "180°" 是自配对的（顺时针180° = 逆时针180°）。
 * 所以这里只保留 3 种互不重复的卡牌，而不是原先容易产生重复/虚假
 * 稀有度的 5 种卡牌。
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const CARD_DEFS = [
    { degree: 60, steps: 1, rarity: "普通", stars: "★", color: "#95a5a6", weight: 50 },
    { degree: 120, steps: 2, rarity: "稀有", stars: "★★★", color: "#3498db", weight: 35 },
    { degree: 180, steps: 3, rarity: "史诗", stars: "★★★★★", color: "#9b59b6", weight: 15 },
  ];

  const HAND_SIZE = 5;
  const TOTAL_DRAFT_DRAWS = HAND_SIZE * 2;

  function drawRandomCard() {
    const total = CARD_DEFS.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    for (const c of CARD_DEFS) {
      if (r < c.weight) return c;
      r -= c.weight;
    }
    return CARD_DEFS[CARD_DEFS.length - 1];
  }

  window.CCG = window.CCG || {};
  window.CCG.cards = { CARD_DEFS, HAND_SIZE, TOTAL_DRAFT_DRAWS, drawRandomCard };
})();
