#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中国跳棋 (Chinese Checkers) - 两人对战版
使用 tkinter 实现的图形界面，鼠标点击操作。

规则简介：
- 标准六角星棋盘，121 个孔位。
- 两人对战时，玩家分别占据棋盘相对的两个尖角（各 10 颗棋子）。
- 每回合可以：
    1) 将一颗棋子移动到相邻的空位（移动后回合结束）；或
    2) 跳过一颗相邻的棋子（己方或对方均可）落到其后方的空位（不吃子），
       并且可以连续多次跳跃，直到玩家选择停止或无路可跳。
- 谁先把自己全部 10 颗棋子移动到棋盘对面的尖角区域，谁获胜。
"""

import tkinter as tk
from tkinter import messagebox
import math

# ----------------------------------------------------------------------
# 1. 棋盘几何：使用立方体坐标 (x, y, z)，x + y + z = 0 来表示三角网格上的孔位
# ----------------------------------------------------------------------

R = 4  # 中心六边形的“半径”

# 六个方向（对应六角星格子的六个相邻方向）
DIRS = [(1, -1, 0), (1, 0, -1), (0, 1, -1),
        (-1, 1, 0), (-1, 0, 1), (0, -1, 1)]


def in_hex(x, y, z):
    """是否在中心六边形区域内"""
    return abs(x) <= R and abs(y) <= R and abs(z) <= R


def in_point(x, y, z):
    """是否在六个尖角三角区域之一内"""
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


BOARD = build_board()  # 全部 121 个合法孔位

# 顶部尖角（玩家1 初始位置） / 底部尖角（玩家2 初始位置，棋盘相对的另一端）
TOP_REGION = {(x, y, z) for (x, y, z) in BOARD if z <= -(R + 1) and x <= R and y <= R}
BOTTOM_REGION = {(x, y, z) for (x, y, z) in BOARD if z >= (R + 1) and x >= -R and y >= -R}

assert len(BOARD) == 121
assert len(TOP_REGION) == 10
assert len(BOTTOM_REGION) == 10

# ----------------------------------------------------------------------
# 2. 立方体坐标 -> 屏幕像素坐标
# ----------------------------------------------------------------------

SIZE = 24       # 网格缩放比例
HOLE_R = 11      # 画孔的半径
CLICK_R = 16     # 点击判定半径

CANVAS_W = 640
CANVAS_H = 680
OFFSET_X = CANVAS_W // 2
OFFSET_Y = CANVAS_H // 2


def cell_to_pixel(cell):
    x, y, z = cell
    q, r = x, z  # 用 (x, z) 作为“轴坐标”
    px = SIZE * math.sqrt(3) * (q + r / 2)
    py = SIZE * 1.5 * r
    return OFFSET_X + px, OFFSET_Y + py


PIXEL = {c: cell_to_pixel(c) for c in BOARD}

# ----------------------------------------------------------------------
# 3. 颜色配置
# ----------------------------------------------------------------------

COLOR_EMPTY_FILL = "#f5f6f7"
COLOR_EMPTY_OUTLINE = "#9aa0a6"
COLOR_P1 = "#e74c3c"      # 红方
COLOR_P1_OUTLINE = "#922b1f"
COLOR_P2 = "#3498db"      # 蓝方
COLOR_P2_OUTLINE = "#1f618d"
COLOR_SELECT = "#f1c40f"  # 选中描边
COLOR_HINT = "#2ecc71"    # 可走位置提示

PLAYER_NAME = {1: "红方", 2: "蓝方"}
PLAYER_COLOR = {1: COLOR_P1, 2: COLOR_P2}
PLAYER_OUTLINE = {1: COLOR_P1_OUTLINE, 2: COLOR_P2_OUTLINE}


# ----------------------------------------------------------------------
# 4. 游戏主类
# ----------------------------------------------------------------------

class CheckersGame:
    def __init__(self, root):
        self.root = root
        self.root.title("中国跳棋 - 双人对战")

        # 顶部状态栏
        top_frame = tk.Frame(root, bg="#2c3e50")
        top_frame.pack(fill=tk.X)

        self.status_var = tk.StringVar()
        self.status_label = tk.Label(
            top_frame, textvariable=self.status_var, font=("Microsoft YaHei", 14, "bold"),
            fg="white", bg="#2c3e50", pady=10
        )
        self.status_label.pack(side=tk.LEFT, padx=12)

        self.end_turn_btn = tk.Button(
            top_frame, text="结束本回合", command=self.end_turn_clicked,
            state=tk.DISABLED, font=("Microsoft YaHei", 11)
        )
        self.end_turn_btn.pack(side=tk.RIGHT, padx=8, pady=6)

        self.reset_btn = tk.Button(
            top_frame, text="重新开始", command=self.reset_game,
            font=("Microsoft YaHei", 11)
        )
        self.reset_btn.pack(side=tk.RIGHT, padx=4, pady=6)

        # 画布
        self.canvas = tk.Canvas(root, width=CANVAS_W, height=CANVAS_H, bg="#ecf0f1",
                                 highlightthickness=0)
        self.canvas.pack()
        self.canvas.bind("<Button-1>", self.on_click)

        # 提示文字
        hint_frame = tk.Frame(root)
        hint_frame.pack(fill=tk.X)
        tk.Label(
            hint_frame,
            text="点击己方棋子选中，再点击高亮位置移动；跳跃可连续进行，点击\"结束本回合\"提前结束。",
            font=("Microsoft YaHei", 10), fg="#555"
        ).pack(pady=4)

        self.reset_game()

    # -------------------- 游戏状态初始化 --------------------
    def reset_game(self):
        self.board_state = {c: 0 for c in BOARD}   # 0=空, 1=玩家1, 2=玩家2
        for c in TOP_REGION:
            self.board_state[c] = 1
        for c in BOTTOM_REGION:
            self.board_state[c] = 2

        self.current_player = 1
        self.selected = None
        self.in_jump_chain = False
        self.highlight_cells = []   # 当前可点击的目标位置
        self.game_over = False

        self.end_turn_btn.config(state=tk.DISABLED)
        self.update_status()
        self.draw_board()

    # -------------------- 状态文字 --------------------
    def update_status(self, extra=""):
        if self.game_over:
            return
        name = PLAYER_NAME[self.current_player]
        msg = f"轮到 {name} 走棋"
        if self.in_jump_chain:
            msg += "（连续跳跃中，可继续跳或点击\"结束本回合\"）"
        if extra:
            msg += "  " + extra
        self.status_var.set(msg)

    # -------------------- 绘制棋盘 --------------------
    def draw_board(self):
        self.canvas.delete("all")

        # 先画所有孔位
        for c in BOARD:
            px, py = PIXEL[c]
            state = self.board_state[c]
            if state == 0:
                fill = COLOR_EMPTY_FILL
                outline = COLOR_EMPTY_OUTLINE
                r = HOLE_R - 3
            else:
                fill = PLAYER_COLOR[state]
                outline = PLAYER_OUTLINE[state]
                r = HOLE_R
            self.canvas.create_oval(px - r, py - r, px + r, py + r,
                                     fill=fill, outline=outline, width=2,
                                     tags=("cell", f"cell_{c}"))

        # 选中棋子描边
        if self.selected is not None:
            px, py = PIXEL[self.selected]
            self.canvas.create_oval(px - HOLE_R - 4, py - HOLE_R - 4,
                                     px + HOLE_R + 4, py + HOLE_R + 4,
                                     outline=COLOR_SELECT, width=3)

        # 可走位置高亮
        for c in self.highlight_cells:
            px, py = PIXEL[c]
            self.canvas.create_oval(px - 7, py - 7, px + 7, py + 7,
                                     fill=COLOR_HINT, outline="")

    # -------------------- 坐标工具 --------------------
    def neighbors(self, cell):
        x, y, z = cell
        result = []
        for dx, dy, dz in DIRS:
            n = (x + dx, y + dy, z + dz)
            if n in BOARD:
                result.append(n)
        return result

    def first_moves(self, cell):
        """选中棋子时，第一步可走的位置：单步 + 跳跃"""
        x, y, z = cell
        steps = []
        jumps = []
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
        """连续跳跃时，下一步可跳的位置（只能跳，不能单步）"""
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

    # -------------------- 点击处理 --------------------
    def on_click(self, event):
        if self.game_over:
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

        # 点击己方棋子 -> 选中
        if state == self.current_player:
            self.selected = cell
            steps, jumps = self.first_moves(cell)
            self.highlight_cells = steps + jumps
            self.draw_board()
            self.update_status()
            return

        # 没有选中棋子时点击其他地方，无效
        if self.selected is None:
            return

        # 点击高亮的可走位置
        if cell in self.highlight_cells:
            steps, jumps = self.first_moves(self.selected)
            if cell in steps:
                # 单步移动，回合直接结束
                self.move_piece(self.selected, cell)
                self.finish_turn()
            elif cell in jumps:
                # 跳跃移动，可能继续连跳
                self.move_piece(self.selected, cell)
                self.selected = cell
                self.in_jump_chain = True
                next_jumps = self.continue_jumps(cell)
                if next_jumps:
                    self.highlight_cells = next_jumps
                    self.end_turn_btn.config(state=tk.NORMAL)
                    self.draw_board()
                    self.update_status()
                else:
                    self.finish_turn()
            return

        # 点击空白/无效处 -> 取消选中
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
            # 再次点击自己，主动结束回合
            self.finish_turn()
        # 其他点击在连跳状态下忽略

    # -------------------- 移动 / 回合结束 --------------------
    def move_piece(self, src, dst):
        self.board_state[dst] = self.board_state[src]
        self.board_state[src] = 0

    def end_turn_clicked(self):
        if self.in_jump_chain:
            self.finish_turn()

    def finish_turn(self):
        winner = self.check_win(self.current_player)
        self.selected = None
        self.highlight_cells = []
        self.in_jump_chain = False
        self.end_turn_btn.config(state=tk.DISABLED)
        self.draw_board()

        if winner:
            self.game_over = True
            self.status_var.set(f"🎉 {PLAYER_NAME[winner]} 获胜！")
            self.draw_board()
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
# 5. 启动程序
# ----------------------------------------------------------------------

def main():
    root = tk.Tk()
    CheckersGame(root)
    root.mainloop()


if __name__ == "__main__":
    main()