/* ----------------------------------------------------------------------
 * gameState.js
 * 纯游戏逻辑（不操作 DOM/Canvas）：棋子状态、走棋/跳棋规则、
 * 圆盘旋转、胜负判定、抽卡阶段的状态推进。
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const B = window.CCG.board;
  const C = window.CCG.cards;

  function resetState(state) {
    state.boardState = {};
    B.BOARD_KEYS.forEach((k) => (state.boardState[k] = 0));
    B.TOP_REGION_SET.forEach((k) => (state.boardState[k] = 1));
    B.BOTTOM_REGION_SET.forEach((k) => (state.boardState[k] = 2));

    state.currentPlayer = 1;
    state.selected = null;
    state.inJumpChain = false;
    state.highlightCells = [];
    state.gameOver = false;
    state.rotatingCircle = null;

    // ---- 抽卡阶段(Gacha) ----
    state.phase = "draft"; // 'draft' -> 'play'
    state.playerHands = { 1: [], 2: [] };
    state.draftCount = 0;
    state.draftAnimating = false;
    state.draftReveal = false;
    state.lastDrawnCard = null;
    state.draftDeckRect = null;
    state.selectedCardIndex = null;

    return state;
  }

  function createInitialState() {
    return resetState({});
  }

  function currentDraftPlayer(state) {
    return state.draftCount % 2 === 0 ? 1 : 2;
  }

  function firstMoves(state, srcKey) {
    const [x, y, z] = B.parseKey(srcKey);
    const steps = [];
    const jumps = [];
    for (const [dx, dy, dz] of B.DIRS) {
      const n1 = B.key([x + dx, y + dy, z + dz]);
      if (B.BOARD_SET.has(n1) && state.boardState[n1] === 0) steps.push(n1);
      const n2 = B.key([x + 2 * dx, y + 2 * dy, z + 2 * dz]);
      if (
        B.BOARD_SET.has(n1) && state.boardState[n1] !== 0 &&
        B.BOARD_SET.has(n2) && state.boardState[n2] === 0
      ) {
        jumps.push(n2);
      }
    }
    return { steps, jumps };
  }

  function continueJumps(state, srcKey) {
    const [x, y, z] = B.parseKey(srcKey);
    const jumps = [];
    for (const [dx, dy, dz] of B.DIRS) {
      const n1 = B.key([x + dx, y + dy, z + dz]);
      const n2 = B.key([x + 2 * dx, y + 2 * dy, z + 2 * dz]);
      if (
        B.BOARD_SET.has(n1) && state.boardState[n1] !== 0 &&
        B.BOARD_SET.has(n2) && state.boardState[n2] === 0
      ) {
        jumps.push(n2);
      }
    }
    return jumps;
  }

  function movePiece(state, src, dst) {
    state.boardState[dst] = state.boardState[src];
    state.boardState[src] = 0;
  }

  /**
   * 把整个圆盘（所有同心环）当作刚体旋转 steps*60 度。
   * 半径为 r 的环有 6r 个格子，转 60 度时整环正好移动 r 个位置。
   */
  function rotateCircle(state, cid, direction, steps) {
    const rings = B.CIRCLE_DISK_RINGS[cid];
    const oldVals = {};
    Object.values(rings).forEach((ring) =>
      ring.forEach((c) => {
        const k = B.key(c);
        oldVals[k] = state.boardState[k];
      })
    );
    Object.entries(rings).forEach(([rStr, ring]) => {
      const r = Number(rStr);
      if (r === 0) return; // 圆心是旋转轴，自身不移动
      const n = ring.length;
      let shift = direction === "ccw" ? steps * r : -steps * r;
      shift = ((shift % n) + n) % n;
      ring.forEach((cellArr, i) => {
        const srcK = B.key(cellArr);
        const destK = B.key(ring[(i + shift) % n]);
        state.boardState[destK] = oldVals[srcK];
      });
    });
  }

  function checkWin(state, player) {
    const target = player === 1 ? B.BOTTOM_REGION_SET : B.TOP_REGION_SET;
    const cells = B.BOARD_KEYS.filter((k) => state.boardState[k] === player);
    if (cells.length === 10 && cells.every((k) => target.has(k))) return player;
    return null;
  }

  /** 抽之前完全随机、未知 — 纯数据层面的一次抽卡，不含动画/计时。 */
  function draftDrawCard(state) {
    const p = currentDraftPlayer(state);
    if (state.playerHands[p].length >= C.HAND_SIZE) return null;
    const card = C.drawRandomCard();
    state.playerHands[p].push(card);
    state.draftCount += 1;
    state.lastDrawnCard = card;
    return card;
  }

  window.CCG = window.CCG || {};
  window.CCG.game = {
    createInitialState, resetState, currentDraftPlayer,
    firstMoves, continueJumps, movePiece, rotateCircle,
    checkWin, draftDrawCard,
  };
})();
