/* ----------------------------------------------------------------------
 * boardGeometry.js
 * 棋盘几何：立方体坐标 (x,y,z, x+y+z=0) 表示三角网格上的孔位，
 * 以及中央三个可旋转"圆盘"的格点定义。
 * 直接翻译自原 Python/tkinter 版本，不依赖任何 DOM。
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const R = 4; // 中心六边形的"半径"

  const DIRS = [
    [1, -1, 0], [1, 0, -1], [0, 1, -1],
    [-1, 1, 0], [-1, 0, 1], [0, -1, 1],
  ];

  function key(cell) {
    return cell[0] + "," + cell[1] + "," + cell[2];
  }
  function parseKey(k) {
    return k.split(",").map(Number);
  }

  function inHex(x, y, z) {
    return Math.abs(x) <= R && Math.abs(y) <= R && Math.abs(z) <= R;
  }
  function inPoint(x, y, z) {
    return (
      (z <= -(R + 1) && x <= R && y <= R) ||
      (z >= (R + 1) && x >= -R && y >= -R) ||
      (x <= -(R + 1) && y <= R && z <= R) ||
      (x >= (R + 1) && y >= -R && z >= -R) ||
      (y <= -(R + 1) && x <= R && z <= R) ||
      (y >= (R + 1) && x >= -R && z >= -R)
    );
  }

  function buildBoard() {
    const cells = [];
    for (let x = -2 * R; x <= 2 * R; x++) {
      for (let y = -2 * R; y <= 2 * R; y++) {
        const z = -x - y;
        if (Math.abs(z) <= 2 * R && (inHex(x, y, z) || inPoint(x, y, z))) {
          cells.push([x, y, z]);
        }
      }
    }
    return cells;
  }

  const BOARD = buildBoard();
  const BOARD_KEYS = BOARD.map(key);
  const BOARD_SET = new Set(BOARD_KEYS);

  const TOP_REGION = BOARD.filter(([x, y, z]) => z <= -(R + 1) && x <= R && y <= R);
  const BOTTOM_REGION = BOARD.filter(([x, y, z]) => z >= (R + 1) && x >= -R && y >= -R);
  const TOP_REGION_SET = new Set(TOP_REGION.map(key));
  const BOTTOM_REGION_SET = new Set(BOTTOM_REGION.map(key));

  // 健全性检查（与原 Python 版本中的 assert 对应）
  console.assert(BOARD.length === 121, "board should have 121 holes, got " + BOARD.length);
  console.assert(TOP_REGION.length === 10, "top region should have 10 holes");
  console.assert(BOTTOM_REGION.length === 10, "bottom region should have 10 holes");

  // -------------------- 立方体坐标 -> 像素坐标 --------------------
  const SIZE = 24;
  const HOLE_R = 11;
  const CLICK_R = 16;
  const CANVAS_W = 600;
  const CANVAS_H = 700;
  const OFFSET_X = CANVAS_W / 2;
  const OFFSET_Y = CANVAS_H / 2 - 10;

  function cellToPixel(cell) {
    const x = cell[0], z = cell[2];
    const q = x, r = z;
    const px = SIZE * Math.sqrt(3) * (q + r / 2);
    const py = SIZE * 1.5 * r;
    return { x: OFFSET_X + px, y: OFFSET_Y + py };
  }

  const PIXEL = {};
  BOARD.forEach((c) => (PIXEL[key(c)] = cellToPixel(c)));

  // -------------------- 中央三个可旋转圆盘 --------------------
  function hexRing(center, radius) {
    if (radius === 0) return [center.slice()];
    const [cx, cy, cz] = center;
    const results = [];
    const [sdx, sdy, sdz] = DIRS[4];
    let x = cx + sdx * radius, y = cy + sdy * radius, z = cz + sdz * radius;
    for (let i = 0; i < 6; i++) {
      const [ddx, ddy, ddz] = DIRS[i];
      for (let s = 0; s < radius; s++) {
        results.push([x, y, z]);
        x += ddx; y += ddy; z += ddz;
      }
    }
    return results;
  }

  const DISK_R = 2; // 圆盘半径：圆心 + 第1环(6格) + 第2环(12格) = 19格
  const CIRCLE_CENTERS = { A: [1, -1, 0], B: [0, 1, -1], C: [-1, 0, 1] };
  const CIRCLE_COLOR = { A: "#e67e22", B: "#9b59b6", C: "#16a085" };
  const CIRCLE_LABEL = { A: "圆盘 A（橙）", B: "圆盘 B（紫）", C: "圆盘 C（青）" };

  const CIRCLE_DISK_RINGS = {};
  const CIRCLE_DISK_CELLS = {};
  Object.entries(CIRCLE_CENTERS).forEach(([cid, center]) => {
    const rings = {};
    for (let r = 0; r <= DISK_R; r++) rings[r] = hexRing(center, r);
    CIRCLE_DISK_RINGS[cid] = rings;
    const cellSet = new Set();
    Object.values(rings).forEach((ring) => ring.forEach((c) => cellSet.add(key(c))));
    CIRCLE_DISK_CELLS[cid] = cellSet;
  });

  const CIRCLE_DRAW = {};
  Object.entries(CIRCLE_CENTERS).forEach(([cid, center]) => {
    const c = cellToPixel(center);
    const outerRing = CIRCLE_DISK_RINGS[cid][DISK_R];
    const dists = outerRing.map((pt) => {
      const p = cellToPixel(pt);
      return Math.hypot(p.x - c.x, p.y - c.y);
    });
    const rad = dists.reduce((a, b) => a + b, 0) / dists.length;
    CIRCLE_DRAW[cid] = { cx: c.x, cy: c.y, rad };
  });

  const CELL_DISK_MEMBERSHIP = {};
  BOARD_KEYS.forEach((k) => {
    const owned = ["A", "B", "C"].filter((cid) => CIRCLE_DISK_CELLS[cid].has(k));
    if (owned.length) CELL_DISK_MEMBERSHIP[k] = owned.sort();
  });

  const TINT_COLOR = {
    "A": "#fdebd0",
    "B": "#f0e6f6",
    "C": "#daf5ef",
    "A,B": "#f6d4d4",
    "B,C": "#d6e8f7",
    "A,C": "#eaf0c8",
    "A,B,C": "#fff2a8",
  };

  // -------------------- 颜色 / 名称配置（支持 2/4 人）--------------------
  const PLAYER_NAME    = { 1: "红方", 2: "蓝方", 3: "绿方", 4: "橙方", 5: "紫方", 6: "青方" };
  const PLAYER_COLOR   = { 1: "#e74c3c", 2: "#3498db", 3: "#27ae60", 4: "#f39c12", 5: "#9b59b6", 6: "#1abc9c" };
  const PLAYER_OUTLINE = { 1: "#922b1f", 2: "#1f618d", 3: "#1a6e3f", 4: "#b7770d", 5: "#6c3483", 6: "#148f77" };

  // -------------------- 4人模式：6个臂区域 --------------------
  // 布局：P1=顶, P2=右上, P3=底, P4=左下（两两相对）
  // 剩余两臂（右下/左上）为空白通道
  const ARM = {
    top:          new Set(BOARD.filter(([x,y,z]) => z<=-(R+1) && x<=R && y<=R   ).map(key)),
    top_right:    new Set(BOARD.filter(([x,y,z]) => x>=(R+1)  && y>=-R && z>=-R ).map(key)),
    bottom_right: new Set(BOARD.filter(([x,y,z]) => y<=-(R+1) && x<=R && z<=R   ).map(key)),
    bottom:       new Set(BOARD.filter(([x,y,z]) => z>=(R+1)  && x>=-R && y>=-R ).map(key)),
    bottom_left:  new Set(BOARD.filter(([x,y,z]) => x<=-(R+1) && y<=R && z<=R   ).map(key)),
    top_left:     new Set(BOARD.filter(([x,y,z]) => y>=(R+1)  && x>=-R && z>=-R ).map(key)),
  };
  // 4人起始位置 & 目标位置
  const P4_STARTS = { 1: ARM.top, 2: ARM.top_right, 3: ARM.bottom, 4: ARM.bottom_left };
  const P4_GOALS  = { 1: ARM.bottom, 2: ARM.bottom_left, 3: ARM.top, 4: ARM.top_right };

  // 6人模式：全部6个臂，顶点顺序P1→P2→P3顺时针，对面分别是P4→P5→P6
  const P6_STARTS = {
    1: ARM.top,          2: ARM.top_right,   3: ARM.bottom_right,
    4: ARM.bottom,       5: ARM.bottom_left, 6: ARM.top_left,
  };
  const P6_GOALS = {
    1: ARM.bottom,       2: ARM.bottom_left, 3: ARM.top_left,
    4: ARM.top,          5: ARM.top_right,   6: ARM.bottom_right,
  };

  window.CCG = window.CCG || {};
  window.CCG.board = {
    R, DIRS, key, parseKey,
    BOARD, BOARD_KEYS, BOARD_SET,
    TOP_REGION_SET, BOTTOM_REGION_SET,
    ARM, P4_STARTS, P4_GOALS, P6_STARTS, P6_GOALS,
    SIZE, HOLE_R, CLICK_R, CANVAS_W, CANVAS_H,
    cellToPixel, PIXEL,
    DISK_R, CIRCLE_CENTERS, CIRCLE_COLOR, CIRCLE_LABEL,
    CIRCLE_DISK_RINGS, CIRCLE_DISK_CELLS, CIRCLE_DRAW,
    CELL_DISK_MEMBERSHIP, TINT_COLOR,
    PLAYER_NAME, PLAYER_COLOR, PLAYER_OUTLINE,
  };
})();
