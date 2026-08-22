// ============================================================
// 揭棋 - Zustand 游戏状态管理
// ============================================================

import { create } from 'zustand';
import { Color, GameStatus, GameMode, type Position, type Piece } from '../engine/types';
import { initBoard } from '../engine/board';
import { buildGameRecord } from '../engine/record';
import { getLegalMoves, executeMove, undoMove } from '../engine/moves';
import { samePos } from '../engine/utils';
import { findSimpleMove } from '../ai/search';
import { createAIManager, type AIManager } from '../ai/manager';
import type { BoardState } from '../engine/moves';

interface GameStore {
  // 棋盘状态
  board: BoardState;
  gameMode: GameMode;
  playerColor: Color;
  selectedPos: Position | null;
  legalMoves: Position[];
  aiThinking: boolean;

  // AI Manager（持久化复用）
  aiManager: AIManager | null;
  aiRequestId: number;

  // Actions
  newGame: (mode: GameMode, playerColor?: Color) => void;
  selectPiece: (pos: Position) => void;
  movePiece: (to: Position) => void;
  undo: () => void;
  setGameMode: (mode: GameMode) => void;
  requestAIMove: () => void;
  fallbackAIMove: () => void;
  getPieceAt: (pos: Position) => Piece | null;
  getLegalMovesFor: (pos: Position) => Position[];
  cleanup: () => void;
  exportGameRecord: () => string;
}

export const useGameStore = create<GameStore>((set, get) => ({
  board: initBoard(),
  gameMode: GameMode.PvP,
  playerColor: Color.Red,
  selectedPos: null,
  legalMoves: [],
  aiThinking: false,
  aiManager: null,
  aiRequestId: 0,

  newGame: (mode: GameMode, playerColor: Color = Color.Red) => {
    const board = initBoard();

    // 清理旧 Manager
    const { aiManager } = get();
    if (aiManager) {
      aiManager.terminate();
    }

    // 创建持久化 Manager（人机模式）
    const newManager = mode === GameMode.PvAI ? createAIManager() : null;

    set({
      board,
      gameMode: mode,
      playerColor,
      selectedPos: null,
      legalMoves: [],
      aiThinking: false,
      aiManager: newManager,
      aiRequestId: 0,
    });

    // 若当前轮到 AI（即玩家执后手），让 AI 先走
    if (mode === GameMode.PvAI && board.currentTurn !== playerColor) {
      setTimeout(() => get().requestAIMove(), 500);
    }
  },

  selectPiece: (pos: Position) => {
    const { board, gameMode, playerColor, aiThinking } = get();
    if (board.status !== GameStatus.Playing) return;
    if (aiThinking) return;

    if (gameMode === GameMode.PvAI && board.currentTurn !== playerColor) return;

    const piece = board.grid[pos.row][pos.col];
    if (!piece || piece.color !== board.currentTurn) {
      const { selectedPos } = get();
      if (selectedPos) {
        get().movePiece(pos);
      }
      return;
    }

    const moves = getLegalMoves(board, pos);
    set({ selectedPos: pos, legalMoves: moves });
  },

  movePiece: (to: Position) => {
    const { board, selectedPos, gameMode } = get();
    if (!selectedPos || board.status !== GameStatus.Playing) return;
    if (samePos(selectedPos, to)) {
      set({ selectedPos: null, legalMoves: [] });
      return;
    }

    const result = executeMove(board, selectedPos, to);
    if (!result) return;

    set({
      board: result.newState,
      selectedPos: null,
      legalMoves: [],
    });

    if (gameMode === GameMode.PvAI && result.newState.status === GameStatus.Playing) {
      setTimeout(() => get().requestAIMove(), 300);
    }
  },

  undo: () => {
    const { board, gameMode, aiThinking } = get();
    if (aiThinking) return;
    if (board.moveHistory.length === 0) return;

    const steps = gameMode === GameMode.PvAI && board.moveHistory.length >= 2 ? 2 : 1;
    const newBoard = undoMove(board, steps);
    set({ board: newBoard, selectedPos: null, legalMoves: [] });
  },

  setGameMode: (mode: GameMode) => {
    set({ gameMode: mode });
  },

  requestAIMove: async () => {
    const { board, aiThinking, aiManager } = get();
    if (aiThinking || board.status !== GameStatus.Playing) return;

    if (aiManager) {
      set({ aiThinking: true });
      const id = get().aiRequestId + 1;
      set({ aiRequestId: id });

      const result = await aiManager.requestMove(
        board,
        { maxDepth: 6, timeLimit: 3000 },
        5000,
      );

      // 检查请求是否仍然有效（期间可能已 newGame / undo）
      if (get().aiRequestId !== id) return;

      if (result) {
        const store = get();
        const moveResult = executeMove(store.board, result.from, result.to);
        if (moveResult) {
          set({ board: moveResult.newState, aiThinking: false });
          return;
        }
      }

      // Worker 超时或返回 null → fallback
      set({ aiThinking: false });
      get().fallbackAIMove();
    } else {
      // 没有 Manager（PvP 模式）→ fallback
      get().fallbackAIMove();
    }
  },

  // Fallback AI：使用轻量搜索（无需 Worker），远优于随机走法
  fallbackAIMove: () => {
    const { board } = get();
    if (board.status !== GameStatus.Playing) return;
    set({ aiThinking: true });

    setTimeout(() => {
      const state = get();
      const move = findSimpleMove(state.board, 3);
      if (move) {
        const result = executeMove(state.board, move.from, move.to);
        if (result) {
          set({ board: result.newState, aiThinking: false });
          return;
        }
      }
      set({ aiThinking: false });
    }, 500);
  },

  getPieceAt: (pos: Position) => {
    return get().board.grid[pos.row][pos.col];
  },

  getLegalMovesFor: (pos: Position) => {
    return getLegalMoves(get().board, pos);
  },

  cleanup: () => {
    const { aiManager } = get();
    if (aiManager) {
      aiManager.terminate();
      set({ aiManager: null });
    }
  },

  exportGameRecord: () => {
    const { board, gameMode, playerColor } = get();
    return buildGameRecord(board, {
      mode: gameMode,
      playerColor,
      status: board.status,
      endReason: board.endReason,
    });
  },
}));
