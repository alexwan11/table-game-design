/* ----------------------------------------------------------------------
 * ui.js
 * 把 DOM（按钮、状态文字、卡牌选择面板）和 Canvas 点击事件
 * 接到 gameState.js 的纯逻辑函数上，并在每次状态变化后重新渲染。
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const B = window.CCG.board;
  const C = window.CCG.cards;
  const G = window.CCG.game;
  const Rd = window.CCG.render;

  let state;
  let canvas, ctx;
  const els = {};

  function init() {
    canvas = document.getElementById("board-canvas");
    ctx = canvas.getContext("2d");

    els.status = document.getElementById("status-box");
    els.handCount = document.getElementById("hand-count");
    els.btnReset = document.getElementById("btn-reset");
    els.btnEndJump = document.getElementById("btn-end-jump");
    els.circleBtns = {
      A: document.getElementById("circle-A"),
      B: document.getElementById("circle-B"),
      C: document.getElementById("circle-C"),
    };
    els.dirCw = document.getElementById("dir-cw");
    els.dirCcw = document.getElementById("dir-ccw");
    els.cardSelect = document.getElementById("card-select");
    els.btnConfirm = document.getElementById("btn-confirm");
    els.btnCancel = document.getElementById("btn-cancel");
    els.winBanner = document.getElementById("win-banner");

    canvas.addEventListener("click", onCanvasClick);
    els.btnReset.addEventListener("click", doReset);
    els.btnEndJump.addEventListener("click", endJumpClicked);
    Object.entries(els.circleBtns).forEach(([cid, btn]) =>
      btn.addEventListener("click", () => selectCircle(cid))
    );
    els.dirCw.addEventListener("change", () => updateStatus());
    els.dirCcw.addEventListener("change", () => updateStatus());
    els.btnConfirm.addEventListener("click", confirmRotate);
    els.btnCancel.addEventListener("click", cancelRotate);

    state = G.createInitialState();
    fullRefresh();
  }

  function doReset() {
    G.resetState(state);
    els.winBanner.classList.add("hidden");
    fullRefresh();
  }

  function fullRefresh() {
    updateControlsState();
    redraw();
    updateStatus();
  }

  function redraw() {
    Rd.drawBoard(ctx, state);
  }

  function getDirection() {
    return els.dirCw.checked ? "cw" : "ccw";
  }

  // ==================== 画布点击分发 ====================
  function onCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (state.phase === "draft") { handleDraftClick(x, y); return; }
    if (state.gameOver) return;
    if (state.rotatingCircle !== null) return; // 正在配置旋转时，画布点击无效

    const cellKey = findClickedCell(x, y);
    if (cellKey === null) return;
    if (!state.inJumpChain) handleClickNormal(cellKey);
    else handleClickJumpChain(cellKey);
  }

  function findClickedCell(x, y) {
    let best = null, bestD = B.CLICK_R;
    for (const k of B.BOARD_KEYS) {
      const p = B.PIXEL[k];
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  // ==================== 走棋 / 跳跃逻辑 ====================
  function handleClickNormal(cellKey) {
    const st = state.boardState[cellKey];

    if (st === state.currentPlayer) {
      state.selected = cellKey;
      const { steps, jumps } = G.firstMoves(state, cellKey);
      state.highlightCells = steps.concat(jumps);
      redraw(); updateStatus();
      return;
    }

    if (state.selected === null) return;

    if (state.highlightCells.includes(cellKey)) {
      const { steps, jumps } = G.firstMoves(state, state.selected);
      if (steps.includes(cellKey)) {
        G.movePiece(state, state.selected, cellKey);
        finishTurn();
      } else if (jumps.includes(cellKey)) {
        G.movePiece(state, state.selected, cellKey);
        state.selected = cellKey;
        state.inJumpChain = true;
        const nextJumps = G.continueJumps(state, cellKey);
        if (nextJumps.length) {
          state.highlightCells = nextJumps;
          els.btnEndJump.disabled = false;
          updateControlsState();
          redraw(); updateStatus();
        } else {
          finishTurn();
        }
      }
      return;
    }

    state.selected = null;
    state.highlightCells = [];
    redraw(); updateStatus();
  }

  function handleClickJumpChain(cellKey) {
    if (state.highlightCells.includes(cellKey)) {
      G.movePiece(state, state.selected, cellKey);
      state.selected = cellKey;
      const nextJumps = G.continueJumps(state, cellKey);
      if (nextJumps.length) {
        state.highlightCells = nextJumps;
        redraw(); updateStatus();
      } else {
        finishTurn();
      }
    } else if (cellKey === state.selected) {
      finishTurn();
    }
  }

  function endJumpClicked() {
    if (state.inJumpChain) finishTurn();
  }

  function finishTurn() {
    const winner = G.checkWin(state, state.currentPlayer);
    concludeTurn(winner);
  }

  // ==================== 转圆 / 卡牌逻辑 ====================
  function selectCircle(cid) {
    if (state.gameOver || state.inJumpChain || state.phase !== "play") return;
    if (state.playerHands[state.currentPlayer].length === 0) return; // 没有手牌，无法发起旋转
    state.selected = null;
    state.highlightCells = [];
    state.rotatingCircle = cid;
    state.selectedCardIndex = null;
    updateControlsState();
    redraw(); updateStatus();
  }

  function cancelRotate() {
    state.rotatingCircle = null;
    state.selectedCardIndex = null;
    updateControlsState();
    redraw(); updateStatus();
  }

  function selectCard(idx) {
    if (state.rotatingCircle === null) return;
    state.selectedCardIndex = idx;
    refreshCardSelector();
    updateStatus();
  }

  function confirmRotate() {
    if (state.rotatingCircle === null) return;
    if (state.selectedCardIndex === null) {
      updateStatus("⚠ 请先在下方选择一张要打出的卡牌");
      return;
    }
    const cid = state.rotatingCircle;
    const direction = getDirection();
    const hand = state.playerHands[state.currentPlayer];
    const card = hand[state.selectedCardIndex];

    G.rotateCircle(state, cid, direction, card.steps);
    hand.splice(state.selectedCardIndex, 1); // 打出的卡牌被消耗

    state.rotatingCircle = null;
    state.selectedCardIndex = null;
    const winner = G.checkWin(state, 1) || G.checkWin(state, 2);
    concludeTurn(winner);
  }

  // ==================== 回合结束公共逻辑 ====================
  function concludeTurn(winner) {
    state.selected = null;
    state.highlightCells = [];
    state.inJumpChain = false;
    state.rotatingCircle = null;
    state.selectedCardIndex = null;
    els.btnEndJump.disabled = true;
    updateControlsState();
    redraw();

    if (winner) {
      state.gameOver = true;
      showWinBanner(winner);
      updateControlsState();
      return;
    }

    state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
    updateControlsState(); // 切换玩家后刷新手牌选择面板
    updateStatus();
  }

  function showWinBanner(winner) {
    els.winBanner.textContent = `🎉 ${B.PLAYER_NAME[winner]} 获胜！`;
    els.winBanner.classList.remove("hidden");
  }

  // ==================== 抽卡阶段(Gacha)逻辑 ====================
  function handleDraftClick(x, y) {
    if (state.draftAnimating) return;
    const r = state.draftDeckRect;
    if (!r) return;
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) draftDrawCard();
  }

  function draftDrawCard() {
    if (state.draftAnimating || state.phase !== "draft") return;
    const p = G.currentDraftPlayer(state);
    if (state.playerHands[p].length >= C.HAND_SIZE) return;

    state.draftAnimating = true;
    state.draftReveal = false;
    G.draftDrawCard(state); // 抽之前完全随机、未知

    redraw();
    updateStatus("抽取中…");
    setTimeout(draftRevealStep, 300);
  }

  function draftRevealStep() {
    state.draftReveal = true;
    redraw();
    const card = state.lastDrawnCard;
    updateStatus(`获得 ${card.rarity}（${card.degree}°）卡牌！`);
    setTimeout(draftFinishStep, 1000);
  }

  function draftFinishStep() {
    state.draftAnimating = false;
    state.draftReveal = false;
    if (state.draftCount >= C.TOTAL_DRAFT_DRAWS) startPlayPhase();
    else { redraw(); updateStatus(); }
  }

  function startPlayPhase() {
    state.phase = "play";
    state.currentPlayer = 1;
    state.selected = null;
    state.highlightCells = [];
    state.selectedCardIndex = null;
    state.rotatingCircle = null;
    updateControlsState();
    redraw();
    updateStatus("双方手牌已抽取完毕，正式开局！红方先走。");
  }

  // ==================== 面板刷新 ====================
  function updateControlsState() {
    const hand = state.phase === "play" ? state.playerHands[state.currentPlayer] : [];
    const canStartRotate = state.phase === "play" && !state.gameOver && !state.inJumpChain && hand.length > 0;

    Object.entries(els.circleBtns).forEach(([cid, btn]) => {
      btn.disabled = !canStartRotate;
      btn.classList.toggle("active", cid === state.rotatingCircle);
    });

    const configuring = canStartRotate && state.rotatingCircle !== null;
    [els.dirCw, els.dirCcw, els.btnConfirm, els.btnCancel].forEach((el) => (el.disabled = !configuring));

    refreshCardSelector();
    updateHandCounts();
  }

  function refreshCardSelector() {
    els.cardSelect.innerHTML = "";
    if (state.phase !== "play") {
      els.cardSelect.innerHTML = '<span class="placeholder">（开局后才能使用卡牌）</span>';
      return;
    }
    const hand = state.playerHands[state.currentPlayer];
    if (!hand.length) {
      els.cardSelect.innerHTML = '<span class="placeholder">（当前玩家无手牌，无法旋转圆盘）</span>';
      return;
    }
    const active = state.rotatingCircle !== null;
    hand.forEach((card, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-btn" + (idx === state.selectedCardIndex ? " selected" : "");
      btn.style.background = card.color;
      btn.disabled = !active;
      btn.innerHTML = `${card.degree}°<br>${card.stars}`;
      btn.addEventListener("click", () => selectCard(idx));
      els.cardSelect.appendChild(btn);
    });
  }

  function updateHandCounts() {
    const r = state.playerHands[1].length;
    const b = state.playerHands[2].length;
    els.handCount.textContent = `🔴 红方卡牌 ${r}/${C.HAND_SIZE}　　🔵 蓝方卡牌 ${b}/${C.HAND_SIZE}`;
  }

  function updateStatus(extra) {
    if (state.gameOver) return;

    if (state.phase === "draft") {
      const p = G.currentDraftPlayer(state);
      let msg = `🎴 抽卡阶段：${B.PLAYER_NAME[p]} 抽卡中 (${state.playerHands[p].length}/${C.HAND_SIZE})　请点击棋盘中央卡背抽取`;
      if (extra) msg += "　" + extra;
      els.status.textContent = msg;
      return;
    }

    let msg = `轮到 ${B.PLAYER_NAME[state.currentPlayer]} 走棋`;
    if (state.inJumpChain) msg += "（连续跳跃中，可继续跳或点击\u201c结束跳跃\u201d）";
    if (state.rotatingCircle) {
      msg += `（正在配置旋转：${B.CIRCLE_LABEL[state.rotatingCircle]}）`;
      const hand = state.playerHands[state.currentPlayer];
      if (state.selectedCardIndex !== null && state.selectedCardIndex < hand.length) {
        const card = hand[state.selectedCardIndex];
        msg += ` 已选卡牌 ${card.degree}°(${card.rarity})`;
      } else {
        msg += " 请在下方选择一张要打出的卡牌";
      }
    }
    if (extra) msg += "  " + extra;
    els.status.textContent = msg;
  }

  window.CCG = window.CCG || {};
  window.CCG.ui = { init };
})();
