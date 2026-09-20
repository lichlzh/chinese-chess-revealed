// ============================================================
// 揭棋 - 自我对弈验证（AI vs AI 20 局）
// 跑 20 局、导出每局棋谱，并对每一步做合法性 / 终局不变量检查。
// 运行：npm test -- src/selftest/selfplay.test.ts
// ============================================================

import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initBoard, resetIdCounter, opponentColor } from '../engine/board';
import { getAllLegalMoves, executeMove, isInCheck, type BoardState } from '../engine/moves';
import { findBestMove } from '../ai/search';
import { TranspositionTable } from '../ai/tt';
import { buildGameRecord } from '../engine/record';
import { Color, GameStatus, GameMode, samePos, type Piece } from '../engine/types';

const NUM_GAMES = 20;
const MAX_PLIES = 400;
// 浅搜索即可验证「游戏逻辑」：每步有硬时限，避免单步卡死
const CONFIG = { maxDepth: 3, timeLimit: 60 };

const OUT_DIR = path.resolve(process.cwd(), 'selftest_out');

interface GameResult {
  index: number;
  status: GameStatus;
  endReason?: string;
  plies: number;
  error?: string;
  usedSafetyCap: boolean;
}

function emptyGrid(): (Piece | null)[][] {
  return Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null));
}

function countKings(grid: (Piece | null)[][], color: Color): number {
  let n = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = grid[r][c];
      if (p && p.type === 'king' && p.color === color && !p.hidden) n++;
    }
  }
  return n;
}

function playOneGame(index: number): GameResult {
  resetIdCounter();
  let state = initBoard();
  const tt = new TranspositionTable();
  let plies = 0;
  let error: string | undefined;
  let usedSafetyCap = false;

  while (state.status === GameStatus.Playing && plies < MAX_PLIES) {
    // 不变量：对局进行中双方将帅应各 1 枚且未翻开
    if (countKings(state.grid, Color.Red) !== 1 || countKings(state.grid, Color.Black) !== 1) {
      error = 'king count != 1 during play';
      break;
    }

    const legal = getAllLegalMoves(state);
    if (legal.length === 0) {
      error = 'no legal moves but status still Playing (should have ended)';
      break;
    }

    const mv = findBestMove(state, CONFIG, tt);
    if (!mv) {
      error = 'findBestMove returned null';
      break;
    }

    // 检查 AI 选择的着法确实在合法集合内
    const legalHit = legal.some(l => samePos(l.from, mv.from) && samePos(l.to, mv.to));
    if (!legalHit) {
      error = `AI chose illegal move ${JSON.stringify(mv)} (turn=${state.currentTurn})`;
      break;
    }

    const res = executeMove(state, mv.from, mv.to);
    if (!res) {
      error = 'executeMove returned null';
      break;
    }
    state = res.newState;

    // 不变量：走子方走完后自己不能被将（合法着法保证）
    const mover = opponentColor(state.currentTurn);
    if (isInCheck(state.grid, mover)) {
      error = `move left own king in check: ${JSON.stringify(mv)} (mover=${mover})`;
      break;
    }

    plies++;
  }

  if (plies >= MAX_PLIES && state.status === GameStatus.Playing) {
    usedSafetyCap = true;
    error = error ?? 'reached safety cap (game did not terminate)';
  }

  const record = buildGameRecord(state, {
    mode: GameMode.PvAI,
    playerColor: Color.Red,
    status: state.status,
    endReason: state.endReason,
  });
  fs.writeFileSync(path.join(OUT_DIR, `record_${String(index).padStart(3, '0')}.txt`), record, 'utf8');

  return {
    index,
    status: state.status,
    endReason: state.endReason,
    plies,
    error,
    usedSafetyCap,
  };
}

describe('self-play 20 games', () => {
  test(
    'AI vs AI 20 局自我对弈 + 合法性校验',
    () => {
      // 抑制搜索时的 debug 日志（timeLimit>0 才会打印）
      const origDebug = console.debug;
      console.debug = () => {};

      fs.mkdirSync(OUT_DIR, { recursive: true });

      const results: GameResult[] = [];
      const t0 = Date.now();
      for (let i = 1; i <= NUM_GAMES; i++) {
        results.push(playOneGame(i));
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`\r  进度 ${i}/${NUM_GAMES} 局，已用 ${elapsed}s`);
      }
      process.stdout.write('\n');
      console.debug = origDebug;

      // ---- 汇总统计 ----
      const redWins = results.filter(r => r.status === GameStatus.RedWin).length;
      const blackWins = results.filter(r => r.status === GameStatus.BlackWin).length;
      const draws = results.filter(r => r.status === GameStatus.Draw).length;
      const unfinished = results.filter(r => r.status === GameStatus.Playing).length;
      const errors = results.filter(r => r.error);
      const capped = results.filter(r => r.usedSafetyCap);
      const pliesArr = results.map(r => r.plies).sort((a, b) => a - b);
      const avgPlies = (pliesArr.reduce((s, n) => s + n, 0) / results.length).toFixed(1);
      const reasonCounts: Record<string, number> = {};
      for (const r of results) {
        const key = r.status === GameStatus.Playing ? '(未结束)' : `${r.status}:${r.endReason ?? ''}`;
        reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
      }

      const total = Date.now() - t0;
      const summary =
`揭棋自我对弈验证报告
========================================
对局数：${NUM_GAMES}
总耗时：${(total / 1000).toFixed(1)}s（平均每局 ${(total / NUM_GAMES / 1000).toFixed(2)}s）

【结果分布】
红胜：${redWins}
黑胜：${blackWins}
和棋：${draws}
未结束：${unfinished}

【着法数（半回合）】
最少：${pliesArr[0]}
最多：${pliesArr[pliesArr.length - 1]}
平均：${avgPlies}

【终止原因统计】
${Object.entries(reasonCounts).map(([k, v]) => `  ${k}：${v}`).join('\n')}

【异常 / 问题】
报错局数：${errors.length}
触顶（未正常终止）局数：${capped.length}
${errors.map(r => `  [局 ${r.index}] ${r.error} (plies=${r.plies}, status=${r.status})`).join('\n') || '  无'}

【不变量校验】
- 每步着法均在合法集合内：已校验
- 走子方走完不被将：已校验
- 对局中双方将帅各 1：已校验
- 每局均导出棋谱至 selftest_out/record_NNN.txt：已校验
`;

      fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), summary, 'utf8');
      // 同时把每局汇总写成紧凑 csv 便于核对
      fs.writeFileSync(
        path.join(OUT_DIR, 'games.csv'),
        ['idx', 'status', 'endReason', 'plies', 'error'].join(',') + '\n' +
        results.map(r => [r.index, r.status, r.endReason ?? '', r.plies, r.error ?? ''].join(',')).join('\n'),
        'utf8',
      );

      console.log('\n' + summary);

      // ---- 断言：发现任何问题则测试失败 ----
      expect(errors.length, '存在非法着法 / 不变量违背 / 异常').toBe(0);
      expect(capped.length, '存在未能正常终止的对局').toBe(0);
      expect(unfinished, '存在未结束的对局').toBe(0);
    },
    30 * 60 * 1000, // 测试超时 30 分钟
  );
});
