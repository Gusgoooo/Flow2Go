import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
const routifyProxy = {
  '/protocol/openai/v1': {
    target: 'http://routify.alibaba-inc.com',
    changeOrigin: true,
  },
} as const

export default defineConfig({
  // 使用相对路径，方便挂载到任意子路径（如 /flow2go/flow2go/0.0.1/）
  base: './',
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  /** 浏览器直连 Routify 会触发 CORS；开发/预览经同源路径转发 */
  server: { proxy: routifyProxy },
  preview: { proxy: routifyProxy },
})
