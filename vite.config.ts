import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 相对路径 base：部署到 GitHub Pages 子路径（/仓库名/）时无需硬编码仓库名，
  // 所有资源与 Worker 均以相对路径引用，本地 dev / preview 也不受影响。
  base: './',
  plugins: [react()],
})
