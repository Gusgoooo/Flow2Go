/**
 * Routify OpenAI-compatible 统一网关客户端（极简版）。
 *
 * 架构与 codify 对齐：
 * - 构建时 `VITE_ROUTIFY_API_KEY` 被 Vite 内联到 JS bundle，前端直连 Routify。
 * - 本地开发走 Vite devServer 代理（`/protocol/openai/v1` → routify.alibaba-inc.com）解决 CORS。
 * - 线上（非 localhost）直接请求 https://routify.alibaba-inc.com/protocol/openai/v1。
 *
 * ⚡ 只有一个环境变量需要关心：VITE_ROUTIFY_API_KEY
 *    - 本地：写在 .env.local（已 gitignore）
 *    - 线上：在 CI/CD 构建环境中设置
 */

const ROUTIFY_OPENAI_BASE_REMOTE = 'https://routify.alibaba-inc.com/protocol/openai/v1'

function getViteRoutifyKey(): string {
  try {
    const v = (import.meta as { env?: { VITE_ROUTIFY_API_KEY?: string } }).env?.VITE_ROUTIFY_API_KEY
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch { /* ignore */ }
  return ''
}

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

export function getRoutifyOpenAIBase(): string {
  if (isLocalhost()) return '/protocol/openai/v1'
  return ROUTIFY_OPENAI_BASE_REMOTE
}

export function getRoutifyApiKey(): string {
  return getViteRoutifyKey()
}

export const ROUTIFY_OPENAI_BASE = ROUTIFY_OPENAI_BASE_REMOTE
export const ROUTIFY_CHAT_COMPLETIONS_URL = `${ROUTIFY_OPENAI_BASE_REMOTE}/chat/completions`

if (typeof window !== 'undefined') {
  const key = getViteRoutifyKey()
  const base = getRoutifyOpenAIBase()
  console.info(
    '[Flow2Go Routify] 启动诊断',
    '\n  API Key:', key ? `已配置 (${key.slice(0, 6)}…)` : '⚠️ 未配置 VITE_ROUTIFY_API_KEY',
    '\n  Base URL:', base,
    '\n  Hostname:', window.location.hostname,
  )
}

export type RoutifyOpenAIPostOptions = {
  body?: unknown
  signal?: AbortSignal
  method?: 'POST' | 'GET'
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

  const apiKey = getViteRoutifyKey()
  if (!apiKey) {
    throw new Error(
      '[Flow2Go] 未配置 Routify API Key！\n'
      + '请在构建环境（CI/CD）中设置 VITE_ROUTIFY_API_KEY=sk-xxx，\n'
      + '或本地 .env.local 文件中添加 VITE_ROUTIFY_API_KEY=sk-xxx。\n'
      + '⚠️ 这是 Vite 构建时变量，必须在 `npm run build` 时存在。',
    )
  }

  const headers: Record<string, string> = {
    ...opts.headers,
    'Authorization': `Bearer ${apiKey}`,
  }

  const hasBody = opts.body !== undefined && method !== 'GET'
  if (hasBody) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  console.info('[Flow2Go Routify]', method, url)

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })

  return res
}

export type RoutifyChatCompletionsOptions = {
  body: Record<string, unknown>
  signal?: AbortSignal
}

export async function routifyChatCompletions(opts: RoutifyChatCompletionsOptions): Promise<Response> {
  return routifyOpenAICompatiblePost('chat/completions', {
    body: opts.body,
    signal: opts.signal,
  })
}

export async function routifyImagesGenerations(opts: {
  body: Record<string, unknown>
  signal?: AbortSignal
}): Promise<Response> {
  return routifyOpenAICompatiblePost('images/generations', {
    body: opts.body,
    signal: opts.signal,
  })
}

export async function routifyEmbeddings(opts: {
  body: Record<string, unknown>
  signal?: AbortSignal
}): Promise<Response> {
  return routifyOpenAICompatiblePost('embeddings', {
    body: opts.body,
    signal: opts.signal,
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
