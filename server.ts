import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response } from 'express'
import { DEFAULT_ROUTIFY_OPENAI_BASE, resolveRoutifyProfile } from './server/routifyTokenMap'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadDotEnv(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* file not found is fine */ }
}

loadDotEnv(path.resolve(__dirname, '.env.local'))
loadDotEnv(path.resolve(__dirname, '.env'))

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

/** 与前端 VITE_ROUTIFY_PROXY_BASE 路径段保持一致，默认 /api/routify */
const PROXY_MOUNT = (process.env.ROUTIFY_PROXY_MOUNT || '/api/routify').replace(/\/+$/, '')
/** Vertex（按文档示例）本地代理 mount */
const VERTEX_PROXY_MOUNT = (process.env.ROUTIFY_VERTEX_PROXY_MOUNT || '/api/vertex').replace(/\/+$/, '')

const DEFAULT_ROUTIFY_VERTEX_BASE = 'https://routify.alibaba-inc.com/protocol/vertex/v1beta'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const app = express()
app.use(express.json({ limit: '20mb' }))

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true })
})

app.options(`${PROXY_MOUNT}/*path`, (_req: Request, res: Response) => {
  res.set(corsHeaders).status(204).end()
})

app.all(`${PROXY_MOUNT}/*path`, async (req: Request, res: Response) => {
  const profile = resolveRoutifyProfile(req)
  if ('error' in profile) {
    res.set(corsHeaders).status(profile.status).json({ error: profile.error })
    return
  }

  const { apiKey, baseURL, token, source } = profile

  const rawPath = (req.params as any)?.path
  const subPath = Array.isArray(rawPath)
    ? rawPath.filter(Boolean).join('/')
    : String(rawPath ?? '')
        // Express v5 在某些场景下会把通配符段序列化为逗号分隔
        .replace(/,+/g, '/')
        .replace(/^\/+/, '')
  const upstream = `${baseURL.replace(/\/+$/, '')}/${subPath}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': (req.headers['content-type'] as string) || 'application/json',
  }

  try {
    const controller = new AbortController()
    // 生图/识图可能明显慢于普通 chat；本地代理提高超时避免误中止
    // 备注：Routify 的“chat 生图”可能需要数分钟
    const timeout = setTimeout(() => controller.abort(), 600000)
    const upstreamRes = await fetch(upstream, {
      method: req.method === 'GET' ? 'GET' : 'POST',
      headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    res.set(corsHeaders)
    upstreamRes.headers.forEach((v, k) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        res.setHeader(k, v)
      }
    })
    res.status(upstreamRes.status)

    if (!upstreamRes.body) {
      res.end()
      return
    }
    const reader = upstreamRes.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { res.end(); return }
        res.write(value)
      }
    }
    await pump()
  } catch (e) {
    const isAbort = e instanceof Error && e.name === 'AbortError'
    console.error('[routify proxy]', { token, source, upstream }, e)
    res
      .set(corsHeaders)
      .status(502)
      .json({
        error: isAbort
          ? 'Routify 代理失败: 上游请求超时被中止（本地代理超时）'
          : `Routify 代理失败: ${e instanceof Error ? e.message : String(e)}`,
      })
  }
})

app.options(`${VERTEX_PROXY_MOUNT}/*path`, (_req: Request, res: Response) => {
  res.set(corsHeaders).status(204).end()
})

app.all(`${VERTEX_PROXY_MOUNT}/*path`, async (req: Request, res: Response) => {
  const profile = resolveRoutifyProfile(req)
  if ('error' in profile) {
    res.set(corsHeaders).status(profile.status).json({ error: profile.error })
    return
  }

  const { apiKey, token, source } = profile
  const baseURL = (process.env.ROUTIFY_VERTEX_BASE_URL || DEFAULT_ROUTIFY_VERTEX_BASE).replace(/\/+$/, '')

  const rawPath = (req.params as any)?.path
  const subPath = Array.isArray(rawPath)
    ? rawPath.filter(Boolean).join('/')
    : String(rawPath ?? '')
        .replace(/,+/g, '/')
        .replace(/^\/+/, '')
  const upstream = `${baseURL}/${subPath}`

  const headers: Record<string, string> = {
    'x-goog-api-key': apiKey,
    'Content-Type': (req.headers['content-type'] as string) || 'application/json',
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 600000)
    const upstreamRes = await fetch(upstream, {
      method: req.method === 'GET' ? 'GET' : 'POST',
      headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    res.set(corsHeaders)
    upstreamRes.headers.forEach((v, k) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        res.setHeader(k, v)
      }
    })
    res.status(upstreamRes.status)

    if (!upstreamRes.body) {
      res.end()
      return
    }
    const reader = upstreamRes.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { res.end(); return }
        res.write(value)
      }
    }
    await pump()
  } catch (e) {
    const isAbort = e instanceof Error && e.name === 'AbortError'
    console.error('[routify vertex proxy]', { token, source, upstream }, e)
    res
      .set(corsHeaders)
      .status(502)
      .json({
        error: isAbort
          ? 'Routify Vertex 代理失败: 上游请求超时被中止（本地代理超时）'
          : `Routify Vertex 代理失败: ${e instanceof Error ? e.message : String(e)}`,
      })
  }
})

const distDir = path.resolve(__dirname, 'dist')
app.use(express.static(distDir))
app.get('*path', (_req: Request, res: Response) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

app.listen(PORT, HOST, () => {
  const probe = resolveRoutifyProfile({
    headers: { 'x-api-token': 'flow2go_routify' },
  })
  const ok = 'apiKey' in probe && probe.apiKey
  console.info(`🚀 Flow2Go server on http://${HOST}:${PORT}`)
  console.info(`   Routify proxy mount → ${PROXY_MOUNT}/*`)
  console.info(`   Routify default upstream → ${DEFAULT_ROUTIFY_OPENAI_BASE}`)
  console.info(`   X-API-Token flow2go_routify + ROUTIFY_API_KEY ${ok ? '✅' : '❌ NOT SET'}`)
})
