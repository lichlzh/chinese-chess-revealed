import { describe, test, expect } from 'vitest';
import { initBoard, resetIdCounter, opponentColor } from './src/engine/board';
import { getAllLegalMoves, executeMove, isInCheckFast, findAllKings } from './src/engine/moves';
import { findBestMove, type SearchConfig } from './src/ai/search';
import { TranspositionTable } from './src/ai/tt';
import { Color, GameStatus, samePos } from './src/engine/types';

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initSeeded(seed: number) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  resetIdCounter();
  const s = initBoard();
  Math.random = orig;
  return s;
}

describe('mini AB', () => {
  test('2 games depth 3', () => {
    const origDebug = (console as any).debug;
    (console as any).debug = () => {};
    
    for (let game = 0; game < 2; game++) {
      let state = initSeeded(1000 + game);
      const ttA = new TranspositionTable();
      const ttB = new TranspositionTable();
      let plies = 0;
      
      while (state.status === GameStatus.Playing && plies < 50) {
        const isATurn = plies % 2 === 0;
        const config: SearchConfig = isATurn 
          ? { maxDepth: 3, timeLimit: 1000 } 
          : { maxDepth: 3, timeLimit: 1000 };
        const tt = isATurn ? ttA : ttB;
        
        const move = findBestMove(state, config, tt);
        if (!move) break;
        
        const legal = getAllLegalMoves(state);
        const ok = legal.some(l => samePos(l.from, move.from) && samePos(l.to, move.to));
        if (!ok) {
          console.log('ILLEGAL move at ply', plies);
          break;
        }
        
        const res = executeMove(state, move.from, move.to);
        if (!res) break;
        state = res.newState;
        plies++;
        process.stdout.write(`\rGame ${game}: ply ${plies}`);
      }
      process.stdout.write('\n');
      console.log(`Game ${game} ended after ${plies} plies, status=${state.status}, reason=${state.endReason}`);
    }
    
    (console as any).debug = origDebug;
    expect(true).toBe(true);
  });
});
