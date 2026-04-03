import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const routifyKey = env.ROUTIFY_API_KEY || ''

  return {
    base: './',
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    /**
     * 本地开发代理：模拟 codify 服务端代理行为。
     * /api/flow2go/routify/* → https://routify.alibaba-inc.com/protocol/openai/v1/*
     * 并自动注入 .env.local 中的 ROUTIFY_API_KEY 作为 Bearer token。
     */
    server: {
      proxy: {
        '/api/flow2go/routify': {
          target: 'https://routify.alibaba-inc.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/flow2go\/routify/, '/protocol/openai/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (routifyKey) {
                proxyReq.setHeader('Authorization', `Bearer ${routifyKey}`)
              }
            })
          },
        },
      },
    },
  }
})
