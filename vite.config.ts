import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const routifyKey = env.ROUTIFY_API_KEY || ''
  const routifyBase = env.VITE_ROUTIFY_BASE_URL || 'https://routify.alibaba-inc.com/protocol/openai/v1'
  const routifyOrigin = routifyBase.replace(/\/protocol\/openai\/v1\/?$/, '')
  // 可选：本地启动 server.ts 作为“变量注入代理”（不影响线上 codify）
  // - target: http://localhost:3001
  // - mount: /api/routify/*
  const localProxy = env.VITE_ROUTIFY_LOCAL_PROXY_URL || ''

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
          target: localProxy || routifyOrigin,
          changeOrigin: true,
          rewrite: (p) =>
            (localProxy
              ? p.replace(/^\/api\/flow2go\/routify/, '/api/routify')
              : p.replace(/^\/api\/flow2go\/routify/, '/protocol/openai/v1')),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (routifyKey) {
                proxyReq.setHeader('Authorization', `Bearer ${routifyKey}`)
              }
            })
          },
        },
        '/api/flow2go/vertex': {
          target: localProxy || routifyOrigin,
          changeOrigin: true,
          rewrite: (p) =>
            (localProxy
              ? p.replace(/^\/api\/flow2go\/vertex/, '/api/vertex')
              : p.replace(/^\/api\/flow2go\/vertex/, '/protocol/vertex/v1beta')),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (routifyKey) {
                proxyReq.setHeader('x-goog-api-key', routifyKey)
              }
            })
          },
        },
      },
    },
  }
})
