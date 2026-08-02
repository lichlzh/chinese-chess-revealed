import { useEffect } from 'react';
import { useGameStore } from './stores/gameStore';
import { GameMode } from './engine/types';
import Board from './components/Board';
import GamePanel from './components/GamePanel';

export default function App() {
  const newGame = useGameStore(s => s.newGame);

  useEffect(() => {
    // 默认启动人机对战
    newGame(GameMode.PvAI);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f5f0e8 0%, #e8dcc8 50%, #f0e6d3 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      gap: '24px',
      flexWrap: 'wrap',
    }}>
      <Board />
      <GamePanel />
    </div>
  );
}
