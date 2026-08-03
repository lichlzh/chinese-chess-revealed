import { describe, it, expect } from 'vitest';
import { Color, PieceType, POSITION_IDENTITY } from './types';
import {
  initBoard,
  createPiece,
  findKing,
  getEffectiveType,
  getPositionIdentity,
  opponentColor,
  cloneBoardState,
  cloneGrid,
  isCapturedRevealed,
} from './board';

function emptyGrid(): any {
  return Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null));
}

describe('initBoard - 开局', () => {
  const b = initBoard();
  it('棋盘为 10 行 9 列', () => {
    expect(b.grid.length).toBe(10);
    expect(b.grid[0].length).toBe(9);
  });
  it('红方先手', () => {
    expect(b.currentTurn).toBe(Color.Red);
  });
  it('双方各 16 子、各 15 暗子', () => {
    let red = 0, black = 0, redHidden = 0, blackHidden = 0;
    for (const row of b.grid) {
      for (const p of row) {
        if (!p) continue;
        if (p.color === Color.Red) { red++; if (p.hidden) redHidden++; }
        else { black++; if (p.hidden) blackHidden++; }
      }
    }
    expect(red).toBe(16);
    expect(black).toBe(16);
    expect(redHidden).toBe(15);
    expect(blackHidden).toBe(15);
  });
  it('双方将/帅就位', () => {
    expect(b.grid[0][4]?.type).toBe(PieceType.King);
    expect(b.grid[9][4]?.type).toBe(PieceType.King);
  });
});

describe('createPiece - 建子', () => {
  it('正确设置类型与明暗', () => {
    const p = createPiece(PieceType.Horse, Color.Red, true);
    expect(p.type).toBe(PieceType.Horse);
    expect(p.color).toBe(Color.Red);
    expect(p.hidden).toBe(true);
  });
  it('id 全局唯一', () => {
    const a = createPiece(PieceType.Chariot, Color.Red, false);
    const bPiece = createPiece(PieceType.Chariot, Color.Red, false);
    expect(a.id).not.toBe(bPiece.id);
  });
});

describe('findKing - 找将/帅', () => {
  it('找到指定方的王', () => {
    const g = emptyGrid();
    g[0][4] = createPiece(PieceType.King, Color.Black, false);
    g[9][4] = createPiece(PieceType.King, Color.Red, false);
    expect(findKing(g, Color.Black)).toEqual({ row: 0, col: 4 });
    expect(findKing(g, Color.Red)).toEqual({ row: 9, col: 4 });
  });
  it('缺王时返回 null', () => {
    const g = emptyGrid();
    expect(findKing(g, Color.Red)).toBeNull();
  });
});

describe('getPositionIdentity / getEffectiveType - 暗子身份', () => {
  it('九宫暗子位置映射到真实身份', () => {
    expect(getPositionIdentity({ row: 0, col: 0 })).toBe(PieceType.Chariot);
    expect(getPositionIdentity({ row: 0, col: 1 })).toBe(PieceType.Horse);
    expect(getPositionIdentity({ row: 4, col: 4 })).toBeUndefined();
  });
  it('暗子返回位置身份，明子返回自身类型', () => {
    const hidden = createPiece(PieceType.Horse, Color.Red, true);
    // (9,0) 处暗子身份为车
    expect(getEffectiveType(hidden, { row: 9, col: 0 })).toBe(PieceType.Chariot);
    const revealed = createPiece(PieceType.Horse, Color.Red, false);
    expect(getEffectiveType(revealed, { row: 0, col: 0 })).toBe(PieceType.Horse);
  });
  it('暗子位置身份表大小为 32（每方 16 子）', () => {
    expect(Object.keys(POSITION_IDENTITY).length).toBe(32);
  });
});

describe('opponentColor - 换色', () => {
  it('红↔黑互换', () => {
    expect(opponentColor(Color.Red)).toBe(Color.Black);
    expect(opponentColor(Color.Black)).toBe(Color.Red);
  });
});

describe('cloneBoardState / cloneGrid - 深拷贝', () => {
  it('克隆与原始互不污染', () => {
    const b = initBoard();
    const c = cloneBoardState(b);
    c.grid[4][4] = createPiece(PieceType.King, Color.Red, false);
    expect(b.grid[4][4]).toBeNull();
  });
  it('cloneGrid 复制单元引用独立', () => {
    const g = emptyGrid();
    g[0][0] = createPiece(PieceType.King, Color.Red, false);
    const c = cloneGrid(g);
    c[0][0] = null;
    expect(g[0][0]).not.toBeNull();
  });
});

describe('initBoard - 暗子身份随机性（出车概率校验）', () => {
  it('各兵种在全部暗子位置上近似服从 15 子构成比例，无整体偏向', () => {
    const N = 4000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const b = initBoard();
      for (const row of b.grid) {
        for (const p of row) {
          if (p && p.hidden) counts[p.type] = (counts[p.type] ?? 0) + 1;
        }
      }
    }
    const total = Object.values(counts).reduce((a, x) => a + x, 0);
    const expected: Record<string, number> = {
      [PieceType.Chariot]: 2 / 15,
      [PieceType.Horse]: 2 / 15,
      [PieceType.Cannon]: 2 / 15,
      [PieceType.Elephant]: 2 / 15,
      [PieceType.Advisor]: 2 / 15,
      [PieceType.Pawn]: 5 / 15,
    };
    for (const t of Object.keys(expected) as PieceType[]) {
      const prop = (counts[t] ?? 0) / total;
      expect(Math.abs(prop - expected[t])).toBeLessThan(0.02);
    }
    // 特别强调：车的真实比例 ≈ 2/15，而非偏高
    expect(Math.abs((counts[PieceType.Chariot] ?? 0) / total - 2 / 15)).toBeLessThan(0.02);
  });

  it('特定位置（(9,0)）的车概率 ≈ 2/15，与各位置一致（无位置偏向）', () => {
    const N = 4000;
    let chariot = 0, total = 0;
    for (let i = 0; i < N; i++) {
      const b = initBoard();
      const p = b.grid[9][0];
      if (p && p.hidden) { total++; if (p.type === PieceType.Chariot) chariot++; }
    }
    expect(total).toBe(N); // 该位置恒为暗子
    expect(Math.abs(chariot / total - 2 / 15)).toBeLessThan(0.02);
  });
});

describe('isCapturedRevealed - 被吃暗子身份保密', () => {
  it('暗子在进行中保密、终局揭晓', () => {
    const hidden = createPiece(PieceType.Chariot, Color.Black, true);
    expect(isCapturedRevealed(hidden, false)).toBe(false); // 进行中隐藏
    expect(isCapturedRevealed(hidden, true)).toBe(true);   // 终局揭晓
  });
  it('已翻明的子无论是否终局都展示', () => {
    const revealed = createPiece(PieceType.Horse, Color.Red, false);
    expect(isCapturedRevealed(revealed, false)).toBe(true);
    expect(isCapturedRevealed(revealed, true)).toBe(true);
  });
});
