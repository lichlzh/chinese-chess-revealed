// ============================================================
// 揭棋 - AI Web Worker（持久化，复用置换表）
// ============================================================

import { findBestMove } from './search';
import { TranspositionTable } from './tt';
import type { BoardState } from '../engine/moves';
import { getPositionIdentity } from '../engine/board';
import type { Piece } from '../engine/types';

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

/**
 * 脱敏：把棋盘上所有暗子的真实随机兵种替换成公开的「位置身份」。
 * 揭棋规则下，暗子翻开前任一方（包括 AI 自己）都不应知道其真实身份，
 * 因此搜索时只暴露位置身份这一公开信息。这样即便搜索/评估中任何代码读取
 * piece.type，拿到的也只是公开信息，AI 在物理上无法偷看暗子身份。
 */
function sanitizeState(state: BoardState): BoardState {
  const grid = state.grid.map((row, r) =>
    row.map((cell, c): Piece | null => {
      if (!cell) return null;
      if (!cell.hidden) return { ...cell };
      const identity = getPositionIdentity({ row: r, col: c });
      return { ...cell, type: identity ?? cell.type };
    }),
  );
  return { ...state, grid };
}

self.onmessage = (e: MessageEvent<SearchRequest | ClearRequest>) => {
  const msg = e.data;

  if (msg.type === 'clear') {
    tt.clear();
    return;
  }

  if (msg.type === 'search') {
    const result = findBestMove(sanitizeState(msg.state), msg.config, tt);
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
