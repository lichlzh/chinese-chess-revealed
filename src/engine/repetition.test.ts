import { describe, it, expect } from 'vitest';
import { Color, PieceType, type Move, type BoardState } from './types';
import { createPiece } from './board';
import { judgeCycle, positionKey, REPETITION_LIMIT, getRepetitionHint, type CycleEntry } from './repetition';

const R = Color.Red;
const B = Color.Black;

/** 构造一组循环着法 */
function cyc(entries: Array<Partial<CycleEntry> & { side: Color; kind: CycleEntry['kind'] }>): CycleEntry[] {
  return entries.map(e => ({ chases: [], ...e })) as CycleEntry[];
}

describe('judgeCycle - 长将', () => {
  it('红方长将（黑方闲躲）→ 红判负', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'check' },
      { side: B, kind: 'idle' },
      { side: R, kind: 'check' },
      { side: B, kind: 'idle' },
    ]));
    expect(v.loser).toBe(R);
    expect(v.reason).toContain('长将');
  });

  it('黑方长将 → 黑判负', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'idle' },
      { side: B, kind: 'check' },
      { side: R, kind: 'idle' },
      { side: B, kind: 'check' },
    ]));
    expect(v.loser).toBe(B);
  });
});

describe('judgeCycle - 长捉', () => {
  it('红方长捉同一子 → 红判负', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'chase', chases: [5] },
      { side: B, kind: 'idle' },
      { side: R, kind: 'chase', chases: [5] },
      { side: B, kind: 'idle' },
    ]));
    expect(v.loser).toBe(R);
    expect(v.reason).toContain('长捉');
  });

  it('红方捉不同子（目标无交集）→ 保守判和', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'chase', chases: [5] },
      { side: B, kind: 'idle' },
      { side: R, kind: 'chase', chases: [6] },
      { side: B, kind: 'idle' },
    ]));
    expect(v.loser).toBeNull();
  });

  it('一将一捉（同方）→ 按长捉判负', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'check' },
      { side: B, kind: 'idle' },
      { side: R, kind: 'chase', chases: [5] },
      { side: B, kind: 'idle' },
    ]));
    // 循环里红方两步都生事（一将一捉），无闲着 → 判负
    expect(v.loser).toBe(R);
    expect(v.reason).toContain('长捉');
  });
});

describe('judgeCycle - 和棋', () => {
  it('双方纯闲着 → 和棋', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'idle' },
      { side: B, kind: 'idle' },
      { side: R, kind: 'idle' },
      { side: B, kind: 'idle' },
    ]));
    expect(v.loser).toBeNull();
  });

  it('一将一闲（同方）→ 含闲着不算生事，和棋', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'check' },
      { side: B, kind: 'idle' },
      { side: R, kind: 'idle' },
      { side: B, kind: 'idle' },
    ]));
    expect(v.loser).toBeNull();
  });

  it('双方均长将 → 和棋（谁也不赢）', () => {
    const v = judgeCycle(cyc([
      { side: R, kind: 'check' },
      { side: B, kind: 'check' },
    ]));
    expect(v.loser).toBeNull();
  });
});

describe('positionKey - 基本正确性', () => {
  const mk = (): any =>
    Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null));

  it('可调用并返回字符串', () => {
    const g = mk();
    expect(typeof positionKey(g, R)).toBe('string');
    expect(typeof positionKey(g, B)).toBe('string');
  });

  it('轮到不同方 → 指纹不同', () => {
    const g = mk();
    expect(positionKey(g, R)).not.toBe(positionKey(g, B));
  });
});

describe('常量', () => {
  it('三次重复触发', () => {
    expect(REPETITION_LIMIT).toBe(3);
  });
});

describe('getRepetitionHint - UI 预警', () => {
  function emptyBoard(): BoardState {
    return {
      grid: Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => null)),
      currentTurn: Color.Red,
      status: 0 as unknown as BoardState['status'],
      moveHistory: [],
      redCaptured: [],
      blackCaptured: [],
      movesWithoutCapture: 0,
    };
  }

  function repMove(key: string, color: Color, isCheck: boolean): Move {
    return {
      from: { row: 0, col: 0 },
      to: { row: 0, col: 1 },
      piece: createPiece(PieceType.Chariot, color, false),
      posKeyAfter: key,
      isCheck,
      chases: [],
    } as Move;
  }

  it('未达重复阈值 → 不提示', () => {
    const h = getRepetitionHint(emptyBoard());
    expect(h.level).toBe('none');
    expect(h.message).toBe('');
  });

  it('红方长将循环（2 次重复）→ 预警红方长将', () => {
    const key = positionKey(emptyBoard().grid, Color.Red);
    const board = emptyBoard();
    board.moveHistory = [
      repMove(key, Color.Red, true),
      repMove(key, Color.Black, false),
      repMove(key, Color.Red, true),
      repMove(key, Color.Black, false),
    ];
    const h = getRepetitionHint(board);
    expect(h.level).toBe('warn');
    expect(h.count).toBeGreaterThanOrEqual(2);
    expect(h.message).toContain('红方');
    expect(h.message).toContain('长将');
  });

  it('双方不变着（2 次重复）→ 预警和棋', () => {
    const key = positionKey(emptyBoard().grid, Color.Red);
    const board = emptyBoard();
    board.moveHistory = [
      repMove(key, Color.Red, false),
      repMove(key, Color.Black, false),
      repMove(key, Color.Red, false),
      repMove(key, Color.Black, false),
    ];
    const h = getRepetitionHint(board);
    expect(h.level).toBe('warn');
    expect(h.message).toContain('和棋');
  });
});
