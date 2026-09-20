// ============================================================
// 揭棋 - AI 局面评估函数（精简高效版）
//   - 去掉机动性计算（太慢，拖累搜索深度）
//   - 保留子力 + PST + 国王安全 + 局面阶段
// ============================================================

import { Color, PieceType, type Piece, type Position } from '../engine/types';
import { findKing } from '../engine/board';

/** ---- 子力基础价值 ---- */
const PIECE_VALUE: Record<PieceType, number> = {
  [PieceType.King]: 10000,
  [PieceType.Chariot]: 900,
  [PieceType.Cannon]: 450,
  [PieceType.Horse]: 400,
  [PieceType.Elephant]: 200,
  [PieceType.Advisor]: 200,
  [PieceType.Pawn]: 100,
};

/** 每方初始暗子池（不含将/帅） */
const INITIAL_POOL: Record<PieceType, number> = {
  [PieceType.King]: 0,
  [PieceType.Chariot]: 2,
  [PieceType.Horse]: 2,
  [PieceType.Cannon]: 2,
  [PieceType.Elephant]: 2,
  [PieceType.Advisor]: 2,
  [PieceType.Pawn]: 5,
};

/**
 * 计算当前棋盘上暗子的超几何期望价值。
 * 根据已翻开/被吃的子推算剩余池中暗子的平均价值。
 * 随剩余池收缩动态变化（车已翻完时暗子期望值下降）。
 */
export function hiddenPieceValue(grid: (Piece | null)[][]): number {
  const remaining: Record<PieceType, number> = { ...INITIAL_POOL };

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = grid[r][c];
      if (p && !p.hidden && p.type !== PieceType.King) {
        remaining[p.type] = Math.max(0, remaining[p.type] - 1);
      }
    }
  }

  let totalVal = 0;
  let totalCount = 0;
  for (const t of [PieceType.Chariot, PieceType.Horse, PieceType.Cannon, PieceType.Elephant, PieceType.Advisor, PieceType.Pawn]) {
    const n = remaining[t];
    totalVal += n * PIECE_VALUE[t];
    totalCount += n;
  }

  return totalCount > 0 ? Math.round(totalVal / totalCount) : 320;
}

/** 默认暗子价值（无棋盘信息时的回退值） */
export const HIDDEN_PIECE_VALUE = 320;

// 兵/卒过河加成
const PAWN_CROSSED = 100;

/** ---- 位置价值表 (PST)，红方视角 row=0 为己方底线 ---- */

const PST_CHARIOT = [
  [14,14,12,18,16,18,12,14,14],
  [16,20,18,24,26,24,18,20,16],
  [12,12,12,18,18,18,12,12,12],
  [12,18,16,22,22,22,16,18,12],
  [12,14,12,18,18,18,12,14,12],
  [12,16,14,20,20,20,14,16,12],
  [ 6,10, 8,14,14,14, 8,10, 6],
  [ 4, 8, 6,14,12,14, 6, 8, 4],
  [ 8, 4, 8,16, 8,16, 8, 4, 8],
  [-2,10, 6,14,12,14, 6,10,-2],
];

const PST_HORSE = [
  [ 4, 8,16,12, 4,12,16, 8, 4],
  [ 4,10,28,16, 8,16,28,10, 4],
  [12,14,16,20,18,20,16,14,12],
  [ 8,24,18,24,20,24,18,24, 8],
  [ 6,16,14,18,16,18,14,16, 6],
  [ 4,12,16,14,12,14,16,12, 4],
  [ 2, 6, 8, 6,10, 6, 8, 6, 2],
  [ 4, 2, 8, 8, 4, 8, 8, 2, 4],
  [ 0, 2, 4, 4,-2, 4, 4, 2, 0],
  [ 0,-4, 0, 0, 0, 0, 0,-4, 0],
];

const PST_CANNON = [
  [ 6, 4, 0,-10,-12,-10, 0, 4, 6],
  [ 2, 2, 0, -4,-14, -4, 0, 2, 2],
  [ 2, 2, 0,-10, -8,-10, 0, 2, 2],
  [ 0, 0,-2,  4, 10,  4,-2, 0, 0],
  [ 0, 0, 0,  2,  8,  2, 0, 0, 0],
  [-2, 0, 4,  2,  6,  2, 4, 0,-2],
  [ 0, 0, 0,  2,  4,  2, 0, 0, 0],
  [ 4, 0, 8,  6, 10,  6, 8, 0, 4],
  [ 0, 2, 4,  6,  6,  6, 4, 2, 0],
  [ 0, 0, 2,  6,  6,  6, 2, 0, 0],
];

const PST_PAWN = [
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0,-2, 0, 4, 0,-2, 0, 0],
  [ 2, 0, 8, 0, 8, 0, 8, 0, 2],
  [ 6,12,18,18,20,18,18,12, 6],
  [10,20,30,34,40,34,30,20,10],
  [14,26,42,60,80,60,42,26,14],
  [18,36,56,80,120,80,56,36,18],
  [ 0, 3, 6, 9,12, 9, 6, 3, 0],
];

/** 获取 PST 位置加成 */
function pstAt(table: number[][], row: number, col: number, color: Color): number {
  const r = color === Color.Red ? (9 - row) : row;
  return table[r]?.[col] ?? 0;
}

/** 单枚棋子估值（子力 + 位置） */
function pieceEval(type: PieceType, row: number, col: number, color: Color): number {
  let val = PIECE_VALUE[type] ?? 0;
  switch (type) {
    case PieceType.Chariot: val += pstAt(PST_CHARIOT, row, col, color); break;
    case PieceType.Horse:   val += pstAt(PST_HORSE, row, col, color); break;
    case PieceType.Cannon:  val += pstAt(PST_CANNON, row, col, color); break;
    case PieceType.Pawn:
      val += pstAt(PST_PAWN, row, col, color);
      if (color === Color.Red ? row <= 4 : row >= 5) val += PAWN_CROSSED;
      break;
  }
  return val;
}

/**
 * 完整评估（用于主搜索）
 * 正数 = 红方优，负数 = 黑方优
 * 优化：单次扫描完成子力、暗子池、大子计数 + 机动性 + 兵型 + 开放线
 */
export function evaluateBoard(grid: (Piece | null)[][]): number {
  let material = 0;
  let redHidden = 0;
  let blackHidden = 0;
  let majors = 0;
  let redMobility = 0;
  let blackMobility = 0;
  let redOpenLines = 0;
  let blackOpenLines = 0;
  let redPawnStructure = 0;
  let blackPawnStructure = 0;

  // 已翻开非将棋子计数（用于暗子期望值计算）
  let nChariot = 0, nHorse = 0, nCannon = 0, nElephant = 0, nAdvisor = 0, nPawn = 0;

  // 单次扫描：子力 + 暗子统计 + 大子计数 + 机动性 + 兵型 + 开放线
  for (let r = 0; r < 10; r++) {
    const row = grid[r];
    for (let c = 0; c < 9; c++) {
      const p = row[c];
      if (!p) continue;

      if (p.hidden) {
        if (p.color === Color.Red) redHidden++; else blackHidden++;
      } else {
        const val = pieceEval(p.type, r, c, p.color);
        material += (p.color === Color.Red ? val : -val);

        // 统计已翻开棋子（暗子池计算）+ 大子计数
        switch (p.type) {
          case PieceType.Chariot: nChariot++; majors++; break;
          case PieceType.Horse:   nHorse++; majors++; break;
          case PieceType.Cannon:  nCannon++; majors++; break;
          case PieceType.Elephant: nElephant++; break;
          case PieceType.Advisor: nAdvisor++; break;
          case PieceType.Pawn:    nPawn++; break;
        }

        // 机动性：每个已翻开棋子的合法走法数（轻量计算）
        const moves = countPieceMoves(grid, r, c, p);
        if (p.color === Color.Red) redMobility += moves; else blackMobility += moves;

        // 车/炮开放线检测
        if (p.type === PieceType.Chariot || p.type === PieceType.Cannon) {
          const openLines = countOpenLines(grid, r, c, p.color);
          if (p.color === Color.Red) redOpenLines += openLines; else blackOpenLines += openLines;
        }

        // 兵型评估
        if (p.type === PieceType.Pawn) {
          const pawnScore = evaluatePawnStructure(grid, r, c, p.color);
          if (p.color === Color.Red) redPawnStructure += pawnScore; else blackPawnStructure += pawnScore;
        }
      }
    }
  }

  // 暗子期望值（基于剩余池）
  const rChariot = Math.max(0, 2 - nChariot);
  const rHorse = Math.max(0, 2 - nHorse);
  const rCannon = Math.max(0, 2 - nCannon);
  const rElephant = Math.max(0, 2 - nElephant);
  const rAdvisor = Math.max(0, 2 - nAdvisor);
  const rPawn = Math.max(0, 5 - nPawn);

  const totalCount = rChariot + rHorse + rCannon + rElephant + rAdvisor + rPawn;
  const hiddenVal = totalCount > 0
    ? Math.round((rChariot * PIECE_VALUE[PieceType.Chariot] +
                  rHorse * PIECE_VALUE[PieceType.Horse] +
                  rCannon * PIECE_VALUE[PieceType.Cannon] +
                  rElephant * PIECE_VALUE[PieceType.Elephant] +
                  rAdvisor * PIECE_VALUE[PieceType.Advisor] +
                  rPawn * PIECE_VALUE[PieceType.Pawn]) / totalCount)
    : 320;

  // 加上暗子的贡献
  material += hiddenVal * (redHidden - blackHidden);

  // 国王安全（便宜）
  const redKing = findKing(grid, Color.Red);
  const blackKing = findKing(grid, Color.Black);
  if (!redKing || !blackKing) {
    return !redKing ? -100000 : 100000;
  }

  const redSafety = kingSafety(grid, redKing, Color.Red);
  const blackSafety = kingSafety(grid, blackKing, Color.Black);

  const phaseFactor = Math.min(1, majors / 8); // 0(残局) ~ 1(开局)

  // 综合评估：子力 + 国王安全 + 机动性 + 开放线 + 兵型
  const mobilityBonus = (redMobility - blackMobility) * 2;
  const openLineBonus = (redOpenLines - blackOpenLines) * 30;
  const pawnBonus = (redPawnStructure - blackPawnStructure) * 10;

  return material + (redSafety - blackSafety) * phaseFactor + mobilityBonus + openLineBonus + pawnBonus;
}

/** 轻量机动性：计算单个棋子的合法走法数（不生成完整着法列表） */
function countPieceMoves(grid: (Piece | null)[][], row: number, col: number, piece: Piece): number {
  let count = 0;
  const { type, color } = piece;

  if (type === PieceType.Chariot) {
    // 车：四个方向
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      while (r >= 0 && r <= 9 && c >= 0 && c <= 8) {
        const p = grid[r][c];
        if (!p) count++;
        else { if (p.color !== color) count++; break; }
        r += dr; c += dc;
      }
    }
  } else if (type === PieceType.Horse) {
    // 马：8个位置
    const horseMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    const horseBlocks = [[-1,0],[-1,0],[0,-1],[0,1],[0,-1],[0,1],[1,0],[1,0]];
    for (let i = 0; i < 8; i++) {
      const nr = row + horseMoves[i][0], nc = col + horseMoves[i][1];
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
      const br = row + horseBlocks[i][0], bc = col + horseBlocks[i][1];
      if (grid[br]?.[bc]) continue; // 蹩马腿
      const p = grid[nr][nc];
      if (!p || p.color !== color) count++;
    }
  } else if (type === PieceType.Cannon) {
    // 炮：四个方向，需要炮架
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      let jumped = false;
      while (r >= 0 && r <= 9 && c >= 0 && c <= 8) {
        const p = grid[r][c];
        if (!jumped) {
          if (!p) count++;
          else jumped = true;
        } else {
          if (p) { if (p.color !== color) count++; break; }
        }
        r += dr; c += dc;
      }
    }
  } else if (type === PieceType.Elephant) {
    // 象：4个位置
    const elephantMoves = [[-2,-2],[-2,2],[2,-2],[2,2]];
    const elephantBlocks = [[-1,-1],[-1,1],[1,-1],[1,1]];
    for (let i = 0; i < 4; i++) {
      const nr = row + elephantMoves[i][0], nc = col + elephantMoves[i][1];
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
      const br = row + elephantBlocks[i][0], bc = col + elephantBlocks[i][1];
      if (grid[br]?.[bc]) continue; // 塞象眼
      const p = grid[nr][nc];
      if (!p || p.color !== color) count++;
    }
  } else if (type === PieceType.Advisor) {
    // 士：4个位置
    const advisorMoves = [[-1,-1],[-1,1],[1,-1],[1,1]];
    for (const [dr, dc] of advisorMoves) {
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
      // 士必须在九宫格内
      if (color === Color.Red && (nr < 7 || nc < 3 || nc > 5)) continue;
      if (color === Color.Black && (nr > 2 || nc < 3 || nc > 5)) continue;
      const p = grid[nr][nc];
      if (!p || p.color !== color) count++;
    }
  } else if (type === PieceType.Pawn) {
    // 兵/卒
    const forward = color === Color.Red ? -1 : 1;
    const nr = row + forward;
    if (nr >= 0 && nr <= 9) {
      const p = grid[nr][col];
      if (!p || p.color !== color) count++;
    }
    // 过河后可以横走
    const crossed = color === Color.Red ? row <= 4 : row >= 5;
    if (crossed) {
      for (const dc of [-1, 1]) {
        const nc = col + dc;
        if (nc < 0 || nc > 8) continue;
        const p = grid[row][nc];
        if (!p || p.color !== color) count++;
      }
    }
  } else if (type === PieceType.King) {
    // 将/帅：4个位置
    const kingMoves = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of kingMoves) {
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
      // 将帅必须在九宫格内
      if (color === Color.Red && (nr < 7 || nc < 3 || nc > 5)) continue;
      if (color === Color.Black && (nr > 2 || nc < 3 || nc > 5)) continue;
      const p = grid[nr][nc];
      if (!p || p.color !== color) count++;
    }
  }

  return count;
}

/** 开放线检测：车/炮在列方向上无遮挡的线数 */
function countOpenLines(grid: (Piece | null)[][], row: number, col: number, color: Color): number {
  let open = 0;
  // 检查列方向（上下）
  for (const dir of [-1, 1]) {
    let r = row + dir;
    let blocked = false;
    while (r >= 0 && r <= 9 && !blocked) {
      const p = grid[r][col];
      if (p) blocked = true;
      r += dir;
    }
    if (!blocked) open++;
  }
  // 检查行方向（左右）
  for (const dir of [-1, 1]) {
    let c = col + dir;
    let blocked = false;
    while (c >= 0 && c <= 8 && !blocked) {
      const p = grid[row][c];
      if (p) blocked = true;
      c += dir;
    }
    if (!blocked) open++;
  }
  return open;
}

/** 兵型评估：叠兵惩罚 + 通路兵奖励 */
function evaluatePawnStructure(grid: (Piece | null)[][], row: number, col: number, color: Color): number {
  let score = 0;

  // 叠兵检测：同一列上是否有多个己方兵
  let sameColPawns = 0;
  for (let r = 0; r < 10; r++) {
    const p = grid[r][col];
    if (p && !p.hidden && p.type === PieceType.Pawn && p.color === color) {
      sameColPawns++;
    }
  }
  if (sameColPawns > 1) score -= 20 * (sameColPawns - 1); // 叠兵惩罚

  // 通路兵检测：前方无敌方兵阻挡
  const forward = color === Color.Red ? -1 : 1;
  let r = row + forward;
  let blocked = false;
  while (r >= 0 && r <= 9 && !blocked) {
    const p = grid[r][col];
    if (p && p.color !== color && p.type === PieceType.Pawn) blocked = true;
    r += forward;
  }
  if (!blocked) score += 30; // 通路兵奖励

  return score;
}

/** 国王安全：护卫 + 暴露惩罚 */
function kingSafety(grid: (Piece | null)[][], pos: Position, color: Color): number {
  let score = 0;
  const { row, col } = pos;

  // 1. 周围护卫奖励
  const guardOffsets: [number, number][] = [
    [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1],
  ];
  for (const [dr, dc] of guardOffsets) {
    const nr = row + dr, nc = col + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    const p = grid[nr]?.[nc];
    if (p && p.color === color && !p.hidden &&
        (p.type === PieceType.Advisor || p.type === PieceType.Elephant)) {
      score += 15;
    }
  }

  // 2. 露出九宫格外惩罚
  const [minR, maxR] = color === Color.Red ? [7, 9] : [0, 2];
  if (row < minR || row > maxR || col < 3 || col > 5) {
    score -= 40;
  }

  // 3. 正面敌方子力威胁
  const dir = color === Color.Red ? -1 : 1;
  let r = row + dir;
  let block = 0;
  while (r >= 0 && r <= 9) {
    const p = grid[r]?.[col];
    if (p) {
      if (p.color !== color && !p.hidden) {
        if ((p.type === PieceType.Chariot && block === 0) ||
            (p.type === PieceType.Cannon && block === 1)) {
          score -= 50;
        }
      }
      block++;
    }
    r += dir;
  }

  return score;
}

/** 子力简单值（用于 MVV-LVA） */
export function getPieceValueSimple(type: PieceType): number {
  return PIECE_VALUE[type] ?? 0;
}

export { PIECE_VALUE as PIECE_VALUES };
