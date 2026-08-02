// ============================================================
// 揭棋 - AI 局面评估函数
// ============================================================

import { Color, PieceType, type Piece } from '../engine/types';
import { getPositionIdentity } from '../engine/board';

/** 子力价值表 */
export const PIECE_VALUES: Record<PieceType, number> = {
  [PieceType.King]: 10000,
  [PieceType.Chariot]: 900,
  [PieceType.Cannon]: 450,
  [PieceType.Horse]: 400,
  [PieceType.Elephant]: 200,
  [PieceType.Advisor]: 200,
  [PieceType.Pawn]: 100,
};

/** 兵/卒过河后价值提升 */
const PAWN_CROSSED_BONUS = 80;

/** 位置价值表 (Piece-Square Table) - 红方视角 row 0 = 己方底线 */
const CHARIOT_PST = [
  [ 14, 14, 12, 18, 16, 18, 12, 14, 14],
  [ 16, 20, 18, 24, 26, 24, 18, 20, 16],
  [ 12, 12, 12, 18, 18, 18, 12, 12, 12],
  [ 12, 18, 16, 22, 22, 22, 16, 18, 12],
  [ 12, 14, 12, 18, 18, 18, 12, 14, 12],
  [ 12, 16, 14, 20, 20, 20, 14, 16, 12],
  [ 6, 10,  8, 14, 14, 14,  8, 10,  6],
  [ 4,  8,  6, 14, 12, 14,  6,  8,  4],
  [ 8,  4,  8, 16,  8, 16,  8,  4,  8],
  [-2, 10,  6, 14, 12, 14,  6, 10, -2],
];

const HORSE_PST = [
  [ 4,  8, 16, 12,  4, 12, 16,  8,  4],
  [ 4, 10, 28, 16,  8, 16, 28, 10,  4],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [ 8, 24, 18, 24, 20, 24, 18, 24,  8],
  [ 6, 16, 14, 18, 16, 18, 14, 16,  6],
  [ 4, 12, 16, 14, 12, 14, 16, 12,  4],
  [ 2,  6,  8,  6, 10,  6,  8,  6,  2],
  [ 4,  2,  8,  8,  4,  8,  8,  2,  4],
  [ 0,  2,  4,  4, -2,  4,  4,  2,  0],
  [ 0, -4,  0,  0,  0,  0,  0, -4,  0],
];

const CANNON_PST = [
  [ 6,  4,  0, -10, -12, -10,  0,  4,  6],
  [ 2,  2,  0,  -4, -14,  -4,  0,  2,  2],
  [ 2,  2,  0, -10,  -8, -10,  0,  2,  2],
  [ 0,  0, -2,   4,  10,   4, -2,  0,  0],
  [ 0,  0,  0,   2,   8,   2,  0,  0,  0],
  [-2,  0,  4,   2,   6,   2,  4,  0, -2],
  [ 0,  0,  0,   2,   4,   2,  0,  0,  0],
  [ 4,  0,  8,   6,  10,   6,  8,  0,  4],
  [ 0,  2,  4,   6,   6,   6,  4,  2,  0],
  [ 0,  0,  2,   6,   6,   6,  2,  0,  0],
];

const PAWN_PST = [
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0, -2,  0,  4,  0, -2,  0,  0],
  [ 2,  0,  8,  0,  8,  0,  8,  0,  2],
  [ 6, 12, 18, 18, 20, 18, 18, 12,  6],
  [10, 20, 30, 34, 40, 34, 30, 20, 10],
  [14, 26, 42, 60, 80, 60, 42, 26, 14],
  [18, 36, 56, 80,120, 80, 56, 36, 18],
  [ 0,  3,  6,  9, 12,  9,  6,  3,  0],
];

/** 获取位置价值 */
function getPieceValue(pieceType: PieceType, row: number, col: number, color: Color): number {
  const base = PIECE_VALUES[pieceType] ?? 0;
  let bonus = 0;
  // 红方视角需要翻转行号（红方 row 9 = PST row 0）
  const r = color === Color.Red ? (9 - row) : row;
  const c = col;

  switch (pieceType) {
    case PieceType.Chariot:
      bonus = CHARIOT_PST[r]?.[c] ?? 0;
      break;
    case PieceType.Horse:
      bonus = HORSE_PST[r]?.[c] ?? 0;
      break;
    case PieceType.Cannon:
      bonus = CANNON_PST[r]?.[c] ?? 0;
      break;
    case PieceType.Pawn:
      bonus = PAWN_PST[r]?.[c] ?? 0;
      const hasCrossed = color === Color.Red ? row <= 4 : row >= 5;
      if (hasCrossed) bonus += PAWN_CROSSED_BONUS;
      break;
  }

  return base + bonus;
}

/** 评估局面分数：正数 = 红方优势，负数 = 黑方优势 */
export function evaluateBoard(grid: (Piece | null)[][]): number {
  let score = 0;

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = grid[r][c];
      if (!piece) continue;

      const effType = piece.hidden
        ? (getPositionIdentity({ row: r, col: c }) ?? piece.type)
        : piece.type;

      let value: number;
      if (piece.hidden) {
        // 暗子的期望价值（简化处理：取该位置身份的70%价值）
        value = (PIECE_VALUES[effType] ?? 0) * 0.7 + 10; // +10 威慑价值
      } else {
        value = getPieceValue(piece.type, r, c, piece.color);
      }

      if (piece.color === Color.Red) {
        score += value;
      } else {
        score -= value;
      }
    }
  }

  return score;
}
