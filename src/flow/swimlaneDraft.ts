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
