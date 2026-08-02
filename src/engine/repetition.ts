// ============================================================
// 揭棋 - 重复局面检测与裁决
//
// 设计要点：
// 1. 「重复局面」是长将 / 长捉 的必要条件——任何无休止的骚扰
//    最终都表现为同一局面反复出现，因此可用它作为触发器。
// 2. 但重复局面本身**不足以判负**：双方各自不变着也会重复，
//    此时应判和。所以触发后还要判定「谁在生事」。
// 3. 揭棋特殊性：吃子与翻子都是不可逆操作，之前的局面永不再现，
//    因此重复检测只需回溯到最近一次吃子/翻子，窗口很短。
// ============================================================

import { Color, PieceType, type Piece, type Move } from './types';

/** 同一局面出现该次数即触发重复裁决（三次重复） */
export const REPETITION_LIMIT = 3;

const TYPE_CHAR: Record<PieceType, string> = {
  [PieceType.King]: 'k',
  [PieceType.Advisor]: 'a',
  [PieceType.Elephant]: 'e',
  [PieceType.Horse]: 'h',
  [PieceType.Chariot]: 'r',
  [PieceType.Cannon]: 'c',
  [PieceType.Pawn]: 'p',
};

/**
 * 计算局面指纹：棋子分布 + 明暗状态 + 轮到谁走。
 * 暗子加 `*` 标记——明暗不同即视为不同局面（翻子不可逆，必须区分）。
 */
export function positionKey(grid: (Piece | null)[][], turn: Color): string {
  let s = '';
  for (let r = 0; r < 10; r++) {
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = grid[r][c];
      if (!p) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      const ch = TYPE_CHAR[p.type];
      s += p.color === Color.Red ? ch.toUpperCase() : ch;
      if (p.hidden) s += '*';
    }
    if (empty) s += empty;
    s += '/';
  }
  return s + (turn === Color.Red ? 'w' : 'b');
}

/**
 * 当前局面（即最后一步走完后的局面）在可回溯窗口内出现的次数。
 * 回溯遇到吃子/翻子即停止——该步之前的局面不可能重现。
 */
export function countRepetition(moveHistory: Move[]): number {
  const last = moveHistory[moveHistory.length - 1];
  if (!last?.posKeyAfter) return 1;
  const key = last.posKeyAfter;

  let count = 0;
  for (let i = moveHistory.length - 1; i >= 0; i--) {
    const m = moveHistory[i];
    if (m.posKeyAfter === key) count++;
    if (m.captured || m.revealed) break; // 不可逆着法，窗口到此为止
  }
  return count;
}

/** 取出构成循环的着法：从该局面首次出现之后的所有着法 */
export function repetitionCycleMoves(moveHistory: Move[]): Move[] {
  const last = moveHistory[moveHistory.length - 1];
  if (!last?.posKeyAfter) return [];
  const key = last.posKeyAfter;

  let firstIdx = -1;
  for (let i = moveHistory.length - 1; i >= 0; i--) {
    const m = moveHistory[i];
    if (m.posKeyAfter === key) firstIdx = i;
    if (m.captured || m.revealed) break;
  }
  return firstIdx < 0 ? [] : moveHistory.slice(firstIdx + 1);
}

/** 单方在循环中的行为定性 */
export type SideVerdict = 'check' | 'chase' | null;

/**
 * 判断某一方在循环中是否「生事」：
 * - 每一步都在将军           → 长将
 * - 每一步都在捉住同一枚子   → 长捉
 * - 其余（含一将一闲、一捉一闲、纯闲着）→ 不算违规
 */
function judgeSide(moves: Move[]): SideVerdict {
  if (moves.length === 0) return null;

  if (moves.every(m => m.isCheck)) return 'check';

  let intersection: number[] | null = null;
  for (const m of moves) {
    const chases = m.chases ?? [];
    if (chases.length === 0) return null; // 出现闲着，长捉中断
    intersection = intersection === null
      ? [...chases]
      : intersection.filter(id => chases.includes(id));
    if (intersection.length === 0) return null; // 捉的不是同一枚子
  }
  return 'chase';
}

export interface RepetitionVerdict {
  /** 判负的一方；为 null 表示和棋 */
  loser: Color | null;
  reason: string;
}

/**
 * 三次重复局面的裁决：
 * - 仅一方生事 → 该方判负（长将 / 长捉）
 * - 双方都生事 / 双方都不变着 → 和棋
 */
export function adjudicateRepetition(moveHistory: Move[]): RepetitionVerdict {
  const cycle = repetitionCycleMoves(moveHistory);
  const redVerdict = judgeSide(cycle.filter(m => m.piece.color === Color.Red));
  const blackVerdict = judgeSide(cycle.filter(m => m.piece.color === Color.Black));

  const label = (v: SideVerdict) => (v === 'check' ? '长将判负' : '长捉判负');

  if (redVerdict && !blackVerdict) return { loser: Color.Red, reason: label(redVerdict) };
  if (blackVerdict && !redVerdict) return { loser: Color.Black, reason: label(blackVerdict) };
  if (redVerdict && blackVerdict) return { loser: null, reason: '双方均不变着，和棋' };
  return { loser: null, reason: '三次重复局面，和棋' };
}
