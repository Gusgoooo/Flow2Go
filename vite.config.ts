import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 使用相对路径，方便挂载到任意子路径（如 /flow2go/flow2go/0.0.1/）
  base: './',
  plugins: [react()],
})
