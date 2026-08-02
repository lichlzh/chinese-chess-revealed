// ============================================================
// 揭棋 - 置换表 (Transposition Table)
// ============================================================

/** 置换表条目 */
export interface TTEntry {
  hash: number;       // 完整哈希值（防碰撞）
  depth: number;      // 搜索深度
  score: number;      // 评估值
  flag: TTFlag;       // 边界类型
  bestMove: number;   // 最佳着法（编码为 fromRow*1000+fromCol*100+toRow*10+toCol）
}

export const enum TTFlag {
  EXACT = 0,  // 精确值
  ALPHA = 1,  // 上界（<=alpha 的剪枝节点）
  BETA = 2,   // 下界（>=beta 的剪枝节点）
}

/** 置换表最大条目数 */
const MAX_SIZE = 1 << 20; // ~1M 条目

/**
 * 简单置换表：基于原生 Map 实现
 * V8 对 Map<number, TTEntry> 有良好的优化
 */
export class TranspositionTable {
  private table = new Map<number, TTEntry>();
  private hits = 0;
  private probes = 0;

  /** 查找条目 */
  probe(hash: number): TTEntry | null {
    this.probes++;
    const entry = this.table.get(hash);
    if (entry && entry.hash === hash) {
      this.hits++;
      return entry;
    }
    return null;
  }

  /** 存入条目（始终替换策略） */
  store(hash: number, depth: number, score: number, flag: TTFlag, bestMove: number): void {
    // 达到容量上限时不清除，保持高效
    if (this.table.size >= MAX_SIZE) {
      // 简单清理：删除第一个（Map 维持插入顺序）
      const first = this.table.keys().next();
      if (!first.done) this.table.delete(first.value);
    }
    this.table.set(hash, { hash, depth, score, flag, bestMove });
  }

  /** 清空置换表 */
  clear(): void {
    this.table.clear();
    this.hits = 0;
    this.probes = 0;
  }

  /** 命中率统计 */
  hitRate(): number {
    return this.probes > 0 ? this.hits / this.probes : 0;
  }

  /** 条目数量 */
  get size(): number { return this.table.size; }
}
