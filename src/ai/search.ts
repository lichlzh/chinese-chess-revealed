// ============================================================
// 揭棋 - AI 搜索（Minimax + Alpha-Beta + PVS + Quiescence）
// Phase 1: make/unmake + isInCheckFast + generateCaptures + 缓存将位
// Phase 3: 将军延伸 + LMR + Futility
// ============================================================

import { Color, PieceType, type Position, type Piece } from '../engine/types';
import { opponentColor } from '../engine/board';
import {
  getAllLegalMoves, isInCheckFast, makeMove, unmakeMove,
  generateCaptures, findAllKings, type UndoMove,
  computeChases, type BoardState,
} from '../engine/moves';
import { positionKey, REPETITION_LIMIT, judgeCycle, type MoveKind } from '../engine/repetition';
import { evaluateBoard, getPieceValueSimple, hiddenPieceValue } from './evaluate';
import { TranspositionTable, TTFlag } from './tt';
import { computeHash, updateHash, sideKey } from './zobrist';
import { seeCapture } from '../engine/see';

// ---- 常量 ----
const INF = 999999;
const MATE_SCORE = 100000;
const DRAW_SCORE = 0;
const RAZOR_MARGIN = 300;
const MAX_HISTORY = 1 << 16;
const MAX_PLY = 128;
const LMR_MIN_DEPTH = 3;
const LMR_MIN_MOVE_IDX = 4;
const FUTILITY_MAX_DEPTH = 4;  // 扩展至 depth 4
const EXTENDED_FUTILITY_MAX_DEPTH = 3;  // 扩展 futility（更深一层，更大裕量）
const BASE_FUTILITY_MARGIN = [0, 80, 160, 280, 450];  // 基础裕量表
const QUIESCENCE_CHECK_MAX = 4; // QS 被将递归深度限制
const NULL_MIN_DEPTH = 3;      // 空着裁剪最低深度（>=3 才启用，暗子局面安全）
const NULL_R = 2;               // 空着裁剪缩减量
const IID_MIN_DEPTH = 4;       // Internal Iterative Deepening 最低深度
const PROBCUT_MIN_DEPTH = 5;    // ProbCut 最低深度
const PROBCUT_REDUCTION = 3;    // ProbCut 缩减深度
const PROBCUT_MARGIN = 120;     // ProbCut 边界裕量

// ---- 搜索上下文 ----
export interface SearchContext {
  tt: TranspositionTable;
  nodesSearched: number;
  searchStartTime: number;
  timeLimit: number;
  killerMoves: [number, number][];
  historyTable: Map<number, number>;
}

export function createSearchContext(tt: TranspositionTable, timeLimit: number): SearchContext {
  return {
    tt,
    nodesSearched: 0,
    searchStartTime: Date.now(),
    timeLimit,
    killerMoves: Array.from({ length: MAX_PLY }, () => [0, 0]),
    historyTable: new Map(),
  };
}

function encode(from: Position, to: Position): number {
  return from.row * 1000 + from.col * 100 + to.row * 10 + to.col;
}

function makeTempState(grid: (Piece | null)[][], turn: Color): BoardState {
  return {
    grid, currentTurn: turn,
    status: 0 as unknown as BoardState['status'],
    moveHistory: [], redCaptured: [], blackCaptured: [],
    movesWithoutCapture: 0,
  };
}

/** 快速吃子评分（用于未被 SEE 评估的吃子，比 MVV-LVA 更快） */
function quickCaptureScore(grid: (Piece | null)[][], mv: { from: Position; to: Position }): number {
  const victim = grid[mv.to.row][mv.to.col];
  if (!victim) return 0;
  const attacker = grid[mv.from.row][mv.from.col];
  const victimVal = victim.hidden ? 320 : getPieceValueSimple(victim.type);
  const attackerVal = attacker?.hidden ? 320 : getPieceValueSimple(attacker?.type ?? PieceType.Pawn);
  return victimVal * 100 - attackerVal;
}

export interface PathEntry {
  key: string;
  side: Color;
  kind: MoveKind;
  chases: number[];
}

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

export function repetitionScore(
  currentKey: string, path: PathEntry[], turn: Color, ply: number,
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

// ---- 静态搜索（Quiescence Search）—— Phase 1: generateCaptures + make/unmake ----
function quiescence(
  ctx: SearchContext,
  grid: (Piece | null)[][],
  turn: Color,
  alpha: number,
  beta: number,
  kingPos: Record<Color, Position | null>,
  checkDepth: number = 0,  // 被将递归深度（防栈溢出）
  hash: number = 0,        // 当前局面的 Zobrist 哈希
  cachedEval: number = 0,  // 预计算的评估值（0 表示未缓存）
): number {
  ctx.nodesSearched++;

  if (ctx.timeLimit > 0 && (ctx.nodesSearched & 127) === 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) {
    return 0;
  }

  const kp = kingPos[turn]!;
  const inCheck = isInCheckFast(grid, turn, kp);

  // 使用缓存的评估值（如果可用），否则重新计算
  const standPat = cachedEval !== 0
    ? cachedEval
    : (turn === Color.Red ? evaluateBoard(grid) : -evaluateBoard(grid));

  if (!inCheck && standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  // 被将时的深度限制：超过阈值直接返回静态评估
  if (inCheck && checkDepth >= QUIESCENCE_CHECK_MAX) return standPat;

  const captures = generateCaptures(grid, turn, kp);

  if (captures.length === 0) {
    if (inCheck && checkDepth < QUIESCENCE_CHECK_MAX) {
      // 被将且无吃子 → 调用 search 降层解将
      // 递增 checkDepth 防止连续将军导致栈溢出
      return search(ctx, grid, turn, 1, alpha, beta, 0, false, [], true, kingPos, checkDepth + 1, hash, false);
    }
    return standPat;
  }

  // SEE 排序：只对前 N 个吃子计算 SEE（最可能触发 beta 截断），其余用快速启发式
  const MAX_SEE = 3;
  const scoredCaptures = captures.map((mv, i) => ({
    mv,
    score: i < MAX_SEE ? seeCapture(grid, mv.from, mv.to) : quickCaptureScore(grid, mv),
  }));
  scoredCaptures.sort((a, b) => b.score - a.score);
  const sortedCaptures = scoredCaptures.map(sc => sc.mv);

  // Delta 剪枝
  if (!inCheck && standPat + getPieceValueSimple(PieceType.Chariot) + 200 < alpha) return alpha;

  const nextCheckDepth = inCheck ? checkDepth + 1 : 0;

  for (const mv of sortedCaptures) {
    const undo = makeMove(grid, mv.from, mv.to);
    const newTurn = opponentColor(turn);
    const newHash = updateHash(hash, undo.movedPiece, mv.from, mv.to, undo.capturedPiece, newTurn);
    const oldKp = kingPos[turn];
    if (grid[undo.toRow][undo.toCol]?.type === PieceType.King) {
      kingPos[turn] = { row: undo.toRow, col: undo.toCol };
    }

    const score = -quiescence(ctx, grid, newTurn, -beta, -alpha, kingPos, nextCheckDepth, newHash);

    kingPos[turn] = oldKp;
    unmakeMove(grid, undo);

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
  // 动态暗子期望值（一次计算，复用整个排序）
  const hVal = hiddenPieceValue(grid);

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
        const victimVal = victim.hidden ? hVal : getPieceValueSimple(victim.type);
        const attackerVal = attacker?.hidden ? hVal : getPieceValueSimple(attacker?.type ?? PieceType.Pawn);
        score = 900_000 + victimVal * 100 - attackerVal;
      } else {
        const ki = Math.min(ply, MAX_PLY - 1);
        if (ctx.killerMoves[ki][0] === enc) score = 800_000;
        else if (ctx.killerMoves[ki][1] === enc) score = 799_999;
        else score = ctx.historyTable.get(enc) ?? 0;
        if (attacker?.hidden) score += 500;
      }
    }
    result.push({ from: m.from, to: m.to, score, encoded: enc });
  }
  result.sort((a, b) => b.score - a.score);
  return result;
}

function updateKiller(ctx: SearchContext, encoded: number, ply: number) {
  const ki = Math.min(ply, MAX_PLY - 1);
  if (ctx.killerMoves[ki][0] !== encoded) {
    ctx.killerMoves[ki][1] = ctx.killerMoves[ki][0];
    ctx.killerMoves[ki][0] = encoded;
  }
}

function updateHistory(ctx: SearchContext, encoded: number, depth: number) {
  const bonus = Math.min(depth * depth, 400);
  const old = ctx.historyTable.get(encoded) ?? 0;
  const newVal = old + bonus - (old * bonus) / 1024;
  ctx.historyTable.set(encoded, newVal);
  if (ctx.historyTable.size > MAX_HISTORY) {
    const half = ctx.historyTable.size >> 1;
    let count = 0;
    for (const key of ctx.historyTable.keys()) {
      ctx.historyTable.delete(key);
      if (++count >= half) break;
    }
  }
}

// ---- 主搜索（Negamax + PVS + Phase 3 增强） ----
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
  kingPos: Record<Color, Position | null> = { [Color.Red]: null, [Color.Black]: null },
  checkDepth: number = 0,
  hash: number = 0,
  allowNull: boolean = true,
): number {
  ctx.nodesSearched++;

  if (ctx.timeLimit > 0 && (ctx.nodesSearched & 63) === 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) {
    return 0;
  }

  // 重复局面裁决
  if (repetitionAware) {
    const key = positionKey(grid, turn);
    const verdictScore = repetitionScore(key, path, turn, ply);
    if (verdictScore !== null) return verdictScore;
  }

  // 安全阀：超过最大层数直接返回静态评估（防栈溢出）
  if (ply >= MAX_PLY) {
    return turn === Color.Red ? evaluateBoard(grid) : -evaluateBoard(grid);
  }

  // 置换表探测（使用传入的增量哈希，避免每节点 O(90) 全扫描）
  const ttEntry = ctx.tt.probe(hash);
  let ttMove = 0;
  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === TTFlag.EXACT) return ttEntry.score;
    if (ttEntry.flag === TTFlag.ALPHA && ttEntry.score <= alpha) return ttEntry.score;
    if (ttEntry.flag === TTFlag.BETA && ttEntry.score >= beta) return ttEntry.score;
  }
  if (ttEntry) ttMove = ttEntry.bestMove;

  // Internal Iterative Deepening: PV 节点 + 深度足够 + TT 无走法 → 浅搜获取好着
  if (isPV && depth >= IID_MIN_DEPTH && ttMove === 0) {
    search(ctx, grid, turn, depth - 2, alpha, beta, ply, true, path, repetitionAware, kingPos, checkDepth, hash, false);
    const iidEntry = ctx.tt.probe(hash);
    if (iidEntry) ttMove = iidEntry.bestMove;
  }

  // 叶节点 → 静态搜索
  if (depth <= 0) {
    return quiescence(ctx, grid, turn, alpha, beta, kingPos, checkDepth, hash);
  }

  const kp = kingPos[turn];
  const inCheck = kp ? isInCheckFast(grid, turn, kp) : false;

  // Phase 3: 将军延伸
  let effectiveDepth = depth;
  if (inCheck) {
    effectiveDepth = depth + 1;
  }

  // 计算一次局面评估，供空着/Futility/剃刀三个剪枝条件复用
  const needsEval = (allowNull && !isPV && !inCheck && effectiveDepth >= NULL_MIN_DEPTH) ||
                    (!isPV && !inCheck && effectiveDepth <= FUTILITY_MAX_DEPTH) ||
                    (!isPV && effectiveDepth <= 2 && !inCheck);
  const evalScore = needsEval
    ? (turn === Color.Red ? evaluateBoard(grid) : -evaluateBoard(grid))
    : 0;

  // 空着裁剪（Null Move Pruning）
  if (allowNull && !isPV && !inCheck && effectiveDepth >= NULL_MIN_DEPTH) {
    if (evalScore >= beta) {
      const nullTurn = opponentColor(turn);
      // 只换手不走子：XOR sideKey 切换轮次标记，路径不变，不记录重复
      const nullHash = (hash ^ sideKey) >>> 0;
      const nullScore = -search(ctx, grid, nullTurn, effectiveDepth - 1 - NULL_R, -beta, -beta + 1,
        ply + 1, false, path, false, kingPos, 0, nullHash, false);
      if (nullScore >= beta) return beta;
    }
  }

  // ProbCut 剪枝：深节点浅层搜索测试 beta+margin
  if (!isPV && !inCheck && effectiveDepth >= PROBCUT_MIN_DEPTH && beta < MATE_SCORE - 200) {
    const probcutBeta = beta + PROBCUT_MARGIN;
    // 浅层搜索（同一局面、缩减深度、提升 beta）
    const probcutScore = -search(ctx, grid, turn, effectiveDepth - PROBCUT_REDUCTION,
      -probcutBeta, -probcutBeta + 1, ply, false, path, false, kingPos, 0, hash, false);
    if (probcutScore >= probcutBeta) return beta;
  }

  // 生成合法着法
  const state = makeTempState(grid, turn);
  const allMoves = getAllLegalMoves(state);

  if (allMoves.length === 0) {
    if (inCheck) return -(MATE_SCORE - ply);
    return DRAW_SCORE;
  }

    // 动态 Futility 剪枝：裕量 = 基础值 + 暗子数量×30 + 子力差×0.3
  if (!isPV && !inCheck && effectiveDepth <= FUTILITY_MAX_DEPTH) {
    const baseMargin = BASE_FUTILITY_MARGIN[effectiveDepth];
    // 快速估算暗子数量影响（不确定性 → 增大裕量，减少误剪）
    let hiddenCount = 0;
    for (let r = 0; r < grid.length && r < 4; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c]?.hidden) hiddenCount++;
      }
    }
    const dynamicMargin = baseMargin + hiddenCount * 25;
    if (evalScore + dynamicMargin <= alpha) {
      return evalScore + dynamicMargin;
    }
    // 扩展 Futility：更深一层用更大裕量
    if (effectiveDepth <= EXTENDED_FUTILITY_MAX_DEPTH && evalScore - dynamicMargin * 1.5 >= beta) {
      return evalScore - dynamicMargin * 1.5;
    }
  }

  // 剃刀剪枝
  if (!isPV && effectiveDepth <= 2 && !inCheck) {
    if (evalScore - RAZOR_MARGIN * effectiveDepth >= beta) {
      return evalScore - RAZOR_MARGIN * effectiveDepth;
    }
  }

  // 着法排序
  const scored = orderMoves(ctx, grid, turn, allMoves, ttMove, ply);

  // PVS 主搜索循环
  let bestScore = -INF;
  let bestMove = 0;
  let flag = TTFlag.ALPHA;
  let first = true;

  for (let i = 0; i < scored.length; i++) {
    const move = scored[i];
    const undo = makeMove(grid, move.from, move.to);
    const newTurn = opponentColor(turn);
    const newHash = updateHash(hash, undo.movedPiece, move.from, move.to, undo.capturedPiece, newTurn);
    const newKey = positionKey(grid, newTurn);

    // 更新将位缓存
    const oldKpTurn = kingPos[turn];
    const oldKpOpp = kingPos[newTurn];
    if (grid[undo.toRow][undo.toCol]?.type === PieceType.King) {
      kingPos[turn] = { row: undo.toRow, col: undo.toCol };
    }

    // 记录搜索路径
    const isChk = isInCheckFast(grid, newTurn, kingPos[newTurn]!);
    let alreadyInPath = false;
    for (const e of path) if (e.key === newKey) { alreadyInPath = true; break; }
    const { kind, chases } = moveKindAfter(grid, turn, newTurn, isChk, alreadyInPath);
    path.push({ key: newKey, side: turn, kind, chases });

    let score: number;

    // Phase 3: 动态 LMR（基于着法序号 + 历史分 + 杀手着法）
    const isKiller = ctx.killerMoves[Math.min(ply, MAX_PLY - 1)][0] === move.encoded ||
                     ctx.killerMoves[Math.min(ply, MAX_PLY - 1)][1] === move.encoded;
    const histScore = ctx.historyTable.get(move.encoded) ?? 0;

    const canLMR = effectiveDepth >= LMR_MIN_DEPTH &&
                    i >= LMR_MIN_MOVE_IDX &&
                    !isChk &&
                    !isKiller &&
                    !grid[undo.toRow][undo.toCol]?.hidden &&
                    !undo.capturedPiece;

    if (canLMR) {
      // 动态缩减：基础 1，序号大 +1，历史分低 +1，暗子攻击方 +0.5
      let reduction = 1;
      if (i >= 8) reduction++;
      if (histScore < 0) reduction++;           // 历史分低 → 多减
      if (grid[move.from.row][move.from.col]?.hidden) reduction++; // 暗子 → 多减
      reduction = Math.min(reduction, effectiveDepth - 2); // 不能减太多
      score = -search(ctx, grid, newTurn, effectiveDepth - 1 - reduction, -alpha - 1, -alpha, ply + 1, false, path, repetitionAware, kingPos, checkDepth, newHash);
      if (score > alpha) {
        score = -search(ctx, grid, newTurn, effectiveDepth - 1, -alpha - 1, -alpha, ply + 1, false, path, repetitionAware, kingPos, checkDepth, newHash);
        if (score > alpha && score < beta) {
          score = -search(ctx, grid, newTurn, effectiveDepth - 1, -beta, -alpha, ply + 1, true, path, repetitionAware, kingPos, checkDepth, newHash);
        }
      }
    } else if (first) {
      score = -search(ctx, grid, newTurn, effectiveDepth - 1, -beta, -alpha, ply + 1, isPV, path, repetitionAware, kingPos, checkDepth, newHash);
      first = false;
    } else {
      score = -search(ctx, grid, newTurn, effectiveDepth - 1, -alpha - 1, -alpha, ply + 1, false, path, repetitionAware, kingPos, checkDepth, newHash);
      if (score > alpha && score < beta) {
        score = -search(ctx, grid, newTurn, effectiveDepth - 1, -beta, -alpha, ply + 1, true, path, repetitionAware, kingPos, checkDepth, newHash);
      }
    }

    path.pop();
    kingPos[turn] = oldKpTurn;
    kingPos[newTurn] = oldKpOpp;
    unmakeMove(grid, undo);

    if (score > bestScore) {
      bestScore = score;
      bestMove = move.encoded;

      if (score > alpha) {
        alpha = score;
        flag = TTFlag.EXACT;

        if (score >= beta) {
          flag = TTFlag.BETA;
          if (!grid[move.to.row][move.to.col]) {
            updateKiller(ctx, move.encoded, ply);
          }
          updateHistory(ctx, move.encoded, effectiveDepth);
          break;
        }
      }
    }

    if (ctx.timeLimit > 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) break;
  }

  if (bestScore > -INF && (ctx.timeLimit === 0 || Date.now() - ctx.searchStartTime <= ctx.timeLimit)) {
    ctx.tt.store(hash, effectiveDepth, bestScore, flag, bestMove);
  }

  return bestScore;
}

// ========================================================================
// 公开接口
// ========================================================================
export interface SearchConfig {
  maxDepth: number;
  timeLimit: number;
}

export function findBestMove(
  state: BoardState,
  config: SearchConfig,
  transpositionTable: TranspositionTable,
): { from: Position; to: Position } | null {
  const ctx = createSearchContext(transpositionTable, config.timeLimit);
  const kingPos = findAllKings(state.grid);
  const initialHash = computeHash(state.grid, state.currentTurn);

  const allMoves = getAllLegalMoves(state);
  if (allMoves.length === 0) return null;
  if (allMoves.length === 1) return allMoves[0];

  let bestMove: { from: Position; to: Position } | null = null;
  let bestScore = -INF;
  let prevBestScore = -INF;
  let windowSize = 80;  // 自适应窗口起始值（比固定 150 更激进）

  for (let depth = 1; depth <= config.maxDepth; depth++) {
    let alpha = -INF;
    let beta = INF;

    if (depth >= 2) {
      alpha = bestScore - windowSize;
      beta = bestScore + windowSize;
    }

    let currentBest: { from: Position; to: Position; encoded: number } | null = null;
    let currentBestScore = -INF;
    let windowFail = false;

    const scored = orderMoves(ctx, state.grid, state.currentTurn, allMoves, 0, 0);

    for (const move of scored) {
      const undo = makeMove(state.grid, move.from, move.to);
      const newTurn = opponentColor(state.currentTurn);
      const newHash = updateHash(initialHash, undo.movedPiece, move.from, move.to, undo.capturedPiece, newTurn);
      const oldKp = kingPos[state.currentTurn];
      if (state.grid[undo.toRow][undo.toCol]?.type === PieceType.King) {
        kingPos[state.currentTurn] = { row: undo.toRow, col: undo.toCol };
      }

      const path: PathEntry[] = [];
      let score = -search(ctx, state.grid, newTurn, depth - 1, -beta, -alpha, 0, true, path, true, kingPos, 0, newHash);

      // 窗口失效 → 用全窗口重搜
      if (score <= alpha || score >= beta) {
        windowFail = true;
        kingPos[state.currentTurn] = oldKp;
        unmakeMove(state.grid, undo);

        const undo2 = makeMove(state.grid, move.from, move.to);
        const newHash2 = updateHash(initialHash, undo2.movedPiece, move.from, move.to, undo2.capturedPiece, newTurn);
        if (state.grid[undo2.toRow][undo2.toCol]?.type === PieceType.King) {
          kingPos[state.currentTurn] = { row: undo2.toRow, col: undo2.toCol };
        }
        const path2: PathEntry[] = [];
        score = -search(ctx, state.grid, newTurn, depth - 1, -INF, INF, 0, true, path2, true, kingPos, 0, newHash2);
        kingPos[state.currentTurn] = oldKp;
        unmakeMove(state.grid, undo2);
      } else {
        kingPos[state.currentTurn] = oldKp;
        unmakeMove(state.grid, undo);
      }

      if (score > currentBestScore) {
        currentBestScore = score;
        currentBest = { from: move.from, to: move.to, encoded: move.encoded };
      }

      if (ctx.timeLimit > 0 && Date.now() - ctx.searchStartTime > ctx.timeLimit) break;
    }

    if (currentBest) {
      prevBestScore = bestScore;
      bestMove = currentBest;
      bestScore = currentBestScore;
    }

    // 自适应窗口调整
    if (depth >= 2) {
      if (windowFail) {
        // 窗口失效 → 扩大窗口（下次更容易命中）
        windowSize = Math.min(windowSize * 2, 500);
      } else {
        // 窗口命中 → 根据稳定性微调
        const scoreDelta = Math.abs(bestScore - prevBestScore);
        if (scoreDelta > 80) {
          // 分数波动大 → 稍扩大窗口
          windowSize = Math.min(windowSize + 20, 300);
        } else {
          // 分数稳定 → 缩小窗口（提高精度）
          windowSize = Math.max(windowSize - 10, 50);
        }
      }
    }

    if (ctx.timeLimit > 0 && Date.now() - ctx.searchStartTime > config.timeLimit) break;
    if (Math.abs(bestScore) > MATE_SCORE - 200) break;
  }

  if (ctx.timeLimit > 0) {
    console.debug(`[AI] depth=${config.maxDepth} nodes=${ctx.nodesSearched} time=${Date.now() - ctx.searchStartTime}ms ttSize=${ctx.tt.size} ttHit=${Math.round(ctx.tt.hitRate() * 100)}%`);
  }

  return bestMove;
}

// ========================================================================
// 轻量级 AI（fallback）—— Phase 1: make/unmake
// ========================================================================

function simpleSearch(
  grid: (Piece | null)[][],
  turn: Color,
  depth: number,
  alpha: number,
  beta: number,
  kingPos: Record<Color, Position | null>,
): number {
  if (depth <= 0) {
    return turn === Color.Red ? evaluateBoard(grid) : -evaluateBoard(grid);
  }

  const state = makeTempState(grid, turn);
  const allMoves = getAllLegalMoves(state);

  if (allMoves.length === 0) {
    const kp = kingPos[turn];
    return kp && isInCheckFast(grid, turn, kp) ? -(MATE_SCORE - depth) : DRAW_SCORE;
  }

  let bestScore = -INF;
  for (const mv of allMoves) {
    const undo = makeMove(grid, mv.from, mv.to);
    const oldKp = kingPos[turn];
    if (grid[undo.toRow][undo.toCol]?.type === PieceType.King) {
      kingPos[turn] = { row: undo.toRow, col: undo.toCol };
    }
    const kp = kingPos[turn]!;
    if (isInCheckFast(grid, turn, kp)) {
      kingPos[turn] = oldKp;
      unmakeMove(grid, undo);
      continue;
    }
    const score = -simpleSearch(grid, opponentColor(turn), depth - 1, -beta, alpha, kingPos);
    kingPos[turn] = oldKp;
    unmakeMove(grid, undo);

    if (score > bestScore) bestScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return bestScore;
}

export function findSimpleMove(
  state: BoardState,
  maxDepth: number = 3,
): { from: Position; to: Position } | null {
  const kingPos = findAllKings(state.grid);
  const allMoves = getAllLegalMoves(state);
  if (allMoves.length === 0) return null;
  if (allMoves.length === 1) return allMoves[0];

  let bestMove: { from: Position; to: Position } | null = null;
  let bestScore = -INF;

  for (const mv of allMoves) {
    const undo = makeMove(state.grid, mv.from, mv.to);
    const oldKp = kingPos[state.currentTurn];
    if (state.grid[undo.toRow][undo.toCol]?.type === PieceType.King) {
      kingPos[state.currentTurn] = { row: undo.toRow, col: undo.toCol };
    }
    if (isInCheckFast(state.grid, state.currentTurn, kingPos[state.currentTurn]!)) {
      kingPos[state.currentTurn] = oldKp;
      unmakeMove(state.grid, undo);
      continue;
    }
    const score = -simpleSearch(state.grid, opponentColor(state.currentTurn), maxDepth - 1, -INF, INF, kingPos);
    kingPos[state.currentTurn] = oldKp;
    unmakeMove(state.grid, undo);

    if (score > bestScore) {
      bestScore = score;
      bestMove = mv;
    }
  }
  return bestMove;
}
