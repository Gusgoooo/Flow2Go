/**
 * codify 侧 API Route：为 Flow2Go 前端代理 Routify Vertex 请求（generateContent）。
 *
 * 放置位置：codify 项目 app/api/flow2go/vertex/[...path]/route.ts
 *
 * 工作原理：
 *   Flow2Go 前端 POST /api/flow2go/vertex/models/<model>:generateContent
 *   → 本 Route 读取 process.env.ROUTIFY_API_KEY，注入 x-goog-api-key header
 *   → 转发到 https://routify.alibaba-inc.com/protocol/vertex/v1beta/models/<model>:generateContent
 *   → 响应原样返回给前端
 *
 * 需要在 codify 服务端环境变量中配置：
 *   ROUTIFY_API_KEY=sk-xxx
 *   ROUTIFY_VERTEX_BASE_URL=https://routify.alibaba-inc.com/protocol/vertex/v1beta（可选，有默认值）
 */

import { type NextRequest, NextResponse } from 'next/server'

const DEFAULT_BASE = 'https://routify.alibaba-inc.com/protocol/vertex/v1beta'

function getConfig() {
  const apiKey = process.env.ROUTIFY_API_KEY ?? ''
  const baseUrl = (process.env.ROUTIFY_VERTEX_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, '')
  return { apiKey, baseUrl }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { apiKey, baseUrl } = getConfig()
  if (!apiKey) {
    return NextResponse.json(
      { error: '服务端未配置 ROUTIFY_API_KEY' },
      { status: 500 },
    )
  }

  const { path } = await params
  const subPath = path.join('/')
  const upstream = `${baseUrl}/${subPath}`

  const body = await req.text()

  const upstreamRes = await fetch(upstream, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body,
  })

  const responseHeaders = new Headers()
  const ct = upstreamRes.headers.get('content-type')
  if (ct) responseHeaders.set('Content-Type', ct)

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  })
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

