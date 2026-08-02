// ============================================================
// 揭棋 - 引擎工具函数（快速克隆等）
// ============================================================

import type { Piece, Position } from './types';
import { Color } from './types';

/** 快速克隆 grid（避免 map/map 的函数调用开销） */
export function cloneGridFast(grid: (Piece | null)[][]): (Piece | null)[][] {
  const result: (Piece | null)[][] = new Array(10);
  for (let r = 0; r < 10; r++) {
    const row = grid[r];
    const newRow: (Piece | null)[] = new Array(9);
    for (let c = 0; c < 9; c++) {
      const cell = row[c];
      newRow[c] = cell ? { id: cell.id, type: cell.type, color: cell.color, hidden: cell.hidden } : null;
    }
    result[r] = newRow;
  }
  return result;
}

/** 通过坐标比较位置 */
export function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}
