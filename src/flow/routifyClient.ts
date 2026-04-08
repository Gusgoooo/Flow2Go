/**
 * Routify OpenAI-compatible 统一网关客户端。
 *
 * 架构：前端零密钥，所有请求走同源 codify 服务端代理。
 * - 线上：前端 → /api/flow2go/routify/* → codify Next.js API Route → Routify 网关
 *   AK 由 codify 服务端 process.env.ROUTIFY_API_KEY 注入，前端不持有任何密钥。
 * - 本地开发：Vite devServer 代理同路径 → routify.alibaba-inc.com（注入 .env.local 的 key）
 */

const PROXY_PATH = '/api/flow2go/routify'
const VERTEX_PROXY_PATH = '/api/flow2go/vertex'

export function getRoutifyOpenAIBase(): string {
  return PROXY_PATH
}

export function getRoutifyApiKey(): string {
  return '(server-managed)'
}

export const ROUTIFY_OPENAI_BASE = 'https://routify.alibaba-inc.com/protocol/openai/v1'
export const ROUTIFY_CHAT_COMPLETIONS_URL = `${ROUTIFY_OPENAI_BASE}/chat/completions`

if (typeof window !== 'undefined') {
  console.info(
    '[Flow2Go Routify] 启动诊断',
    '\n  模式: 服务端代理（codify Next.js）',
    '\n  代理路径:', PROXY_PATH,
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
  const url = `${PROXY_PATH}/${clean}`
  const method = opts.method ?? 'POST'

  const headers: Record<string, string> = { ...opts.headers }

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

export async function routifyVertexPost(
  path: string,
  opts: RoutifyOpenAIPostOptions = {},
): Promise<Response> {
  const clean = path.replace(/^\/+/, '')
  const url = `${VERTEX_PROXY_PATH}/${clean}`
  const method = opts.method ?? 'POST'
  const headers: Record<string, string> = { ...opts.headers }
  const hasBody = opts.body !== undefined && method !== 'GET'
  if (hasBody) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }
  console.info('[Flow2Go Routify]', method, url)
  return fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })
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

export async function routifyVertexGenerateContent(opts: {
  model: string
  body: Record<string, unknown>
  signal?: AbortSignal
}): Promise<Response> {
  const model = String(opts.model || '').trim()
  if (!model) throw new Error('Vertex 生图缺少 model')
  // Vertex: POST /protocol/vertex/v1beta/models/{model}:generateContent
  return routifyVertexPost(`models/${encodeURIComponent(model)}:generateContent`, {
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
