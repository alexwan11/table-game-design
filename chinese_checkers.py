#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中国跳棋 (Chinese Checkers) - 两人对战升级版
使用 tkinter 实现的图形界面，鼠标点击操作。

新增机关：棋盘中央有三个互相重叠的圆盘（类似韦恩图，不是细圆环而是整片实心区域）。
每回合玩家可以二选一：
    A) 正常走一步棋 / 进行一次连续跳跃；
    B) 选择一个圆盘，指定方向（顺时针/逆时针）和格数（每格=60°，1~5格），旋转它 ——
       圆盘内部所有同心环上的棋子（无论谁的棋子，圆心棋子除外）都会作为一个整体
       一起转动到新的位置。
两个动作选其一，做完即结束本回合。

胜负判定：谁先把自己全部 10 颗棋子移动到棋盘对面的尖角区域，谁获胜。
"""

import tkinter as tk
from tkinter import messagebox
import math

# ----------------------------------------------------------------------
# 1. 棋盘几何：使用立方体坐标 (x, y, z)，x + y + z = 0 来表示三角网格上的孔位
# ----------------------------------------------------------------------

R = 4  # 中心六边形的"半径"

DIRS = [(1, -1, 0), (1, 0, -1), (0, 1, -1),
        (-1, 1, 0), (-1, 0, 1), (0, -1, 1)]


def in_hex(x, y, z):
    return abs(x) <= R and abs(y) <= R and abs(z) <= R


def in_point(x, y, z):
    return ((z <= -(R + 1) and x <= R and y <= R) or
            (z >= (R + 1) and x >= -R and y >= -R) or
            (x <= -(R + 1) and y <= R and z <= R) or
            (x >= (R + 1) and y >= -R and z >= -R) or
            (y <= -(R + 1) and x <= R and z <= R) or
            (y >= (R + 1) and x >= -R and z >= -R))


def build_board():
    cells = set()
    for x in range(-2 * R, 2 * R + 1):
        for y in range(-2 * R, 2 * R + 1):
            z = -x - y
            if abs(z) <= 2 * R:
                if in_hex(x, y, z) or in_point(x, y, z):
                    cells.add((x, y, z))
    return cells


BOARD = build_board()

TOP_REGION = {(x, y, z) for (x, y, z) in BOARD if z <= -(R + 1) and x <= R and y <= R}
BOTTOM_REGION = {(x, y, z) for (x, y, z) in BOARD if z >= (R + 1) and x >= -R and y >= -R}

assert len(BOARD) == 121
assert len(TOP_REGION) == 10
assert len(BOTTOM_REGION) == 10

# ----------------------------------------------------------------------
# 2. 立方体坐标 -> 屏幕像素坐标
# ----------------------------------------------------------------------

SIZE = 24
HOLE_R = 11
CLICK_R = 16

CANVAS_W = 600
CANVAS_H = 700
OFFSET_X = CANVAS_W // 2
OFFSET_Y = CANVAS_H // 2 - 10


def cell_to_pixel(cell):
    x, y, z = cell
    q, r = x, z
    px = SIZE * math.sqrt(3) * (q + r / 2)
    py = SIZE * 1.5 * r
    return OFFSET_X + px, OFFSET_Y + py


PIXEL = {c: cell_to_pixel(c) for c in BOARD}


def pixel_of_point(cube_point):
    """允许对任意立方体坐标点（不一定是合法棋盘格）求像素坐标，用于圆心。"""
    x, y, z = cube_point
    q, r = x, z
    px = SIZE * math.sqrt(3) * (q + r / 2)
    py = SIZE * 1.5 * r
    return OFFSET_X + px, OFFSET_Y + py


# ----------------------------------------------------------------------
# 3. 中央三个可旋转"圆盘"（不是细圆环，是整片实心区域，圆盘内部所有棋子
#    都跟着一起转）
# ----------------------------------------------------------------------

def hex_ring(center, radius):
    """按角度顺序返回以 center 为心、半径为 radius 的六边形格点环（逆时针方向）"""
    if radius == 0:
        return [center]
    cx, cy, cz = center
    results = []
    sdx, sdy, sdz = DIRS[4]
    x, y, z = cx + sdx * radius, cy + sdy * radius, cz + sdz * radius
    for i in range(6):
        ddx, ddy, ddz = DIRS[i]
        for _ in range(radius):
            results.append((x, y, z))
            x, y, z = x + ddx, y + ddy, z + ddz
    return results


_D, _DISK_R = 1, 2  # 圆盘半径（含几层同心环），半径2 = 中心 + 第1环(6格) + 第2环(12格) = 19格
CIRCLE_CENTERS = {
    'A': (_D * 1, _D * -1, _D * 0),
    'B': (_D * 0, _D * 1, _D * -1),
    'C': (_D * -1, _D * 0, _D * 1),
}
CIRCLE_COLOR = {'A': '#e67e22', 'B': '#9b59b6', 'C': '#16a085'}
CIRCLE_LABEL = {'A': '圆盘 A（橙）', 'B': '圆盘 B（紫）', 'C': '圆盘 C（青）'}

# 每个圆盘按半径分层的格点环：{半径: [按角度顺序的格点列表]}，半径0是圆心自己
CIRCLE_DISK_RINGS = {}
# 每个圆盘包含的全部格点集合（圆心 + 各层环），用于判断某格属于哪些圆盘
CIRCLE_DISK_CELLS = {}
for _cid, _center in CIRCLE_CENTERS.items():
    _rings = {r: hex_ring(_center, r) for r in range(0, _DISK_R + 1)}
    CIRCLE_DISK_RINGS[_cid] = _rings
    _cells = set()
    for _r in _rings.values():
        _cells.update(_r)
    CIRCLE_DISK_CELLS[_cid] = _cells

# 整个圆盘旋转时，只有"转动整60度的倍数"才能让圆盘里所有同心环同时对齐回格点上
# （三角网格只有6重旋转对称），所以步数固定为 1~5 格，每格 = 60度。
ROTATE_MAX_STEPS = 5

# 每个圆盘外边界（最外层环）的平均像素半径和圆心像素坐标，用来画装饰圆圈
CIRCLE_DRAW = {}
for _cid, _center in CIRCLE_CENTERS.items():
    _cpx, _cpy = pixel_of_point(_center)
    _outer_ring = CIRCLE_DISK_RINGS[_cid][_DISK_R]
    _dists = [math.hypot(*(p - c for p, c in zip(pixel_of_point(pt), (_cpx, _cpy))))
              for pt in _outer_ring]
    CIRCLE_DRAW[_cid] = (_cpx, _cpy, sum(_dists) / len(_dists))

# 每个格子属于哪些圆盘（用于背景底色标注，让玩家一眼看出归属/重叠区域）
CELL_DISK_MEMBERSHIP = {}
for _c in BOARD:
    _owned = frozenset(cid for cid in ('A', 'B', 'C') if _c in CIRCLE_DISK_CELLS[cid])
    if _owned:
        CELL_DISK_MEMBERSHIP[_c] = _owned

TINT_COLOR = {
    frozenset({'A'}): '#fdebd0',
    frozenset({'B'}): '#f0e6f6',
    frozenset({'C'}): '#daf5ef',
    frozenset({'A', 'B'}): '#f6d4d4',
    frozenset({'B', 'C'}): '#d6e8f7',
    frozenset({'A', 'C'}): '#eaf0c8',
    frozenset({'A', 'B', 'C'}): '#fff2a8',
}


# ----------------------------------------------------------------------
# 4. 颜色配置
# ----------------------------------------------------------------------

COLOR_EMPTY_FILL = "#f5f6f7"
COLOR_EMPTY_OUTLINE = "#9aa0a6"
COLOR_P1 = "#e74c3c"
COLOR_P1_OUTLINE = "#922b1f"
COLOR_P2 = "#3498db"
COLOR_P2_OUTLINE = "#1f618d"
COLOR_SELECT = "#f1c40f"
COLOR_HINT = "#2ecc71"

PLAYER_NAME = {1: "红方", 2: "蓝方"}
PLAYER_COLOR = {1: COLOR_P1, 2: COLOR_P2}
PLAYER_OUTLINE = {1: COLOR_P1_OUTLINE, 2: COLOR_P2_OUTLINE}


# ----------------------------------------------------------------------
# 5. 游戏主类
# ----------------------------------------------------------------------

class CheckersGame:
    def __init__(self, root):
        self.root = root
        self.root.title("中国跳棋 - 双人对战（含旋转圆盘机关）")

        # ---------- 整体左右布局：左边棋盘，右边控制面板 ----------
        main_frame = tk.Frame(root)
        main_frame.pack(fill=tk.BOTH, expand=True)

        left_frame = tk.Frame(main_frame)
        left_frame.pack(side=tk.LEFT, padx=8, pady=8)

        right_frame = tk.Frame(main_frame, width=300, bg="#dfe6e9")
        right_frame.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 8), pady=8)
        right_frame.pack_propagate(False)

        # ---------- 左侧：棋盘画布 ----------
        self.canvas = tk.Canvas(left_frame, width=CANVAS_W, height=CANVAS_H, bg="#ecf0f1",
                                 highlightthickness=0)
        self.canvas.pack()
        self.canvas.bind("<Button-1>", self.on_click)

        # ---------- 右侧：标题 + 状态 ----------
        tk.Label(right_frame, text="中国跳棋", font=("Microsoft YaHei", 16, "bold"),
                 bg="#dfe6e9", fg="#2c3e50").pack(pady=(12, 6))

        self.status_var = tk.StringVar()
        tk.Label(right_frame, textvariable=self.status_var, font=("Microsoft YaHei", 12, "bold"),
                 bg="#2c3e50", fg="white", wraplength=270, justify="left", pady=10
                 ).pack(fill=tk.X, padx=10, pady=(0, 12))

        btn_row = tk.Frame(right_frame, bg="#dfe6e9")
        btn_row.pack(fill=tk.X, padx=10)
        tk.Button(btn_row, text="重新开始", command=self.reset_game,
                  font=("Microsoft YaHei", 10)).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)
        self.end_jump_btn = tk.Button(btn_row, text="结束跳跃", command=self.end_jump_clicked,
                                       state=tk.DISABLED, font=("Microsoft YaHei", 10))
        self.end_jump_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)

        # ---------- 右侧：走棋说明 ----------
        tk.Label(right_frame, text="① 走棋 / 跳棋", font=("Microsoft YaHei", 11, "bold"),
                 bg="#dfe6e9", fg="#2c3e50").pack(anchor="w", padx=10, pady=(18, 0))
        tk.Label(right_frame, text="点击己方棋子选中，再点棋盘上高亮的位置完成移动或跳跃。",
                 font=("Microsoft YaHei", 9), bg="#dfe6e9", fg="#555", wraplength=270,
                 justify="left").pack(anchor="w", padx=10, pady=(2, 4))

        ttk_sep = tk.Frame(right_frame, height=2, bg="#b2bec3")
        ttk_sep.pack(fill=tk.X, padx=10, pady=10)

        # ---------- 右侧：转圆控制面板 ----------
        tk.Label(right_frame, text="② 转圆动作（与①二选一）", font=("Microsoft YaHei", 11, "bold"),
                 bg="#dfe6e9", fg="#2c3e50").pack(anchor="w", padx=10)

        circle_frame = tk.Frame(right_frame, bg="#dfe6e9")
        circle_frame.pack(padx=10, pady=(8, 0), fill=tk.X)
        self.circle_buttons = {}
        for cid in ('A', 'B', 'C'):
            b = tk.Button(circle_frame, text=CIRCLE_LABEL[cid], bg=CIRCLE_COLOR[cid], fg="white",
                           font=("Microsoft YaHei", 10, "bold"),
                           command=lambda c=cid: self.select_circle(c))
            b.pack(fill=tk.X, pady=3)
            self.circle_buttons[cid] = b

        dir_frame = tk.Frame(right_frame, bg="#dfe6e9")
        dir_frame.pack(padx=10, pady=(10, 0), fill=tk.X)
        self.dir_var = tk.StringVar(value="ccw")
        self.dir_cw_rb = tk.Radiobutton(dir_frame, text="顺时针 ↻", variable=self.dir_var, value="cw",
                                         bg="#dfe6e9", font=("Microsoft YaHei", 10),
                                         command=self.refresh_rotate_preview)
        self.dir_ccw_rb = tk.Radiobutton(dir_frame, text="逆时针 ↺", variable=self.dir_var, value="ccw",
                                          bg="#dfe6e9", font=("Microsoft YaHei", 10),
                                          command=self.refresh_rotate_preview)
        self.dir_cw_rb.pack(side=tk.LEFT, expand=True)
        self.dir_ccw_rb.pack(side=tk.LEFT, expand=True)

        steps_frame = tk.Frame(right_frame, bg="#dfe6e9")
        steps_frame.pack(pady=(8, 0))
        tk.Label(steps_frame, text="格数(1格=60°):", bg="#dfe6e9", font=("Microsoft YaHei", 10)).pack(side=tk.LEFT)
        self.minus_btn = tk.Button(steps_frame, text="－", width=2, command=self.dec_steps)
        self.minus_btn.pack(side=tk.LEFT, padx=4)
        self.steps_var = tk.StringVar(value="1")
        tk.Label(steps_frame, textvariable=self.steps_var, bg="#dfe6e9", width=2,
                 font=("Microsoft YaHei", 10, "bold")).pack(side=tk.LEFT)
        self.plus_btn = tk.Button(steps_frame, text="＋", width=2, command=self.inc_steps)
        self.plus_btn.pack(side=tk.LEFT, padx=4)

        confirm_frame = tk.Frame(right_frame, bg="#dfe6e9")
        confirm_frame.pack(padx=10, pady=12, fill=tk.X)
        self.confirm_btn = tk.Button(confirm_frame, text="确认旋转", bg="#27ae60", fg="white",
                                      font=("Microsoft YaHei", 10, "bold"),
                                      command=self.confirm_rotate)
        self.confirm_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)
        self.cancel_btn = tk.Button(confirm_frame, text="取消", command=self.cancel_rotate,
                                     font=("Microsoft YaHei", 10))
        self.cancel_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)

        tk.Label(right_frame, text="提示：转圆盘会带动盘内所有同心环上的棋子（含对方棋子）整体一起转动，只有圆心棋子不动；受三角网格限制，每格固定转60°。",
                 font=("Microsoft YaHei", 9), bg="#dfe6e9", fg="#888", wraplength=270,
                 justify="left").pack(anchor="w", padx=10, pady=(4, 10))

        self.reset_game()

    # ==================== 状态初始化 ====================
    def reset_game(self):
        self.board_state = {c: 0 for c in BOARD}
        for c in TOP_REGION:
            self.board_state[c] = 1
        for c in BOTTOM_REGION:
            self.board_state[c] = 2

        self.current_player = 1
        self.selected = None
        self.in_jump_chain = False
        self.highlight_cells = []
        self.game_over = False

        self.rotating_circle = None  # 当前正在配置的圆 ('A'/'B'/'C' 或 None)
        self.dir_var.set("ccw")
        self.steps_var.set("1")

        self.end_jump_btn.config(state=tk.DISABLED)
        self.update_controls_state()
        self.update_status()
        self.draw_board()

    def update_status(self, extra=""):
        if self.game_over:
            return
        name = PLAYER_NAME[self.current_player]
        msg = f"轮到 {name} 走棋"
        if self.in_jump_chain:
            msg += "（连续跳跃中，可继续跳或点击\"结束跳跃\"）"
        if self.rotating_circle:
            msg += f"（正在配置旋转：{CIRCLE_LABEL[self.rotating_circle]}）"
        if extra:
            msg += "  " + extra
        self.status_var.set(msg)

    def update_controls_state(self):
        """根据当前状态启用/禁用各按钮，防止误操作"""
        can_start_rotate = (not self.game_over) and (not self.in_jump_chain)
        for b in self.circle_buttons.values():
            b.config(state=(tk.NORMAL if can_start_rotate else tk.DISABLED),
                     relief=tk.SUNKEN if False else tk.RAISED)
        configuring = can_start_rotate and self.rotating_circle is not None
        state = tk.NORMAL if configuring else tk.DISABLED
        for w in (self.dir_cw_rb, self.dir_ccw_rb, self.minus_btn, self.plus_btn,
                  self.confirm_btn, self.cancel_btn):
            w.config(state=state)
        # 突出显示当前选中的圆按钮
        for cid, b in self.circle_buttons.items():
            b.config(relief=tk.SUNKEN if cid == self.rotating_circle else tk.RAISED)

    # ==================== 绘制 ====================
    def draw_board(self):
        self.canvas.delete("all")

        # 1) 先给每个格子按所属圆盘画底色（重叠区域会用混合色，一眼看出归属）
        for cell, owned in CELL_DISK_MEMBERSHIP.items():
            px, py = PIXEL[cell]
            rr = HOLE_R + 7
            self.canvas.create_oval(px - rr, py - rr, px + rr, py + rr,
                                     fill=TINT_COLOR[owned], outline="")

        # 2) 再画三个圆盘的装饰外圈，标出每个圆盘的边界
        for cid in ('A', 'B', 'C'):
            cx, cy, rad = CIRCLE_DRAW[cid]
            width = 4 if cid == self.rotating_circle else 2
            self.canvas.create_oval(cx - rad, cy - rad, cx + rad, cy + rad,
                                     outline=CIRCLE_COLOR[cid], width=width)

        # 3) 画所有孔位（棋子/空格）
        for c in BOARD:
            px, py = PIXEL[c]
            state = self.board_state[c]
            if state == 0:
                fill, outline, r = COLOR_EMPTY_FILL, COLOR_EMPTY_OUTLINE, HOLE_R - 3
            else:
                fill, outline, r = PLAYER_COLOR[state], PLAYER_OUTLINE[state], HOLE_R
            self.canvas.create_oval(px - r, py - r, px + r, py + r,
                                     fill=fill, outline=outline, width=2)

        # 4) 选中棋子描边
        if self.selected is not None:
            px, py = PIXEL[self.selected]
            self.canvas.create_oval(px - HOLE_R - 4, py - HOLE_R - 4,
                                     px + HOLE_R + 4, py + HOLE_R + 4,
                                     outline=COLOR_SELECT, width=3)

        # 5) 可走位置高亮
        for c in self.highlight_cells:
            px, py = PIXEL[c]
            self.canvas.create_oval(px - 7, py - 7, px + 7, py + 7,
                                     fill=COLOR_HINT, outline="")

    # ==================== 走棋 / 跳跃逻辑 ====================
    def first_moves(self, cell):
        x, y, z = cell
        steps, jumps = [], []
        for dx, dy, dz in DIRS:
            n1 = (x + dx, y + dy, z + dz)
            if n1 in BOARD and self.board_state[n1] == 0:
                steps.append(n1)
            n2 = (x + 2 * dx, y + 2 * dy, z + 2 * dz)
            if n1 in BOARD and self.board_state[n1] != 0 and \
               n2 in BOARD and self.board_state[n2] == 0:
                jumps.append(n2)
        return steps, jumps

    def continue_jumps(self, cell):
        x, y, z = cell
        jumps = []
        for dx, dy, dz in DIRS:
            n1 = (x + dx, y + dy, z + dz)
            n2 = (x + 2 * dx, y + 2 * dy, z + 2 * dz)
            if n1 in BOARD and self.board_state[n1] != 0 and \
               n2 in BOARD and self.board_state[n2] == 0:
                jumps.append(n2)
        return jumps

    def find_clicked_cell(self, x, y):
        best, best_d = None, CLICK_R
        for c, (px, py) in PIXEL.items():
            d = math.hypot(px - x, py - y)
            if d < best_d:
                best_d = d
                best = c
        return best

    def on_click(self, event):
        if self.game_over:
            return
        if self.rotating_circle is not None:
            # 正在配置旋转时，画布点击无效，必须先确认或取消
            return
        cell = self.find_clicked_cell(event.x, event.y)
        if cell is None:
            return
        if not self.in_jump_chain:
            self.handle_click_normal(cell)
        else:
            self.handle_click_jump_chain(cell)

    def handle_click_normal(self, cell):
        state = self.board_state[cell]

        if state == self.current_player:
            self.selected = cell
            steps, jumps = self.first_moves(cell)
            self.highlight_cells = steps + jumps
            self.draw_board()
            self.update_status()
            return

        if self.selected is None:
            return

        if cell in self.highlight_cells:
            steps, jumps = self.first_moves(self.selected)
            if cell in steps:
                self.move_piece(self.selected, cell)
                self.finish_turn()
            elif cell in jumps:
                self.move_piece(self.selected, cell)
                self.selected = cell
                self.in_jump_chain = True
                next_jumps = self.continue_jumps(cell)
                if next_jumps:
                    self.highlight_cells = next_jumps
                    self.end_jump_btn.config(state=tk.NORMAL)
                    self.update_controls_state()
                    self.draw_board()
                    self.update_status()
                else:
                    self.finish_turn()
            return

        self.selected = None
        self.highlight_cells = []
        self.draw_board()
        self.update_status()

    def handle_click_jump_chain(self, cell):
        if cell in self.highlight_cells:
            self.move_piece(self.selected, cell)
            self.selected = cell
            next_jumps = self.continue_jumps(cell)
            if next_jumps:
                self.highlight_cells = next_jumps
                self.draw_board()
                self.update_status()
            else:
                self.finish_turn()
        elif cell == self.selected:
            self.finish_turn()

    def move_piece(self, src, dst):
        self.board_state[dst] = self.board_state[src]
        self.board_state[src] = 0

    def end_jump_clicked(self):
        if self.in_jump_chain:
            self.finish_turn()

    def finish_turn(self):
        winner = self.check_win(self.current_player)
        self.conclude_turn(winner)

    # ==================== 转圆逻辑 ====================
    def select_circle(self, cid):
        if self.game_over or self.in_jump_chain:
            return
        # 切换/选定圆，同时清空棋子选择
        self.selected = None
        self.highlight_cells = []
        self.rotating_circle = cid
        self.steps_var.set("1")
        self.update_controls_state()
        self.draw_board()
        self.update_status()

    def cancel_rotate(self):
        self.rotating_circle = None
        self.update_controls_state()
        self.draw_board()
        self.update_status()

    def refresh_rotate_preview(self):
        # 方向切换时暂不做实际预演，只刷新状态文字
        self.update_status()

    def max_steps(self):
        return ROTATE_MAX_STEPS

    def inc_steps(self):
        if self.rotating_circle is None:
            return
        cur = int(self.steps_var.get())
        if cur < self.max_steps():
            self.steps_var.set(str(cur + 1))

    def dec_steps(self):
        cur = int(self.steps_var.get())
        if cur > 1:
            self.steps_var.set(str(cur - 1))

    def rotate_circle(self, cid, direction, steps):
        """把整个圆盘（所有同心环）当作刚体旋转 steps*60 度。
        半径为 r 的环有 6r 个格子，转 60 度时整环正好移动 r 个位置，
        所以转 steps 格(=steps*60度) 时该环移动 steps*r 个位置；
        所有半径用同一个角度，保证圆盘内部始终是一个整体在转。"""
        rings = CIRCLE_DISK_RINGS[cid]
        # 先把这个圆盘内所有格子的当前棋子状态拍快照，避免转动过程中互相覆盖
        old_vals = {cell: self.board_state[cell] for r, ring in rings.items() for cell in ring}
        for r, ring in rings.items():
            if r == 0:
                continue  # 圆心是旋转轴，自身不移动
            n = len(ring)
            shift = steps * r if direction == 'ccw' else -steps * r
            shift %= n
            for i, cell in enumerate(ring):
                new_cell = ring[(i + shift) % n]
                self.board_state[new_cell] = old_vals[cell]

    def confirm_rotate(self):
        if self.rotating_circle is None:
            return
        cid = self.rotating_circle
        direction = self.dir_var.get()
        steps = int(self.steps_var.get())
        self.rotate_circle(cid, direction, steps)
        self.rotating_circle = None
        winner = self.check_win(1) or self.check_win(2)
        self.conclude_turn(winner)

    # ==================== 回合结束公共逻辑 ====================
    def conclude_turn(self, winner):
        self.selected = None
        self.highlight_cells = []
        self.in_jump_chain = False
        self.rotating_circle = None
        self.end_jump_btn.config(state=tk.DISABLED)
        self.update_controls_state()
        self.draw_board()

        if winner:
            self.game_over = True
            self.status_var.set(f"🎉 {PLAYER_NAME[winner]} 获胜！")
            self.update_controls_state()
            messagebox.showinfo("游戏结束", f"{PLAYER_NAME[winner]} 获胜！")
            return

        self.current_player = 2 if self.current_player == 1 else 1
        self.update_status()

    def check_win(self, player):
        target = BOTTOM_REGION if player == 1 else TOP_REGION
        cells = [c for c in BOARD if self.board_state[c] == player]
        if len(cells) == 10 and all(c in target for c in cells):
            return player
        return None


# ----------------------------------------------------------------------
# 6. 启动程序
# ----------------------------------------------------------------------

def main():
    root = tk.Tk()
    CheckersGame(root)
    root.mainloop()


if __name__ == "__main__":
    main()