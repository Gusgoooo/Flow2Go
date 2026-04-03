/**
 * SwimlaneDraft: 泳道图中间结构。
 * LLM / 外部输入只需产出此结构，由 swimlaneDraftToGraphBatchPayload 转为 GraphBatchPayload。
 */
import type { GraphBatchPayload, GraphOperation } from '../mermaid/types'
import { routifyChatCompletions } from '../routifyClient'

export type SwimlaneDraftNode = {
  id: string
  title: string
  subtitle?: string
  shape?: 'rect' | 'circle' | 'diamond'
  laneId: string
  semanticType?: 'start' | 'task' | 'decision' | 'end' | 'data'
  order?: number
  /**
   * 泳道内行列锚点（可选）：
   * - laneRow: 同一 lane 内第几行（0 开始）
   * - laneCol: 同一 lane 内第几列（0 开始）
   */
  laneRow?: number
  laneCol?: number
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
    /** 泳道标题栏（整段色带）→ GroupNode `laneHeaderBackground`；标题文字无独立底色 */
    laneHeaderBackground?: string
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

function isDecisionNode(node: SwimlaneDraftNode): boolean {
  return node.semanticType === 'decision' || node.shape === 'diamond'
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.round(n))
}

function cloneDraft(draft: SwimlaneDraft): SwimlaneDraft {
  return {
    ...draft,
    lanes: draft.lanes.map((lane) => ({ ...lane })),
    nodes: draft.nodes.map((node) => ({ ...node })),
    edges: draft.edges.map((edge) => ({ ...edge })),
  }
}

const EDGE_SEMANTIC_TYPES = new Set<NonNullable<SwimlaneDraftEdge['semanticType']>>([
  'normal',
  'crossLane',
  'returnFlow',
  'conditional',
])

function normalizeEdgeSemanticType(value: unknown): SwimlaneDraftEdge['semanticType'] | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  return EDGE_SEMANTIC_TYPES.has(raw as NonNullable<SwimlaneDraftEdge['semanticType']>)
    ? (raw as SwimlaneDraftEdge['semanticType'])
    : undefined
}

function isYesNoLabel(text: unknown): boolean {
  const t = String(text ?? '').trim().toLowerCase()
  if (!t) return false
  return t === 'yes' || t === 'no' || t === '是' || t === '否'
}

function isReturnLabel(text: unknown): boolean {
  const t = String(text ?? '').trim()
  if (!t) return false
  return /(回流|驳回|退回|重试|回退|返回)/.test(t)
}

const HIDDEN_EDGE_RELATION_LABELS = new Set([
  'next',
  'submit_to',
  'notify',
  'request',
  'return_to',
  'cancel_to',
])

function normalizeRelationToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function sanitizeEdgeLabel(
  labelValue: unknown,
  relationValue?: unknown,
): string | undefined {
  if (typeof labelValue !== 'string') return undefined
  const trimmed = labelValue.trim()
  if (!trimmed) return undefined
  const labelToken = normalizeRelationToken(trimmed)
  const relationToken = normalizeRelationToken(relationValue)
  const token = labelToken || relationToken

  if (HIDDEN_EDGE_RELATION_LABELS.has(token)) return undefined
  if (labelToken === 'yes') return '是'
  if (labelToken === 'no') return '否'
  return trimmed.slice(0, 12)
}

/**
 * Detect implied return flow by geometric position first (laneCol/laneRow),
 * falling back to order only when geometry is unavailable.
 * Horizontal swimlanes flow left-to-right so "backward" = target is left of source.
 * Vertical swimlanes flow top-to-bottom so "backward" = target is above source.
 */
function isImpliedReturnFlow(
  sourceNode: SwimlaneDraftNode,
  targetNode: SwimlaneDraftNode,
  direction: SwimlaneDraft['direction'],
): boolean {
  if (sourceNode.laneId !== targetNode.laneId) return false
  const isHorizontal = direction === 'horizontal'

  const srcPrimary = isHorizontal ? sourceNode.laneCol : sourceNode.laneRow
  const tgtPrimary = isHorizontal ? targetNode.laneCol : targetNode.laneRow
  if (srcPrimary != null && tgtPrimary != null) {
    if (srcPrimary !== tgtPrimary) return srcPrimary > tgtPrimary
    const srcSecondary = isHorizontal ? sourceNode.laneRow : sourceNode.laneCol
    const tgtSecondary = isHorizontal ? targetNode.laneRow : targetNode.laneCol
    if (srcSecondary != null && tgtSecondary != null && srcSecondary !== tgtSecondary) {
      return srcSecondary > tgtSecondary
    }
  }

  return (sourceNode.order ?? 0) > (targetNode.order ?? 0)
}

function isCrossLaneReturnFlowEdge(
  edge: SwimlaneDraftEdge,
  nodeById: Map<string, SwimlaneDraftNode>,
): boolean {
  if (edge.semanticType !== 'returnFlow') return false
  const sourceNode = nodeById.get(edge.source)
  const targetNode = nodeById.get(edge.target)
  if (!sourceNode || !targetNode) return false
  return sourceNode.laneId !== targetNode.laneId
}

function pruneCrossLaneReturnFlowEdges(
  edges: SwimlaneDraftEdge[],
  nodeById: Map<string, SwimlaneDraftNode>,
  laneOrderById: Map<string, number>,
): SwimlaneDraftEdge[] {
  if (edges.length <= 1) return edges

  const sameLaneReturnSources = new Set<string>()
  for (const edge of edges) {
    if (edge.semanticType !== 'returnFlow') continue
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) continue
    if (sourceNode.laneId === targetNode.laneId) sameLaneReturnSources.add(edge.source)
  }

  // 同 source 已有同泳道回流时，移除对应跨泳道回流。
  const afterSameLanePrune = edges.filter((edge) => {
    return !(isCrossLaneReturnFlowEdge(edge, nodeById) && sameLaneReturnSources.has(edge.source))
  })

  // 全图跨泳道回流边最多保留 1 条，确保初稿清晰。
  const crossReturnWithIndex = afterSameLanePrune
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => isCrossLaneReturnFlowEdge(edge, nodeById))

  if (crossReturnWithIndex.length <= 1) return afterSameLanePrune

  const best = [...crossReturnWithIndex].sort((a, b) => {
    const sa = nodeById.get(a.edge.source)
    const ta = nodeById.get(a.edge.target)
    const sb = nodeById.get(b.edge.source)
    const tb = nodeById.get(b.edge.target)
    const laneGapA = Math.abs((laneOrderById.get(sa?.laneId ?? '') ?? 0) - (laneOrderById.get(ta?.laneId ?? '') ?? 0))
    const laneGapB = Math.abs((laneOrderById.get(sb?.laneId ?? '') ?? 0) - (laneOrderById.get(tb?.laneId ?? '') ?? 0))
    const orderGapA = Math.max(0, Number(sa?.order ?? 0) - Number(ta?.order ?? 0))
    const orderGapB = Math.max(0, Number(sb?.order ?? 0) - Number(tb?.order ?? 0))
    const labelPenaltyA = isReturnLabel(a.edge.label) ? 0 : 1
    const labelPenaltyB = isReturnLabel(b.edge.label) ? 0 : 1
    const scoreA = labelPenaltyA * 1_000_000 + laneGapA * 1_000 + orderGapA
    const scoreB = labelPenaltyB * 1_000_000 + laneGapB * 1_000 + orderGapB
    if (scoreA !== scoreB) return scoreA - scoreB
    return a.index - b.index
  })[0]

  const keepId = best?.edge.id
  return afterSameLanePrune.filter((edge) => {
    if (!isCrossLaneReturnFlowEdge(edge, nodeById)) return true
    return edge.id === keepId
  })
}

/**
 * 对 Draft 做“生成链路兜底归一化”：
 * 1) lane 顺序连续；
 * 2) node 必有有效 laneId（便于后续 parentId + laneId 双归属）；
 * 3) edge.semanticType 显式且与跨泳道/回流语义一致。
 */
function enforceSwimlaneDraftSemantics(input: SwimlaneDraft): SwimlaneDraft {
  const draft = cloneDraft(input)

  const lanesSorted = [...draft.lanes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const lanes: SwimlaneDraft['lanes'] = []
  const laneIdSeen = new Set<string>()
  for (let i = 0; i < lanesSorted.length; i += 1) {
    const lane = lanesSorted[i]
    const title = String(lane?.title ?? '').trim() || `泳道${i + 1}`
    const baseId = String(lane?.id ?? '').trim() || `lane-${slug(title) || i + 1}`
    let id = baseId
    let k = 2
    while (laneIdSeen.has(id)) {
      id = `${baseId}-${k}`
      k += 1
    }
    laneIdSeen.add(id)
    const headerBg = String(lane?.laneHeaderBackground ?? '').trim()
    lanes.push({
      id,
      title,
      order: lanes.length,
      ...(headerBg ? { laneHeaderBackground: headerBg.slice(0, 120) } : {}),
    })
  }
  if (lanes.length === 0) {
    lanes.push({ id: 'lane-default', title: '默认泳道', order: 0 })
    laneIdSeen.add('lane-default')
  }
  draft.lanes = lanes
  const laneOrderById = new Map(draft.lanes.map((lane) => [lane.id, lane.order]))
  const fallbackLaneId = lanes[0].id

  const nodes: SwimlaneDraftNode[] = []
  const nodeIdSeen = new Set<string>()
  for (let i = 0; i < draft.nodes.length; i += 1) {
    const node = draft.nodes[i]
    const baseId = String(node?.id ?? '').trim() || `n-${i + 1}`
    let id = baseId
    let k = 2
    while (nodeIdSeen.has(id)) {
      id = `${baseId}-${k}`
      k += 1
    }
    nodeIdSeen.add(id)
    const semanticType =
      (node.semanticType as SwimlaneDraftNode['semanticType'] | undefined) ??
      (node.shape === 'diamond' ? 'decision' : undefined)
    const shape = node.shape ?? inferShape(semanticType)
    const laneId = laneIdSeen.has(String(node.laneId ?? '')) ? String(node.laneId) : fallbackLaneId
    nodes.push({
      ...node,
      id,
      title: String(node.title ?? '').trim().slice(0, 16),
      laneId,
      semanticType,
      shape,
      order: Number.isFinite(node.order) ? Number(node.order) : i,
      laneRow: Number.isFinite(node.laneRow) ? Math.max(0, Math.round(Number(node.laneRow))) : undefined,
      laneCol: Number.isFinite(node.laneCol) ? Math.max(0, Math.round(Number(node.laneCol))) : undefined,
    })
  }
  draft.nodes = nodes
  const nodeById = new Map(draft.nodes.map((node) => [node.id, node]))

  const edges: SwimlaneDraftEdge[] = []
  const edgeIdSeen = new Set<string>()
  for (let i = 0; i < draft.edges.length; i += 1) {
    const edge = draft.edges[i]
    const source = String(edge.source ?? '').trim()
    const target = String(edge.target ?? '').trim()
    if (!nodeById.has(source) || !nodeById.has(target)) continue
    const sourceNode = nodeById.get(source)!
    const targetNode = nodeById.get(target)!
    const isCrossLane = sourceNode.laneId !== targetNode.laneId
    const explicit = normalizeEdgeSemanticType(edge.semanticType)

    let semanticType: SwimlaneDraftEdge['semanticType']
    if (isCrossLane) {
      semanticType = explicit === 'returnFlow' || isReturnLabel(edge.label) ? 'returnFlow' : 'crossLane'
    } else if (explicit === 'returnFlow') {
      semanticType = 'returnFlow'
    } else if (isImpliedReturnFlow(sourceNode, targetNode, draft.direction)) {
      semanticType = 'returnFlow'
    } else if (explicit === 'conditional' || isDecisionNode(sourceNode) || isYesNoLabel(edge.label)) {
      semanticType = 'conditional'
    } else {
      semanticType = 'normal'
    }

    const baseId = String(edge?.id ?? '').trim() || `e-${i + 1}`
    let id = baseId
    let k = 2
    while (edgeIdSeen.has(id)) {
      id = `${baseId}-${k}`
      k += 1
    }
    edgeIdSeen.add(id)

    edges.push({
      ...edge,
      id,
      source,
      target,
      label: sanitizeEdgeLabel(edge.label),
      semanticType,
    })
  }
  draft.edges = pruneCrossLaneReturnFlowEdges(edges, nodeById, laneOrderById)
  return draft
}

/**
 * 为泳道图补齐 laneRow/laneCol：
 * 1) 决策节点多出边时，目标节点分行；
 * 2) A 跨过 B 直连 C（同 lane）时，把 B 下沉到 C 的下一行，并与 C 同列。
 */
export function applySwimlaneDraftLaneHeuristics(input: SwimlaneDraft): SwimlaneDraft {
  const draft = cloneDraft(input)
  const nodeById = new Map(draft.nodes.map((node) => [node.id, node]))
  const explicitLaneRowIds = new Set(
    input.nodes
      .filter((node) => Number.isFinite(node.laneRow))
      .map((node) => node.id),
  )
  const explicitLaneColIds = new Set(
    input.nodes
      .filter((node) => Number.isFinite(node.laneCol))
      .map((node) => node.id),
  )
  const outBySource = new Map<string, SwimlaneDraftEdge[]>()
  for (const edge of draft.edges) {
    const arr = outBySource.get(edge.source)
    if (arr) arr.push(edge)
    else outBySource.set(edge.source, [edge])
  }

  const laneNodes = new Map<string, SwimlaneDraftNode[]>()
  for (const node of draft.nodes) {
    const list = laneNodes.get(node.laneId)
    if (list) list.push(node)
    else laneNodes.set(node.laneId, [node])
  }
  for (const nodes of laneNodes.values()) {
    nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i]
      n.laneRow = normalizeNonNegativeInt(n.laneRow, 0)
      n.laneCol = normalizeNonNegativeInt(n.laneCol, i)
    }
  }

  // 规则 1：decision 出边目标分行（按目标在各自 lane 内顺序分配）
  for (const decision of draft.nodes) {
    if (!isDecisionNode(decision)) continue
    const outgoing = outBySource.get(decision.id) ?? []
    // 克制：仅处理典型二分 decision，避免多分支导致大量折行
    if (outgoing.length !== 2) continue
    const targetsByLane = new Map<string, SwimlaneDraftNode[]>()
    for (const edge of outgoing) {
      const target = nodeById.get(edge.target)
      if (!target) continue
      const list = targetsByLane.get(target.laneId)
      if (list) list.push(target)
      else targetsByLane.set(target.laneId, [target])
    }
    for (const targets of targetsByLane.values()) {
      // 仅在“同 row 且同列冲突”时才分行；否则保留单行横向优先。
      if (targets.length < 2) continue
      targets.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const a = targets[0]
      const b = targets[1]
      const sameRow = (a.laneRow ?? 0) === (b.laneRow ?? 0)
      const sameCol = (a.laneCol ?? -1) === (b.laneCol ?? -2)
      const bothExplicit = explicitLaneRowIds.has(a.id) && explicitLaneRowIds.has(b.id)
      if (!sameRow || !sameCol || bothExplicit) continue

      const baseRow = a.laneRow ?? 0
      if (!explicitLaneRowIds.has(b.id)) {
        b.laneRow = Math.max(b.laneRow ?? 0, baseRow + 1)
      }
    }
  }

  // 规则 2：A->C 跨过中间节点 B（同 lane）时，让 B 下沉并与 C 同列
  for (const nodes of laneNodes.values()) {
    const indexById = new Map(nodes.map((n, i) => [n.id, i]))
    for (const edge of draft.edges) {
      const edgeSemantic = edge.semanticType ?? 'normal'
      if (edgeSemantic !== 'normal') continue
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) continue
      if (source.laneId !== target.laneId) continue
      if (source.laneId !== nodes[0]?.laneId) continue
      const sIdx = indexById.get(source.id)
      const tIdx = indexById.get(target.id)
      if (sIdx == null || tIdx == null) continue
      // 克制：仅处理“恰好跨过 1 个中间节点”的 A->C（A,B,C）模式。
      if (tIdx !== sIdx + 2) continue
      const mid = nodes[sIdx + 1]
      if (!mid) continue

      const targetRow = target.laneRow ?? 0
      const targetCol = target.laneCol ?? tIdx
      const sourceRow = source.laneRow ?? 0
      const midRow = mid.laneRow ?? 0
      // 仅当三者当前在同一 row（会形成跨越遮挡）时才下沉中间节点。
      if (sourceRow === targetRow && midRow === targetRow) {
        if (!explicitLaneRowIds.has(mid.id)) {
          mid.laneRow = Math.max(mid.laneRow ?? 0, targetRow + 1)
        }
        if (!explicitLaneColIds.has(mid.id)) {
          mid.laneCol = targetCol
        }
      }
    }
  }

  return draft
}

export function swimlaneDraftToGraphBatchPayload(
  draft: SwimlaneDraft,
): GraphBatchPayload {
  const normalizedDraft = applySwimlaneDraftLaneHeuristics(enforceSwimlaneDraftSemantics(draft))
  const ops: GraphOperation[] = []

  // lanes -> createFrame (排序后按 order)
  const sortedLanes = [...normalizedDraft.lanes].sort((a, b) => a.order - b.order)
  for (const lane of sortedLanes) {
    const headerBg = String(lane.laneHeaderBackground ?? '').trim()
    const laneStyle: Record<string, unknown> = {}
    if (headerBg) laneStyle.laneHeaderBackground = headerBg.slice(0, 120)
    ops.push({
      op: 'graph.createFrame',
      params: {
        id: lane.id,
        title: lane.title,
        ...(Object.keys(laneStyle).length ? { style: laneStyle } : {}),
      },
    })
  }

  // nodes -> createNodeQuad
  for (const node of normalizedDraft.nodes) {
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
          laneId: node.laneId,
          ...(node.semanticType ? { semanticType: node.semanticType } : {}),
          ...(node.order != null ? { nodeOrder: node.order } : {}),
          ...(node.laneRow != null ? { laneRow: node.laneRow } : {}),
          ...(node.laneCol != null ? { laneCol: node.laneCol } : {}),
        } as any,
      },
    })
  }

  // edges -> createEdge
  for (const edge of normalizedDraft.edges) {
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
      direction: normalizedDraft.direction === 'horizontal' ? 'LR' : 'TB',
      scope: 'all',
    },
  })

  return {
    version: '1.0',
    source: 'swimlane-draft',
    graphType: 'swimlane',
    direction: normalizedDraft.direction === 'horizontal' ? 'LR' : 'TB',
    operations: ops,
    meta: {
      layoutProfile: 'swimlane',
      swimlaneDirection: normalizedDraft.direction,
      /** 文本泳道 Draft：不自动注入语义节点色等预设 */
      neutralGeneration: true,
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
    // 优先回到最近的同 lane 上游节点；若找不到，则不自动补跨泳道回流（保持初稿清晰）。
    let to: SwimlaneDraftNode | undefined
    for (let j = i - 1; j >= 0; j -= 1) {
      if (nodes[j].laneId === from.laneId) {
        to = nodes[j]
        break
      }
    }
    if (!to) continue
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
  } satisfies SwimlaneDraft
}

type GenerateSwimlaneDraftOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
}

const SWIMLANE_DRAFT_SYSTEM_PROMPT = `
你是一个“自然语言 -> 标准泳道图逻辑”的转译器。
目标不是完整保留用户描述，而是压缩为“简单、稳定、接近真实业务”的泳道流程结构。

一、布局规则（必须遵守）
1) 泳道从上到下排列（每行一个角色）。
2) 流程从左到右推进。
3) 主流程必须是水平向右推进的单链路。
4) 每个泳道内部步骤优先横向（左到右）顺序排列。
5) 主路径不允许明显回头。

二、连接规则（核心约束）
1) 绝大多数节点必须 1 by 1 连接：
   - 普通节点仅连一个下游；
   - 普通节点不允许多入多出。
2) 只允许判断节点产生分支，且最多 2 条（yes/no），并尽快收敛。
3) 严格限制跨泳道：
   - 默认禁止跨泳道；
   - 仅在“责任交接”时允许：submit_to / request / notify / return_to / cancel_to；
   - 不允许频繁跨泳道、不允许跨多个泳道远距连接、不允许来回横跳。
重要原则：能在当前泳道完成就不要跨泳道。
4) 每个节点必须明确归属某个泳道，禁止归属模糊。
5) decision 节点的 yes/no 分支必须走不同 handle（不要求固定左右），不要单侧多叉。

三、结构收敛原则
- 用户描述复杂时，主动简化；
- 优先保留主流程；
- 删除次要步骤、合并相似动作、压缩冗余；
- 复杂关系改写为“逐角色串行交接”。
宁可简单，不要复杂；宁可少，不要乱。

四、典型业务结构（优先套用）
开始 -> 提交 -> 记录 -> 审核 -> 判断 -> 批准/驳回 -> 执行 -> 通知 -> 结束

五、节点语义（必须体现形状）
- start_end
- process
- decision
- io
禁止所有节点同一种类型。

六、回流与异常（严格控制）
1) 回流最多 1~2 条；
2) 只回到最近合理上游；
3) 不允许长距离回流；
4) 取消/终止走独立短路径并快速结束；
5) 异常路径不反复穿插主流程。
6) 跨泳道回流默认尽量不画；若业务强需要，最多保留 1 条最关键跨泳道回流，其余交给用户手动补线。

七、输出前自检（必须执行）
1) 大多数节点是否 1 by 1？
2) 跨泳道是否很少？
3) 是否没有网状结构？
4) 是否没有多余分支？
5) 主流程是否清晰左到右？
6) 是否符合真实审批直觉？
若不满足，先简化再输出。

八、最终原则（最重要）
不要忠实还原全部关系；主动压缩为“简单、顺序、责任清晰”的泳道流程链。

输出要求（必须遵守）
1) 只输出严格 JSON，不要 markdown，不要解释，不要注释。
2) 输出必须是“纯 JSON 文本”，首字符必须是 {，尾字符必须是 }，禁止任何前后缀。
3) 严禁输出 \`\`\`json 或 \`\`\` 包裹代码块。
4) 输出结构必须包含：title, direction, lanes, nodes, edges。
5) 除非用户明确只有单一参与方，否则不要退化为单泳道。
6) lanes.order 必须从 0 开始连续递增（0,1,2...）。
7) 每条 edge 必须有 semanticType，且跨泳道边优先显式为 crossLane；跨泳道 returnFlow 必须极少（默认 0，最多 1）。
8) nodes 必须有 laneId（后续会映射为 parentId + laneId 双归属）。
9) 泳道配色：laneHeaderBackground 为标题栏整段色带；仅当用户明确要求时再输出；默认不要输出装饰性颜色字段。不要输出泳道描边色 stroke / strokeWidth（由产品统一）。
9) laneHeaderBackground（泳道标题条底色）：仅当用户在描述中**明确要求**泳道标题/底色配色时才输出；默认不要输出任何泳道或节点的装饰性颜色字段。


优先输出语义 schema（推荐）：
{
  "title": "流程名称",
  "direction": "horizontal",
  "lanes": [{ "id": "lane-user", "title": "用户", "order": 0 }],
  "nodes": [
    { "id": "n1", "label": "提交订单", "lane": "用户", "type": "process" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "relation": "next" }
  ]
}

relation 仅允许：
next | yes | no | submit_to | notify | request | return_to | cancel_to

兼容输出（也接受）：
{
  "title": "流程名称",
  "direction": "horizontal" | "vertical",
  "lanes": [{ "id": "lane-id", "title": "角色名", "order": 0 }],
  "nodes": [{
    "id": "n-1",
    "title": "短标题",
    "subtitle": "可选",
    "shape": "rect|circle|diamond",
    "laneId": "lane-id",
    "semanticType": "start|task|decision|end|data",
    "order": 0,
    "laneRow": 0,
    "laneCol": 0
  }],
  "edges": [{
    "id": "e-1",
    "source": "n-1",
    "target": "n-2",
    "label": "可选短词",
    "semanticType": "normal|crossLane|returnFlow|conditional"
  }]
}
`.trim()

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

function normalizeStartEndSemantic(title: string, index: number, total: number): 'start' | 'end' {
  const t = title.trim()
  if (/(开始|发起|启动|start)/i.test(t)) return 'start'
  if (/(结束|完成|终止|关闭|end)/i.test(t)) return 'end'
  if (index === 0) return 'start'
  if (index === total - 1) return 'end'
  return 'start'
}

function mapUserNodeTypeToSemanticType(typeValue: unknown, title: string, index: number, total: number): SwimlaneDraftNode['semanticType'] | undefined {
  const raw = String(typeValue ?? '').trim().toLowerCase()
  if (!raw) return undefined
  if (raw === 'start' || raw === 'start_end' || raw === 'start-end') return normalizeStartEndSemantic(title, index, total)
  if (raw === 'end') return 'end'
  if (raw === 'process' || raw === 'task') return 'task'
  if (raw === 'decision' || raw === 'judge' || raw === 'condition') return 'decision'
  if (raw === 'io' || raw === 'input' || raw === 'output' || raw === 'message') return 'data'
  if (raw === 'subprocess' || raw === 'sub-process') return 'task'
  if (raw === 'data') return 'data'
  return undefined
}

function mapRelationToSemanticType(relationValue: unknown): SwimlaneDraftEdge['semanticType'] | undefined {
  const relation = String(relationValue ?? '').trim().toLowerCase()
  if (!relation) return undefined
  if (relation === 'yes' || relation === 'no') return 'conditional'
  if (relation === 'return_to') return 'returnFlow'
  if (relation === 'submit_to' || relation === 'notify' || relation === 'request') return 'crossLane'
  if (relation === 'cancel_to') return 'conditional'
  return undefined
}

/**
 * 兼容两类 LLM 输出：
 * A) 现有 Flow2Go schema（title/laneId/source/semanticType）
 * B) 语义转译 schema（label/lane/type + from/to/relation）
 */
export function normalizeSwimlaneDraftCandidate(input: any): any {
  if (!input || typeof input !== 'object') return input

  const hasNodes = Array.isArray(input.nodes)
  const hasEdges = Array.isArray(input.edges)
  if (!hasNodes || !hasEdges) return input

  const usesLogicNodeSchema = input.nodes.some((n: any) => n && (n.label != null || n.lane != null || n.type != null))
  const usesLogicEdgeSchema = input.edges.some((e: any) => e && (e.from != null || e.to != null || e.relation != null))
  if (!usesLogicNodeSchema && !usesLogicEdgeSchema) return input

  const rawNodes = Array.isArray(input.nodes) ? input.nodes : []
  const rawLanes = Array.isArray(input.lanes) ? input.lanes : []
  const rawEdges = Array.isArray(input.edges) ? input.edges : []
  const lanes: SwimlaneDraft['lanes'] = []
  const laneIdByKey = new Map<string, string>()

  const registerLane = (id: string, title: string, order: number, headerBgRaw?: unknown) => {
    const keyId = id.toLowerCase()
    const keyTitle = title.toLowerCase()
    if (!laneIdByKey.has(keyId)) laneIdByKey.set(keyId, id)
    if (!laneIdByKey.has(keyTitle)) laneIdByKey.set(keyTitle, id)
    const headerBg = String(headerBgRaw ?? '').trim().slice(0, 120)
    const existing = lanes.find((lane) => lane.id === id)
    if (existing) {
      if (headerBg && !existing.laneHeaderBackground) existing.laneHeaderBackground = headerBg
      return
    }
    lanes.push({
      id,
      title,
      order,
      ...(headerBg ? { laneHeaderBackground: headerBg } : {}),
    })
  }

  const ensureLane = (laneValue: unknown, orderHint: number): string => {
    const raw = String(laneValue ?? '').trim()
    const fallbackTitle = raw || `泳道${orderHint + 1}`
    const normalizedKey = fallbackTitle.toLowerCase()
    const known = laneIdByKey.get(normalizedKey)
    if (known) return known

    const id = `lane-${slug(fallbackTitle) || orderHint + 1}`
    let uniqId = id
    let k = 2
    while (lanes.some((lane) => lane.id === uniqId)) {
      uniqId = `${id}-${k}`
      k += 1
    }
    registerLane(uniqId, fallbackTitle, lanes.length)
    return uniqId
  }

  for (let i = 0; i < rawLanes.length; i += 1) {
    const lane = rawLanes[i]
    if (typeof lane === 'string') {
      ensureLane(lane, i)
      continue
    }
    const title = String(lane?.title ?? lane?.name ?? lane?.label ?? '').trim()
    const idRaw = String(lane?.id ?? '').trim()
    const stripBg = lane?.laneHeaderBackground ?? (lane as any)?.headerBackground
    const titleFinal = title || `泳道${i + 1}`
    const idFinal = idRaw || `lane-${slug(titleFinal) || i + 1}`
    registerLane(
      idFinal,
      titleFinal,
      Number.isFinite(lane?.order) ? lane.order : lanes.length,
      stripBg,
    )
  }

  const nodes = rawNodes.map((node: any, i: number) => {
    const id = String(node?.id ?? `n-${i + 1}`).trim() || `n-${i + 1}`
    const title = String(node?.title ?? node?.label ?? '').trim().slice(0, 16)
    const semanticType =
      (node?.semanticType as SwimlaneDraftNode['semanticType'] | undefined) ??
      mapUserNodeTypeToSemanticType(node?.type, title, i, rawNodes.length)
    const shape =
      node?.shape ??
      (semanticType === 'decision'
        ? 'diamond'
        : semanticType === 'start' || semanticType === 'end'
          ? 'circle'
          : 'rect')
    const laneId = ensureLane(node?.laneId ?? node?.lane, i)
    return {
      id,
      title,
      subtitle: typeof node?.subtitle === 'string' ? node.subtitle.slice(0, 24) : undefined,
      shape,
      laneId,
      semanticType,
      order: Number.isFinite(node?.order) ? node.order : i,
      laneRow: Number.isFinite(node?.laneRow) ? Math.max(0, Math.round(Number(node.laneRow))) : undefined,
      laneCol: Number.isFinite(node?.laneCol) ? Math.max(0, Math.round(Number(node.laneCol))) : undefined,
    }
  })

  const edges = rawEdges.map((edge: any, i: number) => {
    const relation = String(edge?.relation ?? '').trim().toLowerCase()
    const semanticType =
      (edge?.semanticType as SwimlaneDraftEdge['semanticType'] | undefined) ??
      mapRelationToSemanticType(relation)
    const cleanedLabel = sanitizeEdgeLabel(edge?.label, relation)
    const label =
      cleanedLabel ??
      (relation === 'yes'
        ? '是'
        : relation === 'no'
          ? '否'
          : undefined)
    return {
      id: String(edge?.id ?? `e-${i + 1}`),
      source: String(edge?.source ?? edge?.from ?? ''),
      target: String(edge?.target ?? edge?.to ?? ''),
      label,
      semanticType,
    }
  })

  lanes.sort((a, b) => a.order - b.order)
  lanes.forEach((lane, idx) => {
    lane.order = idx
  })

  return {
    title: String(input.title ?? input.flowName ?? input.processName ?? '泳道图').slice(0, 24),
    direction: input.direction === 'vertical' ? 'vertical' : 'horizontal',
    lanes,
    nodes,
    edges,
  } satisfies SwimlaneDraft
}

function validateSwimlaneDraft(draft: any): SwimlaneDraft {
  draft = normalizeSwimlaneDraftCandidate(draft)
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
    const title = String(l?.title ?? l?.name ?? l?.label ?? '').trim() || id
    const stripRaw = l?.laneHeaderBackground ?? l?.headerBackground
    const strip = typeof stripRaw === 'string' ? stripRaw.trim().slice(0, 120) : ''
    laneIds.add(id)
    return {
      id,
      title,
      order: Number.isFinite(l?.order) ? l.order : i,
      ...(strip ? { laneHeaderBackground: strip } : {}),
    }
  })
  draft.lanes.sort((a: any, b: any) => a.order - b.order)
  draft.lanes.forEach((lane: any, idx: number) => {
    lane.order = idx
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
      laneRow: Number.isFinite(n?.laneRow) ? Math.max(0, Math.round(Number(n.laneRow))) : undefined,
      laneCol: Number.isFinite(n?.laneCol) ? Math.max(0, Math.round(Number(n.laneCol))) : undefined,
    }
  })
  draft.edges = draft.edges.map((e: any, i: number) => {
    const source = String(e?.source ?? '')
    const target = String(e?.target ?? '')
    if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error(`edge[${i}] source/target 无效`)
    const relation = normalizeRelationToken(e?.relation)
    const cleanedLabel = sanitizeEdgeLabel(e?.label, relation)
    const label =
      cleanedLabel ??
      (relation === 'yes'
        ? '是'
        : relation === 'no'
          ? '否'
          : undefined)
    return {
      id: String(e?.id ?? `e-${i + 1}`),
      source,
      target,
      label,
      semanticType: e?.semanticType,
    }
  })
  return applySwimlaneDraftLaneHeuristics(enforceSwimlaneDraftSemantics(draft as SwimlaneDraft))
}

export async function generateSwimlaneDraftWithLLM(
  opts: GenerateSwimlaneDraftOptions,
): Promise<SwimlaneDraft> {
  const { apiKey, model, prompt, signal, timeoutMs = 90_000 } = opts
  // Key 可选：生产环境可通过服务端代理环境变量提供
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await routifyChatCompletions({
      body: {
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: SWIMLANE_DRAFT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      },
      signal: controller.signal,
      bearerFallback: apiKey,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Routify 请求失败: ${res.status} ${text}`)
    const json = safeJsonParse(JSON.parse(text).choices?.[0]?.message?.content ?? '')
    return validateSwimlaneDraft(json)
  } catch (e) {
    if (signal?.aborted) throw new Error('已取消本次泳道图生成')
    if (controller.signal.aborted) throw new Error(`生成泳道图请求超时（>${Math.round(timeoutMs / 1000)}s）`)
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
