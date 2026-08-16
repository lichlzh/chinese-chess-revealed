// ============================================================
// 揭棋 - 中文记谱法（纵线记谱法）
//   红方：从己方右侧向左数 1-9 路；黑方：同理
//   格式：棋子名 + 所在路数(或前/后) + 方向(进/退/平) + 目标
// ============================================================

import { Color, PieceType, type Piece, type Position } from './types';
import { getPositionIdentity } from './board';

/** 记谱用棋子名（红/黑区分） */
const NOTATION_NAMES: Record<Color, Record<PieceType, string>> = {
  [Color.Red]: {
    [PieceType.King]: '帅', [PieceType.Advisor]: '仕', [PieceType.Elephant]: '相',
    [PieceType.Horse]: '马', [PieceType.Chariot]: '车', [PieceType.Cannon]: '炮', [PieceType.Pawn]: '兵',
  },
  [Color.Black]: {
    [PieceType.King]: '将', [PieceType.Advisor]: '士', [PieceType.Elephant]: '象',
    [PieceType.Horse]: '马', [PieceType.Chariot]: '车', [PieceType.Cannon]: '砲', [PieceType.Pawn]: '卒',
  },
};

/** 直线走子（进/退用步数；平用目标路数） */
function isStraightMover(type: PieceType): boolean {
  return type === PieceType.Chariot || type === PieceType.Cannon ||
         type === PieceType.Pawn || type === PieceType.King;
}

/** 列 → 路数（红:9-col, 黑:col+1） */
function fileNumber(col: number, color: Color): number {
  return color === Color.Red ? 9 - col : col + 1;
}

/** 收集同一列、同色、同类型的棋子，按"前→后"排序 */
function collectSameFile(
  grid: (Piece | null)[][],
  col: number,
  color: Color,
  type: PieceType,
): Position[] {
  const list: Position[] = [];
  for (let r = 0; r < 10; r++) {
    const p = grid[r][col];
    if (p && p.color === color && p.type === type) {
      list.push({ row: r, col });
    }
  }
  // 前 = 靠近敌方。红方前=row 小；黑方前=row 大
  list.sort((a, b) => color === Color.Red ? a.row - b.row : b.row - a.row);
  return list;
}

/**
 * 生成一步棋的中文记谱
 * @param prevGrid 走子前的棋盘（用于判定同列同子、路数）
 * @param from 起点
 * @param to 终点
 * @param piece 走动的棋子（隐藏子则取真实类型）
 */
export function generateNotation(
  prevGrid: (Piece | null)[][],
  from: Position,
  to: Position,
  piece: Piece,
): string {
  const color = piece.color;
  // 暗子（未翻开）按「位置身份」记谱：既与走法一致，又不泄露真实兵种；
  // 翻开后才用真实类型。揭棋标准记法：暗子走子时显示的是位置身份。
  const nominalType = piece.hidden
    ? (getPositionIdentity(from) ?? piece.type)
    : piece.type;
  const name = NOTATION_NAMES[color][nominalType];

  // 同列同色同型棋子（用于前/后区分）
  const sameFile = collectSameFile(prevGrid, from.col, color, nominalType);
  let label: string;
  if (piece.hidden) {
    // 暗子按位置身份记谱：同一列同一位置身份至多一枚，直接用路数
    label = String(fileNumber(from.col, color));
  } else if (sameFile.length === 1) {
    label = String(fileNumber(from.col, color));
  } else {
    const idx = sameFile.findIndex(p => p.row === from.row);
    if (sameFile.length === 2) {
      label = idx === 0 ? '前' : '后';
    } else {
      // 3 个及以上：前/中/后
      const pos = ['前', '中', '后', '四', '五'];
      label = pos[Math.min(idx, pos.length - 1)] ?? '前';
    }
  }

  // 方向（红前进 row 减；黑前进 row 增）
  const forwardDir = color === Color.Red ? -1 : 1;
  let direction: '进' | '退' | '平';
  if (to.row === from.row) direction = '平';
  else if ((to.row - from.row) * forwardDir > 0) direction = '进';
  else direction = '退';

  // 第四字
  let fourth: string;
  if (direction === '平') {
    fourth = String(fileNumber(to.col, color));
  } else if (isStraightMover(nominalType)) {
    fourth = String(Math.abs(to.row - from.row)); // 步数
  } else {
    fourth = String(fileNumber(to.col, color));     // 斜线子：目标路数
  }

  return `${name}${label}${direction}${fourth}`;
}
