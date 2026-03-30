import { routifyOpenAICompatiblePost } from './routifyClient'

type PostOpenRouterOptions = {
  apiKey?: string
  signal?: AbortSignal
}

/**
 * 兼容旧名：向 Routify OpenAI 兼容网关 POST（path 如 `chat/completions`、`images/generations`）。
 */
export async function postOpenRouter(
  path: string,
  payload: unknown,
  opts: PostOpenRouterOptions = {},
): Promise<Response> {
  return routifyOpenAICompatiblePost(path, {
    body: payload,
    signal: opts.signal,
    bearerFallback: opts.apiKey,
  })
}
