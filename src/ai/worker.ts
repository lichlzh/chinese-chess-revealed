// ============================================================
// 揭棋 - AI Web Worker（持久化，复用置换表）
// ============================================================

import { findBestMove } from './search';
import { TranspositionTable } from './tt';
import type { BoardState } from '../engine/moves';

interface SearchRequest {
  id: number;
  type: 'search';
  state: BoardState;
  config: { maxDepth: number; timeLimit: number };
}

interface SearchResponse {
  id: number;
  type: 'result';
  result: { from: { row: number; col: number }; to: { row: number; col: number } } | null;
}

interface ClearRequest {
  type: 'clear';
}

/** 持久化置换表：在同一次对局中复用 */
const tt = new TranspositionTable();

self.onmessage = (e: MessageEvent<SearchRequest | ClearRequest>) => {
  const msg = e.data;

  if (msg.type === 'clear') {
    tt.clear();
    return;
  }

  if (msg.type === 'search') {
    const result = findBestMove(msg.state, msg.config, tt);
    const response: SearchResponse = {
      id: msg.id,
      type: 'result',
      result: result ? {
        from: { row: result.from.row, col: result.from.col },
        to: { row: result.to.row, col: result.to.col },
      } : null,
    };
    self.postMessage(response);
  }
};
