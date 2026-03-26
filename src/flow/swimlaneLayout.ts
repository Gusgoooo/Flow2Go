/**
 * Swimlane 专用自动布局。
 * 两阶段：A) 排列 lane 容器  B) 布局 lane 内节点
 * 不依赖 ELK / Dagre，纯规则布局，保证结果稳定。
 */
import type { Edge, Node } from '@xyflow/react'
import type { FlowDirection } from './mermaid/types'
import { doesPolylineIntersectAnyExclusionBox, getNodeExclusionBoxes } from './layout/routing/exclusion'
import { normalizeNodeGeometryToGrid, normalizeWaypointsToGrid } from './grid'

const LANE_HEADER_SIZE = 48
const LANE_GAP = 24
const LANE_PADDING = { top: 24, right: 24, bottom: 24, left: 24 }
const MIN_LANE_WIDTH = 912
const MIN_LANE_HEIGHT = 160
const CANVAS_START_X = 80
const CANVAS_START_Y = 80
const NODE_GAP_X = 48
const NODE_GAP_Y = 32

const DEFAULT_NODE_SIZES: Record<string, { w: number; h: number }> = {
  rect: { w: 160, h: 48 },
  circle: { w: 64, h: 64 },
  diamond: { w: 96, h: 64 },
}

function gridIndex(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.round(n))
}

function getAbsolutePosition(node: Node<any>, byId: Map<string, Node<any>>): { x: number; y: number } {
  let x = node.position?.x ?? 0
  let y = node.position?.y ?? 0
  let cur = node
  const seen = new Set<string>()
  while (cur.parentId) {
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    const p = byId.get(cur.parentId)
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
  byId: Map<string, Node<any>>,
): { x: number; y: number } {
  const abs = getAbsolutePosition(node, byId)
  const size = estimateNodeSize(node)
  if (handle.endsWith('-top')) return { x: abs.x + size.w / 2, y: abs.y }
  if (handle.endsWith('-bottom')) return { x: abs.x + size.w / 2, y: abs.y + size.h }
  if (handle.endsWith('-left')) return { x: abs.x, y: abs.y + size.h / 2 }
  return { x: abs.x + size.w, y: abs.y + size.h / 2 }
}
function getNodeSize(n: Node<any>): { w: number; h: number } {
  const w = n.measured?.width ?? n.width ?? (typeof (n.style as any)?.width === 'number' ? (n.style as any).width : undefined) ?? 160
  const h = n.measured?.height ?? n.height ?? (typeof (n.style as any)?.height === 'number' ? (n.style as any).height : undefined) ?? 48
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

function edgeLabelLength(edge: Edge<any>): number {
  const text = typeof edge.label === 'string' ? edge.label.trim() : ''
  return text.length
}

function labelGapExtraByMaxLen(maxLen: number): number {
  if (maxLen <= 0) return 0
  return Math.min(120, Math.max(32, Math.round(maxLen * 5)))
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
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const laneLabelMaxLen = new Map<string, number>()
  for (const edge of edges) {
    const len = edgeLabelLength(edge)
    if (len <= 0) continue
    const srcNode = nodeById.get(edge.source)
    const tgtNode = nodeById.get(edge.target)
    if (!srcNode || !tgtNode) continue
    const srcLaneId = (srcNode.data as any)?.laneId ?? srcNode.parentId
    const tgtLaneId = (tgtNode.data as any)?.laneId ?? tgtNode.parentId
    if (!srcLaneId || srcLaneId !== tgtLaneId) continue
    laneLabelMaxLen.set(srcLaneId, Math.max(laneLabelMaxLen.get(srcLaneId) ?? 0, len))
  }
  const laneLabelGapExtra = new Map(
    Array.from(laneLabelMaxLen.entries()).map(([laneId, maxLen]) => [laneId, labelGapExtraByMaxLen(maxLen)]),
  )

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
    const laneGapExtra = laneLabelGapExtra.get(lane.id) ?? 0
    const laneGapX = NODE_GAP_X + laneGapExtra
    const laneGapY = NODE_GAP_Y + Math.round(laneGapExtra * 0.35)

    let totalContentW = 0
    let totalContentH = 0

    if (isHorizontal) {
      // 节点在 lane 内按“列 + 行”网格布局（支持多行）
      const layoutItems = ordered.map((child, index) => {
        const size = estimateNodeSize(child)
        const row = gridIndex((child.data as any)?.laneRow, 0)
        const col = gridIndex((child.data as any)?.laneCol, index)
        return { child, size, row, col }
      })
      const colKeys = Array.from(new Set(layoutItems.map((item) => item.col))).sort((a, b) => a - b)
      const rowKeys = Array.from(new Set(layoutItems.map((item) => item.row))).sort((a, b) => a - b)
      const colRank = new Map(colKeys.map((key, idx) => [key, idx]))
      const rowRank = new Map(rowKeys.map((key, idx) => [key, idx]))

      const colWidths = new Map<number, number>()
      const rowHeights = new Map<number, number>()
      for (const item of layoutItems) {
        const c = colRank.get(item.col) ?? 0
        const r = rowRank.get(item.row) ?? 0
        colWidths.set(c, Math.max(colWidths.get(c) ?? 0, item.size.w))
        rowHeights.set(r, Math.max(rowHeights.get(r) ?? 0, item.size.h))
      }

      const colStarts = new Map<number, number>()
      const rowStarts = new Map<number, number>()
      let cx = padLeft
      for (let c = 0; c < colKeys.length; c += 1) {
        colStarts.set(c, cx)
        cx += (colWidths.get(c) ?? 0) + laneGapX
      }
      let cy = padTop
      for (let r = 0; r < rowKeys.length; r += 1) {
        rowStarts.set(r, cy)
        cy += (rowHeights.get(r) ?? 0) + laneGapY
      }

      for (const item of layoutItems) {
        const c = colRank.get(item.col) ?? 0
        const r = rowRank.get(item.row) ?? 0
        const colStart = colStarts.get(c) ?? padLeft
        const rowStart = rowStarts.get(r) ?? padTop
        const colW = colWidths.get(c) ?? item.size.w
        const rowH = rowHeights.get(r) ?? item.size.h

        item.child.width = item.size.w
        item.child.height = item.size.h
        item.child.style = { ...(item.child.style as any), width: item.size.w, height: item.size.h }
        item.child.position = {
          x: colStart + (colW - item.size.w) / 2,
          y: rowStart + (rowH - item.size.h) / 2,
        }
      }

      totalContentW = (colKeys.length > 0 ? cx - laneGapX : padLeft) + padRight
      totalContentH = (rowKeys.length > 0 ? cy - laneGapY : padTop) + padBottom
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
        cy += size.h + laneGapY
        maxW = Math.max(maxW, size.w)
      }
      totalContentW = padLeft + maxW + padRight
      totalContentH = cy - laneGapY + padBottom
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

  // ── Phase C: crossLane 一次性路由修正（仅自动布局时） ──
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const laneIndexById = new Map(lanes.map((l, i) => [l.id, i]))
  const laneOrderCounter = new Map<string, number>()
  const usedRouteSignatures = new Set<string>()
  const exclusionBoxes = getNodeExclusionBoxes(nodes as Node<any>[])
  const routedEdges = edges.map((e) => {
    const srcNode = byId.get(e.source)
    const tgtNode = byId.get(e.target)
    if (!srcNode || !tgtNode) return e
    const srcLaneId = (srcNode.data as any)?.laneId ?? srcNode.parentId
    const tgtLaneId = (tgtNode.data as any)?.laneId ?? tgtNode.parentId
    const isCrossLane = Boolean(srcLaneId && tgtLaneId && srcLaneId !== tgtLaneId)
    if (!isCrossLane || !srcLaneId || !tgtLaneId) return e
    const srcLane = byId.get(srcLaneId)
    const tgtLane = byId.get(tgtLaneId)
    if (!srcLane || !tgtLane) return e
    const srcIdx = laneIndexById.get(srcLaneId) ?? 0
    const tgtIdx = laneIndexById.get(tgtLaneId) ?? 0
    const sourceHandle = tgtIdx > srcIdx ? 's-bottom' : 's-top'
    const targetHandle = tgtIdx > srcIdx ? 't-top' : 't-bottom'
    const sp = getHandlePoint(srcNode, sourceHandle, byId)
    const tp = getHandlePoint(tgtNode, targetHandle, byId)
    const pairKey = `${srcLaneId}->${tgtLaneId}`
    const order = laneOrderCounter.get(pairKey) ?? 0
    laneOrderCounter.set(pairKey, order + 1)
    const signed = order % 2 === 0 ? order / 2 : -((order + 1) / 2)
    // 走“就近 corridor”，仅在必要时逐步外扩，避免夸张拉线到泳道外
    const baseLift = 16 + Math.abs(signed) * 8
    const baseCorridor = (sp.x + tp.x) / 2 + signed * 8
    const buildWaypoints = (corridorX: number, lift: number) =>
      sourceHandle === 's-bottom'
        ? [
            { x: sp.x, y: sp.y + lift },
            { x: corridorX, y: sp.y + lift },
            { x: corridorX, y: tp.y - lift },
            { x: tp.x, y: tp.y - lift },
          ]
        : [
            { x: sp.x, y: sp.y - lift },
            { x: corridorX, y: sp.y - lift },
            { x: corridorX, y: tp.y + lift },
            { x: tp.x, y: tp.y + lift },
          ]

    let bestWaypoints = normalizeWaypointsToGrid(buildWaypoints(baseCorridor, baseLift))
    let bestSig = ''
    let bestNodeSafe: Array<{ x: number; y: number }> | null = null
    for (let i = 0; i <= 10; i++) {
      const tryLift = baseLift + i * 8
      const tryCorridor = baseCorridor + (i % 2 === 0 ? i * 8 : -i * 8)
      const tryWaypoints = normalizeWaypointsToGrid(buildWaypoints(tryCorridor, tryLift))
      const polyline = [{ x: sp.x, y: sp.y }, ...tryWaypoints, { x: tp.x, y: tp.y }]
      const collide = doesPolylineIntersectAnyExclusionBox(polyline, exclusionBoxes, [srcNode.id, tgtNode.id])
      const sig = JSON.stringify(polyline)
      const occupied = usedRouteSignatures.has(sig)
      if (!collide && !bestNodeSafe) bestNodeSafe = tryWaypoints
      if (!collide && !occupied) {
        bestWaypoints = tryWaypoints
        bestSig = sig
        break
      }
      bestWaypoints = tryWaypoints
    }
    if (!bestSig) {
      if (bestNodeSafe) bestWaypoints = bestNodeSafe
      bestSig = JSON.stringify([{ x: sp.x, y: sp.y }, ...bestWaypoints, { x: tp.x, y: tp.y }])
    }
    usedRouteSignatures.add(bestSig)
    return {
      ...e,
      // 泳道图禁用贝塞尔：跨泳道也统一走正交多弯折（smoothstep）。
      // 即使当前 try 未找到完全无碰撞路径，也保留“最优尝试”的 waypoints，保证可读性与一致性。
      type: 'smoothstep',
      sourceHandle,
      targetHandle,
      data: {
        ...(e.data as any),
        semanticType: 'crossLane',
        sourceLaneId: srcLaneId,
        targetLaneId: tgtLaneId,
        waypoints: bestWaypoints,
      },
    }
  })
  return {
    nodes: nodes.map((n) => normalizeNodeGeometryToGrid(n) as Node<any>),
    edges: routedEdges.map((e) => {
      const wps = ((e.data ?? {}) as any)?.waypoints as Array<{ x: number; y: number }> | undefined
      if (!Array.isArray(wps) || wps.length === 0) return e
      return {
        ...e,
        data: {
          ...(e.data as any),
          waypoints: normalizeWaypointsToGrid(wps),
        },
      }
    }),
  }
}
