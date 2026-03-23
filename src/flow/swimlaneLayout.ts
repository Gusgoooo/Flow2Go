/**
 * Swimlane 专用自动布局。
 * 两阶段：A) 排列 lane 容器  B) 布局 lane 内节点
 * 不依赖 ELK / Dagre，纯规则布局，保证结果稳定。
 */
import type { Edge, Node } from '@xyflow/react'
import type { FlowDirection } from './mermaid/types'

const LANE_HEADER_SIZE = 44
const LANE_GAP = 24
const LANE_PADDING = { top: 20, right: 24, bottom: 20, left: 24 }
const MIN_LANE_WIDTH = 900
const MIN_LANE_HEIGHT = 160
const CANVAS_START_X = 80
const CANVAS_START_Y = 80
const NODE_GAP_X = 48
const NODE_GAP_Y = 32

const DEFAULT_NODE_SIZES: Record<string, { w: number; h: number }> = {
  rect: { w: 140, h: 56 },
  circle: { w: 64, h: 64 },
  diamond: { w: 96, h: 64 },
}

function getNodeSize(n: Node<any>): { w: number; h: number } {
  const w = n.measured?.width ?? n.width ?? (typeof (n.style as any)?.width === 'number' ? (n.style as any).width : undefined) ?? 160
  const h = n.measured?.height ?? n.height ?? (typeof (n.style as any)?.height === 'number' ? (n.style as any).height : undefined) ?? 44
  return { w, h }
}

function estimateNodeSize(n: Node<any>): { w: number; h: number } {
  const shape = (n.data as any)?.shape ?? 'rect'
  const preset = DEFAULT_NODE_SIZES[shape] ?? DEFAULT_NODE_SIZES.rect
  const existing = getNodeSize(n)
  return {
    w: existing.w > 1 ? existing.w : preset.w,
    h: existing.h > 1 ? existing.h : preset.h,
  }
}

function getAbsolutePosition(node: Node<any>, nodeById: Map<string, Node<any>>): { x: number; y: number } {
  let x = node.position?.x ?? 0
  let y = node.position?.y ?? 0
  let cur = node
  const seen = new Set<string>()
  while (cur.parentId) {
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    const p = nodeById.get(cur.parentId)
    if (!p) break
    x += p.position?.x ?? 0
    y += p.position?.y ?? 0
    cur = p
  }
  return { x, y }
}

function getHandlePoint(
  node: Node<any>,
  handle: string,
  nodeById: Map<string, Node<any>>,
): { x: number; y: number } {
  const abs = getAbsolutePosition(node, nodeById)
  const size = estimateNodeSize(node)
  if (handle.endsWith('-top')) return { x: abs.x + size.w / 2, y: abs.y }
  if (handle.endsWith('-bottom')) return { x: abs.x + size.w / 2, y: abs.y + size.h }
  if (handle.endsWith('-left')) return { x: abs.x, y: abs.y + size.h / 2 }
  return { x: abs.x + size.w, y: abs.y + size.h / 2 }
}

/**
 * 简单拓扑排序：用边关系决定节点顺序。
 * 若有环或不连通则按 nodeOrder / 创建顺序回退。
 */
function topoSort(nodeIds: string[], edges: Edge[]): string[] {
  const idSet = new Set(nodeIds)
  const adj = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of idSet) {
    adj.set(id, [])
    indeg.set(id, 0)
  }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  const queue = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0)
  const result: string[] = []
  while (queue.length > 0) {
    const cur = queue.shift()!
    result.push(cur)
    for (const nxt of adj.get(cur) ?? []) {
      const d = (indeg.get(nxt) ?? 1) - 1
      indeg.set(nxt, d)
      if (d === 0) queue.push(nxt)
    }
  }
  // 环或孤立节点
  for (const id of nodeIds) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

export function autoLayoutSwimlane(args: {
  nodes: Node<any>[]
  edges: Edge<any>[]
  direction: FlowDirection
  swimlaneDirection?: 'horizontal' | 'vertical'
}): { nodes: Node<any>[]; edges: Edge<any>[] } {
  const { nodes, edges, swimlaneDirection = 'horizontal' } = args
  const isHorizontal = swimlaneDirection === 'horizontal'

  const lanes = nodes.filter(
    (n) => n.type === 'group' && (n.data as any)?.role === 'lane',
  )
  const nonLaneNodes = nodes.filter((n) => !lanes.find((l) => l.id === n.id))

  // 按 laneIndex 排序
  lanes.sort((a, b) => {
    const ai = (a.data as any)?.laneMeta?.laneIndex ?? 0
    const bi = (b.data as any)?.laneMeta?.laneIndex ?? 0
    return ai - bi
  })

  // ── Phase B: 在每个 lane 内布局子节点 ──
  const laneSizes: { id: string; contentW: number; contentH: number }[] = []
  for (const lane of lanes) {
    const children = nonLaneNodes
      .filter((n) => n.parentId === lane.id)
      .sort((a, b) => {
        const ao = (a.data as any)?.nodeOrder
        const bo = (b.data as any)?.nodeOrder
        if (ao != null && bo != null) return ao - bo
        return 0
      })

    if (children.length === 0) {
      laneSizes.push({ id: lane.id, contentW: 0, contentH: 0 })
      continue
    }

    // 若 nodeOrder 全缺则用拓扑排序
    const hasOrder = children.some((c) => (c.data as any)?.nodeOrder != null)
    const ordered = hasOrder
      ? children
      : (() => {
          const sortedIds = topoSort(
            children.map((c) => c.id),
            edges,
          )
          const byId = new Map(children.map((c) => [c.id, c]))
          return sortedIds.map((id) => byId.get(id)!).filter(Boolean)
        })()

    const headerH = LANE_HEADER_SIZE
    const padTop = LANE_PADDING.top + headerH
    const padRight = LANE_PADDING.right
    const padBottom = LANE_PADDING.bottom
    const padLeft = LANE_PADDING.left

    let totalContentW = 0
    let totalContentH = 0

    if (isHorizontal) {
      // 节点在 lane 内从左到右排列
      let cx = padLeft
      let maxH = 0
      for (const child of ordered) {
        const size = estimateNodeSize(child)
        child.width = size.w
        child.height = size.h
        child.style = { ...(child.style as any), width: size.w, height: size.h }
        child.position = { x: cx, y: padTop }
        cx += size.w + NODE_GAP_X
        maxH = Math.max(maxH, size.h)
      }
      totalContentW = cx - NODE_GAP_X + padRight
      totalContentH = padTop + maxH + padBottom
      // 垂直居中到 body 中线
      const bodyMidY = padTop + maxH / 2
      for (const child of ordered) {
        const size = estimateNodeSize(child)
        child.position = { x: child.position!.x, y: bodyMidY - size.h / 2 }
      }
    } else {
      // 节点在 lane 内从上到下排列
      let cy = padTop
      let maxW = 0
      for (const child of ordered) {
        const size = estimateNodeSize(child)
        child.width = size.w
        child.height = size.h
        child.style = { ...(child.style as any), width: size.w, height: size.h }
        child.position = { x: padLeft, y: cy }
        cy += size.h + NODE_GAP_Y
        maxW = Math.max(maxW, size.w)
      }
      totalContentW = padLeft + maxW + padRight
      totalContentH = cy - NODE_GAP_Y + padBottom
    }

    laneSizes.push({ id: lane.id, contentW: totalContentW, contentH: totalContentH })
  }

  // ── Phase A: 排列 lane 容器 ──
  if (isHorizontal) {
    // horizontal: lane 从上到下，所有 lane 统一宽度
    const unifiedW = Math.max(MIN_LANE_WIDTH, ...laneSizes.map((s) => s.contentW))
    let cy = CANVAS_START_Y
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]
      const sizeInfo = laneSizes[i]
      const h = Math.max(MIN_LANE_HEIGHT, sizeInfo.contentH)
      lane.position = { x: CANVAS_START_X, y: cy }
      lane.width = unifiedW
      lane.height = h
      lane.style = { ...(lane.style as any), width: unifiedW, height: h }
      cy += h + LANE_GAP
    }
  } else {
    // vertical: lane 从左到右，所有 lane 统一高度
    const unifiedH = Math.max(MIN_LANE_HEIGHT, ...laneSizes.map((s) => s.contentH))
    let cx = CANVAS_START_X
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]
      const sizeInfo = laneSizes[i]
      const w = Math.max(MIN_LANE_WIDTH, sizeInfo.contentW)
      lane.position = { x: cx, y: CANVAS_START_Y }
      lane.width = w
      lane.height = unifiedH
      lane.style = { ...(lane.style as any), width: w, height: unifiedH }
      cx += w + LANE_GAP
    }
  }

  // ── Phase C: edge 路由修正 ──
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const edgeLaneCounter = new Map<string, number>()
  const usedOutByNode = new Map<string, Set<string>>()
  const usedInByNode = new Map<string, Set<string>>()
  const oppositeHandle = (h: string) => {
    if (h.endsWith('-top')) return h.replace('-top', '-bottom')
    if (h.endsWith('-bottom')) return h.replace('-bottom', '-top')
    if (h.endsWith('-left')) return h.replace('-left', '-right')
    return h.replace('-right', '-left')
  }
  const chooseBestHandle = (nodeId: string, preferred: string[], mode: 'out' | 'in') => {
    const outSet = usedOutByNode.get(nodeId) ?? new Set<string>()
    const inSet = usedInByNode.get(nodeId) ?? new Set<string>()
    let best = preferred[0]
    let bestScore = Number.POSITIVE_INFINITY
    for (const h of preferred) {
      // 规则：同一个 handle 不能同时 in+out；并强惩罚对侧同时占用，避免 top/bottom 或 left/right 对冲重叠
      const sameSideConflict = mode === 'out' ? inSet.has(h) : outSet.has(h)
      const oppositeConflict = mode === 'out' ? inSet.has(oppositeHandle(h)) : outSet.has(oppositeHandle(h))
      const selfReuse = mode === 'out' ? outSet.has(h) : inSet.has(h)
      const score = (sameSideConflict ? 100 : 0) + (oppositeConflict ? 12 : 0) + (selfReuse ? 3 : 0)
      if (score < bestScore) {
        best = h
        bestScore = score
      }
    }
    return best
  }
  const markHandleUse = (nodeId: string, h: string, mode: 'out' | 'in') => {
    const map = mode === 'out' ? usedOutByNode : usedInByNode
    const set = map.get(nodeId) ?? new Set<string>()
    set.add(h)
    map.set(nodeId, set)
  }
  const updatedEdges = edges.map((e) => {
    const srcNode = nodeById.get(e.source)
    const tgtNode = nodeById.get(e.target)
    if (!srcNode || !tgtNode) return e

    const srcLaneId = (srcNode.data as any)?.laneId ?? srcNode.parentId
    const tgtLaneId = (tgtNode.data as any)?.laneId ?? tgtNode.parentId
    const isCrossLane = srcLaneId && tgtLaneId && srcLaneId !== tgtLaneId

    // 判断回流：同 lane 内 source 的 order > target 的 order
    const srcOrder = (srcNode.data as any)?.nodeOrder ?? 0
    const tgtOrder = (tgtNode.data as any)?.nodeOrder ?? 0
    const isReturnFlow =
      !isCrossLane && srcLaneId === tgtLaneId && srcOrder > tgtOrder

    const semanticType = (e.data as any)?.semanticType === 'returnFlow'
      ? 'returnFlow'
      : isReturnFlow
        ? 'returnFlow'
        : isCrossLane
          ? 'crossLane'
          : 'normal'

    let edgeType = e.type
    let edgeStyle = { ...(e.style as any) }

    if (semanticType === 'crossLane') {
      edgeType = 'smoothstep'
    } else if (semanticType === 'returnFlow') {
      edgeType = 'smoothstep'
      edgeStyle.strokeWidth = 1
      edgeStyle.opacity = 0.95
    }

    // Handle 推断（相邻优先 + 禁止同 handle 同时 in/out）
    let sourceHandle: string | undefined
    let targetHandle: string | undefined
    if (isHorizontal) {
      if (isCrossLane) {
        // 跨 lane：上下出入
        const srcLane = lanes.find((l) => l.id === srcLaneId)
        const tgtLane = lanes.find((l) => l.id === tgtLaneId)
        const srcLaneIdx = srcLane ? lanes.indexOf(srcLane) : 0
        const tgtLaneIdx = tgtLane ? lanes.indexOf(tgtLane) : 0
        if (tgtLaneIdx > srcLaneIdx) {
          sourceHandle = chooseBestHandle(e.source, ['s-bottom', 's-right', 's-left', 's-top'], 'out')
          targetHandle = chooseBestHandle(e.target, ['t-top', 't-left', 't-right', 't-bottom'], 'in')
        } else {
          sourceHandle = chooseBestHandle(e.source, ['s-top', 's-right', 's-left', 's-bottom'], 'out')
          targetHandle = chooseBestHandle(e.target, ['t-bottom', 't-left', 't-right', 't-top'], 'in')
        }
      } else if (isReturnFlow) {
        // 回流边优先相邻 handle（top/bottom），避免与主流 right->left 对冲重叠
        sourceHandle = chooseBestHandle(e.source, ['s-top', 's-bottom', 's-right', 's-left'], 'out')
        targetHandle = chooseBestHandle(e.target, ['t-top', 't-bottom', 't-left', 't-right'], 'in')
      } else {
        sourceHandle = chooseBestHandle(e.source, ['s-right', 's-top', 's-bottom', 's-left'], 'out')
        targetHandle = chooseBestHandle(e.target, ['t-left', 't-top', 't-bottom', 't-right'], 'in')
      }
    } else {
      if (isCrossLane) {
        const srcLane = lanes.find((l) => l.id === srcLaneId)
        const tgtLane = lanes.find((l) => l.id === tgtLaneId)
        const srcLaneIdx = srcLane ? lanes.indexOf(srcLane) : 0
        const tgtLaneIdx = tgtLane ? lanes.indexOf(tgtLane) : 0
        if (tgtLaneIdx > srcLaneIdx) {
          sourceHandle = chooseBestHandle(e.source, ['s-right', 's-bottom', 's-top', 's-left'], 'out')
          targetHandle = chooseBestHandle(e.target, ['t-left', 't-top', 't-bottom', 't-right'], 'in')
        } else {
          sourceHandle = chooseBestHandle(e.source, ['s-left', 's-bottom', 's-top', 's-right'], 'out')
          targetHandle = chooseBestHandle(e.target, ['t-right', 't-top', 't-bottom', 't-left'], 'in')
        }
      } else if (isReturnFlow) {
        // 回流边优先相邻 handle（left/right），避免与主流 bottom->top 对冲重叠
        sourceHandle = chooseBestHandle(e.source, ['s-left', 's-right', 's-bottom', 's-top'], 'out')
        targetHandle = chooseBestHandle(e.target, ['t-left', 't-right', 't-top', 't-bottom'], 'in')
      } else {
        sourceHandle = chooseBestHandle(e.source, ['s-bottom', 's-left', 's-right', 's-top'], 'out')
        targetHandle = chooseBestHandle(e.target, ['t-top', 't-left', 't-right', 't-bottom'], 'in')
      }
    }
    markHandleUse(e.source, sourceHandle, 'out')
    markHandleUse(e.target, targetHandle, 'in')

    const lanePairKey = `${String(srcLaneId ?? 'none')}->${String(tgtLaneId ?? 'none')}:${semanticType}`
    const laneOrder = edgeLaneCounter.get(lanePairKey) ?? 0
    edgeLaneCounter.set(lanePairKey, laneOrder + 1)
    const signed = laneOrder % 2 === 0 ? laneOrder / 2 : -((laneOrder + 1) / 2)
    const autoOffset = signed * 18

    let waypoints: Array<{ x: number; y: number }> | undefined
    if (semanticType === 'returnFlow') {
      const srcPt = getHandlePoint(srcNode, sourceHandle, nodeById)
      const tgtPt = getHandlePoint(tgtNode, targetHandle, nodeById)
      if (isHorizontal) {
        // 回流：构造多弯 C/S 结构，避免直连和重叠
        const detourY = Math.min(srcPt.y, tgtPt.y) - 72 - Math.abs(autoOffset) * 1.25
        const shoulderOut = srcPt.x >= tgtPt.x ? 56 : -56
        const shoulderIn = srcPt.x >= tgtPt.x ? -56 : 56
        waypoints = [
          { x: srcPt.x + shoulderOut, y: srcPt.y },
          { x: srcPt.x + shoulderOut, y: detourY },
          { x: tgtPt.x + shoulderIn, y: detourY },
          { x: tgtPt.x + shoulderIn, y: tgtPt.y },
        ]
      } else {
        const detourX = Math.min(srcPt.x, tgtPt.x) - 72 - Math.abs(autoOffset) * 1.25
        const shoulderOut = srcPt.y >= tgtPt.y ? 56 : -56
        const shoulderIn = srcPt.y >= tgtPt.y ? -56 : 56
        waypoints = [
          { x: srcPt.x, y: srcPt.y + shoulderOut },
          { x: detourX, y: srcPt.y + shoulderOut },
          { x: detourX, y: tgtPt.y + shoulderIn },
          { x: tgtPt.x, y: tgtPt.y + shoulderIn },
        ]
      }
    }

    const labelLayout =
      semanticType === 'returnFlow'
        ? { placement: 'manual', offsetX: isHorizontal ? 10 : -12, offsetY: isHorizontal ? -20 : -10 }
        : semanticType === 'crossLane'
          ? { placement: 'manual', offsetX: isHorizontal ? 8 : -10, offsetY: isHorizontal ? -14 : -8 }
          : { placement: 'manual', offsetX: isHorizontal ? 8 : -8, offsetY: isHorizontal ? -10 : -6 }

    return {
      ...e,
      type: edgeType,
      style: edgeStyle,
      sourceHandle,
      targetHandle,
      data: {
        ...(e.data as any),
        semanticType,
        sourceLaneId: srcLaneId,
        targetLaneId: tgtLaneId,
        // Swimlane: 端点必须严格贴 handle，不做端点层 autoOffset 位移。
        autoOffset: 0,
        ...(waypoints ? { waypoints } : {}),
        labelLayout,
      },
    }
  })

  return { nodes, edges: updatedEdges }
}
