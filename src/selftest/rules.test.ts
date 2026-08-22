// ============================================================
// 揭棋 - 规则符合性验证（代码 vs docs/揭棋规则文档.md）
// 逐条验证文档中声明的规则是否在引擎代码中真实成立。
// 运行：npm test -- src/selftest/rules.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  Color, PieceType, GameStatus, POSITION_IDENTITY,
  type BoardState, type Position,
} from '../engine/types';
import {
  initBoard, createPiece, isCapturedRevealed, getPositionIdentity, getEffectiveType,
} from '../engine/board';
import {
  getLegalMoves, getAllLegalMoves, executeMove, isCheckmate, checkPerpetualCheck,
} from '../engine/moves';
import { judgeCycle, type CycleEntry } from '../engine/repetition';

// ---- 测试辅助：构造空棋盘并按需摆子 ----
// 约定：自定义棋盘一律让红帅(9,4)与黑将(0,3)处于不同列，避免误触"飞将照面"
// （飞将照面会使红方自始被将，从而过滤掉所有着法，干扰断言）。
function makeBoard(turn: Color = Color.Red): BoardState {
  const grid: (null | ReturnType<typeof createPiece>)[][] =
    Array.from({ length: 10 }, () => Array(9).fill(null));
  return {
    grid: grid as any,
    currentTurn: turn,
    status: GameStatus.Playing,
    moveHistory: [],
    redCaptured: [],
    blackCaptured: [],
    movesWithoutCapture: 0,
  };
}
function put(b: BoardState, r: number, c: number, t: PieceType, color: Color, hidden = false) {
  b.grid[r][c] = createPiece(t, color, hidden);
}
function has(positions: Position[], r: number, c: number): boolean {
  return positions.some(p => p.row === r && p.col === c);
}

describe('一、初始布局：将/帅明置固定，其余15子暗置随机分布', () => {
  it('每方16子，仅1枚明置将帅在固定底线中路，其余15枚全部暗置', () => {
    const b = initBoard();
    const redKing = b.grid[9][4];
    expect(redKing?.type).toBe(PieceType.King);
    expect(redKing?.color).toBe(Color.Red);
    expect(redKing?.hidden).toBe(false);

    let redCount = 0, redHidden = 0, redKings = 0;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const p = b.grid[r][c];
      if (p && p.color === Color.Red) { redCount++; if (p.hidden) redHidden++; if (p.type === PieceType.King) redKings++; }
    }
    expect(redCount).toBe(16);
    expect(redHidden).toBe(15);
    expect(redKings).toBe(1);

    const blackKing = b.grid[0][4];
    expect(blackKing?.type).toBe(PieceType.King);
    expect(blackKing?.color).toBe(Color.Black);
    expect(blackKing?.hidden).toBe(false);
    let blackHidden = 0, blackKings = 0;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const p = b.grid[r][c];
      if (p && p.color === Color.Black) { if (p.hidden) blackHidden++; if (p.type === PieceType.King) blackKings++; }
    }
    expect(blackHidden).toBe(15);
    expect(blackKings).toBe(1);
  });

  it('暗子池是标准兵种的随机排列（2车2马2炮2象2士5兵/卒）', () => {
    const b = initBoard();
    const cnt: Record<string, number> = {};
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const p = b.grid[r][c];
      if (p && p.color === Color.Red && p.type !== PieceType.King) {
        cnt[p.type] = (cnt[p.type] ?? 0) + 1;
      }
    }
    expect(cnt[PieceType.Chariot]).toBe(2);
    expect(cnt[PieceType.Horse]).toBe(2);
    expect(cnt[PieceType.Cannon]).toBe(2);
    expect(cnt[PieceType.Elephant]).toBe(2);
    expect(cnt[PieceType.Advisor]).toBe(2);
    expect(cnt[PieceType.Pawn]).toBe(5);
  });
});

describe('二、暗子按"位置身份"走法，不泄露真实兵种', () => {
  it('POSITION_IDENTITY 覆盖炮位与兵位（关键不变量）', () => {
    expect(POSITION_IDENTITY['2,1']).toBe(PieceType.Cannon);
    expect(POSITION_IDENTITY['7,1']).toBe(PieceType.Cannon);
    expect(POSITION_IDENTITY['3,0']).toBe(PieceType.Pawn);
    expect(POSITION_IDENTITY['6,8']).toBe(PieceType.Pawn);
    expect(POSITION_IDENTITY['9,4']).toBe(PieceType.King);
  });

  it('暗子真实为车，但位于"马位"时按马走（日字），且 type 仍保密', () => {
    const b = makeBoard(Color.Red);
    put(b, 9, 4, PieceType.King, Color.Red);
    put(b, 0, 3, PieceType.King, Color.Black);   // 不同列，避免飞将
    put(b, 9, 1, PieceType.Chariot, Color.Red, true); // 真实=车，位于马位

    expect(getPositionIdentity({ row: 9, col: 1 })).toBe(PieceType.Horse);
    expect(getEffectiveType(b.grid[9][1]!, { row: 9, col: 1 })).toBe(PieceType.Horse);
    expect(b.grid[9][1]!.type).toBe(PieceType.Chariot); // 真实 type 未泄露

    const moves = getLegalMoves(b, { row: 9, col: 1 });
    expect(has(moves, 7, 0)).toBe(true);  // 马走日
    expect(has(moves, 7, 2)).toBe(true);
    expect(has(moves, 8, 3)).toBe(true);
    expect(has(moves, 9, 0)).toBe(false); // 不像车
    expect(has(moves, 9, 2)).toBe(false);
    expect(has(moves, 8, 1)).toBe(false);
  });
});

describe('三、暗子首次移动翻面；翻面后士/象可过河', () => {
  it('暗子移动后翻为明子，记谱用位置身份不泄露真实兵种', () => {
    const b = makeBoard(Color.Red);
    put(b, 9, 4, PieceType.King, Color.Red);
    put(b, 0, 3, PieceType.King, Color.Black);
    put(b, 9, 0, PieceType.Horse, Color.Red, true); // 真实=马，位于车位

    const res = executeMove(b, { row: 9, col: 0 }, { row: 8, col: 0 });
    expect(res).not.toBeNull();
    const ns = res!.newState;
    expect(ns.grid[8][0]!.hidden).toBe(false);
    expect(res!.move.revealed).toBe(PieceType.Horse);
    expect(res!.move.notation?.startsWith('车')).toBe(true);
  });

  it('翻面后的士/象可过河；翻面前只在九宫内', () => {
    const b1 = makeBoard(Color.Red);
    put(b1, 9, 4, PieceType.King, Color.Red);
    put(b1, 0, 3, PieceType.King, Color.Black);
    put(b1, 9, 3, PieceType.Advisor, Color.Red, true);
    const hiddenAdvisorMoves = getLegalMoves(b1, { row: 9, col: 3 });
    for (const m of hiddenAdvisorMoves) {
      expect(m.row).toBeGreaterThanOrEqual(7);
      expect(m.row).toBeLessThanOrEqual(9);
      expect(m.col).toBeGreaterThanOrEqual(3);
      expect(m.col).toBeLessThanOrEqual(5);
    }

    const b2 = makeBoard(Color.Red);
    put(b2, 9, 4, PieceType.King, Color.Red);
    put(b2, 0, 3, PieceType.King, Color.Black);
    put(b2, 5, 4, PieceType.Advisor, Color.Red, false); // 已翻面
    const revealedAdvisorMoves = getLegalMoves(b2, { row: 5, col: 4 });
    expect(has(revealedAdvisorMoves, 4, 3)).toBe(true); // 过河
    expect(has(revealedAdvisorMoves, 4, 5)).toBe(true);
  });
});

describe('四、飞将（将帅照面）非法', () => {
  it('移开阻塞子导致两将照面的一步被视为被将（非法）', () => {
    const b = makeBoard(Color.Red);
    put(b, 9, 4, PieceType.King, Color.Red);
    put(b, 0, 4, PieceType.King, Color.Black);
    put(b, 5, 4, PieceType.Chariot, Color.Red, true); // 阻塞两将之间

    const moves = getLegalMoves(b, { row: 5, col: 4 });
    expect(has(moves, 4, 4)).toBe(true);   // 沿第4列仍阻塞，合法
    expect(has(moves, 5, 0)).toBe(false);  // 横向离开→两将照面→非法
    expect(has(moves, 5, 8)).toBe(false);
  });
});

describe('五、★暗子被吃的信息不对称（被吃方不可见，吃子方可见，终局才揭晓）', () => {
  function capPiece() {
    return createPiece(PieceType.Chariot, Color.Black, true); // 黑方未翻暗子
  }
  it('isCapturedRevealed 按规则区分视角', () => {
    const p = capPiece();
    expect(isCapturedRevealed(p, Color.Black, false)).toBe(false); // 被吃方看不见
    expect(isCapturedRevealed(p, Color.Red, false)).toBe(true);   // 吃子方看得见
    expect(isCapturedRevealed(p, Color.Black, true)).toBe(true);  // 终局双方揭晓
  });
  it('已翻面的明子被吃：双方都可见', () => {
    const revealed = createPiece(PieceType.Horse, Color.Black, false);
    expect(isCapturedRevealed(revealed, Color.Black, false)).toBe(true);
    expect(isCapturedRevealed(revealed, Color.Red, false)).toBe(true);
  });
  it('端到端：executeMove 吃掉暗子后，被吃方看不到、吃子方看得到，且子仍 hidden', () => {
    const b = makeBoard(Color.Red);
    put(b, 9, 3, PieceType.King, Color.Red);  // 红帅(9,3)
    put(b, 0, 4, PieceType.King, Color.Black); // 黑将(0,4) 不同列
    put(b, 5, 4, PieceType.Chariot, Color.Red);
    put(b, 5, 5, PieceType.Horse, Color.Black, true);

    const res = executeMove(b, { row: 5, col: 4 }, { row: 5, col: 5 });
    expect(res).not.toBeNull();
    const captured = res!.newState.blackCaptured[0];
    expect(captured).toBeDefined();
    expect(captured.hidden).toBe(true);
    expect(isCapturedRevealed(captured, Color.Black, false)).toBe(false);
    expect(isCapturedRevealed(captured, Color.Red, false)).toBe(true);
  });
});

describe('六、终局：将死 / 困毙均判负（无棋可走即负）', () => {
  it('困毙：轮到走棋方无合法着法且未被将军 → 对方胜', () => {
    const b = makeBoard(Color.Black);
    put(b, 9, 4, PieceType.King, Color.Red);
    put(b, 0, 3, PieceType.King, Color.Black);
    put(b, 7, 2, PieceType.Horse, Color.Black); // 封 (9,3)
    put(b, 7, 6, PieceType.Horse, Color.Black); // 封 (9,5)
    put(b, 6, 3, PieceType.Horse, Color.Black); // 封 (8,4)

    const res = executeMove(b, { row: 0, col: 3 }, { row: 1, col: 3 });
    expect(res).not.toBeNull();
    const ns = res!.newState;
    expect(ns.currentTurn).toBe(Color.Red);
    expect(isCheckmate(ns)).toBe(true);
    expect(ns.status).toBe(GameStatus.BlackWin);
    expect(ns.endReason).toBe('困毙');
  });

  it('将死：红帅被将且无任何 escape → 黑胜', () => {
    const b = makeBoard(Color.Black);
    put(b, 9, 4, PieceType.King, Color.Red);
    put(b, 9, 2, PieceType.Chariot, Color.Red, true);
    put(b, 0, 3, PieceType.King, Color.Black);
    put(b, 9, 0, PieceType.Chariot, Color.Black);
    put(b, 6, 3, PieceType.Horse, Color.Black); // 封 (8,4)

    const res = executeMove(b, { row: 9, col: 0 }, { row: 9, col: 2 });
    expect(res).not.toBeNull();
    const ns = res!.newState;
    expect(ns.currentTurn).toBe(Color.Red);
    expect(isCheckmate(ns)).toBe(true);
    expect(ns.status).toBe(GameStatus.BlackWin);
    expect(ns.endReason).toBe('将死');
  });
});

describe('七、重复局面裁决：长将 / 长捉判负，双方不变着和棋', () => {
  const edge = (side: Color, kind: 'check' | 'chase' | 'idle', chases: number[] = []): CycleEntry => ({ side, kind, chases });
  it('一方连续将军 → 长将判负', () => {
    const v = judgeCycle([edge(Color.Red, 'check'), edge(Color.Red, 'check'), edge(Color.Black, 'idle'), edge(Color.Black, 'idle')]);
    expect(v.loser).toBe(Color.Red);
    expect(v.reason).toContain('长将');
  });
  it('一方连续捉同一子 → 长捉判负', () => {
    const v = judgeCycle([edge(Color.Red, 'chase', [5]), edge(Color.Red, 'chase', [5]), edge(Color.Black, 'idle')]);
    expect(v.loser).toBe(Color.Red);
    expect(v.reason).toContain('长捉');
  });
  it('一将一闲 → 不变着，和棋（不误判）', () => {
    const v = judgeCycle([edge(Color.Red, 'check'), edge(Color.Red, 'idle'), edge(Color.Black, 'idle')]);
    expect(v.loser).toBeNull();
  });
  it('双方均长将 → 和棋', () => {
    const v = judgeCycle([edge(Color.Red, 'check'), edge(Color.Black, 'check')]);
    expect(v.loser).toBeNull();
    expect(v.reason).toContain('和棋');
  });
  it('长捉须捉同一子：捉不同子 → 判和', () => {
    const v = judgeCycle([edge(Color.Red, 'chase', [5]), edge(Color.Red, 'chase', [7]), edge(Color.Black, 'idle')]);
    expect(v.loser).toBeNull();
  });
});

describe('八、兜底判负与无吃子和棋', () => {
  it('连续无吃子达 60 半回合 → 和棋', () => {
    const b = makeBoard(Color.Black);
    put(b, 9, 4, PieceType.King, Color.Red);
    put(b, 0, 3, PieceType.King, Color.Black);
    b.movesWithoutCapture = 59;
    const res = executeMove(b, { row: 0, col: 3 }, { row: 1, col: 3 });
    expect(res).not.toBeNull();
    const ns = res!.newState;
    expect(ns.movesWithoutCapture).toBe(60);
    expect(ns.status).toBe(GameStatus.Draw);
    expect(ns.endReason).toContain('无吃子');
  });

  it('同一方连续 6 次将军未成重复 → 长将兜底判负', () => {
    const fm = (color: Color, check: boolean) => ({
      from: { row: 0, col: 0 }, to: { row: 0, col: 1 },
      piece: createPiece(PieceType.Chariot, color, false),
      isCheck: check,
    });
    // 历史末步需为将军，且含 6 次红方连续将军（间隔黑方着法）
    const b = makeBoard(Color.Red);
    b.moveHistory = [
      fm(Color.Black, false), fm(Color.Red, true),
      fm(Color.Black, false), fm(Color.Red, true),
      fm(Color.Black, false), fm(Color.Red, true),
      fm(Color.Black, false), fm(Color.Red, true),
      fm(Color.Black, false), fm(Color.Red, true),
      fm(Color.Black, false), fm(Color.Red, true),
    ];
    expect(checkPerpetualCheck(b)).toBe(Color.Red);

    // 不足 6 次 → 不判负
    const b2 = makeBoard(Color.Red);
    b2.moveHistory = [fm(Color.Black, false), fm(Color.Red, true), fm(Color.Black, false), fm(Color.Red, true)];
    expect(checkPerpetualCheck(b2)).toBeNull();

    // 末步非将军 → 直接返回 null
    const b3 = makeBoard(Color.Red);
    b3.moveHistory = [fm(Color.Red, true), fm(Color.Black, false)];
    expect(checkPerpetualCheck(b3)).toBeNull();
  });
});
