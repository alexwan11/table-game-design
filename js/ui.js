/* ----------------------------------------------------------------------
 * ui.js  (在线双人版)
 * 在原本地对战版的基础上接入 WebSocket：
 *   - 新增大厅界面（创建 / 加入房间）
 *   - 所有会改变游戏状态的操作改为向服务端发消息
 *   - 服务端广播 game_state 后，客户端更新本地镜像状态并重绘
 *   - render.js / boardGeometry.js / cards.js / gameState.js 完全不改
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const B  = window.CCG.board;
  const C  = window.CCG.cards;
  const G  = window.CCG.game;
  const Rd = window.CCG.render;

  /* ── WebSocket & 身份 ── */
  let ws              = null;
  let myPlayerNum     = null;
  let isSpectator     = false;   // 是否以观战者身份进入
  let countdownInterval = null;   // 1 = 红方, 2 = 蓝方，加入房间后确定

  /* ── 游戏状态：服务端权威，客户端保留镜像 ── */
  let state = G.createInitialState();
  // 服务端会附加这两个字段，预先初始化避免 undefined
  state.currentJumper  = null;
  state.availableJumps = [];

  let canvas, ctx;
  const els = {};   // DOM 元素缓存

  /* =====================================================
     初始化入口
     ===================================================== */
  function init() {
    canvas = document.getElementById("board-canvas");
    ctx    = canvas.getContext("2d");

    // ── 游戏区控件 ──
    els.status    = document.getElementById("status-box");
    els.handCount = document.getElementById("hand-count");
    els.btnReset  = document.getElementById("btn-reset");
    els.btnEndJump = document.getElementById("btn-end-jump");
    els.circleBtns = {
      A: document.getElementById("circle-A"),
      B: document.getElementById("circle-B"),
      C: document.getElementById("circle-C"),
    };
    els.dirCw      = document.getElementById("dir-cw");
    els.dirCcw     = document.getElementById("dir-ccw");
    els.cardSelect = document.getElementById("card-select");
    els.btnConfirm = document.getElementById("btn-confirm");
    els.btnCancel  = document.getElementById("btn-cancel");
    els.winBanner  = document.getElementById("win-banner");

    // ── 大厅控件 ──
    els.lobbyOverlay  = document.getElementById("lobby-overlay");
    els.lobbyStatus   = document.getElementById("lobby-status");
    els.btnCreate     = document.getElementById("btn-create-room");
    els.roomInput     = document.getElementById("room-id-input");
    els.btnJoin       = document.getElementById("btn-join-room");
    els.roomIdDisplay = document.getElementById("room-id-display");
    els.lobbyRoomInfo = document.getElementById("lobby-room-info");
    els.playerLabel   = document.getElementById("player-label");
    els.btnCopyRoom   = document.getElementById("btn-copy-room");

    // ── 事件绑定：游戏区 ──
    canvas.addEventListener("click", onCanvasClick);
    els.btnReset.addEventListener("click", doReset);
    els.btnEndJump.addEventListener("click", endJumpClicked);
    Object.entries(els.circleBtns).forEach(([cid, btn]) =>
      btn.addEventListener("click", () => selectCircle(cid))
    );
    els.dirCw.addEventListener("change",  () => updateStatus());
    els.dirCcw.addEventListener("change", () => updateStatus());
    els.btnConfirm.addEventListener("click", confirmRotate);
    els.btnCancel.addEventListener("click",  cancelRotate);

    // ── 事件绑定：大厅 ──
    els.btnCreate.addEventListener("click", createRoom);
    els.btnJoin.addEventListener("click", joinRoom);
    els.roomInput.addEventListener("input",
      () => { els.roomInput.value = els.roomInput.value.toUpperCase(); });
    els.roomInput.addEventListener("keydown",
      (e) => { if (e.key === "Enter") joinRoom(); });
    els.btnCopyRoom.addEventListener("click", copyRoomId);

    // 画初始空棋盘（大厅背景）
    Rd.drawBoard(ctx, state);

    // 建立 WebSocket 连接
    connectWS();
  }

  /* =====================================================
     WebSocket 连接管理
     ===================================================== */
  function connectWS() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
      els.lobbyStatus.textContent = "✅ 已连接，请创建或加入房间";
      els.btnCreate.disabled  = false;
      els.btnJoin.disabled    = false;
      els.roomInput.disabled  = false;
      if (els.btnSpectate) els.btnSpectate.disabled = false;
    };

    ws.onclose = () => {
      els.lobbyStatus.textContent = "❌ 连接已断开，请刷新页面重试";
      showLobby();
    };

    ws.onerror = () => {
      els.lobbyStatus.textContent = "❌ 连接出错，请检查网络后刷新";
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleServerMsg(msg);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /* =====================================================
     服务端消息分发
     ===================================================== */
  function handleServerMsg(msg) {
    switch (msg.type) {

      case "error":
        if (msg.canSpectate) {
          // 房间满：提供"改为观战"选项
          els.lobbyStatus.textContent = "⚠ " + msg.message + "，你可以选择观战";
          if (els.lobbySpectateHint) {
            // 存入房间号供观战按钮使用
            els.lobbySpectateHint.dataset.roomId = msg.roomId || els.roomInput.value.trim().toUpperCase();
            els.lobbySpectateHint.classList.remove("hidden");
          }
        } else {
          els.lobbyStatus.textContent = "❌ " + msg.message;
        }
        els.btnCreate.disabled  = false;
        els.btnJoin.disabled    = false;
        els.roomInput.disabled  = false;
        if (els.btnSpectate) els.btnSpectate.disabled = false;
        break;

      case "joined":
        myPlayerNum = msg.playerNum;
        isSpectator = msg.isSpectator === true;

        if (isSpectator) {
          els.playerLabel.textContent = "👁 观战模式";
          els.playerLabel.style.color = "#7f8c8d";
          els.lobbyStatus.textContent = "已进入观战，游戏加载中…";
        } else {
          els.playerLabel.textContent = `你是 ${B.PLAYER_NAME[msg.playerNum]}`;
          els.playerLabel.style.color = B.PLAYER_COLOR[msg.playerNum];
          if (msg.playerNum === 1) {
            els.roomIdDisplay.textContent = msg.roomId;
            els.lobbyRoomInfo.classList.remove("hidden");
          }
          if (msg.maxPlayers > 2) {
            els.lobbyStatus.textContent =
              `已加入，等待更多玩家（1/${msg.maxPlayers}）…`;
          }
        }
        break;

      case "waiting":
        if (msg.maxPlayers > 2) {
          els.lobbyStatus.textContent =
            `⏳ 已有 ${msg.playerCount}/${msg.maxPlayers} 名玩家，等待更多人加入…`;
        } else {
          els.lobbyStatus.textContent = "⏳ 等待对方加入，把房间号分享给对方…";
        }
        break;

      case "game_state":
        applyGameState(msg);
        break;

      case "spectator_count":
        if (els.spectatorCount) {
          els.spectatorCount.textContent =
            msg.count > 0 ? `👁 ${msg.count} 名观众` : "";
        }
        break;

      case "player_left":
        els.winBanner.textContent =
          `对方（${B.PLAYER_NAME[msg.playerNum]}）已断开连接，游戏中止`;
        els.winBanner.classList.remove("hidden");
        break;
    }
  }

  /* =====================================================
     大厅：显示 / 隐藏 / 创建 / 加入
     ===================================================== */
  function showLobby() {
    els.lobbyOverlay.classList.remove("hidden");
  }
  function hideLobby() {
    els.lobbyOverlay.classList.add("hidden");
  }

  function createRoom() {
    els.lobbyStatus.textContent = "正在创建房间…";
    els.btnCreate.disabled  = true;
    els.btnJoin.disabled    = true;
    els.roomInput.disabled  = true;
    if (els.btnSpectate) els.btnSpectate.disabled = true;
    const playerCount = Number(new URLSearchParams(location.search).get('players')) || 2;
    send({ type: "create_room", playerCount });
  }

  function joinRoom() {
    const roomId = els.roomInput.value.trim().toUpperCase();
    if (!roomId) { els.lobbyStatus.textContent = "⚠ 请先输入房间号"; return; }
    els.lobbyStatus.textContent = "正在加入房间…";
    els.btnCreate.disabled  = true;
    els.btnJoin.disabled    = true;
    els.roomInput.disabled  = true;
    if (els.btnSpectate) els.btnSpectate.disabled = true;
    send({ type: "join_room", roomId, asSpectator: false });
  }

  function joinAsSpectator() {
    // 优先从"房间已满"提示里读取已知房间号，其次用输入框
    const hint   = els.lobbySpectateHint;
    const roomId = (hint && hint.dataset.roomId)
      ? hint.dataset.roomId
      : (els.roomInput.value.trim().toUpperCase());
    if (!roomId) { els.lobbyStatus.textContent = "⚠ 请输入房间号"; return; }
    els.lobbyStatus.textContent = "正在以观战者身份加入…";
    els.btnCreate.disabled  = true;
    els.btnJoin.disabled    = true;
    els.roomInput.disabled  = true;
    if (els.btnSpectate) els.btnSpectate.disabled = true;
    send({ type: "join_room", roomId, asSpectator: true });
  }

  function copyRoomId() {
    const id = els.roomIdDisplay.textContent;
    if (!id) return;

    const onSuccess = () => {
      els.btnCopyRoom.textContent = "✅ 已复制";
      setTimeout(() => { els.btnCopyRoom.textContent = "复制"; }, 2000);
    };

    // 兜底方案：HTTP 下 navigator.clipboard 不可用，改用 execCommand
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = id;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand("copy"); onSuccess(); }
      catch (e) { alert("复制失败，请手动复制房间号：" + id); }
      document.body.removeChild(ta);
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(id).then(onSuccess).catch(fallback);
    } else {
      fallback();
    }
  }

  /* =====================================================
     接收并应用服务端全量状态
     ===================================================== */
  function applyGameState(msg) {
    // ── 一收到 game_state 就关闭大厅 ──
    hideLobby();

    // ── 更新状态镜像（服务端权威字段）──
    state.boardState     = msg.boardState;
    state.currentPlayer  = msg.currentPlayer;
    state.phase          = msg.phase;
    state.playerHands    = msg.playerHands;
    state.draftCount     = msg.draftCount;
    state.gameOver       = msg.gameOver;
    state.inJumpChain      = msg.inJumpChain;
    state.playerCount      = msg.playerCount || 2;
    state.handSize         = msg.handSize || 5;
    state.totalDraftDraws  = msg.totalDraftDraws || 10;
    state.myPlayerNum      = myPlayerNum;
    state.turnStartTime    = msg.turnStartTime || null;
    if (els.spectatorCount) {
      els.spectatorCount.textContent =
        (msg.spectatorCount > 0) ? `👁 ${msg.spectatorCount} 名观众` : "";
    }
    state.currentJumper  = msg.currentJumper;
    state.availableJumps = msg.availableJumps || [];
    state.lastDrawnCard  = msg.lastDrawnCard;

    // ── 重置本地 UI 状态 ──
    state.rotatingCircle    = null;
    state.selectedCardIndex = null;
    // 跳跃链中且轮到自己时，保留高亮
    if (msg.inJumpChain && msg.currentPlayer === myPlayerNum) {
      state.selected       = msg.currentJumper;
      state.highlightCells = msg.availableJumps || [];
    } else {
      state.selected       = null;
      state.highlightCells = [];
    }

    const lastAction = msg.lastAction;

    // ── 抽卡动画（双方都要看到）──
    if (lastAction && lastAction.type === "card_drawn") {
      const isMyDraw = lastAction.player === myPlayerNum;
      state.draftAnimating = true;
      state.draftReveal    = false;
      redraw();
      updateStatus(isMyDraw
        ? "抽取中…"
        : `${B.PLAYER_NAME[lastAction.player]} 正在抽取卡牌…`);

      if (isMyDraw) {
        // 己方抽卡 → 显示翻牌揭示动画
        setTimeout(() => {
          state.draftReveal = true;
          redraw();
          updateStatus(`获得 ${lastAction.card.rarity}（${lastAction.card.degree}°）卡牌！`);
          setTimeout(() => {
            state.draftAnimating = false;
            state.draftReveal    = false;
            fullRefresh();
          }, 1000);
        }, 300);
      } else {
        // 对手抽卡 → 只显示"抽取中"动画，不翻牌，不暴露内容
        setTimeout(() => {
          state.draftAnimating = false;
          fullRefresh();
        }, 800);
      }
      return;
    }

    // 倒计时
    if (msg.phase === 'play' && !msg.gameOver && msg.turnStartTime) {
      startCountdown(msg.turnStartTime);
    } else {
      stopCountdown();
    }

    // turn_timeout 超时提示
    if (lastAction && lastAction.type === 'turn_timeout') {
      els.status.textContent =
        `⏰ ${B.PLAYER_NAME[lastAction.timedOutPlayer]} 超时，自动跳过回合！`;
    }

    fullRefresh();

    if (msg.gameOver && msg.winner) showWinBanner(msg.winner);
  }

  /* =====================================================
     全量刷新
     ===================================================== */
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

  /* =====================================================
     画布点击：走棋 / 跳跃 / 抽卡
     ===================================================== */
  function onCanvasClick(e) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;

    if (isSpectator) return;   // 观战者不能操作
    if (isSpectator && state.phase === "play" && !state.gameOver) {
      els.status.textContent = `👁 观战中：轮到 ${B.PLAYER_NAME[state.currentPlayer]} 走棋`;
      return;
    }
    if (state.phase === "draft") { handleDraftClick(x, y); return; }
    if (state.gameOver) return;
    if (state.currentPlayer !== myPlayerNum) return;
    if (state.rotatingCircle !== null) return;       // 正在配置旋转

    const cellKey = findClickedCell(x, y);
    if (cellKey === null) return;

    if (!state.inJumpChain) handleClickNormal(cellKey);
    else                    handleClickJumpChain(cellKey);
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

  /* =====================================================
     走棋逻辑（本地预览选中 + 高亮，发消息时服务端验证）
     ===================================================== */
  function handleClickNormal(cellKey) {
    const st = state.boardState[cellKey];

    if (st === myPlayerNum) {
      // 选中己方棋子，本地计算可走位置（仅用于高亮预览）
      state.selected = cellKey;
      const { steps, jumps } = G.firstMoves(state, cellKey);
      state.highlightCells = steps.concat(jumps);
      redraw(); updateStatus();
      return;
    }

    if (state.selected === null) return;

    if (state.highlightCells.includes(cellKey)) {
      // 发送移动请求，服务端验证后广播新状态
      send({ type: "move", src: state.selected, dst: cellKey });
      // 乐观清除选中，等待服务端回包更新
      state.selected       = null;
      state.highlightCells = [];
      redraw();
      return;
    }

    // 点击非高亮处 → 取消选中
    state.selected       = null;
    state.highlightCells = [];
    redraw(); updateStatus();
  }

  function handleClickJumpChain(cellKey) {
    if (state.highlightCells.includes(cellKey)) {
      send({ type: "move", src: state.selected, dst: cellKey });
      state.selected       = null;
      state.highlightCells = [];
      redraw();
    } else if (cellKey === state.selected) {
      endJumpClicked();
    }
  }

  function endJumpClicked() {
    if (!state.inJumpChain) return;
    send({ type: "end_jump" });
    els.btnEndJump.disabled = true;
  }

  /* =====================================================
     抽卡阶段
     ===================================================== */
  function handleDraftClick(x, y) {
    if (state.draftAnimating) return;
    // 只有当前应抽卡的玩家才能点击
    if (G.currentDraftPlayer(state) !== myPlayerNum) return;
    const r = state.draftDeckRect;
    if (!r) return;
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
      send({ type: "draw_card" });
    }
  }

  /* =====================================================
     圆盘旋转（本地选圆盘 + 选卡，确认后发送）
     ===================================================== */
  function selectCircle(cid) {
    if (state.gameOver || state.inJumpChain || state.phase !== "play") return;
    if (state.currentPlayer !== myPlayerNum) return;
    if ((state.playerHands[myPlayerNum] || []).length === 0) return;

    state.selected          = null;
    state.highlightCells    = [];
    state.rotatingCircle    = cid;
    state.selectedCardIndex = null;
    updateControlsState();
    redraw(); updateStatus();
  }

  function cancelRotate() {
    state.rotatingCircle    = null;
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
      updateStatus("⚠ 请先在下方选择一张要打出的卡牌"); return;
    }
    send({
      type      : "rotate_disk",
      cid       : state.rotatingCircle,
      direction : getDirection(),
      cardIndex : state.selectedCardIndex,
    });
    state.rotatingCircle    = null;
    state.selectedCardIndex = null;
    updateControlsState();
  }

  /* =====================================================
     重置
     ===================================================== */
  function doReset() {
    els.winBanner.classList.add("hidden");
    send({ type: "reset" });
  }

  /* =====================================================
     获胜横幅
     ===================================================== */
  /* =====================================================
     倒计时
     ===================================================== */
  function startCountdown(turnStartTime) {
    stopCountdown();
    updateCountdown(turnStartTime);                 // 立即刷新一次
    countdownInterval = setInterval(() => updateCountdown(turnStartTime), 500);
  }

  function stopCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    const el = document.getElementById('countdown-bar');
    if (el) { el.textContent = ''; el.className = 'countdown-bar'; }
  }

  function updateCountdown(turnStartTime) {
    const el = document.getElementById('countdown-bar');
    if (!el) return;
    const elapsed   = Math.floor((Date.now() - turnStartTime) / 1000);
    const remaining = Math.max(0, 60 - elapsed);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const pad  = (n) => String(n).padStart(2, '0');
    el.textContent = `⏱ ${pad(mins)}:${pad(secs)}`;
    el.className   = 'countdown-bar'
      + (remaining <= 10 ? ' urgent' : remaining <= 30 ? ' warning' : '');
    if (remaining === 0) stopCountdown();
  }

  function showWinBanner(winner) {
    const isMe = winner === myPlayerNum;
    els.winBanner.textContent =
      isMe
        ? `🎉 你赢了！（${B.PLAYER_NAME[winner]}）`
        : `😞 ${B.PLAYER_NAME[winner]} 获胜，你输了`;
    els.winBanner.classList.remove("hidden");
  }

  /* =====================================================
     控件状态更新
     ===================================================== */
  function updateControlsState() {
    if (isSpectator) {
      // 观战者：禁用全部交互控件
      Object.values(els.circleBtns).forEach((b) => { b.disabled = true; b.classList.remove("active"); });
      [els.dirCw, els.dirCcw, els.btnConfirm, els.btnCancel, els.btnEndJump].forEach((el) => { if(el) el.disabled = true; });
      refreshCardSelector();
      updateHandCounts();
      return;
    }
    const isMyTurn  = state.phase === "play" && !state.gameOver &&
                      state.currentPlayer === myPlayerNum;
    const hand      = state.phase === "play"
                      ? (state.playerHands[myPlayerNum] || []) : [];
    const canRotate = isMyTurn && !state.inJumpChain && hand.length > 0;

    Object.entries(els.circleBtns).forEach(([cid, btn]) => {
      btn.disabled = !canRotate;
      btn.classList.toggle("active", cid === state.rotatingCircle);
    });

    const configuring = canRotate && state.rotatingCircle !== null;
    [els.dirCw, els.dirCcw, els.btnConfirm, els.btnCancel].forEach(
      (el) => (el.disabled = !configuring)
    );

    els.btnEndJump.disabled = !(isMyTurn && state.inJumpChain);

    refreshCardSelector();
    updateHandCounts();
  }

  function refreshCardSelector() {
    els.cardSelect.innerHTML = "";
    if (state.phase !== "play") {
      els.cardSelect.innerHTML = '<span class="placeholder">（开局后才能使用卡牌）</span>';
      return;
    }
    const hand = isSpectator
      ? (state.playerHands[state.currentPlayer] || [])
      : (state.playerHands[myPlayerNum] || []);
    if (!hand.length) {
      els.cardSelect.innerHTML = isSpectator
        ? '<span class="placeholder">（当前玩家无手牌）</span>'
        : '<span class="placeholder">（你已无手牌，无法旋转圆盘）</span>';
      return;
    }
    const active = state.rotatingCircle !== null && state.currentPlayer === myPlayerNum;
    hand.forEach((card, idx) => {
      const btn = document.createElement("button");
      btn.type      = "button";
      btn.className = "card-btn" + (idx === state.selectedCardIndex ? " selected" : "");
      btn.style.background = card.color;
      btn.disabled  = !active;
      btn.innerHTML = `${card.degree}°<br>${card.stars}`;
      btn.addEventListener("click", () => selectCard(idx));
      els.cardSelect.appendChild(btn);
    });
  }

  function updateHandCounts() {
    const pc     = state.playerCount || 2;
    const hs     = state.handSize || C.HAND_SIZE;
    const emojis = ['🔴','🔵','🟢','🟠','🟣','🩵'];
    const parts  = [];
    for (let p = 1; p <= pc; p++) {
      const n = (state.playerHands[p] || []).length;
      parts.push(`${emojis[p-1]} ${B.PLAYER_NAME[p]} ${n}/${hs}`);
    }
    els.handCount.textContent = parts.join('　');
  }

  function updateStatus(extra) {
    if (state.gameOver) return;

    if (state.phase === "draft") {
      const p    = G.currentDraftPlayer(state);
      const isMe = p === myPlayerNum;
      const hs   = state.handSize || C.HAND_SIZE;
      let msg = `🎴 抽卡阶段：${B.PLAYER_NAME[p]} 抽卡中 ` +
                `(${(state.playerHands[p] || []).length}/${hs})`;
      msg += isMe ? "　请点击棋盘中央卡背抽取" : "　等待对方抽卡…";
      if (extra) msg += "　" + extra;
      els.status.textContent = msg;
      return;
    }

    const isMe = state.currentPlayer === myPlayerNum;
    let msg = `轮到 ${B.PLAYER_NAME[state.currentPlayer]} 走棋`;
    if (!isMe) msg += "（等待对方操作…）";
    if (state.inJumpChain && isMe)
      msg += "（连续跳跃中，可继续跳或点击「结束跳跃」）";
    if (state.rotatingCircle) {
      msg += `（正在配置旋转：${B.CIRCLE_LABEL[state.rotatingCircle]}）`;
      const hand = state.playerHands[myPlayerNum] || [];
      if (state.selectedCardIndex !== null && state.selectedCardIndex < hand.length)
        msg += ` 已选卡牌 ${hand[state.selectedCardIndex].degree}°`;
      else
        msg += " 请在下方选择卡牌";
    }
    if (extra) msg += "  " + extra;
    els.status.textContent = msg;
  }

  window.CCG = window.CCG || {};
  window.CCG.ui = { init };
})();