/* ----------------------------------------------------------------------
 * render.js  (在线版：对手手牌显示为背面)
 * 修改点：drawHandPreview 检查 state.myPlayerNum，
 *   若该手牌属于对手则只显示卡背（"?"），不暴露具体信息。
 *   state.myPlayerNum 由 ui.js 在加入房间后写入，本地对战时不设此字段。
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const B = window.CCG.board;

  function clear(ctx) {
    ctx.clearRect(0, 0, B.CANVAS_W, B.CANVAS_H);
    ctx.fillStyle = "#ecf0f1";
    ctx.fillRect(0, 0, B.CANVAS_W, B.CANVAS_H);
  }

  function circle(ctx, cx, cy, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function rect(ctx, x0, y0, x1, y1, fill, stroke, lw, dash) {
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash(dash || []);
    if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
    ctx.setLineDash([]);
  }

  function text(ctx, x, y, str, opts) {
    opts = opts || {};
    ctx.font          = opts.font || '14px "Microsoft YaHei", sans-serif';
    ctx.fillStyle     = opts.fill || "#000";
    ctx.textAlign     = opts.align || "center";
    ctx.textBaseline  = "middle";
    const lines = String(str).split("\n");
    const sizeMatch = /([\d.]+)px/.exec(ctx.font);
    const lineHeight = opts.lineHeight || (sizeMatch ? parseFloat(sizeMatch[1]) * 1.25 : 18);
    const totalH = lineHeight * (lines.length - 1);
    lines.forEach((line, i) => ctx.fillText(line, x, y - totalH / 2 + i * lineHeight));
  }

  function drawBoard(ctx, state) {
    clear(ctx);

    if (state.phase === "draft") {
      drawDraftScene(ctx, state);
      return;
    }

    // 1) 圆盘归属底色
    Object.entries(B.CELL_DISK_MEMBERSHIP).forEach(([k, owned]) => {
      const p = B.PIXEL[k];
      circle(ctx, p.x, p.y, B.HOLE_R + 7, B.TINT_COLOR[owned.join(",")], null);
    });

    // 2) 圆盘装饰外圈
    ["A", "B", "C"].forEach((cid) => {
      const d = B.CIRCLE_DRAW[cid];
      const w = cid === state.rotatingCircle ? 4 : 2;
      circle(ctx, d.cx, d.cy, d.rad, null, B.CIRCLE_COLOR[cid], w);
    });

    // 3) 所有孔位
    B.BOARD_KEYS.forEach((k) => {
      const p  = B.PIXEL[k];
      const st = state.boardState[k];
      let fill, stroke, r;
      if (st === 0) { fill = "#f5f6f7"; stroke = "#9aa0a6"; r = B.HOLE_R - 3; }
      else          { fill = B.PLAYER_COLOR[st]; stroke = B.PLAYER_OUTLINE[st]; r = B.HOLE_R; }
      circle(ctx, p.x, p.y, r, fill, stroke, 2);
    });

    // 4) 选中描边
    if (state.selected !== null) {
      const p = B.PIXEL[state.selected];
      circle(ctx, p.x, p.y, B.HOLE_R + 4, null, "#f1c40f", 3);
    }

    // 5) 高亮可走位置
    state.highlightCells.forEach((k) => {
      const p = B.PIXEL[k];
      circle(ctx, p.x, p.y, 7, "#2ecc71", null);
    });
  }

  function drawDraftScene(ctx, state) {
    const C = window.CCG.cards;
    const G = window.CCG.game;
    const cx = B.CANVAS_W / 2;

    text(ctx, cx, 50, "🎴 卡牌抽取阶段 (Gacha)",
      { font: 'bold 22px "Microsoft YaHei", sans-serif', fill: "#2c3e50" });
    text(ctx, cx, 82, "抽到之前不知道是什么卡！双方各抽 5 张，抽完自动开局。",
      { font: '13px "Microsoft YaHei", sans-serif', fill: "#7f8c8d" });

    const p = G.currentDraftPlayer(state);
    text(ctx, cx, 112, `轮到 ${B.PLAYER_NAME[p]} 抽卡`,
      { font: 'bold 16px "Microsoft YaHei", sans-serif', fill: B.PLAYER_COLOR[p] });

    const deckCy = 250, w = 130, h = 170;
    const x0 = cx - w / 2, y0 = deckCy - h / 2, x1 = cx + w / 2, y1 = deckCy + h / 2;
    state.draftDeckRect = { x0, y0, x1, y1 };

    if (state.draftAnimating && state.draftReveal && state.lastDrawnCard) {
      // 翻牌揭示 —— 只有抽牌方才能看到内容
      const card = state.lastDrawnCard;
      rect(ctx, x0, y0, x1, y1, card.color, "#2c3e50", 3);
      text(ctx, cx, deckCy - 45, `${card.rarity} 卡牌！`,
        { font: 'bold 15px "Microsoft YaHei", sans-serif', fill: "#fff" });
      text(ctx, cx, deckCy, `${card.degree}°`,
        { font: 'bold 32px "Microsoft YaHei", sans-serif', fill: "#fff" });
      text(ctx, cx, deckCy + 40, card.stars,
        { font: '16px "Microsoft YaHei", sans-serif', fill: "#fff" });
      text(ctx, cx, deckCy + 65, `可转 ${card.steps} 格`,
        { font: '12px "Microsoft YaHei", sans-serif', fill: "#fff" });
    } else if (state.draftAnimating && !state.draftReveal) {
      rect(ctx, x0, y0, x1, y1, "#2c3e50", "#1c2833", 3);
      text(ctx, cx, deckCy, "抽取中…",
        { font: 'bold 15px "Microsoft YaHei", sans-serif', fill: "#fff" });
    } else {
      rect(ctx, x0, y0, x1, y1, "#34495e", "#2c3e50", 3);
      text(ctx, cx, deckCy - 15, "🎴", { font: "30px sans-serif", fill: "#fff" });
      text(ctx, cx, deckCy + 30, "点击抽卡",
        { font: 'bold 15px "Microsoft YaHei", sans-serif', fill: "#fff" });
    }

    drawHandPreview(ctx, state, 1, 420);
    drawHandPreview(ctx, state, 2, 560);
  }

  function drawHandPreview(ctx, state, player, y) {
    const C = window.CCG.cards;

    // ★ 核心修改：判断是否为己方手牌
    //   state.myPlayerNum 由 ui.js 在加入房间后写入；
    //   若未设置（本地对战）则显示所有卡牌。
    const isMyHand = !state.myPlayerNum || player === state.myPlayerNum;

    text(ctx, 75, y - 38, `${B.PLAYER_NAME[player]}手牌:`,
      { font: 'bold 13px "Microsoft YaHei", sans-serif', fill: B.PLAYER_COLOR[player], align: "left" });

    const hand = state.playerHands[player];
    const cw = 65, ch = 90, startX = 70;
    for (let i = 0; i < C.HAND_SIZE; i++) {
      const x = startX + i * (cw + 8);
      if (i < hand.length) {
        if (isMyHand) {
          // 己方：显示卡面
          const card = hand[i];
          rect(ctx, x, y - ch / 2, x + cw, y + ch / 2, card.color, "#2c3e50", 2);
          text(ctx, x + cw / 2, y - 12, `${card.degree}°`,
            { font: 'bold 13px "Microsoft YaHei", sans-serif', fill: "#fff" });
          text(ctx, x + cw / 2, y + 14, card.stars,
            { font: '10px "Microsoft YaHei", sans-serif', fill: "#fff" });
        } else {
          // 对手：只显示卡背（不暴露度数/稀有度）
          rect(ctx, x, y - ch / 2, x + cw, y + ch / 2, "#2c3e50", "#455a64", 2);
          text(ctx, x + cw / 2, y, "?",
            { font: 'bold 22px "Microsoft YaHei", sans-serif', fill: "#546e7a" });
        }
      } else {
        // 空槽
        rect(ctx, x, y - ch / 2, x + cw, y + ch / 2, "#ecf0f1", "#b2bec3", 2, [3, 2]);
      }
    }
  }

  window.CCG = window.CCG || {};
  window.CCG.render = { drawBoard, drawDraftScene, drawHandPreview };
})();
