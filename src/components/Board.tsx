// ============================================================
// 揭棋 - Canvas 棋盘组件
// ============================================================

import { useRef, useEffect, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore';
import { Color, PieceType, GameStatus, type Position, type Piece } from '../engine/types';
import type { BoardState } from '../engine/moves';

// 棋盘常量
const BOARD_PADDING = 40;
const CELL_SIZE = 56;
const PIECE_RADIUS = 23;
const BOARD_WIDTH = CELL_SIZE * 8 + BOARD_PADDING * 2;
const BOARD_HEIGHT = CELL_SIZE * 9 + BOARD_PADDING * 2;

// 棋子中文名
const PIECE_NAMES: Record<Color, Record<PieceType, string>> = {
  [Color.Red]: {
    [PieceType.King]: '帅',
    [PieceType.Advisor]: '仕',
    [PieceType.Elephant]: '相',
    [PieceType.Horse]: '馬',
    [PieceType.Chariot]: '車',
    [PieceType.Cannon]: '炮',
    [PieceType.Pawn]: '兵',
  },
  [Color.Black]: {
    [PieceType.King]: '将',
    [PieceType.Advisor]: '士',
    [PieceType.Elephant]: '象',
    [PieceType.Horse]: '馬',
    [PieceType.Chariot]: '車',
    [PieceType.Cannon]: '砲',
    [PieceType.Pawn]: '卒',
  },
};

// 棋子背景色
const PIECE_BG: Record<Color, { fill: string; stroke: string; text: string }> = {
  [Color.Red]: { fill: '#fff5f0', stroke: '#c0392b', text: '#c0392b' },
  [Color.Black]: { fill: '#f0f8ff', stroke: '#1a5276', text: '#1a5276' },
};

// 暗子配色
const HIDDEN_PIECE_STYLE = { fill: '#8b7355', stroke: '#5a4030', text: '#f0e6d3' };

export default function Board() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const board = useGameStore(s => s.board);
  const selectedPos = useGameStore(s => s.selectedPos);
  const legalMoves = useGameStore(s => s.legalMoves);
  const aiThinking = useGameStore(s => s.aiThinking);

  // 坐标转换
  const boardToPixel = useCallback((row: number, col: number): { x: number; y: number } => {
    return {
      x: BOARD_PADDING + col * CELL_SIZE,
      y: BOARD_PADDING + row * CELL_SIZE,
    };
  }, []);

  const pixelToBoard = useCallback((px: number, py: number): Position | null => {
    const col = Math.round((px - BOARD_PADDING) / CELL_SIZE);
    const row = Math.round((py - BOARD_PADDING) / CELL_SIZE);
    if (col >= 0 && col <= 8 && row >= 0 && row <= 9) {
      const { x, y } = boardToPixel(row, col);
      const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
      if (dist <= PIECE_RADIUS + 5) {
        return { row, col };
      }
    }
    return null;
  }, [boardToPixel]);

  // 绘制棋盘
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = BOARD_WIDTH * dpr;
    canvas.height = BOARD_HEIGHT * dpr;
    canvas.style.width = `${BOARD_WIDTH}px`;
    canvas.style.height = `${BOARD_HEIGHT}px`;
    ctx.scale(dpr, dpr);

    drawBoard(ctx, board, selectedPos, legalMoves, aiThinking);
  }, [board, selectedPos, legalMoves, aiThinking]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = BOARD_WIDTH / rect.width;
    const scaleY = BOARD_HEIGHT / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const pos = pixelToBoard(px, py);
    if (pos) {
      useGameStore.getState().selectPiece(pos);
    }
  }, [pixelToBoard]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{
        cursor: 'pointer',
        maxWidth: '100%',
        height: 'auto',
        borderRadius: '8px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }}
    />
  );
}

// ---- 绘制函数 ----

function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: BoardState,
  selectedPos: Position | null,
  legalMoves: Position[],
  aiThinking: boolean,
) {
  // 背景
  ctx.fillStyle = '#f5deb3';
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  // 木板纹理边框
  ctx.strokeStyle = '#8b7355';
  ctx.lineWidth = 3;
  ctx.strokeRect(BOARD_PADDING - 8, BOARD_PADDING - 8, CELL_SIZE * 8 + 16, CELL_SIZE * 9 + 16);

  // 网格线
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth = 1;

  // 横线
  for (let r = 0; r <= 9; r++) {
    const y = BOARD_PADDING + r * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(BOARD_PADDING, y);
    ctx.lineTo(BOARD_PADDING + 8 * CELL_SIZE, y);
    ctx.stroke();
  }

  // 竖线（上半部分和下半部分分别处理，九宫格外的边线贯通）
  for (let c = 0; c <= 8; c++) {
    if (c === 0 || c === 8) {
      // 边线贯通
      const x = BOARD_PADDING + c * CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, BOARD_PADDING);
      ctx.lineTo(x, BOARD_PADDING + 9 * CELL_SIZE);
      ctx.stroke();
    } else {
      // 上半部分（黑方）
      const x = BOARD_PADDING + c * CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, BOARD_PADDING);
      ctx.lineTo(x, BOARD_PADDING + 4 * CELL_SIZE);
      ctx.stroke();
      // 下半部分（红方）
      ctx.beginPath();
      ctx.moveTo(x, BOARD_PADDING + 5 * CELL_SIZE);
      ctx.lineTo(x, BOARD_PADDING + 9 * CELL_SIZE);
      ctx.stroke();
    }
  }

  // 九宫格斜线
  drawPalaceCross(ctx, 0, 3); // 黑方九宫
  drawPalaceCross(ctx, 7, 3); // 红方九宫

  // 楚河汉界
  ctx.fillStyle = '#5a4030';
  ctx.font = '18px "KaiTi", "楷体", serif';
  ctx.textAlign = 'center';
  ctx.fillText('楚  河', BOARD_PADDING + 2 * CELL_SIZE, BOARD_PADDING + 4.5 * CELL_SIZE);
  ctx.fillText('汉  界', BOARD_PADDING + 6 * CELL_SIZE, BOARD_PADDING + 4.5 * CELL_SIZE);

  // 绘制棋子
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board.grid[r][c];
      if (!piece) continue;
      const { x, y } = { x: BOARD_PADDING + c * CELL_SIZE, y: BOARD_PADDING + r * CELL_SIZE };
      const isSelected = selectedPos?.row === r && selectedPos?.col === c;
      drawPiece(ctx, x, y, piece, isSelected);
    }
  }

  // 合法着法提示
  for (const move of legalMoves) {
    const { x, y } = { x: BOARD_PADDING + move.col * CELL_SIZE, y: BOARD_PADDING + move.row * CELL_SIZE };
    const targetPiece = board.grid[move.row][move.col];

    if (targetPiece) {
      // 吃子提示：虚线圆
      ctx.strokeStyle = 'rgba(231, 76, 60, 0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(x, y, PIECE_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // 可走位置：绿色小圆点
      ctx.fillStyle = 'rgba(46, 204, 113, 0.6)';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // AI 思考中提示
  if (aiThinking) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(BOARD_WIDTH / 2 - 60, BOARD_HEIGHT / 2 - 20, 120, 40);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AI 思考中...', BOARD_WIDTH / 2, BOARD_HEIGHT / 2 + 5);
  }
}

function drawPalaceCross(ctx: CanvasRenderingContext2D, startRow: number, startCol: number) {
  const x1 = BOARD_PADDING + startCol * CELL_SIZE;
  const y1 = BOARD_PADDING + startRow * CELL_SIZE;
  const x2 = BOARD_PADDING + (startCol + 2) * CELL_SIZE;
  const y2 = BOARD_PADDING + (startRow + 2) * CELL_SIZE;
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y1);
  ctx.lineTo(x1, y2);
  ctx.stroke();
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  piece: Piece,
  isSelected: boolean,
) {
  const style = piece.hidden ? HIDDEN_PIECE_STYLE : PIECE_BG[piece.color];

  // 选中高亮
  if (isSelected) {
    ctx.fillStyle = 'rgba(52, 152, 219, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, PIECE_RADIUS + 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 棋子阴影
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.arc(x + 2, y + 2, PIECE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // 棋子主体
  const gradient = ctx.createRadialGradient(x - 5, y - 5, PIECE_RADIUS * 0.1, x, y, PIECE_RADIUS);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.7, style.fill);
  gradient.addColorStop(1, '#d5c4a1');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, PIECE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // 棋子外圈
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, PIECE_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  // 内圈
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, PIECE_RADIUS - 3, 0, Math.PI * 2);
  ctx.stroke();

  // 文字
  ctx.fillStyle = style.text;
  if (piece.hidden) {
    ctx.font = `bold 20px "KaiTi", "楷体", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('？', x, y);
  } else {
    ctx.font = `bold 20px "KaiTi", "楷体", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = PIECE_NAMES[piece.color]?.[piece.type] ?? '?';
    ctx.fillText(name, x, y);
  }
}
