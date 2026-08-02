// ============================================================
// 揭棋 - 走子规则（合法性判定 + 走子生成）
// ============================================================

import {
  Color, PieceType, Piece, Position, Move, BoardState, GameStatus,
  samePos,
} from './types';
import {
  inBoard, getEffectiveType, opponentColor, findKing,
  cloneGrid, cloneBoardState, getPositionIdentity,
} from './board';
import { generateNotation } from './notation';

export type { BoardState };
/** 获取某位置棋子在指定局面下的所有合法目标位置 */
export function getLegalMoves(state: BoardState, pos: Position): Position[] {
  const piece = state.grid[pos.row][pos.col];
  if (!piece) return [];
  if (piece.color !== state.currentTurn) return [];

  const effectiveType = piece.hidden
    ? getPositionIdentity(pos) ?? piece.type
    : piece.type;

  const candidates = getRawMoves(piece, effectiveType, pos, state.grid);
  // 过滤掉走后会导致己方被将的着法
  return candidates.filter(to => {
    const newGrid = applyMoveToGrid(state.grid, pos, to, piece);
    return !isInCheck(newGrid, piece.color);
  });
}

/** 获取某个棋子所有候选着法（不过滤将军） */
function getRawMoves(
  piece: Piece,
  effectiveType: PieceType,
  pos: Position,
  grid: (Piece | null)[][],
): Position[] {
  // 揭棋中，士/象翻开后可以过河
  const canCrossRiver = !piece.hidden && (effectiveType === PieceType.Advisor || effectiveType === PieceType.Elephant);

  switch (effectiveType) {
    case PieceType.King: return getKingMoves(pos, grid, piece.color);
    case PieceType.Advisor: return getAdvisorMoves(pos, grid, piece.color, canCrossRiver);
    case PieceType.Elephant: return getElephantMoves(pos, grid, piece.color, canCrossRiver);
    case PieceType.Horse: return getHorseMoves(pos, grid, piece.color);
    case PieceType.Chariot: return getChariotMoves(pos, grid, piece.color);
    case PieceType.Cannon: return getCannonMoves(pos, grid, piece.color);
    case PieceType.Pawn: return getPawnMoves(pos, grid, piece.color);
    default: return [];
  }
}

// ---- 各棋子走法 ----

/** 将/帅：九宫格内一步 */
function getKingMoves(pos: Position, grid: (Piece | null)[][], color: Color): Position[] {
  const result: Position[] = [];
  const [minR, maxR] = color === Color.Red ? [7, 9] : [0, 2];
  const minC = 3, maxC = 5;
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of dirs) {
    const nr = pos.row + dr, nc = pos.col + dc;
    if (nr >= minR && nr <= maxR && nc >= minC && nc <= maxC) {
      const target = grid[nr][nc];
      if (!target || target.color !== color) {
        result.push({ row: nr, col: nc });
      }
    }
  }
  return result;
}

/** 士/仕：斜走一步。揭棋中翻开后可以过河 */
function getAdvisorMoves(pos: Position, grid: (Piece | null)[][], color: Color, canCrossRiver: boolean): Position[] {
  const result: Position[] = [];
  const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  if (!canCrossRiver) {
    const [minR, maxR] = color === Color.Red ? [7, 9] : [0, 2];
    const minC = 3, maxC = 5;
    for (const [dr, dc] of dirs) {
      const nr = pos.row + dr, nc = pos.col + dc;
      if (nr >= minR && nr <= maxR && nc >= minC && nc <= maxC) {
        const target = grid[nr][nc];
        if (!target || target.color !== color) {
          result.push({ row: nr, col: nc });
        }
      }
    }
  } else {
    for (const [dr, dc] of dirs) {
      const nr = pos.row + dr, nc = pos.col + dc;
      if (inBoard(nr, nc)) {
        const target = grid[nr][nc];
        if (!target || target.color !== color) {
          result.push({ row: nr, col: nc });
        }
      }
    }
  }
  return result;
}

/** 象/相：田字走法。揭棋中翻开后可以过河 */
function getElephantMoves(pos: Position, grid: (Piece | null)[][], color: Color, canCrossRiver: boolean): Position[] {
  const result: Position[] = [];
  const steps: [number, number, number, number][] = [
    [2, 2, 1, 1], [2, -2, 1, -1], [-2, 2, -1, 1], [-2, -2, -1, -1],
  ];

  for (const [dr, dc, br, bc] of steps) {
    const nr = pos.row + dr, nc = pos.col + dc;

    // 检查是否过河
    if (!canCrossRiver) {
      const ownSide = color === Color.Red ? 'bottom' : 'top';
      if (ownSide === 'bottom' && nr < 5) continue; // 红象不能过河
      if (ownSide === 'top' && nr > 4) continue;    // 黑象不能过河
    }

    if (!inBoard(nr, nc)) continue;
    // 塞象眼
    const blockR = pos.row + br, blockC = pos.col + bc;
    if (grid[blockR][blockC]) continue;

    const target = grid[nr][nc];
    if (!target || target.color !== color) {
      result.push({ row: nr, col: nc });
    }
  }
  return result;
}

/** 马：日字走法 */
function getHorseMoves(pos: Position, grid: (Piece | null)[][], color: Color): Position[] {
  const result: Position[] = [];
  // [dr, dc, 蹩脚位置相对偏移]
  const steps: [number, number, number, number][] = [
    [-2, -1, -1, 0], [-2, 1, -1, 0],
    [2, -1, 1, 0], [2, 1, 1, 0],
    [-1, -2, 0, -1], [-1, 2, 0, 1],
    [1, -2, 0, -1], [1, 2, 0, 1],
  ];

  for (const [dr, dc, br, bc] of steps) {
    const nr = pos.row + dr, nc = pos.col + dc;
    if (!inBoard(nr, nc)) continue;
    // 蹩马脚
    if (grid[pos.row + br][pos.col + bc]) continue;

    const target = grid[nr][nc];
    if (!target || target.color !== color) {
      result.push({ row: nr, col: nc });
    }
  }
  return result;
}

/** 车：直线走任意步 */
function getChariotMoves(pos: Position, grid: (Piece | null)[][], color: Color): Position[] {
  return getSlidingMoves(pos, grid, color, [[0, 1], [0, -1], [1, 0], [-1, 0]]);
}

/** 炮：走子走直线，吃子需翻山 */
function getCannonMoves(pos: Position, grid: (Piece | null)[][], color: Color): Position[] {
  const result: Position[] = [];
  const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  for (const [dr, dc] of dirs) {
    let r = pos.row + dr, c = pos.col + dc;
    // 炮的走子：直线移动不翻山
    while (inBoard(r, c) && !grid[r][c]) {
      result.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
    // 找到第一个棋子（炮架）
    if (!inBoard(r, c)) continue;
    // 跳过炮架，继续找目标
    r += dr;
    c += dc;
    while (inBoard(r, c)) {
      if (grid[r][c]) {
        // 找到可以吃的敌方棋子
        if (grid[r][c]!.color !== color) {
          result.push({ row: r, col: c });
        }
        break; // 无论友军还是敌军，炮架后只能打第一个
      }
      r += dr;
      c += dc;
    }
  }
  return result;
}

/** 兵/卒 */
function getPawnMoves(pos: Position, grid: (Piece | null)[][], color: Color): Position[] {
  const result: Position[] = [];
  const forward = color === Color.Red ? -1 : 1;
  const hasCrossedRiver = color === Color.Red ? pos.row <= 4 : pos.row >= 5;

  // 向前
  const fr = pos.row + forward;
  const targetF = grid[fr]?.[pos.col];
  if (inBoard(fr, pos.col) && (!targetF || targetF.color !== color)) {
    result.push({ row: fr, col: pos.col });
  }

  // 过河后可以左右走
  if (hasCrossedRiver) {
    for (const dc of [-1, 1]) {
      const nc = pos.col + dc;
      const target = grid[pos.row]?.[nc];
      if (inBoard(pos.row, nc) && (!target || target.color !== color)) {
        result.push({ row: pos.row, col: nc });
      }
    }
  }
  return result;
}

/** 直线滑动走法辅助函数 */
function getSlidingMoves(
  pos: Position,
  grid: (Piece | null)[][],
  color: Color,
  dirs: [number, number][],
): Position[] {
  const result: Position[] = [];
  for (const [dr, dc] of dirs) {
    let r = pos.row + dr, c = pos.col + dc;
    while (inBoard(r, c)) {
      const target = grid[r][c];
      if (target) {
        if (target.color !== color) {
          result.push({ row: r, col: c });
        }
        break;
      }
      result.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
  }
  return result;
}

// ---- 将军检测 ----

/**
 * 飞将（将帅照面）检测：红黑将/帅在同一列、且中间无任何棋子时为非法局面。
 * 此时主动走入该局面的一方视为被"将"（可被对方"飞将"吃掉）。
 */
export function kingsFaceEachOther(grid: (Piece | null)[][]): boolean {
  const redKing = findKing(grid, Color.Red);
  const blackKing = findKing(grid, Color.Black);
  if (!redKing || !blackKing) return false;
  if (redKing.col !== blackKing.col) return false;

  const col = redKing.col;
  const minRow = Math.min(redKing.row, blackKing.row);
  const maxRow = Math.max(redKing.row, blackKing.row);
  for (let r = minRow + 1; r < maxRow; r++) {
    if (grid[r][col]) return false; // 中间有棋子阻隔
  }
  return true;
}

/** 判断指定颜色是否被将军 */
export function isInCheck(grid: (Piece | null)[][], color: Color): boolean {
  const kingPos = findKing(grid, color);
  if (!kingPos) return true; // 将/帅不在了，当成被将

  // 飞将规则：两将照面即视为被将
  if (kingsFaceEachOther(grid)) return true;

  const enemyColor = opponentColor(color);

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = grid[r][c];
      if (!piece || piece.color !== enemyColor) continue;
      const effType = getEffectiveType(piece, { row: r, col: c });
      const moves = getRawMoves(piece, effType, { row: r, col: c }, grid);
      if (moves.some(m => samePos(m, kingPos))) {
        return true;
      }
    }
  }
  return false;
}

/** 判断是否被将死（无合法着法） */
export function isCheckmate(state: BoardState): boolean {
  const allMoves = getAllLegalMoves(state);
  return allMoves.length === 0;
}

/** 获取当前轮到的一方所有合法着法 */
export function getAllLegalMoves(state: BoardState): { from: Position; to: Position }[] {
  const result: { from: Position; to: Position }[] = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const pos = { row: r, col: c };
      const moves = getLegalMoves(state, pos);
      for (const to of moves) {
        result.push({ from: pos, to });
      }
    }
  }
  return result;
}

// ---- 走子应用 ----

/** 在 grid 上执行一步棋（不改动原 grid，返回新 grid） */
export function applyMoveToGrid(
  grid: (Piece | null)[][],
  from: Position,
  to: Position,
  piece: Piece,
): (Piece | null)[][] {
  const newGrid = cloneGrid(grid);
  // 移除原位置
  newGrid[from.row][from.col] = null;

  // 如果暗子移动，翻开
  const movedPiece = { ...piece };
  if (movedPiece.hidden) {
    movedPiece.hidden = false;
  }

  newGrid[to.row][to.col] = movedPiece;
  return newGrid;
}

/** 执行完整的一步棋，返回新的 BoardState 和 Move 记录 */
export function executeMove(state: BoardState, from: Position, to: Position): { newState: BoardState; move: Move } | null {
  const piece = state.grid[from.row][from.col];
  if (!piece) return null;
  if (piece.color !== state.currentTurn) return null;

  const legalMoves = getLegalMoves(state, from);
  if (!legalMoves.some(m => samePos(m, to))) return null;

  const newState = cloneBoardState(state);
  const captured = newState.grid[to.row][to.col] ?? undefined;
  const wasHidden = piece.hidden;

  // 移除原位置
  newState.grid[from.row][from.col] = null;

  // 被吃子处理
  if (captured) {
    if (captured.color === Color.Red) {
      newState.redCaptured.push(captured);
    } else {
      newState.blackCaptured.push(captured);
    }
  }

  // 移动并翻开暗子
  const movedPiece: Piece = { ...piece, hidden: false };
  newState.grid[to.row][to.col] = movedPiece;

  // 切换回合
  newState.currentTurn = opponentColor(state.currentTurn);

  // 构建 Move 记录
  const moveRecord: Move = {
    from, to,
    piece: { ...piece },
    captured,
    revealed: wasHidden ? piece.type : undefined,
    notation: generateNotation(state.grid, from, to, piece),
  };

  // 检测将军/将死
  if (isInCheck(newState.grid, newState.currentTurn)) {
    moveRecord.isCheck = true;
    if (isCheckmate(newState)) {
      moveRecord.isCheckmate = true;
      newState.status = state.currentTurn === Color.Red ? GameStatus.RedWin : GameStatus.BlackWin;
    }
  }

  newState.moveHistory.push(moveRecord);
  return { newState, move: moveRecord };
}

/** 检查长将/长捉等违规着法（简化版：检查最近 6 回合） */
export function isPerpetualCheck(state: BoardState): boolean {
  const history = state.moveHistory;
  if (history.length < 6) return false;

  // 取最近方走的步（跳过当前轮到方）
  const myMoves = history.filter((_, i) => {
    return (history.length - i) % 2 === 1;
  }).slice(-4);

  if (myMoves.length < 4) return false;

  // 检查是否所有步都是将军
  return myMoves.every(m => m.isCheck);
}
