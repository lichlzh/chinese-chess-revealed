// ============================================================
// 揭棋 - AI Worker 管理（封装 Worker 生命周期与通信）
// ============================================================

import type { BoardState } from '../engine/moves';
import type { SearchConfig } from './search';

interface SearchRequest {
  type: 'search';
  id: number;
  state: BoardState;
  config: SearchConfig;
}

interface SearchResponse {
  type: 'result';
  id: number;
  result: { from: { row: number; col: number }; to: { row: number; col: number } } | null;
}

interface ClearRequest {
  type: 'clear';
}

export interface AIManager {
  requestMove(state: BoardState, config: SearchConfig, timeout: number): Promise<{ from: { row: number; col: number }; to: { row: number; col: number } } | null>;
  clear(): void;
  terminate(): void;
}

/**
 * 创建 AI Worker 管理器。
 * 封装了 Worker 的创建、消息通信、超时处理和清理。
 */
export function createAIManager(): AIManager {
  let worker: Worker | null = null;
  let requestId = 0;
  const pending = new Map<number, {
    resolve: (result: { from: { row: number; col: number }; to: { row: number; col: number } } | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function getWorker(): Worker {
    if (!worker) {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<SearchResponse>) => {
        const { id, result } = e.data;
        const entry = pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(id);
          entry.resolve(result);
        }
      };
      worker.onerror = () => {
        // Worker 出错时，拒绝所有待处理请求
        for (const [, entry] of pending) {
          clearTimeout(entry.timer);
          entry.resolve(null);
        }
        pending.clear();
      };
    }
    return worker;
  }

  return {
    requestMove(state: BoardState, config: SearchConfig, timeout: number) {
      const w = getWorker();
      const id = ++requestId;

      return new Promise<{ from: { row: number; col: number }; to: { row: number; col: number } } | null>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(null); // 超时 → 返回 null，由调用方使用 fallback
        }, timeout);

        pending.set(id, { resolve, timer });

        const msg: SearchRequest = { type: 'search', id, state, config };
        w.postMessage(msg);
      });
    },

    clear() {
      if (worker) {
        const msg: ClearRequest = { type: 'clear' };
        worker.postMessage(msg);
      }
    },

    terminate() {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve(null);
      }
      pending.clear();
    },
  };
}
