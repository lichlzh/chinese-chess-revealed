// ============================================================
// 揭棋 - AI 对局 Smoke Test
// 用途：验证 AI 在完整对局中不崩溃、不出非法着法、正常终局
// 运行：npm test -- src/selftest/ab-battle.test.ts
// ============================================================

import { describe, test, expect } from 'vitest';
import { initBoard, resetIdCounter, opponentColor } from '../engine/board';
import { getAllLegalMoves, executeMove, isInCheck, type BoardState } from '../engine/moves';
import { findBestMove, type SearchConfig } from '../ai/search';
import { TranspositionTable } from '../ai/tt';
import { Color, GameStatus, samePos, type Piece } from '../engine/types';

// ---- 可重复随机数生成器 ----
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initBoardSeeded(seed: number): BoardState {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  resetIdCounter();
  const state = initBoard();
  Math.random = origRandom;
  return state;
}

// ---- 对局配置 ----
const CONFIG_A: SearchConfig = { maxDepth: 3, timeLimit: 500 };
const CONFIG_B: SearchConfig = { maxDepth: 3, timeLimit: 1500 };
const NUM_GAMES = 2;
const MAX_PLIES = 150;

interface DuelResult {
  index: number;
  firstPlayer: Color;
  winner: 'A' | 'B' | 'draw';
  endReason?: string;
  plies: number;
  error?: string;
}

function aiMove(
  state: BoardState,
  config: SearchConfig,
  tt: TranspositionTable,
): { move: { from: { row: number; col: number }; to: { row: number; col: number } } | null; time: number } {
  const t0 = Date.now();
  const mv = findBestMove(state, config, tt);
  const time = Date.now() - t0;
  return { move: mv, time };
}

function playDuel(
  seed: number,
  firstColor: Color,
  configA: SearchConfig,
  configB: SearchConfig,
): DuelResult {
  let state = initBoardSeeded(seed);
  const ttA = new TranspositionTable();
  const ttB = new TranspositionTable();
  let plies = 0;
  let error: string | undefined;

  while (state.status === GameStatus.Playing && plies < MAX_PLIES) {
    const legal = getAllLegalMoves(state);
    if (legal.length === 0) {
      error = 'no legal moves but status still Playing';
      break;
    }

    const isATurn = state.currentTurn === firstColor;
    const config = isATurn ? configA : configB;
    const tt = isATurn ? ttA : ttB;

    const { move } = aiMove(state, config, tt);
    if (!move) {
      error = `AI (${isATurn ? 'A' : 'B'}) returned null`;
      break;
    }

    const legalHit = legal.some(l => samePos(l.from, move.from) && samePos(l.to, move.to));
    if (!legalHit) {
      error = `AI (${isATurn ? 'A' : 'B'}) chose illegal move`;
      break;
    }

    const res = executeMove(state, move.from, move.to);
    if (!res) {
      error = 'executeMove returned null';
      break;
    }
    state = res.newState;
    plies++;
  }

  let winner: 'A' | 'B' | 'draw';
  if (state.status === GameStatus.RedWin) {
    winner = firstColor === Color.Red ? 'A' : 'B';
  } else if (state.status === GameStatus.BlackWin) {
    winner = firstColor === Color.Black ? 'A' : 'B';
  } else {
    winner = 'draw';
  }

  return { index: seed, firstPlayer: firstColor, winner, endReason: state.endReason, plies, error };
}

describe('AI duel smoke test', () => {
  test(
    `${NUM_GAMES * 2} 局完整对局：无崩溃、无非法着法、正常终局`,
    () => {
      const origDebug = console.debug;
      console.debug = () => {};

      const results: DuelResult[] = [];
      const t0 = Date.now();

      for (let i = 0; i < NUM_GAMES; i++) {
        results.push(playDuel(1000 + i, Color.Red, CONFIG_A, CONFIG_B));
        results.push(playDuel(1000 + i, Color.Red, CONFIG_B, CONFIG_A));
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`\r  进度 ${(i + 1) * 2}/${NUM_GAMES * 2} 局，已用 ${elapsed}s`);
      }
      process.stdout.write('\n');
      console.debug = origDebug;

      const errors = results.filter(r => r.error);
      const unfinished = results.filter(r => !r.endReason && r.plies >= MAX_PLIES);
      const bWins = results.filter(r => r.winner === 'B').length;
      const aWins = results.filter(r => r.winner === 'A').length;
      const draws = results.filter(r => r.winner === 'draw').length;

      const summary =
`
========================================
AI 对局 Smoke Test 报告
========================================
总对局数：${results.length}（各执先 ${NUM_GAMES} 局）
总耗时：${((Date.now() - t0) / 1000).toFixed(1)}s
平均着数：${(results.reduce((s, r) => s + r.plies, 0) / results.length).toFixed(1)}

【胜负分布】
B 胜：${bWins} (${((bWins / results.length) * 100).toFixed(1)}%)
A 胜：${aWins} (${((aWins / results.length) * 100).toFixed(1)}%)
和棋：${draws} (${((draws / results.length) * 100).toFixed(1)}%)

【异常】
报错局数：${errors.length}
触顶未终局：${unfinished.length}
${errors.map(r => `  [seed ${r.index}] ${r.error}`).join('\n') || '  无'}
`;
      console.log(summary);

      // 断言：无崩溃、无非法着法
      expect(errors.length, '存在非法着法或不变量违背').toBe(0);
      // 断言：所有对局正常终局（非触顶）
      expect(unfinished.length, '存在触顶未终局的对局').toBe(0);
    },
    5 * 60 * 1000,
  );
});
