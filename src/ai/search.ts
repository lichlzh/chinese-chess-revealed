// ============================================================
// 揭棋 - AI 搜索（Minimax + Alpha-Beta + PVS + Quiescence）
// ============================================================

import { Color, PieceType, type Position, type Piece } from '../engine/types';
import { cloneGridFast } from '../engine/utils';
import { opponentColor } from '../engine/board';
import { getAllLegalMoves, isInCheck, computeChases, type BoardState } from '../engine/moves';
import { positionKey, REPETITION_LIMIT, judgeCycle, type MoveKind } from '../engine/repetition';
import { evaluateBoard, getPieceValueSimple, HIDDEN_PIECE_VALUE } from './evaluate';
import { TranspositionTable, TTFlag } from './tt';
import { computeHash } from './zobrist';

// ---- 常量 ----
const INF = 999999;
const MATE_SCORE = 100000;
const DRAW_SCORE = 0;
const NULL_MOVE_R = 2;       // 空着裁剪缩减深度
const MIN_NULL_DEPTH = 2;    // 最小空着深度
const RAZOR_MARGIN = 300;    // 剃刀剪枝边距
const MAX_HISTORY = 1 << 16; // 历史启发表容量上限

// ---- 搜索上下文（替代模块级单例） ----
export interface SearchContext {
  tt: TranspositionTable;
  nodesSearched: number;
  searchStartTime: number;
  timeLimit: number;
  killerMoves: [number, number][];
  historyTable: Map<number, number>;
}

/** 创建搜索上下文 */
export function createSearchContext(
  tt: TranspositionTable,
  timeLimit: number,
): SearchContext {
  return {
    tt,
    nodesSearched: 0,
    searchStartTime: Date.now(),
    timeLimit,
    killerMoves: Array.from({ length: 64 }, () => [0, 0]),
    historyTable: new Map(),
  };
}

// ---- 着法编解码（10*9 棋盘，10 以内数字可单字节编码） ----
function encode(from: Position, to: Position): number {
  return from.row * 1000 + from.col * 100 + to.row * 10 + to.col;
}

// ---- 轻量着法应用（搜索树用，仅克隆 grid） ----
interface MoveResult {
  grid: (Piece | null)[][];
  piece: Piece;
  captured: Piece | null;
}

function applyMove(grid: (Piece | null)[][], from: Position, to: Position): MoveResult {
  const newGrid = cloneGridFast(grid);
  const piece = { ...newGrid[from.row][from.col]! };
  const captured = newGrid[to.row][to.col] ? { ...newGrid[to.row][to.col]! } : null;

  newGrid[from.row][from.col] = null;
  if (piece.hidden) piece.hidden = false;
  newGrid[to.row][to.col] = piece;

  return { grid: newGrid, piece, captured };
}

/** 将 grid + currentTurn 组成临时 BoardState（search 内部快速构造） */
function makeTempState(grid: (Piece | null)[][], turn: Color): BoardState {
  return {
    grid, currentTurn: turn,
    status: 0 as unknown as BoardState['status'],
    moveHistory: [], redCaptured: [], blackCaptured: [],
    movesWithoutCapture: 0,
  };
}

/** 搜索路径上的「边」：从父节点走一步到达子节点局面 */
export interface PathEntry {
  key: string;       // 子节点局面指纹
  side: Color;       // 走这步的一方
  kind: MoveKind;    // 这步的性质（将 / 捉 / 闲）
  chases: number[];  // 这步捉住的对方棋子 id
}

/**
 * 判断「走完某一步后」这步棋的性质，用于搜索树内的循环裁决。
 *
 * 成本控制：
 * - 将军（isChk）极便宜，直接判定；
 * - 仅当该局面之前已在搜索路径上出现过（即将形成循环）时，才调用较重的
 *   computeChases 精确判定「捉」——循环分支会立即被裁决剪枝，不会深展开；
 * - 否则（首次到达且非将军）保守判「闲」。方向保守：宁可漏判长捉为和棋，
 *   也不误判 AI 主动走入长捉被判负（最坏只是没占到规则便宜）。
 */
function moveKindAfter(
  grid: (Piece | null)[][], turn: Color, newTurn: Color,
  isChk: boolean, alreadyInPath: boolean,
): { kind: MoveKind; chases: number[] } {
  if (isChk) return { kind: 'check', chases: [] };
  if (alreadyInPath) {
    const chases = computeChases(makeTempState(grid, newTurn), turn);
    return { kind: chases.length > 0 ? 'chase' : 'idle', chases };
  }
  return { kind: 'idle', chases: [] };
}

/**
 * 搜索路径上的重复裁决打分（供 search 复用，亦可单测）。
 *
 * @param currentKey 当前节点局面指纹
 * @param path       当前 DFS 路径（祖先节点序列）
 * @returns 触发裁决时返回对应分数（判负方为负的大分，和棋为 0）；
 *          未达重复次数时返回 null。
 */
export function repetitionScore(
  currentKey: string,
  path: PathEntry[],
  turn: Color,
  ply: number,
): number | null {
  let reps = 0;
  let firstIdx = -1;
  for (let i = 0; i < path.length; i++) {
    if (path[i].key === currentKey) {
      if (firstIdx < 0) firstIdx = i;
      reps++;
    }
  }
  if (reps < REPETITION_LIMIT) return null;

  const verdict = judgeCycle(path.slice(firstIdx + 1));
  if (verdict.loser === null) return DRAW_SCORE;
  return verdict.loser === turn ? -(MATE_SCORE - ply) : (MATE_SCORE - ply);
}

// ---- 静态搜索（Quiescence Search） ----
function quiescence(
  ctx: SearchContext,
  grid: (Piece | null)[][],
  turn: Color,
  alpha: number,
  beta: number,
): number {
  ctx.nodesSearched++;

  if (ctx.timeLimit > 0 && (ctx.nodesSearched & 127) === 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) {
    return 0;
  }

  // 站位评估
  const standPat = turn === Color.Red
    ? evaluateBoard(grid)
    : -evaluateBoard(grid);

  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  // 收集吃子着法
  const state = makeTempState(grid, turn);
  const allMoves = getAllLegalMoves(state);
  const captures: { from: Position; to: Position; victimVal: number }[] = [];

  for (const m of allMoves) {
    const victim = grid[m.to.row][m.to.col];
    if (victim) {
      captures.push({ ...m, victimVal: victim.hidden ? HIDDEN_PIECE_VALUE : getPieceValueSimple(victim.type) });
    }
  }

  if (captures.length === 0) return standPat;

  // MVV-LVA 排序
  captures.sort((a, b) => {
    const va = a.victimVal;
    const vb = b.victimVal;
    if (va !== vb) return vb - va;
    const aa = grid[a.from.row][a.from.col];
    const ab = grid[b.from.row][b.from.col];
    const ava = aa?.hidden
      ? HIDDEN_PIECE_VALUE
      : getPieceValueSimple(aa?.type ?? PieceType.Pawn);
    const avb = ab?.hidden
      ? HIDDEN_PIECE_VALUE
      : getPieceValueSimple(ab?.type ?? PieceType.Pawn);
    return ava - avb;
  });

  // Delta 剪枝
  if (standPat + getPieceValueSimple(PieceType.Chariot) + 200 < alpha) return alpha;

  for (const mv of captures) {
    const result = applyMove(grid, mv.from, mv.to);
    // 跳过送将的着法
    if (isInCheck(result.grid, turn)) continue;

    const score = -quiescence(ctx, result.grid, opponentColor(turn), -beta, -alpha);

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

// ---- 着法排序 ----
interface ScoredMove {
  from: Position;
  to: Position;
  score: number;
  encoded: number;
}

function orderMoves(
  ctx: SearchContext,
  grid: (Piece | null)[][],
  turn: Color,
  moves: { from: Position; to: Position }[],
  ttMove: number,
  ply: number,
): ScoredMove[] {
  const result: ScoredMove[] = [];

  for (const m of moves) {
    const enc = encode(m.from, m.to);
    let score = 0;

    if (enc === ttMove) {
      score = 10_000_000;
    } else {
      const victim = grid[m.to.row][m.to.col];
      const attacker = grid[m.from.row][m.from.col];

      if (victim) {
        // MVV-LVA 吃子排序
        const victimVal = victim.hidden ? HIDDEN_PIECE_VALUE : getPieceValueSimple(victim.type);
        const attackerVal = attacker?.hidden
          ? HIDDEN_PIECE_VALUE
          : getPieceValueSimple(attacker?.type ?? PieceType.Pawn);
        score = 900_000 + victimVal * 100 - attackerVal;
      } else {
        // 杀手着法
        if (ctx.killerMoves[ply][0] === enc) score = 800_000;
        else if (ctx.killerMoves[ply][1] === enc) score = 799_999;
        // 历史启发
        else score = ctx.historyTable.get(enc) ?? 0;
        // 暗子翻开加成
        if (attacker?.hidden) score += 500;
      }
    }

    result.push({ from: m.from, to: m.to, score, encoded: enc });
  }

  result.sort((a, b) => b.score - a.score);
  return result;
}

// ---- 杀手/历史启发更新 ----
function updateKiller(ctx: SearchContext, encoded: number, ply: number) {
  if (ctx.killerMoves[ply][0] !== encoded) {
    ctx.killerMoves[ply][1] = ctx.killerMoves[ply][0];
    ctx.killerMoves[ply][0] = encoded;
  }
}

function updateHistory(ctx: SearchContext, encoded: number, depth: number) {
  const bonus = Math.min(depth * depth, 400);
  const old = ctx.historyTable.get(encoded) ?? 0;
  const newVal = old + bonus - (old * bonus) / 1024; // 衰减式更新
  ctx.historyTable.set(encoded, newVal);

  if (ctx.historyTable.size > MAX_HISTORY) {
    // 清理过大的历史表
    const half = ctx.historyTable.size >> 1;
    let count = 0;
    for (const key of ctx.historyTable.keys()) {
      ctx.historyTable.delete(key);
      if (++count >= half) break;
    }
  }
}

// ---- 主搜索（Negamax + PVS） ----
function search(
  ctx: SearchContext,
  grid: (Piece | null)[][],
  turn: Color,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  isPV: boolean,
  path: PathEntry[] = [],
  repetitionAware: boolean = true,
): number {
  ctx.nodesSearched++;

  // 超时检测（每 64 个节点检测一次）
  if (ctx.timeLimit > 0 && (ctx.nodesSearched & 63) === 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) {
    return 0;
  }

  // ===== 重复局面裁决（长将 / 长捉 感知）=====
  // 一旦路径上同一局面出现满 REPETITION_LIMIT 次，立即按棋规裁决，
  // 相当于对「走入被判负循环」的分支剪枝——AI 既不会主动长将自杀，
  // 也能在对方违规时主动制造重复逼胜。
  if (repetitionAware) {
    const verdictScore = repetitionScore(positionKey(grid, turn), path, turn, ply);
    if (verdictScore !== null) return verdictScore;
  }

  // ===== 置换表探测 =====
  const hash = computeHash(grid, turn);
  const ttEntry = ctx.tt.probe(hash);
  let ttMove = 0;

  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === TTFlag.EXACT) return ttEntry.score;
    if (ttEntry.flag === TTFlag.ALPHA && ttEntry.score <= alpha) return ttEntry.score;
    if (ttEntry.flag === TTFlag.BETA && ttEntry.score >= beta) return ttEntry.score;
  }
  if (ttEntry) ttMove = ttEntry.bestMove;

  // ===== 叶节点 → 静态搜索 =====
  if (depth <= 0) {
    return quiescence(ctx, grid, turn, alpha, beta);
  }

  // ===== 生成合法着法 =====
  const state = makeTempState(grid, turn);
  const allMoves = getAllLegalMoves(state);

  // 将死/困毙检测
  if (allMoves.length === 0) {
    if (isInCheck(grid, turn)) {
      return -(MATE_SCORE - ply);
    }
    return DRAW_SCORE;
  }

  // ===== 剃刀剪枝（仅在浅层非 PV 节点） =====
  if (!isPV && depth <= 2 && !isInCheck(grid, turn)) {
    const staticEval = turn === Color.Red
      ? evaluateBoard(grid)
      : -evaluateBoard(grid);
    if (staticEval - RAZOR_MARGIN * depth >= beta) {
      return staticEval - RAZOR_MARGIN * depth;
    }
  }

  // ===== 空着裁剪（重复感知模式下关闭，避免路径错位误判循环）=====
  if (!repetitionAware && !isPV && !isInCheck(grid, turn) && depth >= MIN_NULL_DEPTH) {
    // 检查是否有足够子力（避免入局误判）
    let pc = 0;
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 9; c++)
        if (grid[r][c]) pc++;
    if (pc > 10) {
      const R = NULL_MOVE_R + (depth > 6 ? 1 : 0);
      const nullScore = -search(ctx, grid, opponentColor(turn), depth - 1 - R, -beta, -beta + 1, ply + 1, false);
      if (nullScore >= beta) return beta;
    }
  }

  // ===== 着法排序 =====
  const scored = orderMoves(ctx, grid, turn, allMoves, ttMove, ply);

  // ===== PVS 主搜索循环 =====
  let bestScore = -INF;
  let bestMove = 0;
  let flag = TTFlag.ALPHA;
  let first = true;

  for (const move of scored) {
    const result = applyMove(grid, move.from, move.to);
    const newTurn = opponentColor(turn);

    // 记录这条「边」到搜索路径（用于重复局面裁决）
    const newKey = positionKey(result.grid, newTurn);
    const isChk = isInCheck(result.grid, newTurn);
    let alreadyInPath = false;
    for (const e of path) if (e.key === newKey) { alreadyInPath = true; break; }
    const { kind, chases } = moveKindAfter(result.grid, turn, newTurn, isChk, alreadyInPath);
    path.push({ key: newKey, side: turn, kind, chases });

    let score: number;

    if (first) {
      score = -search(ctx, result.grid, newTurn, depth - 1, -beta, -alpha, ply + 1, isPV, path, repetitionAware);
      first = false;
    } else {
      // 零窗口搜索
      score = -search(ctx, result.grid, newTurn, depth - 1, -alpha - 1, -alpha, ply + 1, false, path, repetitionAware);
      // 窗口失效 → 重新完整搜索
      if (score > alpha && score < beta) {
        score = -search(ctx, result.grid, newTurn, depth - 1, -beta, -alpha, ply + 1, true, path, repetitionAware);
      }
    }

    path.pop();

    if (score > bestScore) {
      bestScore = score;
      bestMove = move.encoded;

      if (score > alpha) {
        alpha = score;
        flag = TTFlag.EXACT;

        // Beta 剪枝
        if (score >= beta) {
          flag = TTFlag.BETA;
          // 非吃子着法 → 更新杀手
          if (!grid[move.to.row][move.to.col]) {
            updateKiller(ctx, move.encoded, ply);
          }
          updateHistory(ctx, move.encoded, depth);
          break;
        }
      }
    }

    if (ctx.timeLimit > 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) break;
  }

  // ===== 写入置换表 =====
  if (bestScore > -INF && (ctx.timeLimit === 0 || Date.now() - ctx.searchStartTime <= ctx.timeLimit)) {
    ctx.tt.store(hash, depth, bestScore, flag, bestMove);
  }

  return bestScore;
}

// ========================================================================
// 公开接口：AI 最佳着法搜索
// ========================================================================
export interface SearchConfig {
  maxDepth: number;
  timeLimit: number; // ms
}

/** 找到当前局面下的最佳着法 */
export function findBestMove(
  state: BoardState,
  config: SearchConfig,
  transpositionTable: TranspositionTable,
): { from: Position; to: Position } | null {
  const ctx = createSearchContext(transpositionTable, config.timeLimit);

  const allMoves = getAllLegalMoves(state);
  if (allMoves.length === 0) return null;
  if (allMoves.length === 1) return allMoves[0];

  let bestMove: { from: Position; to: Position } | null = null;
  let bestScore = -INF;

  // ===== 迭代加深 + 期望窗口 =====
  for (let depth = 1; depth <= config.maxDepth; depth++) {
    let alpha = -INF;
    let beta = INF;

    // 用上一轮最佳分数构建期望窗口
    if (depth >= 2) {
      const window = 150;
      alpha = bestScore - window;
      beta = bestScore + window;
    }

    let currentBest: { from: Position; to: Position; encoded: number } | null = null;
    let currentBestScore = -INF;

    const scored = orderMoves(ctx, state.grid, state.currentTurn, allMoves, 0, 0);

    for (const move of scored) {
      const result = applyMove(state.grid, move.from, move.to);
      const newTurn = opponentColor(state.currentTurn);
      const path: PathEntry[] = [];

      let score = -search(ctx, result.grid, newTurn, depth - 1, -beta, -alpha, 0, true, path, true);

      // 窗口失效 → 用全窗口重搜
      if (score <= alpha || score >= beta) {
        score = -search(ctx, result.grid, newTurn, depth - 1, -INF, INF, 0, true, path, true);
      }

      if (score > currentBestScore) {
        currentBestScore = score;
        currentBest = { from: move.from, to: move.to, encoded: move.encoded };
      }

      if (ctx.timeLimit > 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) break;
    }

    if (currentBest) {
      bestMove = currentBest;
      bestScore = currentBestScore;
    }

    // 超时 → 用当前最优着法
    if (ctx.timeLimit > 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) break;

    // 杀棋 → 无需更深搜索
    if (Math.abs(bestScore) > MATE_SCORE - 200) break;
  }

  if (ctx.timeLimit > 0) {
    console.debug(`[AI] depth=${config.maxDepth} nodes=${ctx.nodesSearched} time=${Date.now() - ctx.searchStartTime}ms ttSize=${ctx.tt.size} ttHit=${Math.round(ctx.tt.hitRate() * 100)}%`);
  }

  return bestMove;
}

// ========================================================================
// 轻量级 AI（用于 fallback，无需 Worker）
// ========================================================================

/**
 * 简单的 Negamax + Alpha-Beta 搜索（无置换表、无高级剪枝）。
 * 用于 Worker 不可用时的 fallback，保证 AI 不会退化为随机走法。
 */
function simpleSearch(
  grid: (Piece | null)[][],
  turn: Color,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (depth <= 0) {
    return turn === Color.Red ? evaluateBoard(grid) : -evaluateBoard(grid);
  }

  const state = makeTempState(grid, turn);
  const allMoves = getAllLegalMoves(state);

  if (allMoves.length === 0) {
    return isInCheck(grid, turn) ? -(MATE_SCORE - depth) : DRAW_SCORE;
  }

  let bestScore = -INF;

  for (const mv of allMoves) {
    const result = applyMove(grid, mv.from, mv.to);
    // 跳过送将
    if (isInCheck(result.grid, turn)) continue;

    const score = -simpleSearch(result.grid, opponentColor(turn), depth - 1, -beta, -alpha);

    if (score > bestScore) bestScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break; // Beta 剪枝
  }

  return bestScore;
}

/**
 * Fallback AI：轻量搜索，无需 Web Worker。
 * 搜索深度较浅但远优于随机走法。
 */
export function findSimpleMove(
  state: BoardState,
  maxDepth: number = 3,
): { from: Position; to: Position } | null {
  const allMoves = getAllLegalMoves(state);
  if (allMoves.length === 0) return null;
  if (allMoves.length === 1) return allMoves[0];

  let bestMove: { from: Position; to: Position } | null = null;
  let bestScore = -INF;

  for (const mv of allMoves) {
    const result = applyMove(state.grid, mv.from, mv.to);
    if (isInCheck(result.grid, state.currentTurn)) continue;

    const score = -simpleSearch(result.grid, opponentColor(state.currentTurn), maxDepth - 1, -INF, INF);

    if (score > bestScore) {
      bestScore = score;
      bestMove = mv;
    }
  }

  return bestMove;
}
