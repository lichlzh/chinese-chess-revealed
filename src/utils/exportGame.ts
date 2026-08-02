// ============================================================
// 揭棋 - 棋谱导出（TXT 中文记谱 / JSON 结构化）
// ============================================================

import { Color, GameMode, GameStatus, type BoardState } from '../engine/types';

/** 结果文案 */
function resultText(status: GameStatus): string {
  switch (status) {
    case GameStatus.RedWin: return '红方胜';
    case GameStatus.BlackWin: return '黑方胜';
    case GameStatus.Draw: return '和棋';
    case GameStatus.Playing: return '进行中';
    default: return '未开始';
  }
}

function modeText(mode: GameMode): string {
  return mode === GameMode.PvAI ? '人机对战' : '双人对战';
}

/** 生成中文棋谱文本 */
export function buildNotationText(board: BoardState, mode: GameMode): string {
  const lines: string[] = [];
  lines.push('揭 棋 棋 谱');
  lines.push('========================================');
  lines.push(`模式：${modeText(mode)}`);
  lines.push(`结果：${resultText(board.status)}`);
  lines.push(`步数：${board.moveHistory.length}`);
  lines.push(`导出：${new Date().toLocaleString('zh-CN')}`);
  lines.push('========================================');
  lines.push('');

  if (board.moveHistory.length === 0) {
    lines.push('（暂无着法记录）');
    return lines.join('\n');
  }

  for (let i = 0; i < board.moveHistory.length; i += 2) {
    const red = board.moveHistory[i];
    const black = board.moveHistory[i + 1];
    const round = i / 2 + 1;

    const redStr = red.notation ?? '(未知)';
    const blackStr = black ? (black.notation ?? '(未知)') : '';

    let line = `${String(round).padStart(3, ' ')}. ${redStr.padEnd(6, '　')}`;
    if (blackStr) line += `   ${blackStr}`;
    lines.push(line);
  }

  lines.push('');
  return lines.join('\n');
}

/** 生成结构化 JSON（可复盘/分析） */
export function buildJson(board: BoardState, mode: GameMode): string {
  const data = {
    game: 'jieqi',
    version: 1,
    exportedAt: new Date().toISOString(),
    mode,
    result: board.status,
    moveCount: board.moveHistory.length,
    moves: board.moveHistory.map((m, i) => ({
      no: i + 1,
      color: m.piece.color,
      from: m.from,
      to: m.to,
      piece: m.piece.type,
      wasHidden: m.piece.hidden,
      revealed: m.revealed ?? null,
      captured: m.captured ? m.captured.type : null,
      notation: m.notation ?? null,
      check: m.isCheck ?? false,
      checkmate: m.isCheckmate ?? false,
    })),
  };
  return JSON.stringify(data, null, 2);
}

/** 触发浏览器下载 */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** 生成带时间戳的文件名 */
export function makeFilename(ext: string): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `jieqi-${ts}.${ext}`;
}
