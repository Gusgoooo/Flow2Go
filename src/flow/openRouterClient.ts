type PostOpenRouterOptions = {
  apiKey?: string
  signal?: AbortSignal
}

function getProxyBases(): string[] {
  const bases: string[] = []
  const envBase = String((import.meta as any)?.env?.VITE_OPENROUTER_PROXY_BASE ?? '').trim()
  if (envBase) {
    for (const seg of envBase.split(',')) {
      const t = seg.trim()
      if (t) bases.push(t.replace(/\/+$/, ''))
    }
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname.toLowerCase()
    if (h.includes('gitlab') || h.includes('alibaba-inc.com')) {
      bases.push('/openrouter-proxy')
    }
  }
  bases.push('/api/openrouter')
  return Array.from(new Set(bases))
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
  const bases = getProxyBases()
  const body = JSON.stringify(payload)
  let lastError: string | null = null

  for (const base of bases) {
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
    `OpenRouter 代理链路不可用（${lastError ?? 'unknown'}）。请在 GitLab 部署中配置 VITE_OPENROUTER_PROXY_BASE 或反向代理 /openrouter-proxy`,
  )
}

