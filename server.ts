import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response } from 'express'

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

const ROUTIFY_BASE =
  process.env.ROUTIFY_BASE_URL ||
  'https://routify.alibaba-inc.com/protocol/openai/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function getRoutifyApiKey(): string {
  return (process.env.ROUTIFY_API_KEY || '').trim()
}

const app = express()
app.use(express.json({ limit: '20mb' }))

app.options('/api/routify/*path', (_req: Request, res: Response) => {
  res.set(corsHeaders).status(204).end()
})

app.all('/api/routify/*path', async (req: Request, res: Response) => {
  const apiKey = getRoutifyApiKey()
  if (!apiKey) {
    res.set(corsHeaders).status(500).json({ error: '服务端未配置 ROUTIFY_API_KEY 环境变量' })
    return
  }

  const subPath = (req.params as Record<string, string>).path ?? ''
  const upstream = `${ROUTIFY_BASE.replace(/\/+$/, '')}/${subPath}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': req.headers['content-type'] || 'application/json',
  }

  try {
    const upstreamRes = await fetch(upstream, {
      method: req.method === 'GET' ? 'GET' : 'POST',
      headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    })

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
    console.error('[routify proxy]', e)
    res.set(corsHeaders).status(502).json({ error: `Routify 代理失败: ${e instanceof Error ? e.message : String(e)}` })
  }
})

const distDir = path.resolve(__dirname, 'dist')
app.use(express.static(distDir))
app.get('*path', (_req: Request, res: Response) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

app.listen(PORT, HOST, () => {
  const key = getRoutifyApiKey()
  const keySource = process.env.ROUTIFY_API_KEY ? 'ROUTIFY_API_KEY' : '—'
  const baseSource = process.env.ROUTIFY_BASE_URL ? 'ROUTIFY_BASE_URL' : 'default'
  console.info(`🚀 Flow2Go server on http://${HOST}:${PORT}`)
  console.info(`   Upstream  → ${ROUTIFY_BASE}  (${baseSource})`)
  console.info(`   API Key   ${key ? `✅ from ${keySource}` : '❌ NOT SET'}`)
})
