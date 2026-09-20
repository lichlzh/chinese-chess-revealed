// ============================================================
// 揭棋 - SEE (Static Exchange Evaluation) — 优化版
// 模拟目标格上的连续交换序列，返回净收益（从攻击方视角）。
// 用于 Quiescence 搜索的吃子排序，替代 MVV-LVA。
// ============================================================

import { Color, PieceType, type Piece, type Position } from './types';
import { getPieceValueSimple } from '../ai/evaluate';

/** 棋子价值排序（用于找最小价值攻击者） */
const SEE_PIECE_VALUE: Record<PieceType, number> = {
  [PieceType.Pawn]: 1,
  [PieceType.Advisor]: 2,
  [PieceType.Elephant]: 3,
  [PieceType.Cannon]: 4,
  [PieceType.Horse]: 5,
  [PieceType.Chariot]: 6,
  [PieceType.King]: 7,
};

/**
 * 找到能攻击 `targetPos` 的 `byColor` 棋子中价值最小的一个。
 * 返回 { pos, value } 或 null。
 * 比 findAttackers 快，因为只找最小值，不构建完整列表。
 */
function findSmallestAttacker(
  grid: (Piece | null)[][],
  targetPos: Position,
  byColor: Color,
  removed: Uint8Array,
): { pos: Position; value: number } | null {
  const { row: tr, col: tc } = targetPos;
  let best: { pos: Position; value: number } | null = null;
  let bestOrder = 999;

  // 1. 车/炮射线扫描
  const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of dirs) {
    let r = tr + dr, c = tc + dc;
    let blockCount = 0;

    while (r >= 0 && r <= 9 && c >= 0 && c <= 8) {
      const p = grid[r][c];
      if (p) {
        if (!p.hidden && p.color === byColor) {
          if (p.type === PieceType.Chariot && blockCount === 0) {
            const order = SEE_PIECE_VALUE[PieceType.Chariot];
            if (order < bestOrder && !removed[r * 9 + c]) {
              bestOrder = order;
              best = { pos: { row: r, col: c }, value: getPieceValueSimple(PieceType.Chariot) };
            }
          } else if (p.type === PieceType.Cannon && blockCount === 1) {
            const order = SEE_PIECE_VALUE[PieceType.Cannon];
            if (order < bestOrder && !removed[r * 9 + c]) {
              bestOrder = order;
              best = { pos: { row: r, col: c }, value: getPieceValueSimple(PieceType.Cannon) };
            }
          }
        }
        blockCount++;
        if (blockCount >= 2) break; // 炮之后无需继续
      }
      r += dr;
      c += dc;
    }
  }

  // 2. 马攻击
  const horseAttacks: [number, number, number, number][] = [
    [-2, -1, -1, 0], [-2, 1, -1, 0],
    [2, -1, 1, 0], [2, 1, 1, 0],
    [-1, -2, 0, -1], [-1, 2, 0, 1],
    [1, -2, 0, -1], [1, 2, 0, 1],
  ];
  for (const [dr, dc, br, bc] of horseAttacks) {
    const nr = tr + dr, nc = tc + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    if (grid[tr + br]?.[tc + bc]) continue; // 蹩马脚
    const p = grid[nr][nc];
    if (p && p.color === byColor && !p.hidden && p.type === PieceType.Horse) {
      const order = SEE_PIECE_VALUE[PieceType.Horse];
      if (order < bestOrder && !removed[nr * 9 + nc]) {
        bestOrder = order;
        best = { pos: { row: nr, col: nc }, value: getPieceValueSimple(PieceType.Horse) };
      }
    }
  }

  // 3. 兵/卒攻击
  const fwd = byColor === Color.Red ? -1 : 1;
  const pb = grid[tr - fwd]?.[tc];
  if (pb && pb.color === byColor && !pb.hidden && pb.type === PieceType.Pawn) {
    const order = SEE_PIECE_VALUE[PieceType.Pawn];
    if (order < bestOrder && !removed[(tr - fwd) * 9 + tc]) {
      bestOrder = order;
      best = { pos: { row: tr - fwd, col: tc }, value: getPieceValueSimple(PieceType.Pawn) };
    }
  }
  for (const dc of [-1, 1]) {
    const pp = grid[tr]?.[tc + dc];
    if (pp && pp.color === byColor && !pp.hidden && pp.type === PieceType.Pawn) {
      const order = SEE_PIECE_VALUE[PieceType.Pawn];
      if (order < bestOrder && !removed[tr * 9 + (tc + dc)]) {
        bestOrder = order;
        best = { pos: { row: tr, col: tc + dc }, value: getPieceValueSimple(PieceType.Pawn) };
      }
    }
  }

  // 4. 将/帅（紧邻）
  for (const [dr, dc] of dirs) {
    const nr = tr + dr, nc = tc + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    const p = grid[nr][nc];
    if (p && p.color === byColor && !p.hidden && p.type === PieceType.King) {
      const [minR, maxR] = byColor === Color.Red ? [7, 9] : [0, 2];
      if (nr >= minR && nr <= maxR && nc >= 3 && nc <= 5) {
        const order = SEE_PIECE_VALUE[PieceType.King];
        if (order < bestOrder && !removed[nr * 9 + nc]) {
          bestOrder = order;
          best = { pos: { row: nr, col: nc }, value: getPieceValueSimple(PieceType.King) };
        }
      }
    }
  }

  // 5. 士/仕
  const advisorDirs: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dr, dc] of advisorDirs) {
    const nr = tr + dr, nc = tc + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    const p = grid[nr][nc];
    if (p && p.color === byColor && !p.hidden && p.type === PieceType.Advisor) {
      const order = SEE_PIECE_VALUE[PieceType.Advisor];
      if (order < bestOrder && !removed[nr * 9 + nc]) {
        bestOrder = order;
        best = { pos: { row: nr, col: nc }, value: getPieceValueSimple(PieceType.Advisor) };
      }
    }
  }

  // 6. 象/相
  const elephantSteps: [number, number, number, number][] = [
    [2, 2, 1, 1], [2, -2, 1, -1], [-2, 2, -1, 1], [-2, -2, -1, -1],
  ];
  for (const [dr, dc, br, bc] of elephantSteps) {
    const nr = tr + dr, nc = tc + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    if (grid[tr + br]?.[tc + bc]) continue;
    const p = grid[nr][nc];
    if (p && p.color === byColor && !p.hidden && p.type === PieceType.Elephant) {
      const order = SEE_PIECE_VALUE[PieceType.Elephant];
      if (order < bestOrder && !removed[nr * 9 + nc]) {
        bestOrder = order;
        best = { pos: { row: nr, col: nc }, value: getPieceValueSimple(PieceType.Elephant) };
      }
    }
  }

  return best;
}

/**
 * 评估 `from` 位置棋子吃 `to` 位置棋子后的净交换收益。
 * 正值 = 交换有利，负值 = 交换不利。
 *
 * 优化：快速路径 + 限制深度为 3 层（覆盖绝大多数战术情况）。
 */
export function seeCapture(
  grid: (Piece | null)[][],
  from: Position,
  to: Position,
): number {
  const captured = grid[to.row][to.col];
  if (!captured) return 0;

  const attacker = grid[from.row][from.col];
  if (!attacker) return 0;

  const capturedVal = getPieceValueSimple(captured.type);
  const attackerVal = getPieceValueSimple(attacker.type);

  // 快速路径：吃子价值 >= 攻击者价值 → 检查是否有保护
  if (capturedVal >= attackerVal) {
    const removed = new Uint8Array(90);
    removed[from.row * 9 + from.col] = 1;
    const enemy = attacker.color === Color.Red ? Color.Black : Color.Red;
    const protector = findSmallestAttacker(grid, to, enemy, removed);
    if (!protector) return capturedVal - attackerVal; // 无保护，确定赚
    // 有保护：净收益 = 吃子价值 - 攻击者价值 + 反吃价值（简化）
    return capturedVal - attackerVal + (protector.value < attackerVal ? protector.value : 0);
  }

  // 慢速路径：攻击者价值 > 吃子价值，模拟交换序列（限制深度 3）
  const removed = new Uint8Array(90);
  removed[from.row * 9 + from.col] = 1;

  let gain = capturedVal;
  let currentVal = attackerVal;
  let currentColor = attacker.color;
  const targetPos = to;

  for (let depth = 0; depth < 3; depth++) {
    const nextColor = currentColor === Color.Red ? Color.Black : Color.Red;
    const atk = findSmallestAttacker(grid, targetPos, nextColor, removed);
    if (!atk) break;

    gain = currentVal - gain;
    if (gain < 0 && atk.value >= currentVal) break; // 对手用更大子来吃，确定亏

    removed[atk.pos.row * 9 + atk.pos.col] = 1;
    currentVal = atk.value;
    currentColor = nextColor;
  }

  return currentVal - gain;
}

/**
 * 快速 SEE：仅评估吃子是否 >= 0（是否不亏）。
 */
export function seePositive(
  grid: (Piece | null)[][],
  from: Position,
  to: Position,
): boolean {
  return seeCapture(grid, from, to) >= 0;
}
