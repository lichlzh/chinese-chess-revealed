// ============================================================
// 揭棋 - 游戏控制面板
// ============================================================

import { useGameStore } from '../stores/gameStore';
import { GameMode, GameStatus, Color, PieceType, type Piece, type Move } from '../engine/types';

const PIECE_NAMES: Record<Color, Record<PieceType, string>> = {
  [Color.Red]: {
    [PieceType.King]: '帅', [PieceType.Advisor]: '仕', [PieceType.Elephant]: '相',
    [PieceType.Horse]: '馬', [PieceType.Chariot]: '車', [PieceType.Cannon]: '炮', [PieceType.Pawn]: '兵',
  },
  [Color.Black]: {
    [PieceType.King]: '将', [PieceType.Advisor]: '士', [PieceType.Elephant]: '象',
    [PieceType.Horse]: '馬', [PieceType.Chariot]: '車', [PieceType.Cannon]: '砲', [PieceType.Pawn]: '卒',
  },
};

export default function GamePanel() {
  const board = useGameStore(s => s.board);
  const gameMode = useGameStore(s => s.gameMode);
  const aiThinking = useGameStore(s => s.aiThinking);
  const newGame = useGameStore(s => s.newGame);
  const undo = useGameStore(s => s.undo);

  const statusText = getStatusText(board.status, board.currentTurn, aiThinking, board.endReason);

  return (
    <div style={{
      width: '240px',
      padding: '20px',
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}>
      {/* 标题 */}
      <h1 style={{
        fontSize: '24px',
        fontWeight: 'bold',
        textAlign: 'center',
        color: '#8b4513',
        margin: 0,
        fontFamily: '"KaiTi", "楷体", serif',
      }}>
        揭 棋
      </h1>

      {/* 当前状态 */}
      <div style={{
        textAlign: 'center',
        padding: '12px',
        background: '#faf3e0',
        borderRadius: '8px',
        border: '1px solid #e8d5b0',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#5a4030' }}>{statusText}</div>
        <div style={{ fontSize: '12px', color: '#8b7355', marginTop: '4px' }}>
          第 {Math.floor(board.moveHistory.length / 2) + 1} 回合
        </div>
      </div>

      {/* 游戏模式选择 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => newGame(GameMode.PvAI)}
          style={{
            ...buttonStyle,
            background: gameMode === GameMode.PvAI ? '#8b4513' : '#fff',
            color: gameMode === GameMode.PvAI ? '#fff' : '#8b4513',
            flex: 1,
          }}
        >
          人机对战
        </button>
        <button
          onClick={() => newGame(GameMode.PvP)}
          style={{
            ...buttonStyle,
            background: gameMode === GameMode.PvP ? '#5a4030' : '#fff',
            color: gameMode === GameMode.PvP ? '#fff' : '#5a4030',
            flex: 1,
          }}
        >
          双人对战
        </button>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => newGame(gameMode)}
          style={{ ...buttonStyle, flex: 1, background: '#27ae60', color: '#fff', borderColor: '#27ae60' }}
        >
          新游戏
        </button>
        <button
          onClick={undo}
          disabled={board.moveHistory.length === 0 || aiThinking}
          style={{
            ...buttonStyle, flex: 1,
            opacity: (board.moveHistory.length === 0 || aiThinking) ? 0.5 : 1,
          }}
        >
          悔棋
        </button>
      </div>

      {/* 被吃棋子展示 */}
      <CapturedPieces label="红方损失" pieces={board.redCaptured} color={Color.Red} />
      <CapturedPieces label="黑方损失" pieces={board.blackCaptured} color={Color.Black} />

      {/* 走子记录 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#5a4030', marginBottom: '8px' }}>走子记录</div>
        <div style={{ fontSize: '12px', color: '#8b7355', maxHeight: '160px', overflowY: 'auto' }}>
          {board.moveHistory.length === 0 && <div style={{ opacity: 0.5 }}>暂无记录</div>}
          {board.moveHistory.map((move: Move, i: number) => {
            const isLast = i === board.moveHistory.length - 1;
            return (
            <div key={i} style={{
              padding: '3px 6px',
              borderBottom: '1px solid #f0e6d3',
              color: move.piece.color === Color.Red ? '#c0392b' : '#1a5276',
              background: isLast ? '#fff3e0' : 'transparent',
              borderLeft: isLast ? '3px solid #e67e22' : '3px solid transparent',
              borderRadius: isLast ? '4px' : 0,
              fontWeight: isLast ? 700 : 400,
            }}>
              {Math.floor(i / 2) + 1}. {move.piece.color === Color.Red ? '红' : '黑'}
              {' '}
              {PIECE_NAMES[move.piece.color]?.[move.piece.type] ?? '?'}
              {move.revealed ? `(${PIECE_NAMES[move.piece.color]?.[move.revealed] ?? '?'})` : ''}
              {' → '}
              {move.captured ? `吃${PIECE_NAMES[move.captured.color]?.[move.captured.type]}` : ''}
              {move.isCheck ? ' 将军' : ''}
              {move.isCheckmate ? ' 将死!' : ''}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CapturedPieces({ label, pieces, color }: { label: string; pieces: Piece[]; color: Color }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#5a4030', marginBottom: '4px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', minHeight: '24px' }}>
        {pieces.map(p => {
          const name = PIECE_NAMES[color]?.[p.type] ?? '?';
          const textColor = color === Color.Red ? '#c0392b' : '#1a5276';
          return (
            <span key={p.id} style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#f5f0e8',
              border: `1.5px solid ${textColor}`,
              fontSize: '13px',
              fontWeight: 'bold',
              color: textColor,
              fontFamily: '"KaiTi", "楷体", serif',
            }}>
              {name}
            </span>
          );
        })}
        {pieces.length === 0 && <span style={{ fontSize: '11px', color: '#ccc' }}>无</span>}
      </div>
    </div>
  );
}

function getStatusText(status: GameStatus, currentTurn: Color, aiThinking: boolean, endReason?: string): string {
  if (aiThinking) return 'AI 思考中...';
  switch (status) {
    case GameStatus.NotStarted: return '未开始';
    case GameStatus.Playing:
      return currentTurn === Color.Red ? '红方走棋' : '黑方走棋';
    case GameStatus.RedWin: return `🏆 红方获胜！${endReason ? `（${endReason}）` : ''}`;
    case GameStatus.BlackWin: return `🏆 黑方获胜！${endReason ? `（${endReason}）` : ''}`;
    case GameStatus.Draw: return `🤝 和棋${endReason ? `（${endReason}）` : ''}`;
    default: return '';
  }
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1.5px solid #d5c4a1',
  borderRadius: '8px',
  background: '#fff',
  color: '#5a4030',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all 0.2s',
};
