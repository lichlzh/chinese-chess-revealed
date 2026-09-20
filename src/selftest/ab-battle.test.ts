// ============================================================
// 揭棋 - A/B 对战评估 Harness
// 用途：对比两个 AI 配置的棋力，验证改动是否真正提升强度
// 运行：npm test -- src/selftest/ab-battle.test.ts
// ============================================================

import { describe, test, expect } from 'vitest';
import { initBoard, resetIdCounter, opponentColor } from '../engine/board';
import { getAllLegalMoves, executeMove, isInCheck, type BoardState } from '../engine/moves';
import { findBestMove, type SearchConfig } from '../ai/search';
import { TranspositionTable } from '../ai/tt';
import { Color, GameStatus, samePos, type Piece } from '../engine/types';

// ---- 可重复随机数生成器（保证 A/B 面对同一批开局）----
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 用固定种子初始化棋盘 ----
function initBoardSeeded(seed: number): BoardState {
  // 劫持 Math.random 以控制洗牌
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  resetIdCounter();
  const state = initBoard();
  Math.random = origRandom;
  return state;
}

// ---- 对局配置 ----
const CONFIG_A: SearchConfig = { maxDepth: 3, timeLimit: 1000 };  // 基线（浅层快搜）
const CONFIG_B: SearchConfig = { maxDepth: 4, timeLimit: 2000 };  // 改进版（更深搜索）
const NUM_GAMES = 4;         // 每侧各执先 NUM_GAMES 局（共 2*NUM_GAMES 局）
const MAX_PLIES = 200;

// ---- 对局结果 ----
interface DuelResult {
  index: number;         // 对局编号
  firstPlayer: Color;    // 先手方
  winner: 'A' | 'B' | 'draw';
  endReason?: string;
  plies: number;
  error?: string;
}

/** 用指定配置让 AI 走一步，返回着法 + 耗时 */
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

/** 跑一局：A 执 firstColor，B 执另一方 */
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
    // 不变量
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

  // 判定胜者
  let winner: 'A' | 'B' | 'draw';
  if (state.status === GameStatus.RedWin) {
    winner = firstColor === Color.Red ? 'A' : 'B';
  } else if (state.status === GameStatus.BlackWin) {
    winner = firstColor === Color.Black ? 'A' : 'B';
  } else {
    winner = 'draw';
  }

  return {
    index: seed,
    firstPlayer: firstColor,
    winner,
    endReason: state.endReason,
    plies,
    error,
  };
}

describe('A/B battle: enhanced AI vs baseline', () => {
  test(
    `B vs A: ${NUM_GAMES * 2} 局，B 应显著优于 A`,
    () => {
      const origDebug = console.debug;
      console.debug = () => {};

      const results: DuelResult[] = [];
      const t0 = Date.now();

      for (let i = 0; i < NUM_GAMES; i++) {
        // A 执红先
        results.push(playDuel(1000 + i, Color.Red, CONFIG_A, CONFIG_B));
        // B 执红先（交换先后手消除偏差）
        results.push(playDuel(1000 + i, Color.Red, CONFIG_B, CONFIG_A));

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`\r  进度 ${(i + 1) * 2}/${NUM_GAMES * 2} 局，已用 ${elapsed}s`);
      }
      process.stdout.write('\n');

      console.debug = origDebug;

      // ---- 统计 ----
      const bWins = results.filter(r => r.winner === 'B').length;
      const aWins = results.filter(r => r.winner === 'A').length;
      const draws = results.filter(r => r.winner === 'draw').length;
      const errors = results.filter(r => r.error);
      const unfinished = results.filter(r => r.error?.includes('no legal') || !r.endReason && r.plies >= MAX_PLIES);

      const bWinRate = ((bWins / results.length) * 100).toFixed(1);
      const aWinRate = ((aWins / results.length) * 100).toFixed(1);
      const drawRate = ((draws / results.length) * 100).toFixed(1);

      const avgPlies = (results.reduce((s, r) => s + r.plies, 0) / results.length).toFixed(1);
      const totalTime = ((Date.now() - t0) / 1000).toFixed(1);

      // B 执红时的统计
      const bAsRed = results.filter(r => r.firstPlayer === Color.Red && r.winner === 'B' && CONFIG_B === CONFIG_B);
      // 实际上：playDuel(seed, Red, A, B) 中 B 执黑；playDuel(seed, Red, B, A) 中 B 执红
      const bRedGames = results.filter((_, idx) => idx === 1 || (idx > 1 && idx % 2 === 1));
      const bRedWins = bRedGames.filter(r => r.winner === 'B').length;

      const summary =
`
========================================
A/B 对战评估报告
========================================
总对局数：${results.length}（各执先 ${NUM_GAMES} 局）
总耗时：${totalTime}s

【胜负分布】
B 胜：${bWins} (${bWinRate}%)
A 胜：${aWins} (${aWinRate}%)
和棋：${draws} (${drawRate}%)

【对局长度】
平均着数：${avgPlies}

【异常】
报错局数：${errors.length}
触顶未终局：${unfinished.length}
${errors.map(r => `  [seed ${r.index}] ${r.error}`).join('\n') || '  无'}
`;

      console.log(summary);

      // ---- 断言 ----
      // 1. 无非法着法
      expect(errors.length, '存在非法着法或不变量违背').toBe(0);
      // 2. B 的胜率应 > 50%（显著优于 A）
      expect(bWins, `B 对 A 胜率 ${bWinRate}%，应 > 50%`).toBeGreaterThan(results.length * 0.5);
    },
    5 * 60 * 1000, // 5 分钟超时
  );
});
