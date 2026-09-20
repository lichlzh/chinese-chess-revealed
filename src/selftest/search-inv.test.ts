// 搜索不变量测试：验证 findBestMove 不污染输入局面
import { describe, test, expect } from 'vitest';
import { initBoard, cloneGrid, resetIdCounter } from '../engine/board';
import { getAllLegalMoves } from '../engine/moves';
import { findBestMove, findSimpleMove, type SearchConfig } from '../ai/search';
import { TranspositionTable } from '../ai/tt';

// 固定种子的随机数生成器
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initBoardSeeded(seed: number) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  resetIdCounter();
  const state = initBoard();
  Math.random = origRandom;
  return state;
}

describe('search invariants', () => {
  test('findBestMove 不修改输入 grid', () => {
    const state = initBoard();
    const gridBefore = cloneGrid(state.grid);

    const tt = new TranspositionTable();
    const config: SearchConfig = { maxDepth: 3, timeLimit: 2000 };
    const move = findBestMove(state, config, tt);

    expect(move).not.toBeNull();

    // 验证 grid 未被修改
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const before = gridBefore[r][c];
        const after = state.grid[r][c];
        if (!before && !after) continue;
        if (!before || !after) {
          expect(after).toBe(before);
          continue;
        }
        expect(after!.id).toBe(before!.id);
        expect(after!.type).toBe(before!.type);
        expect(after!.color).toBe(before!.color);
        expect(after!.hidden).toBe(before!.hidden);
      }
    }
  });

  test('findBestMove 返回合法着法', () => {
    const state = initBoard();
    const legal = getAllLegalMoves(state);

    const tt = new TranspositionTable();
    const config: SearchConfig = { maxDepth: 3, timeLimit: 2000 };
    const move = findBestMove(state, config, tt);

    expect(move).not.toBeNull();
    const isLegal = legal.some(l =>
      l.from.row === move!.from.row && l.from.col === move!.from.col &&
      l.to.row === move!.to.row && l.to.col === move!.to.col
    );
    expect(isLegal).toBe(true);
  });

  test('findSimpleMove 不修改输入 grid', () => {
    const state = initBoard();
    const gridBefore = cloneGrid(state.grid);

    const move = findSimpleMove(state, 2);

    expect(move).not.toBeNull();

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const before = gridBefore[r][c];
        const after = state.grid[r][c];
        if (!before && !after) continue;
        if (!before || !after) {
          expect(after).toBe(before);
          continue;
        }
        expect(after!.id).toBe(before!.id);
      }
    }
  });

  test('同一局面连续两次搜索返回一致结果（确定性）', () => {
    const state = initBoardSeeded(42);

    // timeLimit=1000 → 有时间限制但深度浅，应在时限内完成
    const config: SearchConfig = { maxDepth: 2, timeLimit: 1000 };
    const tt1 = new TranspositionTable();
    const tt2 = new TranspositionTable();

    const move1 = findBestMove(state, config, tt1);

    // 用同一种子重建局面再搜一次
    const state2 = initBoardSeeded(42);
    const move2 = findBestMove(state2, config, tt2);

    expect(move1).not.toBeNull();
    expect(move2).not.toBeNull();
    expect(move1).toEqual(move2);
  });
});
