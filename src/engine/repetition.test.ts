import { describe, it, expect } from 'vitest';
import { Color } from './types';
import { judgeCycle, positionKey, REPETITION_LIMIT, type CycleEntry } from './repetition';

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
