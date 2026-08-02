// ============================================================
// 揭棋 - AI 搜索算法 (Minimax + Alpha-Beta 剪枝)
// ============================================================

import { Color, PieceType, type Position, type Piece } from '../engine/types';
import { cloneBoardState, getEffectiveType, opponentColor } from '../engine/board';
import { getAllLegalMoves, isInCheck, type BoardState } from '../engine/moves';
import { evaluateBoard } from './evaluate';

/** AI 配置 */
export interface AIConfig {
  maxDepth: number;
  timeLimit: number; // 毫秒，0 = 不限制
}

let searchStartTime = 0;
let timeLimit = 0;
let nodesSearched = 0;
const killerMoves: Map<number, { from: Position; to: Position }> = new Map();

/** AI 入口：找到最佳着法 */
export function findBestMove(state: BoardState, config: AIConfig): { from: Position; to: Position } | null {
  searchStartTime = Date.now();
  timeLimit = config.timeLimit;
  nodesSearched = 0;
  killerMoves.clear();

  const allMoves = getAllLegalMoves(state);
  if (allMoves.length === 0) return null;

  const aiColor = state.currentTurn;
  let bestMove: { from: Position; to: Position } | null = null;
  let bestScore = -Infinity;

  // 迭代加深
  for (let depth = 1; depth <= config.maxDepth; depth++) {
    let alpha = -Infinity;
    const beta = Infinity;
    let currentBest: { from: Position; to: Position } | null = null;

    // 对候选着法排序
    const sorted = orderMoves(state, allMoves);

    for (const move of sorted) {
      const newGrid = applySimple(state, move.from, move.to);
      const newState: BoardState = { ...state, grid: newGrid, currentTurn: opponentColor(aiColor) };

      const score = -minimax(newState, depth - 1, -beta, -alpha);

      if (score > bestScore) {
        bestScore = score;
        currentBest = move;
      }
      if (score > alpha) {
        alpha = score;
        killerMoves.set(depth, move);
      }

      if (timeLimit > 0 && Date.now() - searchStartTime > timeLimit) break;
    }

    if (currentBest) bestMove = currentBest;
    if (timeLimit > 0 && Date.now() - searchStartTime > timeLimit) break;
    if (bestScore > 9000 || bestScore < -9000) break;
  }

  return bestMove;
}

/** Minimax + Alpha-Beta */
function minimax(
  state: BoardState,
  depth: number,
  alpha: number,
  beta: number,
): number {
  nodesSearched++;

  if (timeLimit > 0 && nodesSearched % 100 === 0 && Date.now() - searchStartTime > timeLimit) {
    return 0;
  }

  if (depth === 0) {
    return evaluateBoard(state.grid);
  }

  const allMoves = getAllLegalMoves(state);

  // 无合法着法 = 被将死/困毙
  if (allMoves.length === 0) {
    if (isInCheck(state.grid, state.currentTurn)) {
      return -10000 + (10 - depth); // 被将死
    }
    return 0; // 困毙
  }

  let bestVal = -Infinity;
  const sorted = orderMoves(state, allMoves);

  for (const move of sorted) {
    const newGrid = applySimple(state, move.from, move.to);
    const newState: BoardState = { ...state, grid: newGrid, currentTurn: opponentColor(state.currentTurn) };

    const evalScore = -minimax(newState, depth - 1, -beta, -alpha);

    if (evalScore >= beta) {
      killerMoves.set(depth, move);
      return beta; // Beta 剪枝
    }
    if (evalScore > bestVal) {
      bestVal = evalScore;
    }
    alpha = Math.max(alpha, evalScore);
  }

  return bestVal;
}

/** 着法排序（MVV-LVA + 杀手启发） */
function orderMoves(
  state: BoardState,
  moves: { from: Position; to: Position }[],
): { from: Position; to: Position }[] {
  const grid = state.grid;

  const scored = moves.map(move => {
    let score = 0;
    const fromPiece = grid[move.from.row][move.from.col];
    const toPiece = grid[move.to.row][move.to.col];

    // MVV-LVA
    if (toPiece && fromPiece) {
      const victimVal = getPieceValueSimple(toPiece);
      const attackerVal = fromPiece.hidden
        ? getPieceValueSimple(getEffectiveType(fromPiece, move.from))
        : getPieceValueSimple(fromPiece.type);
      score = victimVal * 10 - attackerVal;
    }

    // 杀手启发
    const killer = killerMoves.get(state.moveHistory.length + 1);
    if (killer && killer.from.row === move.from.row && killer.from.col === move.from.col &&
        killer.to.row === move.to.row && killer.to.col === move.to.col) {
      score += 500;
    }

    // 暗子翻开加分
    if (fromPiece?.hidden) score += 30;

    return { move, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.move);
}

function getPieceValueSimple(t: Piece | PieceType): number {
  const type = typeof t === 'object' && 'type' in t ? t.type : t;
  const values: Record<PieceType, number> = {
    [PieceType.King]: 10000,
    [PieceType.Chariot]: 900,
    [PieceType.Cannon]: 450,
    [PieceType.Horse]: 400,
    [PieceType.Elephant]: 200,
    [PieceType.Advisor]: 200,
    [PieceType.Pawn]: 100,
  };
  return values[type] ?? 0;
}

/** 应用着法到 grid（不修改状态，用于搜索） */
function applySimple(
  state: BoardState,
  from: Position,
  to: Position,
): (Piece | null)[][] {
  const grid = cloneBoardState(state).grid;
  const piece = { ...grid[from.row][from.col]! };
  if (piece.hidden) piece.hidden = false;
  grid[from.row][from.col] = null;
  grid[to.row][to.col] = piece;
  return grid;
}
