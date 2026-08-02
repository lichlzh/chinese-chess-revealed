import { describe, it, expect } from 'vitest';
import { Color, GameStatus, PieceType, type BoardState, type Move } from './types';
import {
  getLegalMoves,
  applyMoveToGrid,
  executeMove,
  isInCheck,
  kingsFaceEachOther,
  computeChases,
  checkPerpetualCheck,
} from './moves';
import { createPiece } from './board';

function emptyGrid(): any {
  return Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null));
}

function makeBoard(grid: any, turn: Color): BoardState {
  return {
    grid,
    currentTurn: turn,
    status: GameStatus.Playing,
    moveHistory: [],
    redCaptured: [],
    blackCaptured: [],
    movesWithoutCapture: 0,
  };
}

describe('走法生成 - 车', () => {
  it('中心车在无子棋盘有 16 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[5][4] = createPiece(PieceType.Chariot, Color.Red, false);
    const moves = getLegalMoves(makeBoard(g, Color.Red), { row: 5, col: 4 });
    expect(moves.length).toBe(16);
  });
});

describe('走法生成 - 马（蹩脚）', () => {
  it('空棋盘马有 8 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[5][4] = createPiece(PieceType.Horse, Color.Red, false);
    expect(getLegalMoves(makeBoard(g, Color.Red), { row: 5, col: 4 }).length).toBe(8);
  });
  it('蹩马腿后减为 6 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[5][4] = createPiece(PieceType.Horse, Color.Red, false);
    g[4][4] = createPiece(PieceType.Pawn, Color.Red, false); // 蹩 (-2,±1) 两向
    const moves = getLegalMoves(makeBoard(g, Color.Red), { row: 5, col: 4 });
    expect(moves.length).toBe(6);
  });
});

describe('走法生成 - 兵', () => {
  it('未过河兵仅向前 1 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[6][4] = createPiece(PieceType.Pawn, Color.Red, false);
    const moves = getLegalMoves(makeBoard(g, Color.Red), { row: 6, col: 4 });
    expect(moves).toEqual([{ row: 5, col: 4 }]);
  });
  it('过河兵可前进与左右', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[4][4] = createPiece(PieceType.Pawn, Color.Red, false);
    const moves = getLegalMoves(makeBoard(g, Color.Red), { row: 4, col: 4 });
    expect(moves.length).toBe(3);
    expect(moves).toContainEqual({ row: 3, col: 4 });
    expect(moves).toContainEqual({ row: 4, col: 3 });
    expect(moves).toContainEqual({ row: 4, col: 5 });
  });
});

describe('走法生成 - 帅', () => {
  it('九宫内 3 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    const moves = getLegalMoves(makeBoard(g, Color.Red), { row: 9, col: 4 });
    expect(moves.length).toBe(3);
    expect(moves).toContainEqual({ row: 9, col: 3 });
    expect(moves).toContainEqual({ row: 9, col: 5 });
    expect(moves).toContainEqual({ row: 8, col: 4 });
  });
});

describe('走法生成 - 炮（翻山打子）', () => {
  it('空棋盘炮有 16 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[5][4] = createPiece(PieceType.Cannon, Color.Red, false);
    const moves = getLegalMoves(makeBoard(g, Color.Red), { row: 5, col: 4 });
    expect(moves.length).toBe(16);
    expect(moves).toContainEqual({ row: 5, col: 0 });
  });
  it('隔一炮架可吃子', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[5][4] = createPiece(PieceType.Cannon, Color.Red, false);
    g[5][6] = createPiece(PieceType.Chariot, Color.Red, false); // 炮架
    g[5][8] = createPiece(PieceType.Chariot, Color.Black, false); // 目标
    const moves = getLegalMoves(makeBoard(g, Color.Red), { row: 5, col: 4 });
    expect(moves).toContainEqual({ row: 5, col: 8 });
  });
});

describe('走法生成 - 士（暗子/明子 过河）', () => {
  it('暗子士不在九宫 → 0 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[5][3] = createPiece(PieceType.Advisor, Color.Red, true);
    const hidden = getLegalMoves(makeBoard(g, Color.Red), { row: 5, col: 3 });
    expect(hidden.length).toBe(0);
  });
  it('明子士可过河斜走 4 步', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[5][3] = createPiece(PieceType.Advisor, Color.Red, false);
    const revealed = getLegalMoves(makeBoard(g, Color.Red), { row: 5, col: 3 });
    expect(revealed.length).toBe(4);
  });
});

describe('isInCheck / kingsFaceEachOther', () => {
  it('将帅照面 → 双方被将', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[0][4] = createPiece(PieceType.King, Color.Black, false);
    expect(kingsFaceEachOther(g)).toBe(true);
    expect(isInCheck(g, Color.Red)).toBe(true);
    expect(isInCheck(g, Color.Black)).toBe(true);
  });
  it('隔子遮挡 → 不被将', () => {
    const g = emptyGrid();
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    g[0][4] = createPiece(PieceType.King, Color.Black, false);
    g[5][4] = createPiece(PieceType.Pawn, Color.Red, false);
    expect(kingsFaceEachOther(g)).toBe(false);
    expect(isInCheck(g, Color.Red)).toBe(false);
  });
});

describe('applyMoveToGrid - 落子+翻暗', () => {
  it('暗子落子后变明，原格清空，且不影响原网格', () => {
    const g = emptyGrid();
    const p = createPiece(PieceType.Chariot, Color.Red, true);
    g[5][4] = p;
    const ng = applyMoveToGrid(g, { row: 5, col: 4 }, { row: 5, col: 5 }, p);
    expect(ng[5][5]!.hidden).toBe(false);
    expect(ng[5][4]).toBeNull();
    expect(g[5][4]).not.toBeNull();
  });
});

describe('executeMove - 将死', () => {
  it('双车锁死黑王 → 黑负(将死)', () => {
    const g = emptyGrid();
    g[0][4] = createPiece(PieceType.King, Color.Black, false);
    g[9][3] = createPiece(PieceType.King, Color.Red, false);
    g[3][0] = createPiece(PieceType.Chariot, Color.Red, false);
    g[1][8] = createPiece(PieceType.Chariot, Color.Red, false);
    const res = executeMove(makeBoard(g, Color.Red), { row: 3, col: 0 }, { row: 0, col: 0 });
    expect(res).not.toBeNull();
    expect(res!.newState.status).toBe(GameStatus.BlackWin);
    expect(res!.newState.endReason).toBe('将死');
    expect(res!.move.isCheckmate).toBe(true);
    expect(res!.move.isCheck).toBe(true);
  });
});

describe('executeMove - 困毙', () => {
  it('黑王无路可走且未被将 → 黑负(困毙)', () => {
    const g = emptyGrid();
    g[0][4] = createPiece(PieceType.King, Color.Black, false);
    g[9][3] = createPiece(PieceType.King, Color.Red, false);
    g[1][0] = createPiece(PieceType.Chariot, Color.Red, false);
    g[2][3] = createPiece(PieceType.Chariot, Color.Red, false);
    g[2][5] = createPiece(PieceType.Chariot, Color.Red, false);
    const res = executeMove(makeBoard(g, Color.Red), { row: 9, col: 3 }, { row: 8, col: 3 });
    expect(res).not.toBeNull();
    expect(res!.newState.status).toBe(GameStatus.BlackWin);
    expect(res!.newState.endReason).toBe('困毙');
  });
});

describe('executeMove - 无吃子和棋', () => {
  it('连续 60 步无吃子 → 和棋', () => {
    const g = emptyGrid();
    g[0][4] = createPiece(PieceType.King, Color.Black, false);
    g[9][3] = createPiece(PieceType.King, Color.Red, false);
    g[5][0] = createPiece(PieceType.Chariot, Color.Red, false);
    const state = makeBoard(g, Color.Red);
    state.movesWithoutCapture = 59;
    const res = executeMove(state, { row: 5, col: 0 }, { row: 5, col: 1 });
    expect(res).not.toBeNull();
    expect(res!.newState.status).toBe(GameStatus.Draw);
    expect(res!.newState.endReason).toBe('长时间无吃子，和棋');
  });
});

describe('computeChases - 捉子判定', () => {
  it('红车可白吃无根黑车 → 记入捉', () => {
    const g = emptyGrid();
    g[9][3] = createPiece(PieceType.King, Color.Red, false);
    g[1][4] = createPiece(PieceType.King, Color.Black, false);
    g[0][0] = createPiece(PieceType.Chariot, Color.Red, false);
    g[0][8] = createPiece(PieceType.Chariot, Color.Black, false);
    const chases = computeChases(makeBoard(g, Color.Red), Color.Red);
    expect(chases).toContain(g[0][8].id);
  });
});

describe('checkPerpetualCheck - 连将兜底', () => {
  function fakeMove(color: Color, isCheck: boolean): Move {
    return {
      from: { row: 0, col: 0 },
      to: { row: 0, col: 1 },
      piece: { id: 1, type: PieceType.Chariot, color, hidden: false },
      isCheck,
    } as Move;
  }
  it('连续 6 步同方将军 → 返回该方', () => {
    const state = makeBoard(emptyGrid(), Color.Red);
    state.moveHistory = Array.from({ length: 6 }, () => fakeMove(Color.Red, true));
    expect(checkPerpetualCheck(state)).toBe(Color.Red);
  });
  it('不足 6 步 → null', () => {
    const state = makeBoard(emptyGrid(), Color.Red);
    state.moveHistory = [fakeMove(Color.Red, true)];
    expect(checkPerpetualCheck(state)).toBeNull();
  });
  it('末步非将军 → null', () => {
    const state = makeBoard(emptyGrid(), Color.Red);
    state.moveHistory = [fakeMove(Color.Red, true), fakeMove(Color.Black, false)];
    expect(checkPerpetualCheck(state)).toBeNull();
  });
  it('途中含闲着打断连将 → null', () => {
    const state = makeBoard(emptyGrid(), Color.Red);
    state.moveHistory = [
      ...Array.from({ length: 5 }, () => fakeMove(Color.Red, true)),
      fakeMove(Color.Red, false),
    ];
    expect(checkPerpetualCheck(state)).toBeNull();
  });
});
