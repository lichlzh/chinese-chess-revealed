// ============================================================
// 揭棋 - AI Web Worker
// ============================================================

import { findBestMove } from './search';
import type { BoardState } from '../engine/moves';

interface WorkerMessage {
  type: 'search';
  state: BoardState;
  config: { maxDepth: number; timeLimit: number };
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, state, config } = e.data;

  if (type === 'search') {
    const result = findBestMove(state, config);
    self.postMessage({ type: 'result', result });
  }
};
