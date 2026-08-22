// ============================================================
// 揭棋 - 走子规则（合法性判定 + 走子生成）
// ============================================================

import {
  Color, PieceType, Piece, Position, Move, BoardState, GameStatus,
  samePos,
} from './types';
import {
  inBoard, getEffectiveType, opponentColor, findKing,
  cloneGrid, cloneBoardState,
} from './board';
import { generateNotation } from './notation';
import {
  REPETITION_LIMIT, positionKey, countRepetition, adjudicateRepetition,
} from './repetition';

export type { BoardState };
export { REPETITION_LIMIT };

// 棋规常量
export const PERPETUAL_CHECK_LIMIT = 6;   // 连续将军达此次数直接判"长将"负（重复局面检测的兜底）
export const NO_CAPTURE_DRAW_PLIES = 60;  // 连续无吃子半回合数达此值判和（=30 回合）
/** 获取某位置棋子在指定局面下的所有合法目标位置 */
export function getLegalMoves(state: BoardState, pos: Position): Position[] {
  const piece = state.grid[pos.row][pos.col];
  if (!piece) return [];
  if (piece.color !== state.currentTurn) return [];

    const effectiveType = getEffectiveType(piece, pos);

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

// ---- 「捉」的判定（用于长捉裁决） ----

/** 捉子判定用的粗略子力价值 */
const CHASE_VALUE: Record<PieceType, number> = {
  [PieceType.King]: 10000,
  [PieceType.Chariot]: 900,
  [PieceType.Cannon]: 450,
  [PieceType.Horse]: 400,
  [PieceType.Elephant]: 200,
  [PieceType.Advisor]: 200,
  [PieceType.Pawn]: 100,
};
/**
 * 暗子真实身份未知：其期望价值 = 同色未翻暗子的平均真实价值
 * （贝叶斯近似——你不知道它是谁，但知道"剩下的暗子里有哪些"）。
 * HIDDEN_CHASE_VALUE 仅在所有暗子都已翻开时的退化默认值。
 */
const HIDDEN_CHASE_VALUE = 300;

function chaseWorth(piece: Piece, pos: Position, avgHidden: Record<Color, number>): number {
  if (piece.hidden) return avgHidden[piece.color];
  if (piece.type === PieceType.Pawn) {
    const crossed = piece.color === Color.Red ? pos.row <= 4 : pos.row >= 5;
    return crossed ? 200 : 100;
  }
  return CHASE_VALUE[piece.type];
}

/** 判断某枚棋子是否受本方保护（有同色子能"吃回"该格） */
function isDefended(grid: (Piece | null)[][], pos: Position, victimColor: Color): boolean {
  const g = cloneGrid(grid);
  const victim = g[pos.row][pos.col];
  if (!victim) return false;
  // 把目标临时染成敌色，这样同色子生成走法时才会把该格视为可吃
  g[pos.row][pos.col] = { ...victim, color: opponentColor(victimColor) };

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (r === pos.row && c === pos.col) continue;
      const p = g[r][c];
      if (!p || p.color !== victimColor) continue;
      const eff = getEffectiveType(p, { row: r, col: c });
      if (getRawMoves(p, eff, { row: r, col: c }, g).some(m => samePos(m, pos))) return true;
    }
  }
  return false;
}

/**
 * 计算 `attacker` 一方当前"捉"住的对方棋子 id 列表。
 *
 * 采用简化但贴近棋规的判据：
 * - 攻击方能真实吃掉该子（走后本方不被将）
 * - 目标不是将/帅（那是"将"不是"捉"）
 * - 目标不是未过河的兵/卒（棋规视为"闲"）
 * - 攻击子不是帅/将或兵/卒（棋规视为"闲"）
 * - 目标无保护，或目标价值高于攻击子（否则属于"兑"，算闲）
 */
export function computeChases(state: BoardState, attacker: Color): number[] {
  const grid = state.grid;
  const defendedCache = new Map<string, boolean>();
  const chased = new Set<number>();

  // 暗子期望价值：同色未翻暗子的平均真实价值（贝叶斯近似）
  const avgHidden: Record<Color, number> = {
    [Color.Red]: HIDDEN_CHASE_VALUE,
    [Color.Black]: HIDDEN_CHASE_VALUE,
  };
  {
    const sum: Record<Color, { v: number; n: number }> = {
      [Color.Red]: { v: 0, n: 0 },
      [Color.Black]: { v: 0, n: 0 },
    };
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = grid[r][c];
        if (p && p.hidden) { sum[p.color].v += CHASE_VALUE[p.type]; sum[p.color].n++; }
      }
    }
    if (sum[Color.Red].n > 0) avgHidden[Color.Red] = sum[Color.Red].v / sum[Color.Red].n;
    if (sum[Color.Black].n > 0) avgHidden[Color.Black] = sum[Color.Black].v / sum[Color.Black].n;
  }

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = grid[r][c];
      if (!p || p.color !== attacker) continue;

      const from = { row: r, col: c };
      const eff = getEffectiveType(p, from);
      // 帅/将、兵/卒 捉子按棋规算"闲"
      if (eff === PieceType.King || eff === PieceType.Pawn) continue;

      for (const to of getRawMoves(p, eff, from, grid)) {
        const victim = grid[to.row][to.col];
        if (!victim || victim.color === attacker) continue;
        if (chased.has(victim.id)) continue;

        const victimEff = getEffectiveType(victim, to);
        if (victimEff === PieceType.King) continue;         // 将军不算捉
        if (victimEff === PieceType.Pawn) {                 // 捉未过河兵算闲
          const crossed = victim.color === Color.Red ? to.row <= 4 : to.row >= 5;
          if (!crossed) continue;
        }
        // 必须能真的吃掉（走后本方不被将）
        if (isInCheck(applyMoveToGrid(grid, from, to, p), attacker)) continue;

        const key = `${to.row},${to.col}`;
        let defended = defendedCache.get(key);
        if (defended === undefined) {
          defended = isDefended(grid, to, victim.color);
          defendedCache.set(key, defended);
        }
        // 有根且不占便宜 → 属于"兑"，算闲
        if (defended && chaseWorth(victim, to, avgHidden) <= chaseWorth(p, from, avgHidden)) continue;

        chased.add(victim.id);
      }
    }
  }
  return [...chased];
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

  // 连续无吃子计数（用于判和）
  newState.movesWithoutCapture = captured ? 0 : state.movesWithoutCapture + 1;

  // 检测将军 / 将死 / 困毙（轮到走棋的一方无合法着法即判负）
  const opponentInCheck = isInCheck(newState.grid, newState.currentTurn);
  if (opponentInCheck) moveRecord.isCheck = true;

  // 局面指纹 + 捉子信息（吃子/翻子不可逆，不参与循环判定，可跳过）
  moveRecord.posKeyAfter = positionKey(newState.grid, newState.currentTurn);
  if (!captured && !wasHidden) {
    moveRecord.chases = computeChases(newState, state.currentTurn);
  }

  // 先入历史，后续裁决依赖完整历史
  newState.moveHistory.push(moveRecord);

  if (isCheckmate(newState)) {
    moveRecord.isCheckmate = opponentInCheck;
    // state.currentTurn 是「刚走子将死对方」的一方，即胜者
    newState.status = state.currentTurn === Color.Red ? GameStatus.RedWin : GameStatus.BlackWin;
    newState.endReason = opponentInCheck ? '将死' : '困毙';
  }

  // 三次重复局面裁决：区分长将 / 长捉 / 和棋
  if (newState.status === GameStatus.Playing && countRepetition(newState.moveHistory) >= REPETITION_LIMIT) {
    const verdict = adjudicateRepetition(newState.moveHistory);
    if (verdict.loser) {
      newState.status = verdict.loser === Color.Red ? GameStatus.BlackWin : GameStatus.RedWin;
    } else {
      newState.status = GameStatus.Draw;
    }
    newState.endReason = verdict.reason;
  }

  // 兜底：连续将军过多（对方每次都有不同应招、未形成重复局面）
  if (newState.status === GameStatus.Playing) {
    const longChecker = checkPerpetualCheck(newState);
    if (longChecker) {
      newState.status = longChecker === Color.Red ? GameStatus.BlackWin : GameStatus.RedWin;
      newState.endReason = '长将判负';
    }
  }

  // 长时间无吃子判和
  if (newState.status === GameStatus.Playing && newState.movesWithoutCapture >= NO_CAPTURE_DRAW_PLIES) {
    newState.status = GameStatus.Draw;
    newState.endReason = '长时间无吃子，和棋';
  }

  return { newState, move: moveRecord };
}

/**
 * 悔棋：撤销最近的一步（或两步，取决于 mode），返回新的 BoardState。
 * - steps=1：撤销一步（PvP 模式）
 * - steps=2：撤销两步（PvAI 模式，撤销 AI 的着法 + 玩家的着法）
 * 如果历史记录不足 steps 步，则撤销所有可用步数。
 */
export function undoMove(state: BoardState, steps: number): BoardState {
  const newBoard = cloneBoardState(state);

  for (let i = 0; i < steps; i++) {
    const lastMove = newBoard.moveHistory[newBoard.moveHistory.length - 1];
    if (!lastMove) break;

    newBoard.moveHistory = newBoard.moveHistory.slice(0, -1);

    // 恢复到起始位置（piece 保存的是走子前的状态，含 hidden）
    const movedPiece = lastMove.piece;
    newBoard.grid[lastMove.from.row][lastMove.from.col] = movedPiece;

    // 恢复被吃子 / 清空目标格
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

  // 重建连续无吃子计数
  let noCapture = 0;
  for (let i = newBoard.moveHistory.length - 1; i >= 0; i--) {
    if (newBoard.moveHistory[i].captured) break;
    noCapture++;
  }
  newBoard.movesWithoutCapture = noCapture;
  newBoard.endReason = undefined;
  newBoard.status = GameStatus.Playing;

  return newBoard;
}

/**
 * 兜底的"长将"检测：同一方连续将军达 PERPETUAL_CHECK_LIMIT 次即判该方负。
 * 正常的长将由重复局面裁决处理，这里只覆盖"对方每次应招不同、迟迟不形成
 * 重复局面"的情况，因此阈值取得较宽，避免误伤正常的连续将军杀法。
 */
export function checkPerpetualCheck(state: BoardState): Color | null {
  const h = state.moveHistory;
  if (h.length < PERPETUAL_CHECK_LIMIT) return null;

  const last = h[h.length - 1];
  if (!last.isCheck) return null; // 必须当前正在将军
  const checker = last.piece.color;

  let count = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i];
    if (m.piece.color !== checker) continue; // 跳过对方着法
    if (m.isCheck) count++;
    else break;                              // 该方出现非将军着法，长将中断
    if (count >= PERPETUAL_CHECK_LIMIT) return checker;
  }
  return null;
}
