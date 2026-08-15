// ============================================================
// 揭棋 - 棋谱导出
// ============================================================

import { Color, GameMode, GameStatus, type Move } from './types';
import type { BoardState } from './moves';

export interface RecordMeta {
  mode: GameMode;
  playerColor?: Color;
  status: GameStatus;
  endReason?: string;
}

/** 生成一份可读的中文棋谱文本 */
export function buildGameRecord(board: BoardState, meta: RecordMeta): string {
  const lines: string[] = [];
  lines.push('揭棋棋谱');
  lines.push('========================================');

  const modeText = meta.mode === GameMode.PvAI ? '人机对战' : '本地双人';
  lines.push(`模式：${modeText}`);
  if (meta.mode === GameMode.PvAI) {
    lines.push(`玩家执子：${meta.playerColor === Color.Red ? '红方（先手）' : '黑方（后手）'}`);
  }

  const statusText =
    meta.status === GameStatus.RedWin ? '红方胜' :
    meta.status === GameStatus.BlackWin ? '黑方胜' :
    meta.status === GameStatus.Draw ? '和棋' :
    meta.status === GameStatus.NotStarted ? '未开始' : '进行中';
  lines.push(`结果：${statusText}${meta.endReason ? `（${meta.endReason}）` : ''}`);
  lines.push(`着法数：${board.moveHistory.length}`);
  lines.push(`导出时间：${formatDate(new Date())}`);
  lines.push('');

  lines.push('【着法记录】');
  const h = board.moveHistory;
  for (let i = 0; i < h.length; i += 2) {
    const red = h[i];
    const black = h[i + 1];
    const round = String(Math.floor(i / 2) + 1).padStart(2, ' ');
    const redStr = formatMove(red);
    const blackStr = black ? formatMove(black) : '';
    lines.push(black ? `${round}. ${redStr}　　${blackStr}` : `${round}. ${redStr}`);
  }
  if (h.length === 0) lines.push('（暂无着法）');

  // 机器可解析的坐标序列
  lines.push('');
  lines.push('【坐标序列 (from->to，格式 row,col)】');
  lines.push(h.map(m => `${m.from.row},${m.from.col}->${m.to.row},${m.to.col}`).join('  '));

  return lines.join('\n');
}

/** 单步着法的中文展示（含翻面 / 吃子 / 将军 / 将死标记） */
function formatMove(m: Move): string {
  let s = m.notation ?? `${m.from.row},${m.from.col}->${m.to.row},${m.to.col}`;
  if (m.revealed) s += '（翻）';
  if (m.captured) s += '×';
  if (m.isCheckmate) s += '＃';      // 将死
  else if (m.isCheck) s += '＋';     // 将军
  return s;
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
