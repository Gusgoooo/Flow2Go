/**
 * Routify OpenAI-compatible 统一网关客户端。
 *
 * 双模式自动切换：
 * 1. 服务端代理模式（推荐）：Express 代理根路径默认同源 `/api/routify/*`，
 *    或与 `VITE_ROUTIFY_PROXY_BASE` 指向的独立服务通信（避免宿主 Next 抢 `/api`），
 *    API Key 由服务端按 X-API-Token 选择的环境变量注入（与 codify 同思路），前端零密钥。
 *    默认 Token：`flow2go_routify` → `ROUTIFY_API_KEY`（可用 `VITE_ROUTIFY_X_API_TOKEN` 覆盖）。
 * 2. 直连回退模式：未部署 Express server 时，若构建阶段设置了
 *    `VITE_ROUTIFY_API_KEY`，则直连 Routify 网关（本地开发由 Vite 代理解决 CORS）。
 */

const ROUTIFY_OPENAI_BASE_REMOTE = 'https://routify.alibaba-inc.com/protocol/openai/v1'
const DEFAULT_PROXY_RELATIVE_BASE = '/api/routify'
const DEFAULT_X_API_TOKEN = 'flow2go_routify'
const FORCE_DIRECT_HOST_KEYWORDS = ['pre-codify.alibaba-inc.com', 'dev.g.alicdn.com']

function shouldForceDirectByHost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  return FORCE_DIRECT_HOST_KEYWORDS.some((k) => host.includes(k))
}

/**
 * 服务端代理根路径。
 * - 默认：同源 `/api/routify`（需网关把该路径转到 Flow2Go 的 Express）
 * - 部署在其它宿主（如 Fizz / Next）上时，同源没有 Express，请设置构建变量
 *   `VITE_ROUTIFY_PROXY_BASE` 为「仅跑 Flow2Go server」的完整地址，例如
 *   `https://flow2go-api.xxx.com/api/routify`（与 server 上 ROUTIFY_PROXY_MOUNT 一致）
 */
function getServerProxyBase(): string {
  try {
    const explicit = (import.meta as { env?: { VITE_ROUTIFY_PROXY_BASE?: string } }).env?.VITE_ROUTIFY_PROXY_BASE
    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.replace(/\/+$/, '')
    }
  } catch { /* ignore */ }
  return DEFAULT_PROXY_RELATIVE_BASE
}

function getRoutifyXApiToken(): string {
  try {
    const t = (import.meta as { env?: { VITE_ROUTIFY_X_API_TOKEN?: string } }).env?.VITE_ROUTIFY_X_API_TOKEN
    if (typeof t === 'string' && t.trim()) return t.trim()
  } catch { /* ignore */ }
  return DEFAULT_X_API_TOKEN
}

function getViteRoutifyKey(): string {
  try {
    const v = (import.meta as { env?: { VITE_ROUTIFY_API_KEY?: string } }).env?.VITE_ROUTIFY_API_KEY
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch { /* ignore */ }
  return ''
}

function isServerProxyAvailable(): boolean {
  if (shouldForceDirectByHost()) return false
  const viteKey = getViteRoutifyKey()
  if (viteKey) return false
  return true
}

export function getRoutifyOpenAIBase(): string {
  if (isServerProxyAvailable()) return getServerProxyBase()
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
      return '/protocol/openai/v1'
    }
  }
  return ROUTIFY_OPENAI_BASE_REMOTE
}

export function getRoutifyApiKey(): string {
  if (isServerProxyAvailable()) return '(server-managed)'
  return getViteRoutifyKey()
}

export const ROUTIFY_OPENAI_BASE = ROUTIFY_OPENAI_BASE_REMOTE
export const ROUTIFY_CHAT_COMPLETIONS_URL = `${ROUTIFY_OPENAI_BASE_REMOTE}/chat/completions`

export type RoutifyOpenAIPostOptions = {
  body?: unknown
  signal?: AbortSignal
  method?: 'POST' | 'GET'
  bearerFallback?: string
  headers?: Record<string, string>
}

export async function routifyOpenAICompatiblePost(
  path: string,
  opts: RoutifyOpenAIPostOptions = {},
): Promise<Response> {
  const clean = path.replace(/^\/+/, '')
  const base = getRoutifyOpenAIBase()
  const url = `${base}/${clean}`
  const method = opts.method ?? 'POST'
  console.info('[Flow2Go Routify] request', { method, url, mode: isServerProxyAvailable() ? 'proxy' : 'direct' })

  const headers: Record<string, string> = { ...opts.headers }

  if (!isServerProxyAvailable()) {
    const token = getViteRoutifyKey() || (opts.bearerFallback ?? '').trim()
    if (!token) {
      throw new Error(
        '未配置 Routify API Key。请设置环境变量 VITE_ROUTIFY_API_KEY（前端构建），或启动 Express 代理服务器（npm run dev:server）并配置 ROUTIFY_API_KEY。',
      )
    }
    headers['Authorization'] = `Bearer ${token}`
  } else {
    headers['X-API-Token'] = getRoutifyXApiToken()
  }

  const hasBody = opts.body !== undefined && method !== 'GET'
  if (hasBody) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })

  if (!res.ok) {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('text/html')) {
      const base = getServerProxyBase()
      const msg = base.startsWith('/')
        ? [
            `Routify 代理返回 ${res.status}（响应为 HTML，多为宿主应用 404）。`,
            '若静态页与 Fizz/Next 同域，同源 /api/routify 不会命中 Flow2Go 的 Express。',
            '请单独部署 `npm start` 的 Flow2Go server，并在构建时设置：',
            `例如 VITE_ROUTIFY_PROXY_BASE=https://<你的-Flow2Go-主机>${base}`,
            '（须与 server 上 ROUTIFY_PROXY_MOUNT 路径一致，默认 /api/routify）。',
            `当前请求：${url}`,
          ].join('\n')
        : [
            `Routify 代理返回 ${res.status}（HTML）。请核对 VITE_ROUTIFY_PROXY_BASE、网关与 ROUTIFY_PROXY_MOUNT 是否一致。`,
            `当前请求：${url}`,
          ].join('\n')
      throw new Error(msg)
    }
  }

  return res
}

export type RoutifyChatCompletionsOptions = {
  body: Record<string, unknown>
  signal?: AbortSignal
  bearerFallback?: string
}

export async function routifyChatCompletions(opts: RoutifyChatCompletionsOptions): Promise<Response> {
  return routifyOpenAICompatiblePost('chat/completions', {
    body: opts.body,
    signal: opts.signal,
    bearerFallback: opts.bearerFallback,
  })
}

export async function routifyImagesGenerations(opts: {
  body: Record<string, unknown>
  signal?: AbortSignal
  bearerFallback?: string
}): Promise<Response> {
  return routifyOpenAICompatiblePost('images/generations', {
    body: opts.body,
    signal: opts.signal,
    bearerFallback: opts.bearerFallback,
  })
}

export async function routifyEmbeddings(opts: {
  body: Record<string, unknown>
  signal?: AbortSignal
  bearerFallback?: string
}): Promise<Response> {
  return routifyOpenAICompatiblePost('embeddings', {
    body: opts.body,
    signal: opts.signal,
    bearerFallback: opts.bearerFallback,
  })
}

export const routifyOpenAICompatible = {
  get baseUrl() {
    return getRoutifyOpenAIBase()
  },
  get chatCompletionsUrl() {
    return `${getRoutifyOpenAIBase()}/chat/completions`
  },
  getApiKey: getRoutifyApiKey,
  post: routifyOpenAICompatiblePost,
  chatCompletions: routifyChatCompletions,
  imagesGenerations: routifyImagesGenerations,
  embeddings: routifyEmbeddings,
}
