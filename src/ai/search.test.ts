import { describe, it, expect } from 'vitest';
import { Color, PieceType } from '../engine/types';
import { createPiece } from '../engine/board';
import { findBestMove, repetitionScore, type PathEntry } from './search';
import { TranspositionTable } from './tt';
import { getAllLegalMoves, type BoardState } from '../engine/moves';

function emptyGrid(): any {
  return Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null));
}

function makeState(grid: (null)[][][], turn: Color): BoardState {
  return {
    grid: grid as unknown as BoardState['grid'],
    currentTurn: turn,
    status: 0 as unknown as BoardState['status'],
    moveHistory: [],
    redCaptured: [],
    blackCaptured: [],
    movesWithoutCapture: 0,
  };
}

/** 构造一个「红长将」循环路径：红反复将军、黑闲躲，局面 P0 重复出现 */
function perpetualCheckPath(currentKey: string, repeat: number): PathEntry[] {
  const path: PathEntry[] = [];
  for (let i = 0; i < repeat; i++) {
    path.push({ key: 'P1', side: Color.Red, kind: 'check', chases: [] });
    path.push({ key: 'P0', side: Color.Black, kind: 'idle', chases: [] });
  }
  // 当前节点即 P0（红方走棋）
  return path;
}

describe('P0: 搜索重复裁决打分 repetitionScore', () => {
  it('红方长将（己方违规）→ 当前走棋方（红）判负，返回大负数', () => {
    const path = perpetualCheckPath('P0', 3); // P0 在 path 中出现 3 次
    const score = repetitionScore('P0', path, Color.Red, 5);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(0);
    expect(score!).toBeLessThan(-99000); // 接近将死级负分 (MATE_SCORE≈100000)
  });

  it('红方长将，但当前走棋方是黑（对方违规）→ 我方（黑）获利，返回大正数', () => {
    const path = perpetualCheckPath('P0', 3);
    const score = repetitionScore('P0', path, Color.Black, 5);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
  });

  it('双方均闲着（不变着）→ 和棋，返回 0', () => {
    const path: PathEntry[] = [];
    for (let i = 0; i < 3; i++) {
      path.push({ key: 'P1', side: Color.Red, kind: 'idle', chases: [] });
      path.push({ key: 'P0', side: Color.Black, kind: 'idle', chases: [] });
    }
    const score = repetitionScore('P0', path, Color.Red, 5);
    expect(score).toBe(0);
  });

  it('重复次数未达阈值 → 不触发，返回 null', () => {
    const score = repetitionScore('P0', perpetualCheckPath('P0', 1), Color.Red, 5);
    expect(score).toBeNull();
  });
});

describe('P0: findBestMove 基本可用（重复感知不崩）', () => {
  it('返回合法着法', () => {
    const grid = emptyGrid();
    grid[0][4] = createPiece(PieceType.King, Color.Black, false);
    grid[9][4] = createPiece(PieceType.King, Color.Red, false);
    grid[9][0] = createPiece(PieceType.Chariot, Color.Red, false);
    grid[2][3] = createPiece(PieceType.Chariot, Color.Black, false);
    const state = makeState(grid, Color.Red);
    const tt = new TranspositionTable();
    const mv = findBestMove(state, { maxDepth: 5, timeLimit: 400 }, tt);
    expect(mv).not.toBeNull();
    const legal = getAllLegalMoves(state).some(
      m => m.from.row === mv!.from.row && m.from.col === mv!.from.col &&
           m.to.row === mv!.to.row && m.to.col === mv!.to.col,
    );
    expect(legal).toBe(true);
  });
});
