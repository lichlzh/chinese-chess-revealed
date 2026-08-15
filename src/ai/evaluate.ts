// ============================================================
// 揭棋 - AI 局面评估函数（精简高效版）
//   - 去掉机动性计算（太慢，拖累搜索深度）
//   - 保留子力 + PST + 国王安全 + 局面阶段
// ============================================================

import { Color, PieceType, type Piece, type Position } from '../engine/types';
import { findKing } from '../engine/board';

/** ---- 子力基础价值 ---- */
const PIECE_VALUE: Record<PieceType, number> = {
  [PieceType.King]: 10000,
  [PieceType.Chariot]: 900,
  [PieceType.Cannon]: 450,
  [PieceType.Horse]: 400,
  [PieceType.Elephant]: 200,
  [PieceType.Advisor]: 200,
  [PieceType.Pawn]: 100,
};

/**
 * 暗子未翻开时的统一期望值（随机洗牌派）。
 * 取暗子池（车2/马2/炮2/象2/士2/兵5）子力价值的平均值 ≈ 320，
 * 不区分真实类型，避免 AI 偷看暗子身份。
 */
export const HIDDEN_PIECE_VALUE = 320;

// 兵/卒过河加成
const PAWN_CROSSED = 100;

/** ---- 位置价值表 (PST)，红方视角 row=0 为己方底线 ---- */

const PST_CHARIOT = [
  [14,14,12,18,16,18,12,14,14],
  [16,20,18,24,26,24,18,20,16],
  [12,12,12,18,18,18,12,12,12],
  [12,18,16,22,22,22,16,18,12],
  [12,14,12,18,18,18,12,14,12],
  [12,16,14,20,20,20,14,16,12],
  [ 6,10, 8,14,14,14, 8,10, 6],
  [ 4, 8, 6,14,12,14, 6, 8, 4],
  [ 8, 4, 8,16, 8,16, 8, 4, 8],
  [-2,10, 6,14,12,14, 6,10,-2],
];

const PST_HORSE = [
  [ 4, 8,16,12, 4,12,16, 8, 4],
  [ 4,10,28,16, 8,16,28,10, 4],
  [12,14,16,20,18,20,16,14,12],
  [ 8,24,18,24,20,24,18,24, 8],
  [ 6,16,14,18,16,18,14,16, 6],
  [ 4,12,16,14,12,14,16,12, 4],
  [ 2, 6, 8, 6,10, 6, 8, 6, 2],
  [ 4, 2, 8, 8, 4, 8, 8, 2, 4],
  [ 0, 2, 4, 4,-2, 4, 4, 2, 0],
  [ 0,-4, 0, 0, 0, 0, 0,-4, 0],
];

const PST_CANNON = [
  [ 6, 4, 0,-10,-12,-10, 0, 4, 6],
  [ 2, 2, 0, -4,-14, -4, 0, 2, 2],
  [ 2, 2, 0,-10, -8,-10, 0, 2, 2],
  [ 0, 0,-2,  4, 10,  4,-2, 0, 0],
  [ 0, 0, 0,  2,  8,  2, 0, 0, 0],
  [-2, 0, 4,  2,  6,  2, 4, 0,-2],
  [ 0, 0, 0,  2,  4,  2, 0, 0, 0],
  [ 4, 0, 8,  6, 10,  6, 8, 0, 4],
  [ 0, 2, 4,  6,  6,  6, 4, 2, 0],
  [ 0, 0, 2,  6,  6,  6, 2, 0, 0],
];

const PST_PAWN = [
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0,-2, 0, 4, 0,-2, 0, 0],
  [ 2, 0, 8, 0, 8, 0, 8, 0, 2],
  [ 6,12,18,18,20,18,18,12, 6],
  [10,20,30,34,40,34,30,20,10],
  [14,26,42,60,80,60,42,26,14],
  [18,36,56,80,120,80,56,36,18],
  [ 0, 3, 6, 9,12, 9, 6, 3, 0],
];

/** 获取 PST 位置加成 */
function pstAt(table: number[][], row: number, col: number, color: Color): number {
  const r = color === Color.Red ? (9 - row) : row;
  return table[r]?.[col] ?? 0;
}

/** 单枚棋子估值（子力 + 位置） */
function pieceEval(type: PieceType, row: number, col: number, color: Color): number {
  let val = PIECE_VALUE[type] ?? 0;
  switch (type) {
    case PieceType.Chariot: val += pstAt(PST_CHARIOT, row, col, color); break;
    case PieceType.Horse:   val += pstAt(PST_HORSE, row, col, color); break;
    case PieceType.Cannon:  val += pstAt(PST_CANNON, row, col, color); break;
    case PieceType.Pawn:
      val += pstAt(PST_PAWN, row, col, color);
      if (color === Color.Red ? row <= 4 : row >= 5) val += PAWN_CROSSED;
      break;
  }
  return val;
}

/**
 * 完整评估（用于主搜索）
 * 正数 = 红方优，负数 = 黑方优
 */
export function evaluateBoard(grid: (Piece | null)[][]): number {
  let material = 0;

  // 子力 + PST
  for (let r = 0; r < 10; r++) {
    const row = grid[r];
    for (let c = 0; c < 9; c++) {
      const p = row[c];
      if (!p) continue;

      const val = p.hidden
        ? HIDDEN_PIECE_VALUE  // 暗子未翻开:统一期望值,不偷看随机真实类型
        : pieceEval(p.type, r, c, p.color);

      material += (p.color === Color.Red ? val : -val);
    }
  }

  // 国王安全（便宜）
  const redKing = findKing(grid, Color.Red);
  const blackKing = findKing(grid, Color.Black);
  if (!redKing || !blackKing) {
    return !redKing ? -100000 : 100000;
  }

  const redSafety = kingSafety(grid, redKing, Color.Red);
  const blackSafety = kingSafety(grid, blackKing, Color.Black);

  // 局面阶段：统计大子数
  let majors = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = grid[r][c];
      if (p && !p.hidden && (p.type === PieceType.Chariot || p.type === PieceType.Horse || p.type === PieceType.Cannon)) {
        majors++;
      }
    }
  }
  const phaseFactor = Math.min(1, majors / 8); // 0(残局) ~ 1(开局)

  return material + (redSafety - blackSafety) * phaseFactor;
}

/** 国王安全：护卫 + 暴露惩罚 */
function kingSafety(grid: (Piece | null)[][], pos: Position, color: Color): number {
  let score = 0;
  const { row, col } = pos;

  // 1. 周围护卫奖励
  const guardOffsets: [number, number][] = [
    [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1],
  ];
  for (const [dr, dc] of guardOffsets) {
    const nr = row + dr, nc = col + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    const p = grid[nr]?.[nc];
    if (p && p.color === color && !p.hidden &&
        (p.type === PieceType.Advisor || p.type === PieceType.Elephant)) {
      score += 15;
    }
  }

  // 2. 露出九宫格外惩罚
  const [minR, maxR] = color === Color.Red ? [7, 9] : [0, 2];
  if (row < minR || row > maxR || col < 3 || col > 5) {
    score -= 40;
  }

  // 3. 正面敌方子力威胁
  const dir = color === Color.Red ? -1 : 1;
  let r = row + dir;
  let block = 0;
  while (r >= 0 && r <= 9) {
    const p = grid[r]?.[col];
    if (p) {
      if (p.color !== color && !p.hidden) {
        if ((p.type === PieceType.Chariot && block === 0) ||
            (p.type === PieceType.Cannon && block === 1)) {
          score -= 50;
        }
      }
      block++;
    }
    r += dir;
  }

  return score;
}

/** 子力简单值（用于 MVV-LVA） */
export function getPieceValueSimple(type: PieceType): number {
  return PIECE_VALUE[type] ?? 0;
}

export { PIECE_VALUE as PIECE_VALUES };
