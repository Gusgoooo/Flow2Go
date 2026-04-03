/**
 * Routify OpenAI-compatible 统一网关客户端。
 *
 * 所有模型相关 HTTP 调用经此出口，通过服务端代理 `/api/routify/*`
 * 转发到 Routify 网关。API Key 由服务端环境变量 `ROUTIFY_API_KEY` 注入，
 * 前端无需持有任何密钥。
 */

const SERVER_PROXY_BASE = '/api/routify'

/**
 * 当前应使用的 OpenAI 兼容 base。
 * 始终走服务端代理（服务端注入 AK，前端无需感知）。
 */
export function getRoutifyOpenAIBase(): string {
  return SERVER_PROXY_BASE
}

export const ROUTIFY_OPENAI_BASE = SERVER_PROXY_BASE
export const ROUTIFY_CHAT_COMPLETIONS_URL = `${SERVER_PROXY_BASE}/chat/completions`

export function getRoutifyApiKey(): string {
  return '(server-managed)'
}

export type RoutifyOpenAIPostOptions = {
  body?: unknown
  signal?: AbortSignal
  method?: 'POST' | 'GET'
  /** @deprecated 前端不再需要传 key，保留签名以兼容存量调用 */
  bearerFallback?: string
  headers?: Record<string, string>
}

export async function routifyOpenAICompatiblePost(
  path: string,
  opts: RoutifyOpenAIPostOptions = {},
): Promise<Response> {
  const clean = path.replace(/^\/+/, '')
  const url = `${SERVER_PROXY_BASE}/${clean}`
  const method = opts.method ?? 'POST'
  const headers: Record<string, string> = {
    ...opts.headers,
  }
  const hasBody = opts.body !== undefined && method !== 'GET'
  if (hasBody) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }
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
  /** @deprecated 服务端注入 key，前端无需传 */
  bearerFallback?: string
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
  bearerFallback?: string
}): Promise<Response> {
  return routifyOpenAICompatiblePost('images/generations', {
    body: opts.body,
    signal: opts.signal,
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
  })
}

export const routifyOpenAICompatible = {
  get baseUrl() {
    return SERVER_PROXY_BASE
  },
  get chatCompletionsUrl() {
    return `${SERVER_PROXY_BASE}/chat/completions`
  },
  getApiKey: getRoutifyApiKey,
  post: routifyOpenAICompatiblePost,
  chatCompletions: routifyChatCompletions,
  imagesGenerations: routifyImagesGenerations,
  embeddings: routifyEmbeddings,
}
