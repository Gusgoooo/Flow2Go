/** OpenAI 兼容代理：转发至 Routify 网关（服务端使用 process.env.ROUTIFY_API_KEY） */
const ROUTIFY_BASE = 'http://routify.alibaba-inc.com/protocol/openai/v1'

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

  const apiKey = process.env.ROUTIFY_API_KEY?.trim()
  if (!apiKey) {
    res.status(500).json({ error: 'missing_routify_api_key' })
    return
  }

  try {
    const upstream = await fetch(`${ROUTIFY_BASE}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
