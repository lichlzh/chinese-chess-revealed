// ============================================================
// 揭棋 - Zobrist 哈希（用于置换表键值）
// ============================================================

import { Color, PieceType, type Piece, type Position } from '../engine/types';

/** 棋子类型 → 索引映射 */
function typeIdx(t: PieceType): number {
  const map: Record<string, number> = {
    king: 0, advisor: 1, elephant: 2, horse: 3,
    chariot: 4, cannon: 5, pawn: 6,
  };
  return map[t] ?? 0;
}
function colIdx(c: Color): number { return c === Color.Red ? 0 : 1; }

const PIECE_TYPES = 7;
const COLS = 2;
const ROWS = 10;
const COLS_BOARD = 9;

// xorshift32 伪随机数生成器（保证跨环境一致）
function xorshift32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

const rng = xorshift32(0x9E3779B9);

// pieceKeys[typeIdx][colorIdx][row][col]
const pieceKeys: number[][][][] = [];
for (let t = 0; t < PIECE_TYPES; t++) {
  pieceKeys[t] = [];
  for (let c = 0; c < COLS; c++) {
    pieceKeys[t][c] = [];
    for (let r = 0; r < ROWS; r++) {
      pieceKeys[t][c][r] = [];
      for (let col = 0; col < COLS_BOARD; col++) {
        pieceKeys[t][c][r][col] = rng();
      }
    }
  }
}
const sideKey = rng();

/** 从头计算局面的 Zobrist 哈希值 */
export function computeHash(grid: (Piece | null)[][], currentTurn: Color): number {
  let hash = 0;
  // 手工循环避免函数调用开销
  for (let r = 0; r < 10; r++) {
    const row = grid[r];
    for (let c = 0; c < 9; c++) {
      const p = row[c];
      if (p) {
        hash ^= pieceKeys[typeIdx(p.type)][colIdx(p.color)][r][c];
      }
    }
  }
  if (currentTurn === Color.Black) hash ^= sideKey;
  return hash >>> 0;
}

/** 增量更新哈希值：执行一步棋后 */
export function updateHash(
  hash: number,
  piece: Piece,
  from: Position,
  to: Position,
  captured: Piece | null,
  newTurn: Color,
): number {
  let h = hash;
  const ti = typeIdx(piece.type);
  const ci = colIdx(piece.color);

  // 移除原位置
  h ^= pieceKeys[ti][ci][from.row][from.col];
  // 放置到新位置
  h ^= pieceKeys[ti][ci][to.row][to.col];
  // 移除被吃子
  if (captured) {
    h ^= pieceKeys[typeIdx(captured.type)][colIdx(captured.color)][to.row][to.col];
  }
  // 切换回合
  h ^= sideKey;

  return h >>> 0;
}
