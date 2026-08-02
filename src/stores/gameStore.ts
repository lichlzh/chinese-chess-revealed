// ============================================================
// 揭棋 - Zustand 游戏状态管理
// ============================================================

import { create } from 'zustand';
import { Color, GameStatus, GameMode, type Position, type Piece } from '../engine/types';
import { initBoard, opponentColor, cloneBoardState } from '../engine/board';
import { getLegalMoves, executeMove, getAllLegalMoves } from '../engine/moves';
import type { BoardState } from '../engine/moves';

interface GameStore {
  // 棋盘状态
  board: BoardState;
  // 游戏模式
  gameMode: GameMode;
  // 玩家颜色（人机模式中玩家执的颜色）
  playerColor: Color;
  // 当前选中的棋子位置
  selectedPos: Position | null;
  // 合法着法提示
  legalMoves: Position[];
  // AI 是否正在思考
  aiThinking: boolean;
  // AI Worker 引用
  aiWorker: Worker | null;

  // Actions
  newGame: (mode: GameMode) => void;
  selectPiece: (pos: Position) => void;
  movePiece: (to: Position) => void;
  undo: () => void;
  setGameMode: (mode: GameMode) => void;
  requestAIMove: () => void;
  fallbackAIMove: () => void;
  getPieceAt: (pos: Position) => Piece | null;
  getLegalMovesFor: (pos: Position) => Position[];
  cleanup: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  board: initBoard(),
  gameMode: GameMode.PvP,
  playerColor: Color.Red,
  selectedPos: null,
  legalMoves: [],
  aiThinking: false,
  aiWorker: null,

  newGame: (mode: GameMode) => {
    const board = initBoard();
    set({
      board,
      gameMode: mode,
      playerColor: Color.Red,
      selectedPos: null,
      legalMoves: [],
      aiThinking: false,
    });

    // 如果人机模式且 AI 先手（黑方），触发 AI
    if (mode === GameMode.PvAI && board.currentTurn === Color.Black) {
      setTimeout(() => get().requestAIMove(), 500);
    }
  },

  selectPiece: (pos: Position) => {
    const { board, gameMode, playerColor, aiThinking } = get();
    if (board.status !== GameStatus.Playing) return;
    if (aiThinking) return;

    // 人机模式中，玩家只能操作自己的颜色
    if (gameMode === GameMode.PvAI && board.currentTurn !== playerColor) return;

    const piece = board.grid[pos.row][pos.col];
    if (!piece || piece.color !== board.currentTurn) {
      // 如果已经有选中的棋子，尝试走到目标位置
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

    // 人机模式：触发 AI 走棋
    if (gameMode === GameMode.PvAI && result.newState.status === GameStatus.Playing) {
      setTimeout(() => get().requestAIMove(), 300);
    }
  },

  undo: () => {
    const { board, gameMode, aiThinking } = get();
    if (aiThinking) return;
    const history = board.moveHistory;
    if (history.length === 0) return;

    // 人机模式：撤回两步（玩家 + AI）
    const steps = gameMode === GameMode.PvAI && history.length >= 2 ? 2 : 1;
    let newBoard = cloneBoardState(board);

    for (let i = 0; i < steps; i++) {
      const lastMove = newBoard.moveHistory[newBoard.moveHistory.length - 1];
      if (!lastMove) break;

      // 从 history 中移除
      newBoard.moveHistory = newBoard.moveHistory.slice(0, -1);

      // 恢复棋子
      const movedPiece = lastMove.piece;
      newBoard.grid[lastMove.from.row][lastMove.from.col] = movedPiece;

      if (lastMove.captured) {
        newBoard.grid[lastMove.to.row][lastMove.to.col] = lastMove.captured;
        // 从被吃列表中移除
        if (lastMove.captured.color === Color.Red) {
          newBoard.redCaptured = newBoard.redCaptured.filter(p => p.id !== lastMove.captured!.id);
        } else {
          newBoard.blackCaptured = newBoard.blackCaptured.filter(p => p.id !== lastMove.captured!.id);
        }
      } else {
        newBoard.grid[lastMove.to.row][lastMove.to.col] = null;
      }

      // 切换回上一回合
      newBoard.currentTurn = opponentColor(newBoard.currentTurn);
    }

    newBoard.status = GameStatus.Playing;
    set({ board: newBoard, selectedPos: null, legalMoves: [] });
  },

  setGameMode: (mode: GameMode) => {
    set({ gameMode: mode });
  },

  requestAIMove: () => {
    const { board, aiThinking } = get();
    if (aiThinking || board.status !== GameStatus.Playing) return;

    set({ aiThinking: true });

    // 使用 Web Worker
    try {
      const worker = new Worker(
        new URL('../ai/worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent) => {
        const { result } = e.data;
        worker.terminate();

        if (result) {
          const store = get();
          const moveResult = executeMove(store.board, result.from, result.to);
          if (moveResult) {
            set({
              board: moveResult.newState,
              aiThinking: false,
            });
          } else {
            set({ aiThinking: false });
          }
        } else {
          set({ aiThinking: false });
        }
      };

      worker.onerror = () => {
        // Web Worker 失败时，回退到同步搜索
        worker.terminate();
        set({ aiThinking: false });
        get().fallbackAIMove();
      };

      worker.postMessage({
        type: 'search',
        state: board,
        config: { maxDepth: 3, timeLimit: 3000 },
      });
    } catch {
      set({ aiThinking: false });
      get().fallbackAIMove();
    }
  },

  // 回退 AI（主线程同步搜索，可能卡顿）
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
    const { board } = get();
    return board.grid[pos.row][pos.col];
  },

  getLegalMovesFor: (pos: Position) => {
    const { board } = get();
    return getLegalMoves(board, pos);
  },

  cleanup: () => {
    // 清理 Worker
  },
}));

function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}
