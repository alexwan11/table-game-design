/* ----------------------------------------------------------------------
 * render.js  (4人版：支持 2 / 4 人模式，对手手牌显示背面)
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
    ctx.font         = opts.font || '14px "Microsoft YaHei", sans-serif';
    ctx.fillStyle    = opts.fill || "#000";
    ctx.textAlign    = opts.align || "center";
    ctx.textBaseline = "middle";
    const lines = String(str).split("\n");
    const sizeMatch  = /([\d.]+)px/.exec(ctx.font);
    const lineHeight = opts.lineHeight || (sizeMatch ? parseFloat(sizeMatch[1]) * 1.25 : 18);
    const totalH     = lineHeight * (lines.length - 1);
    lines.forEach((line, i) => ctx.fillText(line, x, y - totalH / 2 + i * lineHeight));
  }

  // ── 主绘制入口 ──────────────────────────────────────────────────
  function drawBoard(ctx, state) {
    clear(ctx);
    if (state.phase === "draft") { drawDraftScene(ctx, state); return; }

    // 圆盘底色
    Object.entries(B.CELL_DISK_MEMBERSHIP).forEach(([k, owned]) => {
      const p = B.PIXEL[k];
      circle(ctx, p.x, p.y, B.HOLE_R + 7, B.TINT_COLOR[owned.join(",")], null);
    });
    // 圆盘装饰圈
    ["A", "B", "C"].forEach((cid) => {
      const d = B.CIRCLE_DRAW[cid];
      circle(ctx, d.cx, d.cy, d.rad, null, B.CIRCLE_COLOR[cid],
             cid === state.rotatingCircle ? 4 : 2);
    });
    // 孔位
    B.BOARD_KEYS.forEach((k) => {
      const p  = B.PIXEL[k];
      const st = state.boardState[k];
      let fill, stroke, r;
      if (st === 0) { fill = "#f5f6f7"; stroke = "#9aa0a6"; r = B.HOLE_R - 3; }
      else          { fill = B.PLAYER_COLOR[st]; stroke = B.PLAYER_OUTLINE[st]; r = B.HOLE_R; }
      circle(ctx, p.x, p.y, r, fill, stroke, 2);
    });
    // 选中
    if (state.selected) {
      const p = B.PIXEL[state.selected];
      circle(ctx, p.x, p.y, B.HOLE_R + 4, null, "#f1c40f", 3);
    }
    // 高亮
    state.highlightCells.forEach((k) => {
      const p = B.PIXEL[k];
      circle(ctx, p.x, p.y, 7, "#2ecc71", null);
    });
  }

  // ── 抽卡阶段 ────────────────────────────────────────────────────
  function drawDraftScene(ctx, state) {
    const C  = window.CCG.cards;
    const G  = window.CCG.game;
    const pc = state.playerCount || 2;
    const cx = B.CANVAS_W / 2;

    if (pc === 6) {
      drawDraftScene6P(ctx, state, cx, C, G);
    } else if (pc === 4) {
      drawDraftScene4P(ctx, state, cx, C, G);
    } else {
      drawDraftScene2P(ctx, state, cx, C, G);
    }
  }

  function drawDraftScene2P(ctx, state, cx, C, G) {
    text(ctx, cx, 50, "🎴 卡牌抽取阶段 (Gacha)",
      { font: 'bold 22px "Microsoft YaHei", sans-serif', fill: "#2c3e50" });
    text(ctx, cx, 82, "抽到之前不知道是什么卡！双方各抽 5 张，抽完自动开局。",
      { font: '13px "Microsoft YaHei", sans-serif', fill: "#7f8c8d" });

    const p = G.currentDraftPlayer(state);
    text(ctx, cx, 112, `轮到 ${B.PLAYER_NAME[p]} 抽卡`,
      { font: 'bold 16px "Microsoft YaHei", sans-serif', fill: B.PLAYER_COLOR[p] });

    drawDeck(ctx, state, cx, 250, 130, 170);
    drawHandPreview(ctx, state, 1, 420, 65, 90);
    drawHandPreview(ctx, state, 2, 560, 65, 90);
  }

  function drawDraftScene4P(ctx, state, cx, C, G) {
    text(ctx, cx, 32, "🎴 卡牌抽取阶段 (Gacha)",
      { font: 'bold 19px "Microsoft YaHei", sans-serif', fill: "#2c3e50" });
    text(ctx, cx, 58, "每人随机抽取 3 张，抽完自动开局。",
      { font: '12px "Microsoft YaHei", sans-serif', fill: "#7f8c8d" });

    const p = G.currentDraftPlayer(state);
    text(ctx, cx, 80, `轮到 ${B.PLAYER_NAME[p]} 抽卡`,
      { font: 'bold 15px "Microsoft YaHei", sans-serif', fill: B.PLAYER_COLOR[p] });

    drawDeck(ctx, state, cx, 160, 110, 120);

    // 4行手牌预览，卡片较宽（每人3张）
    drawHandPreview(ctx, state, 1, 295, 80, 75);
    drawHandPreview(ctx, state, 2, 385, 80, 75);
    drawHandPreview(ctx, state, 3, 475, 80, 75);
    drawHandPreview(ctx, state, 4, 565, 80, 75);
  }

  // 中央抽卡牌堆
  function drawDeck(ctx, state, cx, deckCy, w, h) {
    const x0 = cx - w / 2, y0 = deckCy - h / 2;
    const x1 = cx + w / 2, y1 = deckCy + h / 2;
    state.draftDeckRect = { x0, y0, x1, y1 };

    if (state.draftAnimating && state.draftReveal && state.lastDrawnCard) {
      const card = state.lastDrawnCard;
      rect(ctx, x0, y0, x1, y1, card.color, "#2c3e50", 3);
      text(ctx, cx, deckCy - h * 0.28, `${card.rarity} 卡牌！`,
        { font: 'bold 14px "Microsoft YaHei", sans-serif', fill: "#fff" });
      text(ctx, cx, deckCy, `${card.degree}°`,
        { font: 'bold 28px "Microsoft YaHei", sans-serif', fill: "#fff" });
      text(ctx, cx, deckCy + h * 0.22, card.stars,
        { font: '14px "Microsoft YaHei", sans-serif', fill: "#fff" });
      text(ctx, cx, deckCy + h * 0.38, `可转 ${card.steps} 格`,
        { font: '11px "Microsoft YaHei", sans-serif', fill: "#fff" });
    } else if (state.draftAnimating && !state.draftReveal) {
      rect(ctx, x0, y0, x1, y1, "#2c3e50", "#1c2833", 3);
      text(ctx, cx, deckCy, "抽取中…",
        { font: 'bold 14px "Microsoft YaHei", sans-serif', fill: "#fff" });
    } else {
      rect(ctx, x0, y0, x1, y1, "#34495e", "#2c3e50", 3);
      text(ctx, cx, deckCy - h * 0.1, "🎴", { font: "26px sans-serif", fill: "#fff" });
      text(ctx, cx, deckCy + h * 0.2, "点击抽卡",
        { font: 'bold 14px "Microsoft YaHei", sans-serif', fill: "#fff" });
    }
  }

  function drawDraftScene6P(ctx, state, cx, C, G) {
    text(ctx, cx, 28, "🎴 卡牌抽取阶段 (Gacha)",
      { font: 'bold 17px "Microsoft YaHei", sans-serif', fill: "#2c3e50" });
    text(ctx, cx, 52, "六人模式，每人抽取 2 张，抽完自动开局。",
      { font: '12px "Microsoft YaHei", sans-serif', fill: "#7f8c8d" });

    const p = G.currentDraftPlayer(state);
    text(ctx, cx, 74, `轮到 ${B.PLAYER_NAME[p]} 抽卡`,
      { font: 'bold 14px "Microsoft YaHei", sans-serif', fill: B.PLAYER_COLOR[p] });

    // 中央小牌堆
    drawDeck(ctx, state, cx, 140, 100, 90);

    // 左列: P1, P2, P3   右列: P4, P5, P6
    const rowY  = [262, 372, 482];
    const cw = 68, ch = 58;
    const lx = 18, rx = 308;   // 左/右列起始x
    [[1, lx], [2, lx], [3, lx],
     [4, rx], [5, rx], [6, rx]].forEach(([player, startX], i) => {
      const y = rowY[i % 3];
      drawHandPreview(ctx, state, player, y, cw, ch, startX);
    });

    // 左右列分隔线
    ctx.beginPath();
    ctx.moveTo(298, 240); ctx.lineTo(298, 545);
    ctx.strokeStyle = "#dce1e5"; ctx.lineWidth = 1; ctx.stroke();
  }

  // 单行手牌预览
  // cw=卡宽, ch=卡高（自动由 cw 推算）
  function drawHandPreview(ctx, state, player, y, cw, ch, startX) {
    const C = window.CCG.cards;
    const handSize = state.handSize || C.HAND_SIZE;
    // 己方显示卡面，对手显示背面
    const isMyHand = !state.myPlayerNum || player === state.myPlayerNum;
    const gap = 8;
    startX = (startX !== undefined) ? startX : 70;

    text(ctx, startX - 4, y - ch / 2 - 14, `${B.PLAYER_NAME[player]}手牌:`,
      { font: 'bold 12px "Microsoft YaHei", sans-serif', fill: B.PLAYER_COLOR[player], align: "left" });

    const hand = state.playerHands[player] || [];
    for (let i = 0; i < handSize; i++) {
      const x = startX + i * (cw + gap);
      if (i < hand.length) {
        if (isMyHand) {
          const card = hand[i];
          rect(ctx, x, y - ch / 2, x + cw, y + ch / 2, card.color, "#2c3e50", 2);
          text(ctx, x + cw / 2, y - 10, `${card.degree}°`,
            { font: 'bold 12px "Microsoft YaHei", sans-serif', fill: "#fff" });
          text(ctx, x + cw / 2, y + 12, card.stars,
            { font: '9px "Microsoft YaHei", sans-serif', fill: "#fff" });
        } else {
          // 对手：卡背
          rect(ctx, x, y - ch / 2, x + cw, y + ch / 2, "#2c3e50", "#455a64", 2);
          text(ctx, x + cw / 2, y, "?",
            { font: 'bold 18px "Microsoft YaHei", sans-serif', fill: "#546e7a" });
        }
      } else {
        rect(ctx, x, y - ch / 2, x + cw, y + ch / 2, "#ecf0f1", "#b2bec3", 2, [3, 2]);
      }
    }
  }

  window.CCG = window.CCG || {};
  window.CCG.render = { drawBoard, drawDraftScene, drawHandPreview };
})();
