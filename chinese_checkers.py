#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中国跳棋 (Chinese Checkers) - 两人对战升级版（含卡牌抽取 Gacha 系统）
使用 tkinter 实现的图形界面，鼠标点击操作。

机关一：棋盘中央有三个互相重叠的圆盘（类似韦恩图，不是细圆环而是整片实心区域）。
每回合玩家可以二选一：
    A) 正常走一步棋 / 进行一次连续跳跃；
    B) 打出一张手牌，选择一个圆盘和方向（顺时针/逆时针），按手牌标注的格数旋转它——
       圆盘内部所有同心环上的棋子（无论谁的棋子，圆心棋子除外）都会作为一个整体
       一起转动到新的位置。打出的卡牌会被消耗（移出手牌）。
两个动作选其一，做完即结束本回合。

机关二（新增）：游戏开始前是"抽卡阶段(Gacha)"。两位玩家轮流点击棋盘中央的卡背
抽取卡牌（抽到之前完全不知道是什么卡——随机决定稀有度与旋转格数），各抽 5 张
组成手牌后才正式开局。手牌打光后，该玩家就只能正常走棋/跳跃，不能再旋转圆盘。

胜负判定：谁先把自己全部 10 颗棋子移动到棋盘对面的尖角区域，谁获胜。
"""

import tkinter as tk
from tkinter import messagebox
import math
import random

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
# 4.5 卡牌 / 抽卡 (Gacha) 系统
#    每张卡只标注"旋转格数"（1格=60°），稀有度越高、格数越大，抽到概率越低。
#    旋转的圆盘和方向仍由玩家自由选择，卡牌只决定能转多少格(多少度)。
# ----------------------------------------------------------------------

CARD_DEFS = [
    {'degree': 60,  'steps': 1, 'rarity': '普通', 'stars': '★',     'color': '#95a5a6', 'weight': 35},
    {'degree': 120, 'steps': 2, 'rarity': '优秀', 'stars': '★★',    'color': '#2ecc71', 'weight': 30},
    {'degree': 180, 'steps': 3, 'rarity': '稀有', 'stars': '★★★',   'color': '#3498db', 'weight': 20},
    {'degree': 240, 'steps': 4, 'rarity': '史诗', 'stars': '★★★★',  'color': '#9b59b6', 'weight': 10},
    {'degree': 300, 'steps': 5, 'rarity': '传说', 'stars': '★★★★★', 'color': '#f39c12', 'weight': 5},
]

HAND_SIZE = 5            # 每位玩家开局抽卡数量
TOTAL_DRAFT_DRAWS = HAND_SIZE * 2   # 两位玩家交替抽，总抽取次数


def draw_random_card():
    """按权重随机抽取一张卡牌定义（抽之前完全不知道结果，符合 Gacha 抽取的随机性）。"""
    weights = [c['weight'] for c in CARD_DEFS]
    return random.choices(CARD_DEFS, weights=weights, k=1)[0]


# ----------------------------------------------------------------------
# 5. 游戏主类
# ----------------------------------------------------------------------

class CheckersGame:
    def __init__(self, root):
        self.root = root
        self.root.title("中国跳棋 - 双人对战（含旋转圆盘 + 抽卡机关）")

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
                 ).pack(fill=tk.X, padx=10, pady=(0, 6))

        self.hand_count_var = tk.StringVar()
        tk.Label(right_frame, textvariable=self.hand_count_var, font=("Microsoft YaHei", 9),
                 bg="#dfe6e9", fg="#555").pack(pady=(0, 10))

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
        tk.Label(right_frame, text="② 打出卡牌转圆盘（与①二选一）", font=("Microsoft YaHei", 11, "bold"),
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
                                         command=self.update_status)
        self.dir_ccw_rb = tk.Radiobutton(dir_frame, text="逆时针 ↺", variable=self.dir_var, value="ccw",
                                          bg="#dfe6e9", font=("Microsoft YaHei", 10),
                                          command=self.update_status)
        self.dir_cw_rb.pack(side=tk.LEFT, expand=True)
        self.dir_ccw_rb.pack(side=tk.LEFT, expand=True)

        # ---------- 右侧：卡牌选择面板（取代原来手动选格数）----------
        tk.Label(right_frame, text="选择要打出的卡牌（决定旋转格数）:",
                 font=("Microsoft YaHei", 10), bg="#dfe6e9", fg="#2c3e50"
                 ).pack(anchor="w", padx=10, pady=(10, 2))
        self.card_select_frame = tk.Frame(right_frame, bg="#dfe6e9")
        self.card_select_frame.pack(padx=10, pady=(0, 0), fill=tk.X)

        confirm_frame = tk.Frame(right_frame, bg="#dfe6e9")
        confirm_frame.pack(padx=10, pady=12, fill=tk.X)
        self.confirm_btn = tk.Button(confirm_frame, text="确认旋转", bg="#27ae60", fg="white",
                                      font=("Microsoft YaHei", 10, "bold"),
                                      command=self.confirm_rotate)
        self.confirm_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)
        self.cancel_btn = tk.Button(confirm_frame, text="取消", command=self.cancel_rotate,
                                     font=("Microsoft YaHei", 10))
        self.cancel_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)

        tk.Label(right_frame,
                 text="提示：每张卡牌标注固定的旋转格数(1格=60°)，打出后即消耗，手牌打光后将无法再旋转圆盘"
                      "（仍可正常走棋/跳跃）。转圆盘会带动盘内所有同心环上的棋子（含对方棋子）整体一起转动，圆心棋子不动。",
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

        # ---- 抽卡阶段(Gacha)状态 ----
        self.phase = 'draft'          # 'draft' 抽卡阶段 -> 'play' 正式对战
        self.player_hands = {1: [], 2: []}
        self.draft_count = 0          # 已经抽取的总次数 (0 ~ TOTAL_DRAFT_DRAWS)
        self.draft_animating = False
        self.draft_reveal = False
        self.last_drawn_card = None
        self.selected_card_index = None  # 本回合选中要打出的手牌下标

        self.end_jump_btn.config(state=tk.DISABLED)
        self.update_controls_state()
        self.update_status()
        self.draw_board()

    def current_draft_player(self):
        """根据已抽取次数的奇偶交替决定本次该谁抽卡，保证两人各抽 HAND_SIZE 张。"""
        return 1 if self.draft_count % 2 == 0 else 2

    def update_status(self, extra=""):
        if self.game_over:
            return
        if self.phase == 'draft':
            p = self.current_draft_player()
            msg = (f"🎴 抽卡阶段：{PLAYER_NAME[p]} 抽卡中 "
                   f"({len(self.player_hands[p])}/{HAND_SIZE})　请点击棋盘中央卡背抽取")
            if extra:
                msg += "　" + extra
            self.status_var.set(msg)
            return

        name = PLAYER_NAME[self.current_player]
        msg = f"轮到 {name} 走棋"
        if self.in_jump_chain:
            msg += "（连续跳跃中，可继续跳或点击\"结束跳跃\"）"
        if self.rotating_circle:
            msg += f"（正在配置旋转：{CIRCLE_LABEL[self.rotating_circle]}）"
            hand = self.player_hands[self.current_player]
            if self.selected_card_index is not None and self.selected_card_index < len(hand):
                card = hand[self.selected_card_index]
                msg += f" 已选卡牌 {card['degree']}°({card['rarity']})"
            else:
                msg += " 请在下方选择一张要打出的卡牌"
        if extra:
            msg += "  " + extra
        self.status_var.set(msg)

    def update_hand_counts(self):
        r = len(self.player_hands.get(1, []))
        b = len(self.player_hands.get(2, []))
        self.hand_count_var.set(f"🔴 红方卡牌 {r}/{HAND_SIZE}　　🔵 蓝方卡牌 {b}/{HAND_SIZE}")

    def update_controls_state(self):
        """根据当前状态启用/禁用各按钮，防止误操作"""
        hand = self.player_hands.get(self.current_player, []) if self.phase == 'play' else []
        can_start_rotate = (self.phase == 'play') and (not self.game_over) and \
                            (not self.in_jump_chain) and (len(hand) > 0)
        for b in self.circle_buttons.values():
            b.config(state=(tk.NORMAL if can_start_rotate else tk.DISABLED))
        configuring = can_start_rotate and self.rotating_circle is not None
        state = tk.NORMAL if configuring else tk.DISABLED
        for w in (self.dir_cw_rb, self.dir_ccw_rb, self.confirm_btn, self.cancel_btn):
            w.config(state=state)
        # 突出显示当前选中的圆按钮
        for cid, b in self.circle_buttons.items():
            b.config(relief=tk.SUNKEN if cid == self.rotating_circle else tk.RAISED)
        self.refresh_card_selector()
        self.update_hand_counts()

    def refresh_card_selector(self):
        """重新绘制当前玩家手牌按钮，供配置旋转时选择要打出的卡牌。"""
        for w in self.card_select_frame.winfo_children():
            w.destroy()

        if self.phase != 'play':
            tk.Label(self.card_select_frame, text="（开局后才能使用卡牌）",
                     bg="#dfe6e9", fg="#aaa", font=("Microsoft YaHei", 9)).pack(anchor="w")
            return

        hand = self.player_hands[self.current_player]
        if not hand:
            tk.Label(self.card_select_frame, text="（当前玩家无手牌，无法旋转圆盘）",
                     bg="#dfe6e9", fg="#aaa", font=("Microsoft YaHei", 9)).pack(anchor="w")
            return

        row = tk.Frame(self.card_select_frame, bg="#dfe6e9")
        row.pack(anchor="w")
        active = self.rotating_circle is not None
        for i, card in enumerate(hand):
            relief = tk.SUNKEN if i == self.selected_card_index else tk.RAISED
            b = tk.Button(row, text=f"{card['degree']}°\n{card['stars']}",
                          bg=card['color'], fg="white", font=("Microsoft YaHei", 9, "bold"),
                          relief=relief, width=6, height=2,
                          state=(tk.NORMAL if active else tk.DISABLED),
                          command=lambda idx=i: self.select_card(idx))
            b.pack(side=tk.LEFT, padx=2, pady=2)

    def select_card(self, idx):
        if self.rotating_circle is None:
            return
        self.selected_card_index = idx
        self.refresh_card_selector()
        self.update_status()

    # ==================== 绘制 ====================
    def draw_board(self):
        self.canvas.delete("all")
        self.update_hand_counts()

        if self.phase == 'draft':
            self.draw_draft_scene()
            return

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

    def draw_draft_scene(self):
        """抽卡阶段(Gacha)的画面：中央卡背可点击抽卡，下方展示双方已抽到的手牌。"""
        cx = CANVAS_W // 2

        self.canvas.create_text(cx, 50, text="🎴 卡牌抽取阶段 (Gacha)",
                                 font=("Microsoft YaHei", 20, "bold"), fill="#2c3e50")
        self.canvas.create_text(cx, 82,
                                 text="抽到之前不知道是什么卡！双方各抽 5 张，抽完自动开局。",
                                 font=("Microsoft YaHei", 10), fill="#7f8c8d")

        p = self.current_draft_player()
        self.canvas.create_text(cx, 112, text=f"轮到 {PLAYER_NAME[p]} 抽卡",
                                 font=("Microsoft YaHei", 14, "bold"), fill=PLAYER_COLOR[p])

        # 卡背 / 揭示卡牌区域
        deck_cy = 250
        w, h = 130, 170
        x0, y0, x1, y1 = cx - w / 2, deck_cy - h / 2, cx + w / 2, deck_cy + h / 2
        self._draft_deck_rect = (x0, y0, x1, y1)

        if self.draft_animating and self.draft_reveal and self.last_drawn_card:
            card = self.last_drawn_card
            self.canvas.create_rectangle(x0, y0, x1, y1, fill=card['color'],
                                          outline="#2c3e50", width=3)
            self.canvas.create_text(cx, deck_cy - 45, text=f"{card['rarity']} 卡牌！",
                                     font=("Microsoft YaHei", 13, "bold"), fill="white")
            self.canvas.create_text(cx, deck_cy, text=f"{card['degree']}°",
                                     font=("Microsoft YaHei", 30, "bold"), fill="white")
            self.canvas.create_text(cx, deck_cy + 40, text=card['stars'],
                                     font=("Microsoft YaHei", 14), fill="white")
            self.canvas.create_text(cx, deck_cy + 65, text=f"可转 {card['steps']} 格",
                                     font=("Microsoft YaHei", 10), fill="white")
        elif self.draft_animating and not self.draft_reveal:
            self.canvas.create_rectangle(x0, y0, x1, y1, fill="#2c3e50",
                                          outline="#1c2833", width=3)
            self.canvas.create_text(cx, deck_cy, text="抽取中…",
                                     font=("Microsoft YaHei", 13, "bold"), fill="white")
        else:
            self.canvas.create_rectangle(x0, y0, x1, y1, fill="#34495e",
                                          outline="#2c3e50", width=3)
            self.canvas.create_text(cx, deck_cy - 15, text="🎴",
                                     font=("Microsoft YaHei", 26))
            self.canvas.create_text(cx, deck_cy + 30, text="点击抽卡",
                                     font=("Microsoft YaHei", 13, "bold"), fill="white")

        # 双方手牌一览
        self.draw_hand_preview(1, 420)
        self.draw_hand_preview(2, 560)

    def draw_hand_preview(self, player, y):
        self.canvas.create_text(75, y - 38, anchor='w',
                                 text=f"{PLAYER_NAME[player]}手牌:",
                                 font=("Microsoft YaHei", 11, "bold"), fill=PLAYER_COLOR[player])
        hand = self.player_hands[player]
        cw, ch = 65, 90
        start_x = 70
        for i in range(HAND_SIZE):
            x = start_x + i * (cw + 8)
            if i < len(hand):
                card = hand[i]
                self.canvas.create_rectangle(x, y - ch / 2, x + cw, y + ch / 2,
                                              fill=card['color'], outline="#2c3e50", width=2)
                self.canvas.create_text(x + cw / 2, y - 12, text=f"{card['degree']}°",
                                         font=("Microsoft YaHei", 11, "bold"), fill="white")
                self.canvas.create_text(x + cw / 2, y + 14, text=card['stars'],
                                         font=("Microsoft YaHei", 8), fill="white")
            else:
                self.canvas.create_rectangle(x, y - ch / 2, x + cw, y + ch / 2,
                                              fill="#ecf0f1", outline="#b2bec3", width=2,
                                              dash=(3, 2))

    # ==================== 抽卡阶段(Gacha)逻辑 ====================
    def handle_draft_click(self, event):
        if self.draft_animating:
            return
        if not hasattr(self, '_draft_deck_rect'):
            return
        x0, y0, x1, y1 = self._draft_deck_rect
        if x0 <= event.x <= x1 and y0 <= event.y <= y1:
            self.draft_draw_card()

    def draft_draw_card(self):
        if self.draft_animating or self.phase != 'draft':
            return
        p = self.current_draft_player()
        if len(self.player_hands[p]) >= HAND_SIZE:
            return

        card = draw_random_card()           # 抽之前完全随机、未知
        self.player_hands[p].append(card)
        self.last_drawn_card = card
        self.draft_count += 1
        self.draft_animating = True
        self.draft_reveal = False

        self.draw_board()
        self.update_status(extra="抽取中…")
        self.root.after(300, self._draft_reveal_step)

    def _draft_reveal_step(self):
        self.draft_reveal = True
        self.draw_board()
        card = self.last_drawn_card
        self.update_status(extra=f"获得 {card['rarity']}（{card['degree']}°）卡牌！")
        self.root.after(1000, self._draft_finish_step)

    def _draft_finish_step(self):
        self.draft_animating = False
        self.draft_reveal = False
        if self.draft_count >= TOTAL_DRAFT_DRAWS:
            self.start_play_phase()
        else:
            self.draw_board()
            self.update_status()

    def start_play_phase(self):
        self.phase = 'play'
        self.current_player = 1
        self.selected = None
        self.highlight_cells = []
        self.selected_card_index = None
        self.rotating_circle = None
        self.update_controls_state()
        self.draw_board()
        self.update_status()
        messagebox.showinfo("抽卡完成", "双方手牌已抽取完毕，正式开局！红方先走。")

    # ==================== 点击分发 ====================
    def on_click(self, event):
        if self.phase == 'draft':
            self.handle_draft_click(event)
            return
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
        if self.game_over or self.in_jump_chain or self.phase != 'play':
            return
        if not self.player_hands[self.current_player]:
            return  # 没有手牌，无法发起旋转
        # 切换/选定圆，同时清空棋子选择与已选卡牌
        self.selected = None
        self.highlight_cells = []
        self.rotating_circle = cid
        self.selected_card_index = None
        self.update_controls_state()
        self.draw_board()
        self.update_status()

    def cancel_rotate(self):
        self.rotating_circle = None
        self.selected_card_index = None
        self.update_controls_state()
        self.draw_board()
        self.update_status()

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
        if self.selected_card_index is None:
            self.update_status(extra="⚠ 请先在下方选择一张要打出的卡牌")
            return

        cid = self.rotating_circle
        direction = self.dir_var.get()
        hand = self.player_hands[self.current_player]
        if self.selected_card_index >= len(hand):
            self.selected_card_index = None
            return
        card = hand[self.selected_card_index]
        steps = card['steps']

        self.rotate_circle(cid, direction, steps)
        hand.pop(self.selected_card_index)  # 打出的卡牌被消耗

        self.rotating_circle = None
        self.selected_card_index = None
        winner = self.check_win(1) or self.check_win(2)
        self.conclude_turn(winner)

    # ==================== 回合结束公共逻辑 ====================
    def conclude_turn(self, winner):
        self.selected = None
        self.highlight_cells = []
        self.in_jump_chain = False
        self.rotating_circle = None
        self.selected_card_index = None
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
        self.update_controls_state()  # 切换玩家后刷新手牌选择面板
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