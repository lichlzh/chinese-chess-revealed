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

/** 条目优先级：用于同深度替换决策（值越大越优先保留） */
function entryPriority(flag: TTFlag): number {
  switch (flag) {
    case TTFlag.EXACT: return 3;
    case TTFlag.BETA: return 2;
    case TTFlag.ALPHA: return 1;
    default: return 0;
  }
}

/**
 * 置换表：基于原生 Map + 深度优先替换 + 同深度优先级策略
 *   - 新深度 > 旧深度 → 替换
 *   - 新深度 = 旧深度 → 比较 flag 优先级（EXACT > BETA > ALPHA）
 *   - 表满时淘汰深度最低的条目（非随机首条）
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

  /** 存入条目（深度优先 + 同深度优先级替换） */
  store(hash: number, depth: number, score: number, flag: TTFlag, bestMove: number): void {
    const existing = this.table.get(hash);

    if (existing && existing.hash === hash) {
      // 已存在同哈希条目
      if (existing.depth > depth) return; // 旧深度更大 → 保留
      if (existing.depth === depth && entryPriority(existing.flag) > entryPriority(flag)) return; // 同深度但旧 flag 更优 → 保留
    } else if (this.table.size >= MAX_SIZE) {
      // 表满且为新条目 → 淘汰深度最低的旧条目
      this.evictOldEntry();
    }

    this.table.set(hash, { hash, depth, score, flag, bestMove });
  }

  /** 淘汰策略：移除表中最浅深度的条目（扫描一批，取最小） */
  private evictOldEntry(): void {
    let minDepth = Infinity;
    let minKey = -1;
    let count = 0;
    const batchSize = 32; // 每批扫描 32 条，找最浅的删除
    for (const [key, entry] of this.table) {
      if (entry.depth < minDepth) {
        minDepth = entry.depth;
        minKey = key;
      }
      if (++count >= batchSize) break;
    }
    if (minKey >= 0) this.table.delete(minKey);
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
