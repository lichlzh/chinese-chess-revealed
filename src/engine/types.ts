// ============================================================
// 揭棋 (JieQi) - 核心类型定义
// ============================================================

/** 棋子颜色 */
export enum Color {
  Red = 'red',
  Black = 'black',
}

/** 棋子类型 */
export enum PieceType {
  King = 'king',       // 将/帅
  Advisor = 'advisor', // 士/仕
  Elephant = 'elephant', // 象/相
  Horse = 'horse',     // 马
  Chariot = 'chariot', // 车/車
  Cannon = 'cannon',   // 炮
  Pawn = 'pawn',       // 兵/卒
}

/** 棋子 */
export interface Piece {
  id: number;
  type: PieceType;
  color: Color;
  hidden: boolean; // true = 暗子（未翻开）
}

/** 棋盘坐标：row(0-9), col(0-8)。row=0 为黑方底线，row=9 为红方底线 */
export interface Position {
  row: number;
  col: number;
}

/** 一步棋的完整记录 */
export interface Move {
  from: Position;
  to: Position;
  piece: Piece;
  captured?: Piece;        // 被吃的子（如果有）
  revealed?: PieceType;    // 暗子翻开后的真实类型
  isCheck?: boolean;       // 走后是否将军
  isCheckmate?: boolean;   // 走后是否将死
  notation?: string;       // 中文记谱
  /** 走完这步后的局面指纹（用于重复局面检测） */
  posKeyAfter?: string;
  /** 走完这步后，本方"捉住"的对方棋子 id 列表（用于长捉判定） */
  chases?: number[];
}

/** 游戏状态 */
export enum GameStatus {
  NotStarted = 'not_started',
  Playing = 'playing',
  RedWin = 'red_win',
  BlackWin = 'black_win',
  Draw = 'draw',
}

/** 游戏模式 */
export enum GameMode {
  PvP = 'pvp',       // 本地双人
  PvAI = 'pvai',     // 人机对战
}

/** 棋盘状态（用于快照/历史） */
export interface BoardState {
  grid: (Piece | null)[][];   // grid[row][col]
  currentTurn: Color;
  status: GameStatus;
  moveHistory: Move[];
  redCaptured: Piece[];       // 红方被吃的子
  blackCaptured: Piece[];     // 黑方被吃的子
  /** 连续无吃子的半回合数（用于判和，2 = 1 回合） */
  movesWithoutCapture: number;
  /** 终局原因（长将判负 / 无吃子和棋 / 将死 等），仅终局时填充 */
  endReason?: string;
}

/** 初始布局中每个位置的"位置身份"（用于暗子第一步走法判定） */
export const POSITION_IDENTITY: Record<string, PieceType> = {
  // 黑方（row 0-4）
  '0,0': PieceType.Chariot,  '0,1': PieceType.Horse, '0,2': PieceType.Elephant,
  '0,3': PieceType.Advisor,  '0,4': PieceType.King,  '0,5': PieceType.Advisor,
  '0,6': PieceType.Elephant, '0,7': PieceType.Horse,  '0,8': PieceType.Chariot,
  '2,1': PieceType.Cannon,   '2,7': PieceType.Cannon,
  '3,0': PieceType.Pawn, '3,2': PieceType.Pawn, '3,4': PieceType.Pawn,
  '3,6': PieceType.Pawn, '3,8': PieceType.Pawn,
  // 红方（row 5-9）
  '6,0': PieceType.Pawn, '6,2': PieceType.Pawn, '6,4': PieceType.Pawn,
  '6,6': PieceType.Pawn, '6,8': PieceType.Pawn,
  '7,1': PieceType.Cannon,   '7,7': PieceType.Cannon,
  '9,0': PieceType.Chariot,  '9,1': PieceType.Horse, '9,2': PieceType.Elephant,
  '9,3': PieceType.Advisor,  '9,4': PieceType.King,  '9,5': PieceType.Advisor,
  '9,6': PieceType.Elephant, '9,7': PieceType.Horse,  '9,8': PieceType.Chariot,
};

export function posKey(row: number, col: number): string {
  return `${row},${col}`;
}

export function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}
