const BASE = 'https://openrouter.ai/api/v1'

function readBody(req: any): any {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return req.body ?? {}
}

export default async function handler(req: any, res: any) {
  const slug = req.query.slug
  const path = Array.isArray(slug) ? slug.join('/') : String(slug ?? '')
  if (!path) {
    res.status(400).json({ error: 'missing_path' })
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const envKey = process.env.OPENROUTER_API_KEY?.trim()
  const userKey = String(req.headers['x-openrouter-key'] ?? '').trim()
  const apiKey = userKey || envKey
  if (!apiKey) {
    res.status(500).json({ error: 'missing_server_api_key' })
    return
  }

  try {
    const upstream = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.origin || '',
        'X-Title': 'Flow2Go',
      },
      body: JSON.stringify(readBody(req)),
    })
    const text = await upstream.text()
    res.status(upstream.status).send(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'proxy_error'
    res.status(502).json({ error: msg })
  }
}
