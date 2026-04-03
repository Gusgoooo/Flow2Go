import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
const SERVER_PORT = Number(process.env.SERVER_PORT || 3001)

const proxyRules = {
  '/api/routify': {
    target: `http://127.0.0.1:${SERVER_PORT}`,
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
  /** 开发/预览时 /api/routify/* 转发到 Express 代理服务器（服务端注入 AK） */
  server: { proxy: proxyRules },
  preview: { proxy: proxyRules },
})
