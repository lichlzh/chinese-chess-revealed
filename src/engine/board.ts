// ============================================================
// 揭棋 - 棋盘初始化与状态管理
// ============================================================

import {
  Color, PieceType, Piece, Position, BoardState, GameStatus,
  POSITION_IDENTITY, posKey, samePos,
} from './types';

let nextId = 1;
function newId(): number { return nextId++; }

export function resetIdCounter(): void { nextId = 1; }

/** 创建一枚棋子 */
export function createPiece(type: PieceType, color: Color, hidden: boolean): Piece {
  return { id: newId(), type, color, hidden };
}

/** 获取初始棋子池：将/帅固定 + 其他15子 */
function getPiecePool(color: Color): Piece[] {
  const pool: Piece[] = [];
  // 将/帅（明子）
  pool.push(createPiece(PieceType.King, color, false));
  // 其余15子
  const types: PieceType[] = [
    PieceType.Chariot, PieceType.Chariot,
    PieceType.Horse, PieceType.Horse,
    PieceType.Cannon, PieceType.Cannon,
    PieceType.Elephant, PieceType.Elephant,
    PieceType.Advisor, PieceType.Advisor,
    PieceType.Pawn, PieceType.Pawn, PieceType.Pawn, PieceType.Pawn, PieceType.Pawn,
  ];
  for (const t of types) {
    pool.push(createPiece(t, color, true));
  }
  return pool;
}

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 获取一方（红或黑）的初始位置列表（不含将/帅位置） */
function getInitialPositions(color: Color): Position[] {
  const positions: Position[] = [];
  if (color === Color.Black) {
    // 黑方半边：row 0-4
    for (let r = 0; r <= 4; r++) {
      for (let c = 0; c <= 8; c++) {
        if (POSITION_IDENTITY[posKey(r, c)] !== undefined && (r !== 0 || c !== 4)) {
          positions.push({ row: r, col: c });
        }
      }
    }
  } else {
    // 红方半边：row 5-9
    for (let r = 5; r <= 9; r++) {
      for (let c = 0; c <= 8; c++) {
        if (POSITION_IDENTITY[posKey(r, c)] !== undefined && (r !== 9 || c !== 4)) {
          positions.push({ row: r, col: c });
        }
      }
    }
  }
  return positions;
}

/** 初始化棋盘 */
export function initBoard(): BoardState {
  const grid: (Piece | null)[][] = Array.from({ length: 10 }, () => Array(9).fill(null));

  // 放将/帅
  const blackKing = createPiece(PieceType.King, Color.Black, false);
  grid[0][4] = blackKing;
  const redKing = createPiece(PieceType.King, Color.Red, false);
  grid[9][4] = redKing;

  // 黑方暗子
  const blackPool = shuffle(getPiecePool(Color.Black).filter(p => p.type !== PieceType.King));
  const blackPositions = getInitialPositions(Color.Black);
  for (let i = 0; i < blackPositions.length; i++) {
    const p = blackPositions[i];
    grid[p.row][p.col] = blackPool[i];
  }

  // 红方暗子
  const redPool = shuffle(getPiecePool(Color.Red).filter(p => p.type !== PieceType.King));
  const redPositions = getInitialPositions(Color.Red);
  for (let i = 0; i < redPositions.length; i++) {
    const p = redPositions[i];
    grid[p.row][p.col] = redPool[i];
  }

  return {
    grid,
    currentTurn: Color.Red, // 红方先行
    status: GameStatus.Playing,
    moveHistory: [],
    redCaptured: [],
    blackCaptured: [],
    movesWithoutCapture: 0,
  };
}

/** 克隆棋盘状态 */
export function cloneBoardState(state: BoardState): BoardState {
  return {
    grid: state.grid.map(row => row.map(cell => cell ? { ...cell } : null)),
    currentTurn: state.currentTurn,
    status: state.status,
    moveHistory: [...state.moveHistory],
    redCaptured: [...state.redCaptured],
    blackCaptured: [...state.blackCaptured],
    movesWithoutCapture: state.movesWithoutCapture,
    endReason: state.endReason,
  };
}

/** 深拷贝 grid */
export function cloneGrid(grid: (Piece | null)[][]): (Piece | null)[][] {
  return grid.map(row => row.map(cell => cell ? { ...cell } : null));
}

/**
 * 被吃掉的暗子是否应向玩家显示真实身份：
 * 只有该子已经翻开过（hidden=false），或棋局已结束（gameOver）才展示，
 * 否则在棋局进行中对其真实身份保密（显示为「?」）。
 */
export function isCapturedRevealed(piece: Piece, gameOver: boolean): boolean {
  return !piece.hidden || gameOver;
}

/** 获取棋盘上某位置的身份（用于暗子走法判定） */
export function getPositionIdentity(pos: Position): PieceType | undefined {
  return POSITION_IDENTITY[posKey(pos.row, pos.col)];
}

/** 获取对手颜色 */
export function opponentColor(color: Color): Color {
  return color === Color.Red ? Color.Black : Color.Red;
}

/** 找到指定颜色的将/帅位置 */
export function findKing(grid: (Piece | null)[][], color: Color): Position | null {
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = grid[r][c];
      if (piece && piece.type === PieceType.King && piece.color === color && !piece.hidden) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

/** 获取某位置棋子的有效走法类型 */
export function getEffectiveType(piece: Piece, pos: Position): PieceType {
  if (piece.hidden) {
    return getPositionIdentity(pos) ?? piece.type;
  }
  return piece.type;
}

/** 坐标是否在棋盘内 */
export function inBoard(row: number, col: number): boolean {
  return row >= 0 && row <= 9 && col >= 0 && col <= 8;
}
