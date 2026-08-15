// ============================================================
// 揭棋 - Zustand 游戏状态管理
// ============================================================

import { create } from 'zustand';
import { Color, GameStatus, GameMode, type Position, type Piece } from '../engine/types';
import { initBoard, opponentColor, cloneBoardState } from '../engine/board';
import { buildGameRecord } from '../engine/record';
import { getLegalMoves, executeMove, getAllLegalMoves } from '../engine/moves';
import { samePos } from '../engine/utils';
import type { BoardState } from '../engine/moves';

interface GameStore {
  // 棋盘状态
  board: BoardState;
  gameMode: GameMode;
  playerColor: Color;
  selectedPos: Position | null;
  legalMoves: Position[];
  aiThinking: boolean;

  // AI Worker（持久化复用）
  aiWorker: Worker | null;
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
  aiWorker: null,
  aiRequestId: 0,

  newGame: (mode: GameMode, playerColor: Color = Color.Red) => {
    const board = initBoard();

    // 清理旧 Worker
    const { aiWorker } = get();
    if (aiWorker) {
      aiWorker.terminate();
    }

    // 创建持久化 Worker（人机模式）
    let newWorker: Worker | null = null;
    if (mode === GameMode.PvAI) {
      newWorker = createWorker();
    }

    set({
      board,
      gameMode: mode,
      playerColor,
      selectedPos: null,
      legalMoves: [],
      aiThinking: false,
      aiWorker: newWorker,
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
    const history = board.moveHistory;
    if (history.length === 0) return;

    const steps = gameMode === GameMode.PvAI && history.length >= 2 ? 2 : 1;
    let newBoard = cloneBoardState(board);

    for (let i = 0; i < steps; i++) {
      const lastMove = newBoard.moveHistory[newBoard.moveHistory.length - 1];
      if (!lastMove) break;

      newBoard.moveHistory = newBoard.moveHistory.slice(0, -1);

      const movedPiece = lastMove.piece;
      newBoard.grid[lastMove.from.row][lastMove.from.col] = movedPiece;

      if (lastMove.captured) {
        newBoard.grid[lastMove.to.row][lastMove.to.col] = lastMove.captured;
        if (lastMove.captured.color === Color.Red) {
          newBoard.redCaptured = newBoard.redCaptured.filter(p => p.id !== lastMove.captured!.id);
        } else {
          newBoard.blackCaptured = newBoard.blackCaptured.filter(p => p.id !== lastMove.captured!.id);
        }
      } else {
        newBoard.grid[lastMove.to.row][lastMove.to.col] = null;
      }

      newBoard.currentTurn = opponentColor(newBoard.currentTurn);
    }

    // 还原棋规计数（重复局面靠 moveHistory 现算，无需还原）
    let noCapture = 0;
    for (let i = newBoard.moveHistory.length - 1; i >= 0; i--) {
      if (newBoard.moveHistory[i].captured) break;
      noCapture++;
    }
    newBoard.movesWithoutCapture = noCapture;
    newBoard.endReason = undefined;
    newBoard.status = GameStatus.Playing;
    set({ board: newBoard, selectedPos: null, legalMoves: [] });
  },

  setGameMode: (mode: GameMode) => {
    set({ gameMode: mode });
  },

  requestAIMove: () => {
    const { board, aiThinking, aiWorker } = get();
    if (aiThinking || board.status !== GameStatus.Playing) return;

    // 尝试使用持久化 Worker
    if (aiWorker) {
      set({ aiThinking: true });
      const id = get().aiRequestId + 1;
      set({ aiRequestId: id });

      let resolved = false;
      const onMessage = (e: MessageEvent) => {
        if (resolved) return;
        if (e.data.type === 'result' && e.data.id === id) {
          resolved = true;
          aiWorker.removeEventListener('message', onMessage);

          const { result: aiResult } = e.data;
          if (aiResult) {
            const store = get();
            const moveResult = executeMove(store.board, aiResult.from, aiResult.to);
            if (moveResult) {
              set({ board: moveResult.newState, aiThinking: false });
            } else {
              set({ aiThinking: false });
            }
          } else {
            set({ aiThinking: false });
          }
        }
      };

      aiWorker.addEventListener('message', onMessage);

      aiWorker.postMessage({
        type: 'search',
        id,
        state: board,
        config: { maxDepth: 6, timeLimit: 3000 },
      });

      // 超时保护
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          aiWorker.removeEventListener('message', onMessage);
          set({ aiThinking: false });
          get().fallbackAIMove();
        }
      }, 5000);
    } else {
      // 没有 Worker（PvP 模式回调）→ 回退 AI
      get().fallbackAIMove();
    }
  },

  // 回退 AI（简单 Minimax，无 Worker 时使用）
  fallbackAIMove: () => {
    const { board } = get();
    if (board.status !== GameStatus.Playing) return;
    set({ aiThinking: true });

    setTimeout(() => {
      const state = get();
      const allMoves = getAllLegalMoves(state.board);
      if (allMoves.length > 0) {
        const pick = allMoves[Math.floor(Math.random() * allMoves.length)];
        const result = executeMove(state.board, pick.from, pick.to);
        if (result) {
          set({ board: result.newState, aiThinking: false });
        } else {
          set({ aiThinking: false });
        }
      } else {
        set({ aiThinking: false });
      }
    }, 500);
  },

  getPieceAt: (pos: Position) => {
    return get().board.grid[pos.row][pos.col];
  },

  getLegalMovesFor: (pos: Position) => {
    return getLegalMoves(get().board, pos);
  },

  cleanup: () => {
    const { aiWorker } = get();
    if (aiWorker) {
      aiWorker.terminate();
      set({ aiWorker: null });
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

/** 创建持久化 AI Worker */
function createWorker(): Worker {
  return new Worker(
    new URL('../ai/worker.ts', import.meta.url),
    { type: 'module' },
  );
}
