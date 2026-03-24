type PostOpenRouterOptions = {
  apiKey?: string
  signal?: AbortSignal
}

function getProxyBases(): string[] {
  const envBase = String((import.meta as any)?.env?.VITE_OPENROUTER_PROXY_BASE ?? '').trim()
  const base = envBase || '/openrouter-proxy'
  return [base.replace(/\/+$/, '')]
}

function canRetryByStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 502 || status === 503 || status === 504
}

export async function postOpenRouter(
  path: string,
  payload: unknown,
  opts: PostOpenRouterOptions = {},
): Promise<Response> {
  const { apiKey, signal } = opts
  const [base] = getProxyBases()
  const body = JSON.stringify(payload)
  let lastError: string | null = null
  try {
    const res = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey?.trim() ? { 'x-openrouter-key': apiKey.trim() } : {}),
      },
      body,
      signal,
    })
    if (!canRetryByStatus(res.status)) return res
    lastError = `proxy ${base} returned ${res.status}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    lastError = `proxy ${base} failed: ${msg}`
  }

  if (apiKey?.trim()) {
    return fetch('https://openrouter.ai/api/v1/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
        ...(typeof window !== 'undefined'
          ? {
              'HTTP-Referer': window.location.origin,
              'X-Title': 'Flow2Go',
            }
          : {}),
      },
      body,
      signal,
    })
  }

  throw new Error(
    `OpenRouter 代理链路不可用（${lastError ?? 'unknown'}）。请在 GitLab 部署中配置 VITE_OPENROUTER_PROXY_BASE，或将 /openrouter-proxy 反向代理到 https://openrouter.ai/api/v1`,
  )
}

