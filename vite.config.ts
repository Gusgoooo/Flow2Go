import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/

const proxyRules = {
  '/protocol/openai/v1': {
    target: 'https://routify.alibaba-inc.com',
    changeOrigin: true,
  },
} as const

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  /** 本地开发：/protocol/openai/v1 → routify.alibaba-inc.com（解决 CORS） */
  server: { proxy: proxyRules },
  preview: { proxy: proxyRules },
})
