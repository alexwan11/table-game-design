/**
 * server.js — 中国跳棋在线双人对战服务器
 *
 * 架构：
 *   - HTTP：静态文件服务（直接服务 index.html / js / css）
 *   - WebSocket：所有游戏操作通过 WS 消息传递，服务端持有权威状态
 *   - 游戏逻辑：直接 require 客户端的 boardGeometry / cards / gameState，
 *     一份代码两端共用，不会出现规则不一致的问题。
 *
 * 消息协议（Client → Server）：
 *   create_room  {}
 *   join_room    { roomId }
 *   draw_card    {}
 *   move         { src, dst }
 *   end_jump     {}
 *   rotate_disk  { cid, direction, cardIndex }
 *   reset        {}
 *
 * 消息协议（Server → Client）：
 *   error        { message }
 *   joined       { roomId, playerNum }
 *   waiting      {}                       ← 房间创建成功，等待第二人
 *   game_state   { ...全量状态, lastAction }  ← 每次游戏变化后广播
 *   player_left  { playerNum }
 */

'use strict';

/* ── Node.js 内加载浏览器风格的 window.CCG 模块 ── */
global.window = global;
global.CCG    = {};
require('./js/boardGeometry.js');
require('./js/cards.js');
require('./js/gameState.js');

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const B = global.CCG.board;
const C = global.CCG.cards;
const G = global.CCG.game;

const PORT       = process.env.PORT || 3000;
const STATIC_DIR = __dirname;

/* ────────────────────────────────────────────
   静态文件服务
   ──────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.ico' : 'image/x-icon',
  '.png' : 'image/png',
};

const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(STATIC_DIR, urlPath);
  // 防目录穿越
  if (!filePath.startsWith(STATIC_DIR + path.sep) && filePath !== STATIC_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

/* ────────────────────────────────────────────
   房间管理
   ──────────────────────────────────────────── */
const rooms = new Map();   // roomId → Room

class Room {
  constructor(id) {
    this.id      = id;
    this.sockets = new Map();   // playerNum(1|2) → ws
    this.state   = G.createInitialState();
    // 这两个字段 gameState.js 里没有，在这里手动追加
    this.state.currentJumper  = null;
    this.state.availableJumps = [];
  }

  get playerCount() { return this.sockets.size; }
  isFull()          { return this.sockets.size >= 2; }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    this.sockets.forEach((ws) => { if (ws.readyState === 1) ws.send(data); });
  }

  sendTo(playerNum, msg) {
    const ws = this.sockets.get(playerNum);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /** 序列化当前全量状态，附带一个 lastAction 供客户端做动画提示 */
  snapshot(lastAction) {
    const s = this.state;
    // 检查胜负（旋转后双方都可能赢，先检查1）
    const winner = s.gameOver
      ? (G.checkWin(s, 1) || G.checkWin(s, 2) || null)
      : null;
    return {
      type          : 'game_state',
      boardState    : s.boardState,
      currentPlayer : s.currentPlayer,
      phase         : s.phase,
      playerHands   : s.playerHands,
      draftCount    : s.draftCount,
      gameOver      : s.gameOver,
      winner,
      inJumpChain   : s.inJumpChain,
      currentJumper : s.currentJumper,
      availableJumps: s.availableJumps,
      lastDrawnCard : s.lastDrawnCard,
      lastAction    : lastAction || null,
    };
  }
}

function newRoomId() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 200; i++) {
    const id = Array.from({ length: 6 },
      () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
    if (!rooms.has(id)) return id;
  }
  throw new Error('无法生成唯一房间号');
}

/* ────────────────────────────────────────────
   WebSocket 处理
   ──────────────────────────────────────────── */
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws._roomId    = null;
  ws._playerNum = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const room = ws._roomId ? rooms.get(ws._roomId) : null;

    switch (msg.type) {

      /* ── 大厅 ── */
      case 'create_room': {
        if (ws._roomId) return;
        const id   = newRoomId();
        const room = new Room(id);
        rooms.set(id, room);
        room.sockets.set(1, ws);
        ws._roomId    = id;
        ws._playerNum = 1;
        ws.send(JSON.stringify({ type: 'joined', roomId: id, playerNum: 1 }));
        ws.send(JSON.stringify({ type: 'waiting' }));
        break;
      }

      case 'join_room': {
        if (ws._roomId) return;
        const id = (msg.roomId || '').toUpperCase().trim();
        const target = rooms.get(id);
        if (!target) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在，请检查房间号' })); return;
        }
        if (target.isFull()) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已满（已有两名玩家）' })); return;
        }
        target.sockets.set(2, ws);
        ws._roomId    = id;
        ws._playerNum = 2;
        ws.send(JSON.stringify({ type: 'joined', roomId: id, playerNum: 2 }));
        // 双方都在 → 广播初始抽卡阶段状态
        target.broadcast(target.snapshot({ type: 'game_start' }));
        break;
      }

      /* ── 抽卡阶段 ── */
      case 'draw_card': {
        if (!room || room.state.phase !== 'draft') return;
        const expected = G.currentDraftPlayer(room.state);
        if (ws._playerNum !== expected) return;

        const card = G.draftDrawCard(room.state);
        if (!card) return;

        const done = room.state.draftCount >= C.TOTAL_DRAFT_DRAWS;
        if (done) {
          room.state.phase         = 'play';
          room.state.currentPlayer = 1;
        }
        room.broadcast(room.snapshot({ type: 'card_drawn', player: expected, card, done }));
        break;
      }

      /* ── 走棋 / 跳跃 ── */
      case 'move': {
        if (!room || room.state.phase !== 'play' || room.state.gameOver) return;
        if (ws._playerNum !== room.state.currentPlayer) return;

        const { src, dst } = msg;
        if (!B.BOARD_SET.has(src) || !B.BOARD_SET.has(dst)) return;
        if (room.state.boardState[src] !== room.state.currentPlayer) return;

        const s = room.state;

        if (!s.inJumpChain) {
          /* ── 第一步 ── */
          const { steps, jumps } = G.firstMoves(s, src);

          if (steps.includes(dst)) {
            // 单步移动 → 立即结束回合
            G.movePiece(s, src, dst);
            const w = G.checkWin(s, s.currentPlayer);
            if (w) s.gameOver = true;
            else   s.currentPlayer = s.currentPlayer === 1 ? 2 : 1;
            room.broadcast(room.snapshot({ type: 'move', src, dst }));

          } else if (jumps.includes(dst)) {
            // 跳跃开始
            G.movePiece(s, src, dst);
            s.inJumpChain  = true;
            s.currentJumper = dst;
            s.availableJumps = G.continueJumps(s, dst);

            if (s.availableJumps.length === 0) {
              // 无路可继续 → 自动结束
              const w = G.checkWin(s, s.currentPlayer);
              s.inJumpChain   = false;
              s.currentJumper = null;
              if (w) s.gameOver = true;
              else   s.currentPlayer = s.currentPlayer === 1 ? 2 : 1;
            }
            room.broadcast(room.snapshot({ type: 'move', src, dst }));

          }
          // 非法目标：忽略
          return;
        }

        /* ── 连续跳跃 ── */
        if (src !== s.currentJumper || !s.availableJumps.includes(dst)) return;

        G.movePiece(s, src, dst);
        s.currentJumper  = dst;
        s.availableJumps = G.continueJumps(s, dst);

        if (s.availableJumps.length === 0) {
          const w = G.checkWin(s, s.currentPlayer);
          s.inJumpChain   = false;
          s.currentJumper = null;
          if (w) s.gameOver = true;
          else   s.currentPlayer = s.currentPlayer === 1 ? 2 : 1;
        }
        room.broadcast(room.snapshot({ type: 'move', src, dst }));
        break;
      }

      /* ── 主动结束跳跃 ── */
      case 'end_jump': {
        if (!room || !room.state.inJumpChain || room.state.gameOver) return;
        if (ws._playerNum !== room.state.currentPlayer) return;

        const s = room.state;
        const w = G.checkWin(s, s.currentPlayer);
        s.inJumpChain   = false;
        s.currentJumper = null;
        s.availableJumps = [];
        if (w) s.gameOver = true;
        else   s.currentPlayer = s.currentPlayer === 1 ? 2 : 1;
        room.broadcast(room.snapshot({ type: 'end_jump' }));
        break;
      }

      /* ── 旋转圆盘 ── */
      case 'rotate_disk': {
        if (!room || room.state.phase !== 'play' || room.state.gameOver) return;
        if (ws._playerNum !== room.state.currentPlayer) return;

        const { cid, direction, cardIndex } = msg;
        if (!['A', 'B', 'C'].includes(cid))  return;
        if (!['cw', 'ccw'].includes(direction)) return;

        const hand = room.state.playerHands[room.state.currentPlayer];
        if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= hand.length) return;

        const card = hand.splice(cardIndex, 1)[0];
        G.rotateCircle(room.state, cid, direction, card.steps);

        const w = G.checkWin(room.state, 1) || G.checkWin(room.state, 2);
        if (w) room.state.gameOver = true;
        else   room.state.currentPlayer = room.state.currentPlayer === 1 ? 2 : 1;
        room.broadcast(room.snapshot({ type: 'disk_rotated', cid, direction, steps: card.steps }));
        break;
      }

      /* ── 重置 ── */
      case 'reset': {
        if (!room) return;
        G.resetState(room.state);
        room.state.currentJumper  = null;
        room.state.availableJumps = [];
        room.broadcast(room.snapshot({ type: 'reset' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = ws._roomId ? rooms.get(ws._roomId) : null;
    if (!room) return;
    room.broadcast({ type: 'player_left', playerNum: ws._playerNum });
    room.sockets.delete(ws._playerNum);
    // 30 秒后清理空房间
    setTimeout(() => {
      const r = rooms.get(ws._roomId);
      if (r && r.playerCount === 0) rooms.delete(ws._roomId);
    }, 30_000);
  });
});

httpServer.listen(PORT, () => {
  console.log(`✅  服务器已启动 → http://localhost:${PORT}`);
  console.log(`   当前房间数: ${rooms.size}`);
});
