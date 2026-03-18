export type AiDiagramSchema = 'flow2go.ai.diagram.v1'

export type AiDiagramDraft = {
  schema: AiDiagramSchema
  title?: string
  nodes: unknown[]
  edges: unknown[]
  viewport?: { x: number; y: number; zoom: number }
  /** 原始响应文本（用于调试/展示） */
  rawText: string
}

export type OpenRouterChatOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 45_000

function stripCodeFences(s: string): string {
  const t = s.trim()
  // ```json ... ```
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence?.[1]) return fence[1].trim()
  return t
}

function extractFirstJsonObject(s: string): string | null {
  // 尝试从文本中截取第一段 JSON object：从第一个 { 到其匹配的 }
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return s.slice(start, i + 1)
      }
    }
  }
  return null
}

function safeParseJson(raw: string): any {
  const cleaned = stripCodeFences(raw)
  try {
    return JSON.parse(cleaned)
  } catch {
    const chunk = extractFirstJsonObject(cleaned)
    if (!chunk) throw new Error('AI 返回内容不是有效 JSON')
    return JSON.parse(chunk)
  }
}

function isFiniteNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function validateAiDiagramDraft(obj: any, rawText: string): AiDiagramDraft {
  if (!obj || typeof obj !== 'object') throw new Error('AI 返回内容不是对象')
  if (obj.schema !== 'flow2go.ai.diagram.v1') throw new Error('AI schema 不匹配（需要 flow2go.ai.diagram.v1）')
  if (!Array.isArray(obj.nodes)) throw new Error('AI nodes 必须是数组')
  if (!Array.isArray(obj.edges)) throw new Error('AI edges 必须是数组')

  if (obj.viewport != null) {
    const v = obj.viewport
    if (!v || typeof v !== 'object') throw new Error('AI viewport 格式错误')
    if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.zoom)) throw new Error('AI viewport 坐标/缩放必须为数字')
  }

  return {
    schema: 'flow2go.ai.diagram.v1',
    title: typeof obj.title === 'string' ? obj.title : undefined,
    nodes: obj.nodes,
    edges: obj.edges,
    viewport: obj.viewport,
    rawText,
  }
}

export function normalizeAiDiagramToSnapshot(draft: AiDiagramDraft): { nodes: any[]; edges: any[]; viewport?: { x: number; y: number; zoom: number } } {
  // 第一阶段：最小归一化，保证结构可用；坐标/parentId 的强语义在应用阶段继续校验/修复。
  const nodes = Array.isArray(draft.nodes) ? draft.nodes : []
  const edges = Array.isArray(draft.edges) ? draft.edges : []
  const viewport = draft.viewport
  return { nodes, edges, viewport }
}

export async function openRouterGenerateDiagram(opts: OpenRouterChatOptions): Promise<AiDiagramDraft> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  const mergedSignal = signal
    ? (AbortSignal as any).any
      ? (AbortSignal as any).any([signal, controller.signal])
      : controller.signal
    : controller.signal

  const system = [
    '你是 Flow2Go 的图表生成器。',
    '你必须只输出严格 JSON，不要输出任何解释文字或 Markdown。',
    '输出必须符合 schema: flow2go.ai.diagram.v1。',
    'nodes/edges 必须是数组；edge 的 source/target 必须引用已存在的 node id。',
    'type 仅允许：quad, group, text, asset（其它类型不要使用）。',
    "Frame 使用 type='group' 且 data.role='frame' 表示。",
    "默认 edge.type 为 'smoothstep'，默认 data.arrowStyle 为 'end'。",
    'position 为画布坐标（数字）。',
  ].join('\n')

  const user = [
    '根据以下描述生成一张可在 Flow2Go 中直接导入的图：',
    prompt.trim(),
    '',
    '输出 JSON 结构示例：',
    '{"schema":"flow2go.ai.diagram.v1","title":"...","nodes":[...],"edges":[...],"viewport":{"x":0,"y":0,"zoom":1}}',
  ].join('\n')

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Flow2Go',
      },
      signal: mergedSignal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })

    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter 错误 ${res.status}: ${text}`)

    const payload = JSON.parse(text)
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回内容')

    const obj = safeParseJson(content)
    return validateAiDiagramDraft(obj, content)
  } finally {
    window.clearTimeout(timeout)
  }
}

