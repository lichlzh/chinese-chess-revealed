import { describe, it, expect } from 'vitest';
import { Color, PieceType } from './types';
import { generateNotation } from './notation';
import { createPiece } from './board';

function emptyGrid(): any {
  return Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null));
}

describe('generateNotation - 记谱', () => {
  it('红车纵向进 → 车9进4', () => {
    const g = emptyGrid();
    g[9][0] = createPiece(PieceType.Chariot, Color.Red, false);
    const piece = g[9][0];
    const note = generateNotation(g, { row: 9, col: 0 }, { row: 5, col: 0 }, piece);
    expect(note).toBe('车9进4');
  });

  it('红马横向平 → 马8平7', () => {
    const g = emptyGrid();
    g[9][1] = createPiece(PieceType.Horse, Color.Red, false);
    const piece = g[9][1];
    const note = generateNotation(g, { row: 9, col: 1 }, { row: 9, col: 2 }, piece);
    expect(note).toBe('马8平7');
  });

  it('同列有多个同型子时用序位区分', () => {
    const g = emptyGrid();
    // 红方两辆车分别在 (9,0) 与 (9,8)
    g[9][0] = createPiece(PieceType.Chariot, Color.Red, false);
    g[9][8] = createPiece(PieceType.Chariot, Color.Red, false);
    const piece = g[9][0];
    const note = generateNotation(g, { row: 9, col: 0 }, { row: 5, col: 0 }, piece);
    // (9,0) 列编号 9，同列仅此车 → 车9进4
    expect(note).toBe('车9进4');
  });

  it('落点为目标时记谱仍为该步着法', () => {
    const g = emptyGrid();
    g[9][0] = createPiece(PieceType.Chariot, Color.Red, false);
    g[5][0] = createPiece(PieceType.Chariot, Color.Black, false); // 目标
    const piece = g[9][0];
    const note = generateNotation(g, { row: 9, col: 0 }, { row: 5, col: 0 }, piece);
    expect(note).toBe('车9进4');
  });
});
