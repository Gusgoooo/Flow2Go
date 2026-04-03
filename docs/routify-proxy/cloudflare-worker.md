## 在纯静态站点（GitLab Pages/快速部署平台）解决 Routify CORS

你的线上域名是**纯静态托管**时，浏览器直连 `https://routify.alibaba-inc.com/protocol/openai/v1` 往往会因为 **CORS 预检（OPTIONS）** 失败而报错（Network 面板看到 `CORS error` / Console 看到 `Failed to fetch`）。

此时前端无法绕过浏览器限制，必须：

- 让 Routify 网关为你的域名放行 CORS；或
- 使用一个**外部反代**把请求变成“同源可访问”的地址，然后在前端配置 `VITE_ROUTIFY_BASE_URL` 指过去。

下面是 Cloudflare Worker 的最小可用方案（无需自建服务器）。

### 1) 新建 Cloudflare Worker

在 Cloudflare Dashboard 新建一个 Worker，把下面代码粘进去（建议先只允许你的站点域名）。

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // 你的前端会请求：<worker-origin>/protocol/openai/v1/...
    const prefix = '/protocol/openai/v1'
    if (!url.pathname.startsWith(prefix)) {
      return new Response('Not Found', { status: 404 })
    }

    // 只放行你的线上域名（按需改成你的 GitLab 线上域名）
    const origin = request.headers.get('Origin') || ''
    const allowed = new Set([
      // 例：'https://xxx.gitlab.io',
      // 例：'https://your.domain.com',
    ])
    const allowOrigin = allowed.size === 0 ? origin : (allowed.has(origin) ? origin : '')

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        },
      })
    }

    const upstream = new URL('https://routify.alibaba-inc.com')
    upstream.pathname = url.pathname
    upstream.search = url.search

    // 透传关键头（Authorization 必须保留）
    const headers = new Headers(request.headers)
    headers.set('Host', upstream.host)

    const resp = await fetch(upstream.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    })

    const outHeaders = new Headers(resp.headers)
    if (allowOrigin) outHeaders.set('Access-Control-Allow-Origin', allowOrigin)
    outHeaders.set('Access-Control-Allow-Credentials', 'false')
    outHeaders.set('Vary', 'Origin')

    return new Response(resp.body, { status: resp.status, headers: outHeaders })
  },
}
```

### 2) 在前端配置 `VITE_ROUTIFY_BASE_URL`

把你的 Worker 域名（示例）配置成：

- `VITE_ROUTIFY_BASE_URL=https://<your-worker>.workers.dev/protocol/openai/v1`

这样前端会把所有请求发到 Worker，再由 Worker 转发到 Routify，从而避免浏览器直接跨域预检失败。

### 3) 验证

线上打开页面后，Network 应该看到请求命中 Worker 域名，且不再是 `CORS error`。

如果仍然报错，优先检查：

- Worker 的 `allowed` 是否包含你的线上 Origin
- Worker 是否正确处理了 `OPTIONS`
- 上游 Routify 是否对 `Authorization` 有额外校验/限制

