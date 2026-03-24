/**
 * SwimlaneDraft: 泳道图中间结构。
 * LLM / 外部输入只需产出此结构，由 swimlaneDraftToGraphBatchPayload 转为 GraphBatchPayload。
 */
import type { GraphBatchPayload, GraphOperation } from './mermaid/types'

export type SwimlaneDraftNode = {
  id: string
  title: string
  subtitle?: string
  shape?: 'rect' | 'circle' | 'diamond'
  laneId: string
  semanticType?: 'start' | 'task' | 'decision' | 'end' | 'data'
  order?: number
}

export type SwimlaneDraftEdge = {
  id: string
  source: string
  target: string
  label?: string
  semanticType?: 'normal' | 'crossLane' | 'returnFlow' | 'conditional'
}

export type SwimlaneDraft = {
  title?: string
  direction: 'horizontal' | 'vertical'
  lanes: Array<{
    id: string
    title: string
    order: number
  }>
  nodes: SwimlaneDraftNode[]
  edges: SwimlaneDraftEdge[]
}

function inferShape(semanticType?: string): 'rect' | 'circle' | 'diamond' | undefined {
  if (!semanticType) return undefined
  if (semanticType === 'start' || semanticType === 'end') return 'circle'
  if (semanticType === 'decision') return 'diamond'
  return 'rect'
}

export function swimlaneDraftToGraphBatchPayload(
  draft: SwimlaneDraft,
): GraphBatchPayload {
  const ops: GraphOperation[] = []

  // lanes -> createFrame (排序后按 order)
  const sortedLanes = [...draft.lanes].sort((a, b) => a.order - b.order)
  for (const lane of sortedLanes) {
    ops.push({
      op: 'graph.createFrame',
      params: {
        id: lane.id,
        title: lane.title,
      },
    })
  }

  // nodes -> createNodeQuad
  for (const node of draft.nodes) {
    const shape = node.shape ?? inferShape(node.semanticType)
    ops.push({
      op: 'graph.createNodeQuad',
      params: {
        id: node.id,
        title: node.title,
        subtitle: node.subtitle,
        shape,
        parentId: node.laneId,
        style: {
          ...(node.semanticType ? { semanticType: node.semanticType } : {}),
          ...(node.order != null ? { nodeOrder: node.order } : {}),
        } as any,
      },
    })
  }

  // edges -> createEdge
  for (const edge of draft.edges) {
    ops.push({
      op: 'graph.createEdge',
      params: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        style: {
          ...(edge.semanticType ? { semanticType: edge.semanticType } : {}),
        } as any,
      },
    })
  }

  // autoLayout
  ops.push({
    op: 'graph.autoLayout',
    params: {
      direction: draft.direction === 'horizontal' ? 'LR' : 'TB',
      scope: 'all',
    },
  })

  return {
    version: '1.0',
    source: 'swimlane-draft',
    graphType: 'swimlane',
    direction: draft.direction === 'horizontal' ? 'LR' : 'TB',
    operations: ops,
    meta: {
      layoutProfile: 'swimlane',
      swimlaneDirection: draft.direction,
    },
  }
}

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeLine(line: string): string {
  return line
    .replace(/^\s*[-*]\s*/, '')
    .replace(/^\s*\d+[.)、]\s*/, '')
    .trim()
}

/**
 * 从自然语言 prompt 解析一个可用的 SwimlaneDraft（规则版 MVP）。
 * 目标：复杂 prompt 生成更多步骤，而不是固定示例。
 */
export function buildSwimlaneDraftFromPrompt(prompt: string): SwimlaneDraft {
  const rawLines = prompt
    .split(/\n+/)
    .map((l) => normalizeLine(l))
    .filter(Boolean)
  const sentenceLines =
    rawLines.length > 0
      ? rawLines
      : prompt
          .split(/[。！？；]/)
          .map((l) => normalizeLine(l))
          .filter(Boolean)

  // lane 候选：优先抓 “角色：动作” 的角色名
  const laneNameSet = new Set<string>()
  for (const line of sentenceLines) {
    const m = line.match(/^([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})[:：]/)
    if (m) laneNameSet.add(m[1])
  }
  // 回退：常见泳道角色
  if (laneNameSet.size === 0) {
    ;['用户', '系统', '审核员'].forEach((x) => laneNameSet.add(x))
  }
  const lanes = [...laneNameSet].slice(0, 8).map((name, idx) => ({
    id: `lane-${slug(name) || idx}`,
    title: name,
    order: idx,
  }))
  const laneByTitle = new Map(lanes.map((l) => [l.title, l.id]))

  const nodes: SwimlaneDraftNode[] = []
  const edges: SwimlaneDraftEdge[] = []

  const inferLaneId = (line: string): string => {
    const prefix = line.match(/^([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})[:：]/)?.[1]
    if (prefix && laneByTitle.has(prefix)) return laneByTitle.get(prefix)!
    for (const lane of lanes) {
      if (line.includes(lane.title)) return lane.id
    }
    return lanes[0]?.id ?? 'lane-default'
  }

  // 生成节点：每句一个节点，复杂 prompt 会生成更多节点
  for (let i = 0; i < sentenceLines.length; i += 1) {
    const line = sentenceLines[i]
    const laneId = inferLaneId(line)
    const title = line.replace(/^([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})[:：]\s*/, '').slice(0, 30)
    nodes.push({
      id: `n-${i + 1}`,
      title: title || `步骤${i + 1}`,
      laneId,
      semanticType: i === 0 ? 'start' : i === sentenceLines.length - 1 ? 'end' : 'task',
      order: i,
    })
  }

  // 主链顺序边
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      id: `e-${i + 1}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      semanticType: nodes[i].laneId === nodes[i + 1].laneId ? 'normal' : 'crossLane',
    })
  }

  // 回流边关键词（如：驳回/退回/重试/回退）
  const returnKeywords = ['驳回', '退回', '重试', '回退', '返回上一步', '回流']
  for (let i = 1; i < sentenceLines.length; i += 1) {
    const line = sentenceLines[i]
    if (!returnKeywords.some((k) => line.includes(k))) continue
    const from = nodes[i]
    // 优先回到最近的同 lane 上游节点；否则回到起点
    let to = nodes[0]
    for (let j = i - 1; j >= 0; j -= 1) {
      if (nodes[j].laneId === from.laneId) {
        to = nodes[j]
        break
      }
    }
    edges.push({
      id: `re-${i + 1}`,
      source: from.id,
      target: to.id,
      semanticType: 'returnFlow',
      label: '回流',
    })
  }

  return {
    title: sentenceLines[0]?.slice(0, 24) || '泳道图',
    direction: 'horizontal',
    lanes,
    nodes,
    edges,
  }
}

type GenerateSwimlaneDraftOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
}

const SWIMLANE_DRAFT_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Swimlane Diagram Planner。',
  '请把用户输入整理为结构清晰、逻辑正确、可执行的泳道图 JSON。',
  '',
  '硬性要求：',
  '1) 只输出严格 JSON，不要 markdown，不要解释文字。',
  '2) 必须输出字段：title,direction,lanes,nodes,edges。',
  '3) 节点标题必须精简（建议 4-12 字），禁止“操作1/步骤1/节点A”这类占位命名。',
  '4) 节点标题不得是一整句长文本；如果信息多，放到 subtitle 且 subtitle 也要短。',
  '5) lanes 按角色或职责拆分，禁止把无关角色混在同一个 lane。',
  '6) edges 逻辑必须可达：source/target 必须引用已存在节点。',
  '7) 仅在确有回退语义时使用 returnFlow，否则用 normal/crossLane/conditional。',
  '',
  'JSON schema（字段名必须一致）：',
  '{',
  '  "title": "string",',
  '  "direction": "horizontal" | "vertical",',
  '  "lanes": [{ "id": "lane-id", "title": "角色名", "order": 0 }],',
  '  "nodes": [{',
  '    "id": "n-1",',
  '    "title": "短标题",',
  '    "subtitle": "可选短补充",',
  '    "shape": "rect|circle|diamond",',
  '    "laneId": "lane-id",',
  '    "semanticType": "start|task|decision|end|data",',
  '    "order": 0',
  '  }],',
  '  "edges": [{',
  '    "id": "e-1",',
  '    "source": "n-1",',
  '    "target": "n-2",',
  '    "label": "可选短词",',
  '    "semanticType": "normal|crossLane|returnFlow|conditional"',
  '  }]',
  '}',
].join('\n')

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Swimlane Draft 不是有效 JSON')
  }
}

function validateSwimlaneDraft(draft: any): SwimlaneDraft {
  if (!draft || typeof draft !== 'object') throw new Error('Swimlane Draft 为空')
  if (!Array.isArray(draft.lanes) || !Array.isArray(draft.nodes) || !Array.isArray(draft.edges)) {
    throw new Error('Swimlane Draft 缺少 lanes/nodes/edges')
  }
  if (draft.direction !== 'horizontal' && draft.direction !== 'vertical') {
    draft.direction = 'horizontal'
  }
  const laneIds = new Set<string>()
  draft.lanes = draft.lanes.map((l: any, i: number) => {
    const id = String(l?.id ?? `lane-${i + 1}`).trim()
    const title = String(l?.title ?? '').trim()
    if (!title) throw new Error(`lane[${i}] title 不能为空`)
    laneIds.add(id)
    return { id, title, order: Number.isFinite(l?.order) ? l.order : i }
  })
  const nodeIds = new Set<string>()
  draft.nodes = draft.nodes.map((n: any, i: number) => {
    const id = String(n?.id ?? `n-${i + 1}`).trim()
    const title = String(n?.title ?? '').trim()
    if (!title) throw new Error(`node[${i}] title 不能为空`)
    if (/^(操作|步骤|节点)\d+$/i.test(title)) throw new Error(`node[${i}] title 不能为占位命名：${title}`)
    if (!n?.laneId || !laneIds.has(String(n.laneId))) throw new Error(`node[${i}] laneId 无效`)
    nodeIds.add(id)
    return {
      id,
      title: title.slice(0, 16),
      subtitle: typeof n?.subtitle === 'string' ? n.subtitle.slice(0, 24) : undefined,
      shape: n?.shape,
      laneId: String(n.laneId),
      semanticType: n?.semanticType,
      order: Number.isFinite(n?.order) ? n.order : i,
    }
  })
  draft.edges = draft.edges.map((e: any, i: number) => {
    const source = String(e?.source ?? '')
    const target = String(e?.target ?? '')
    if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error(`edge[${i}] source/target 无效`)
    return {
      id: String(e?.id ?? `e-${i + 1}`),
      source,
      target,
      label: typeof e?.label === 'string' ? e.label.slice(0, 12) : undefined,
      semanticType: e?.semanticType,
    }
  })
  return draft as SwimlaneDraft
}

export async function generateSwimlaneDraftWithLLM(
  opts: GenerateSwimlaneDraftOptions,
): Promise<SwimlaneDraft> {
  const { apiKey, model, prompt, signal, timeoutMs = 45_000 } = opts
  if (!apiKey.trim()) throw new Error('生成泳道图需要 OpenRouter API Key')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SWIMLANE_DRAFT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter 请求失败: ${res.status}`)
    const json = safeJsonParse(JSON.parse(text).choices?.[0]?.message?.content ?? '')
    return validateSwimlaneDraft(json)
  } catch (e) {
    if (controller.signal.aborted) throw new Error('生成泳道图超时或被取消')
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
