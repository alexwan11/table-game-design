/* ----------------------------------------------------------------------
 * gameState.js
 * 纯游戏逻辑（不操作 DOM/Canvas）：棋子状态、走棋/跳棋规则、
 * 圆盘旋转、胜负判定、抽卡阶段的状态推进。
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const B = window.CCG.board;
  const C = window.CCG.cards;

  function resetState(state, playerCount) {
    playerCount = playerCount || state.playerCount || 2;
    state.playerCount = playerCount;

    // 每人手牌数：2人=5张，4人=3张
    const handSize = playerCount === 6 ? 2 : (playerCount === 4 ? 3 : 5);
    state.handSize = handSize;
    state.totalDraftDraws = handSize * playerCount;

    state.boardState = {};
    B.BOARD_KEYS.forEach((k) => (state.boardState[k] = 0));

    if (playerCount === 6) {
      // 6人模式：6个臂全部使用
      [1, 2, 3, 4, 5, 6].forEach((p) =>
        B.P6_STARTS[p].forEach((k) => (state.boardState[k] = p))
      );
    } else if (playerCount === 4) {
      // 4人模式：4个臂
      [1, 2, 3, 4].forEach((p) =>
        B.P4_STARTS[p].forEach((k) => (state.boardState[k] = p))
      );
    } else {
      // 2人模式
      B.TOP_REGION_SET.forEach((k) => (state.boardState[k] = 1));
      B.BOTTOM_REGION_SET.forEach((k) => (state.boardState[k] = 2));
    }

    state.currentPlayer = 1;
    state.selected = null;
    state.inJumpChain = false;
    state.highlightCells = [];
    state.gameOver = false;
    state.rotatingCircle = null;

    // ---- 抽卡阶段(Gacha) ----
    state.phase = "draft";
    state.playerHands = {};
    for (let i = 1; i <= playerCount; i++) state.playerHands[i] = [];
    state.draftCount = 0;
    state.draftAnimating = false;
    state.draftReveal = false;
    state.lastDrawnCard = null;
    state.draftDeckRect = null;
    state.selectedCardIndex = null;

    return state;
  }

  function createInitialState(playerCount) {
    return resetState({}, playerCount || 2);
  }

  function currentDraftPlayer(state) {
    const pc = state.playerCount || 2;
    return (state.draftCount % pc) + 1;
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
    let target;
    const pc = state.playerCount || 2;
    if (pc === 6) {
      target = B.P6_GOALS[player];
    } else if (pc === 4) {
      target = B.P4_GOALS[player];
    } else {
      target = player === 1 ? B.BOTTOM_REGION_SET : B.TOP_REGION_SET;
    }
    const cells = B.BOARD_KEYS.filter((k) => state.boardState[k] === player);
    if (cells.length === 10 && cells.every((k) => target.has(k))) return player;
    return null;
  }

  /** 下一个玩家编号（支持 2/4 人循环）*/
  function nextTurnPlayer(state) {
    const pc = state.playerCount || 2;
    return (state.currentPlayer % pc) + 1;
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
    createInitialState, resetState, currentDraftPlayer, nextTurnPlayer,
    firstMoves, continueJumps, movePiece, rotateCircle,
    checkWin, draftDrawCard,
  };
})();
