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

import { Color, PieceType, type Piece, type Move, type BoardState } from './types';

/** 同一局面出现该次数即触发重复裁决（三次重复） */
export const REPETITION_LIMIT = 3;
/** 第二次重复时即可向 UI 发出预警（尚未裁决） */
export const REPETITION_WARN = 2;

/** 一步着法的性质分类（用于裁决） */
export type MoveKind = 'check' | 'chase' | 'idle';

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

/** 将一步 Move 分类为 将 / 捉 / 闲 */
export function classifyMoveKind(m: Move): MoveKind {
  if (m.isCheck) return 'check';
  if (m.chases && m.chases.length > 0) return 'chase';
  return 'idle';
}

export interface RepetitionVerdict {
  /** 判负的一方；为 null 表示和棋 */
  loser: Color | null;
  reason: string;
}

export interface CycleEntry {
  side: Color;
  kind: MoveKind;
  /** 该步捉住的对方棋子 id（kind 为 'chase' 时有效） */
  chases: number[];
}

/**
 * 判断某一方在循环的一组着法中是否「生事」：
 * - 含「闲」(idle)        → 不变着，不算违规（一将一闲 / 一捉一闲 / 纯闲）
 * - 全是将军               → 长将
 * - 含「捉」且捉的是同一枚子（chases 交集非空）→ 长捉
 *   注：一将一捉 也算生事，按「捉」判负（长捉）
 * - 含「捉」但捉的不是同一枚子 → 视为不变着（保守，宁可判和）
 */
function sideFoul(edges: CycleEntry[]): { foul: boolean; kind: 'check' | 'chase' | null } {
  if (edges.length === 0) return { foul: false, kind: null };
  if (edges.some(e => e.kind === 'idle')) return { foul: false, kind: null };

  const chaseEdges = edges.filter(e => e.kind === 'chase');
  if (chaseEdges.length === 0) {
    // 全部为将军
    return { foul: true, kind: 'check' };
  }

  // 含捉：取所有「捉」着法的目标交集，必须捉住同一枚子才算长捉
  let inter: number[] | null = null;
  for (const e of chaseEdges) {
    inter = inter === null ? [...e.chases] : inter.filter(id => e.chases.includes(id));
    if (inter.length === 0) break;
  }
  if (inter && inter.length > 0) return { foul: true, kind: 'chase' };
  return { foul: false, kind: null };
}

/**
 * 通用循环裁决：输入循环里每一步的（走子方 / 性质 / 捉子），
 * 返回判负方（null 表示和棋）。供游戏层与 AI 搜索复用。
 */
export function judgeCycle(entries: CycleEntry[]): RepetitionVerdict {
  const red = sideFoul(entries.filter(e => e.side === Color.Red));
  const black = sideFoul(entries.filter(e => e.side === Color.Black));
  const reasonFor = (s: { kind: 'check' | 'chase' | null }) =>
    s.kind === 'chase' ? '长捉判负' : '长将判负';

  if (red.foul && !black.foul) return { loser: Color.Red, reason: reasonFor(red) };
  if (black.foul && !red.foul) return { loser: Color.Black, reason: reasonFor(black) };
  if (red.foul && black.foul) return { loser: null, reason: '双方均不变着，和棋' };
  return { loser: null, reason: '三次重复局面，和棋' };
}

/**
 * 三次重复局面的裁决（游戏层用）：
 * 取出循环内全部着法，按「走子方 + 性质 + 捉子」交给通用 judgeCycle。
 */
export function adjudicateRepetition(moveHistory: Move[]): RepetitionVerdict {
  const cycle = repetitionCycleMoves(moveHistory);
  return judgeCycle(
    cycle.map(m => ({
      side: m.piece.color,
      kind: classifyMoveKind(m),
      chases: m.chases ?? [],
    })),
  );
}

/** UI 用的重复局面预警等级 */
export type RepetitionLevel = 'none' | 'warn';

/** UI 用的重复局面提示信息 */
export interface RepetitionHint {
  /** 当前局面已出现的次数（含本局） */
  count: number;
  /** none: 未达预警阈值；warn: 已达预警，再次重复将触发裁决 */
  level: RepetitionLevel;
  /** 给玩家看的中文提示 */
  message: string;
}

/**
 * 计算「重复局面」相关的 UI 提示。
 *
 * - 同一局面出现 `REPETITION_WARN`(2) 次即开始预警（游戏层要满 `REPETITION_LIMIT`(3) 次才裁决）。
 * - 预警时尝试推断循环里哪一方在「生事」（长将 / 长捉），以便明确告知玩家。
 * - 仅做只读推断，不修改任何状态；返回 `level==='none'` 表示无需提示。
 */
export function getRepetitionHint(board: BoardState): RepetitionHint {
  const count = countRepetition(board.moveHistory);
  if (count < REPETITION_WARN) {
    return { count, level: 'none', message: '' };
  }

  const cycle = repetitionCycleMoves(board.moveHistory).map(m => ({
    side: m.piece.color,
    kind: classifyMoveKind(m),
    chases: m.chases ?? [],
  }));
  const verdict = judgeCycle(cycle);

  const sideName = (c: Color) => (c === Color.Red ? '红方' : '黑方');
  let message: string;
  if (verdict.loser) {
    const who = sideName(verdict.loser);
    const kind = verdict.reason.includes('长捉') ? '长捉' : '长将';
    message = `⚠️ 重复预警（第 ${count} 次）：当前循环内 ${who}涉嫌${kind}，若再次重复将判${who}负。`;
  } else if (verdict.reason.includes('和棋')) {
    message = `⚠️ 重复预警（第 ${count} 次）：双方均为不变着，若再次重复将判和棋。`;
  } else {
    message = `⚠️ 重复预警（第 ${count} 次）：局面即将三次重复，将触发重复局面裁决。`;
  }

  return { count, level: 'warn', message };
}
