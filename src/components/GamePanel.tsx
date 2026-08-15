// ============================================================
// 揭棋 - 游戏控制面板
// ============================================================

import { useGameStore } from '../stores/gameStore';
import { useState } from 'react';
import { GameMode, GameStatus, Color, PieceType, type Piece, type Move } from '../engine/types';
import { getRepetitionHint } from '../engine/repetition';
import { isCapturedRevealed } from '../engine/board';

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
  const playerColor = useGameStore(s => s.playerColor);
  const aiThinking = useGameStore(s => s.aiThinking);
  const newGame = useGameStore(s => s.newGame);
  const undo = useGameStore(s => s.undo);
  const exportGameRecord = useGameStore(s => s.exportGameRecord);
  const [showRules, setShowRules] = useState(false);
  const [recordText, setRecordText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const statusText = getStatusText(board.status, board.currentTurn, aiThinking, board.endReason);
  const repHint = getRepetitionHint(board);
  const gameOver = board.status !== GameStatus.Playing;

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

      {/* 重复局面 / 长将长捉 预警 */}
      {board.status === GameStatus.Playing && repHint.level === 'warn' && (
        <div style={{
          padding: '10px 12px',
          background: '#fff4e0',
          border: '1px solid #e8a33d',
          borderRadius: '8px',
          fontSize: '12px',
          lineHeight: 1.5,
          color: '#8a5a00',
          fontFamily: '"KaiTi", "楷体", serif',
        }}>
          {repHint.message}
        </div>
      )}

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

      {/* 人机：交换先后手 */}
      {gameMode === GameMode.PvAI && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '12px', color: '#8b7355', textAlign: 'center' }}>
            玩家执{playerColor === Color.Red ? '红方 · 先手' : '黑方 · 后手'}
          </div>
          <button
            onClick={() => newGame(GameMode.PvAI, playerColor === Color.Red ? Color.Black : Color.Red)}
            style={{ ...buttonStyle, background: '#8e44ad', color: '#fff', borderColor: '#8e44ad' }}
          >
            交换先后手
          </button>
        </div>
      )}

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => newGame(gameMode, playerColor)}
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

      {/* 导出棋谱 */}
      <button
        onClick={() => setRecordText(exportGameRecord())}
        disabled={board.moveHistory.length === 0}
        style={{
          ...buttonStyle,
          background: '#16a085', color: '#fff', borderColor: '#16a085',
          opacity: board.moveHistory.length === 0 ? 0.5 : 1,
        }}
      >
        导出棋谱
      </button>

      {/* 棋规说明入口 */}
      <button
        onClick={() => setShowRules(true)}
        style={{ ...buttonStyle, background: '#5d6d7e', color: '#fff', borderColor: '#5d6d7e' }}
      >
        棋规说明
      </button>

      {/* 被吃棋子展示 */}
      <CapturedPieces label="红方损失" pieces={board.redCaptured} color={Color.Red} viewerColor={playerColor} gameOver={gameOver} />
      <CapturedPieces label="黑方损失" pieces={board.blackCaptured} color={Color.Black} viewerColor={playerColor} gameOver={gameOver} />

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
              {move.captured ? `吃${isCapturedRevealed(move.captured, playerColor, gameOver) ? (PIECE_NAMES[move.captured.color]?.[move.captured.type] ?? '?') : '?'}` : ''}
              {move.isCheck ? ' 将军' : ''}
              {move.isCheckmate ? ' 将死!' : ''}
            </div>
            );
          })}
        </div>
      </div>

      {/* 棋规说明弹窗 */}
      {showRules && (
        <div
          onClick={() => setShowRules(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(540px, 90vw)', maxHeight: '85vh', overflowY: 'auto',
              background: '#fff', borderRadius: '14px', padding: '24px 28px',
              boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
              fontFamily: '"KaiTi", "楷体", serif',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, color: '#8b4513', fontSize: '20px' }}>揭棋 · 棋规速览</h2>
              <button onClick={() => setShowRules(false)} style={{ ...buttonStyle, padding: '4px 12px' }}>关闭</button>
            </div>

            <div style={{ fontSize: '13px', lineHeight: 1.75, color: '#5a4030' }}>
              <p style={{ margin: '0 0 10px' }}><b>暗子（翻棋）</b>：开局双方各 15 子暗置，走暗子时翻开真实身份（位置决定其本该是车/马/炮…）。翻面的子即变为明子。</p>

              <p style={{ margin: '0 0 10px' }}><b>被吃暗子保密</b>：被吃掉的暗子（未及翻开者）其真实身份，<b>吃子方（对方）立即知悉</b>，但<b>被吃方（原属方）在棋局结束前看不到</b>（显示为「?」）。已翻明的子被吃则照常显示。</p>

              <p style={{ margin: '0 0 10px' }}><b>胜负</b>：将死或困毙（对方将帅无合法着法）即获胜。双方将帅照面也算被将。</p>

              <p style={{ margin: '0 0 8px' }}><b>重复局面裁决（长将 / 长捉）</b>：同一局面三次重复时触发。</p>
              <ul style={{ margin: '0 0 10px', paddingLeft: '20px' }}>
                <li><b>长将</b>：一方连续将军、对方只能应将（不变着）→ 长将方判负。</li>
                <li><b>长捉</b>：连续捉吃同一枚无根子（含「一将一捉」）→ 长捉方判负。</li>
                <li><b>和棋</b>：双方均生事、或双方均为不变着（一将一闲等）→ 判和。</li>
              </ul>

              <p style={{ margin: '0 0 10px' }}><b>其他和棋</b>：连续 60 回合无吃子判和；连续 6 回合同方将军（连将兜底）判和；长拦/长跟等未细分情形保守判和。</p>

              <p style={{ margin: '0' }}><b>AI</b> 已感知以上规则：不会主动长将/长捉自杀，亦能在对方违规时主动制造重复逼胜/逼和。当局面临近重复时，本面板会给出⚠️预警。</p>
            </div>
          </div>
        </div>
      )}

      {/* 棋谱导出弹窗 */}
      {recordText !== null && (
        <div
          onClick={() => setRecordText(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 92vw)', maxHeight: '85vh', overflowY: 'auto',
              background: '#fff', borderRadius: '14px', padding: '24px 28px',
              boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
              fontFamily: '"KaiTi", "楷体", serif',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, color: '#8b4513', fontSize: '20px' }}>棋谱导出</h2>
              <button onClick={() => setRecordText(null)} style={{ ...buttonStyle, padding: '4px 12px' }}>关闭</button>
            </div>
            <textarea
              readOnly
              value={recordText}
              style={{
                width: '100%', height: '300px', resize: 'vertical',
                boxSizing: 'border-box', padding: '10px',
                fontSize: '13px', lineHeight: 1.6, color: '#333',
                border: '1px solid #d5c4a1', borderRadius: '8px',
                fontFamily: 'monospace', whiteSpace: 'pre',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(recordText).then(
                    () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
                    () => {},
                  );
                }}
                style={{ ...buttonStyle, background: '#27ae60', color: '#fff', borderColor: '#27ae60' }}
              >
                {copied ? '已复制!' : '复制'}
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([recordText], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `揭棋棋谱_${Date.now()}.txt`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                style={{ ...buttonStyle, background: '#8b4513', color: '#fff', borderColor: '#8b4513' }}
              >
                下载 .txt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CapturedPieces({ label, pieces, color, viewerColor, gameOver }: { label: string; pieces: Piece[]; color: Color; viewerColor: Color; gameOver: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#5a4030', marginBottom: '4px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', minHeight: '24px' }}>
        {pieces.map(p => {
          const revealed = isCapturedRevealed(p, viewerColor, gameOver);
          const name = revealed ? (PIECE_NAMES[color]?.[p.type] ?? '?') : '?';
          const textColor = color === Color.Red ? '#c0392b' : '#1a5276';
          return (
            <span
              key={p.id}
              title={revealed ? '' : '被吃暗子：吃子方已知，被吃方(原属方)终局前保密'}
              style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: revealed ? '#f5f0e8' : '#eceff1',
              border: revealed ? `1.5px solid ${textColor}` : '1.5px dashed #b0a99a',
              fontSize: '13px',
              fontWeight: 'bold',
              color: revealed ? textColor : '#9e9e9e',
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
