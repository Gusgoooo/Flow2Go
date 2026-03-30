/**
 * Swimlane 专用自动布局。
 * 两阶段：A) 排列 lane 容器  B) 布局 lane 内节点
 * 不依赖 ELK / Dagre，纯规则布局，保证结果稳定。
 */
import type { Edge, Node } from '@xyflow/react'
import type { FlowDirection } from './mermaid/types'
import { doesPolylineIntersectAnyExclusionBox, getNodeExclusionBoxes } from './layout/routing/exclusion'
import {
  HANDLE_ALIGN_UNIT,
  SIZE_STEP_RATIO,
  normalizeNodeGeometryToGrid,
  normalizeWaypointsToGrid,
  snapSizeByNodeType,
  snapToGrid,
} from './grid'

const LANE_HEADER_SIZE = 48
// 泳道容器（group）按 handle 对齐网格走 16 的半步（8px），
// 这样在后续 normalize 到网格时不会把间距“吃掉”成 0。
const LANE_STACK_STEP = Math.max(1, HANDLE_ALIGN_UNIT * SIZE_STEP_RATIO)
const LANE_GAP = LANE_STACK_STEP
const LANE_TOP_HEADER_NODE_GAP = LANE_STACK_STEP
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

  type HorizontalPending = {
    laneIndex: number
    lane: Node<any>
    layoutItems: Array<{ child: Node<any>; size: { w: number; h: number }; row: number; col: number }>
    padTop: number
    padLeft: number
    padRight: number
    padBottom: number
    laneGapY: number
  }
  const horizontalPending: HorizontalPending[] = []

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
    const laneHeaderOnLeft = (((lane.data as any)?.titlePosition ?? 'top-center') as string) === 'left-center'
    const padTop = laneHeaderOnLeft
      ? LANE_PADDING.top
      : headerH + LANE_TOP_HEADER_NODE_GAP
    const padRight = LANE_PADDING.right
    const padBottom = LANE_PADDING.bottom
    const padLeft = LANE_PADDING.left + (laneHeaderOnLeft ? headerH : 0)
    const laneGapExtra = laneLabelGapExtra.get(lane.id) ?? 0
    const laneGapY = NODE_GAP_Y + Math.round(laneGapExtra * 0.35)

    let totalContentW = 0
    let totalContentH = 0

    if (isHorizontal) {
      // 先只收集「列/行」信息；列宽与列距在跨泳道统一后再落位（避免各泳道独立算 colWidths 导致同列错位）
      const layoutItems = ordered.map((child, index) => {
        const size = estimateNodeSize(child)
        const row = gridIndex((child.data as any)?.laneRow, 0)
        const col = gridIndex((child.data as any)?.laneCol, index)
        return { child, size, row, col }
      })
      const laneIndex = laneSizes.length
      laneSizes.push({ id: lane.id, contentW: 0, contentH: 0 })
      horizontalPending.push({ laneIndex, lane, layoutItems, padTop, padLeft, padRight, padBottom, laneGapY })
      continue
    } else {
      // 节点在 lane 内从上到下排列
      const withSize = ordered.map((child) => ({ child, size: estimateNodeSize(child) }))
      const maxW = Math.max(0, ...withSize.map((item) => item.size.w))
      let cy = padTop
      for (const item of withSize) {
        const { child, size } = item
        child.width = size.w
        child.height = size.h
        child.style = { ...(child.style as any), width: size.w, height: size.h }
        // 列泳道内默认按中心线对齐，避免整列视觉偏右/偏左。
        child.position = { x: padLeft + (maxW - size.w) / 2, y: cy }
        cy += size.h + laneGapY
      }
      totalContentW = padLeft + maxW + padRight
      totalContentH = cy - laneGapY + padBottom
    }

    laneSizes.push({ id: lane.id, contentW: totalContentW, contentH: totalContentH })
  }

  // 水平泳道：跨泳道统一「列宽 + 列距」「行高 + 行距」，使相同 laneCol / laneRow 在各泳道内对齐
  if (horizontalPending.length > 0) {
    const globalColWidth = new Map<number, number>()
    const globalRowHeight = new Map<number, number>()
    for (const p of horizontalPending) {
      for (const item of p.layoutItems) {
        globalColWidth.set(item.col, Math.max(globalColWidth.get(item.col) ?? 0, item.size.w))
        globalRowHeight.set(item.row, Math.max(globalRowHeight.get(item.row) ?? 0, item.size.h))
      }
    }
    const maxLaneGapExtraAll = Math.max(
      0,
      ...horizontalPending.map((p) => laneLabelGapExtra.get(p.lane.id) ?? 0),
    )
    const globalLaneGapX = NODE_GAP_X + maxLaneGapExtraAll
    // 行距取各泳道最大附加间距，避免某一泳道边标签较宽时与其它泳道行带错位
    const globalRowGapY = Math.max(NODE_GAP_Y, ...horizontalPending.map((p) => p.laneGapY))

    const colKeys = Array.from(globalColWidth.keys()).sort((a, b) => a - b)
    const colStartsRel = new Map<number, number>()
    let prevCol: number | null = null
    for (const colKey of colKeys) {
      if (prevCol == null) {
        colStartsRel.set(colKey, 0)
        prevCol = colKey
        continue
      }
      const prevStart = colStartsRel.get(prevCol) ?? 0
      const prevW = globalColWidth.get(prevCol) ?? 0
      const colSpan = Math.max(1, colKey - prevCol)
      colStartsRel.set(colKey, prevStart + prevW + globalLaneGapX * colSpan)
      prevCol = colKey
    }

    const rowKeys = Array.from(globalRowHeight.keys()).sort((a, b) => a - b)
    const rowStartsRel = new Map<number, number>()
    let prevRow: number | null = null
    for (const rowKey of rowKeys) {
      if (prevRow == null) {
        rowStartsRel.set(rowKey, 0)
        prevRow = rowKey
        continue
      }
      const prevStart = rowStartsRel.get(prevRow) ?? 0
      const prevH = globalRowHeight.get(prevRow) ?? 0
      const rowSpan = Math.max(1, rowKey - prevRow)
      rowStartsRel.set(rowKey, prevStart + prevH + globalRowGapY * rowSpan)
      prevRow = rowKey
    }

    for (const p of horizontalPending) {
      const { layoutItems, padTop, padLeft, padRight, padBottom } = p

      let maxContentRight = 0
      let maxContentBottom = padTop
      for (const item of layoutItems) {
        const colStartRel = colStartsRel.get(item.col) ?? 0
        const colW = globalColWidth.get(item.col) ?? item.size.w
        const rowStartRel = rowStartsRel.get(item.row) ?? 0
        const rowH = globalRowHeight.get(item.row) ?? item.size.h
        const rowStart = padTop + rowStartRel
        maxContentRight = Math.max(maxContentRight, colStartRel + colW)
        maxContentBottom = Math.max(maxContentBottom, rowStart + rowH)

        item.child.width = item.size.w
        item.child.height = item.size.h
        item.child.style = { ...(item.child.style as any), width: item.size.w, height: item.size.h }
        item.child.position = {
          x: padLeft + colStartRel + (colW - item.size.w) / 2,
          y: rowStart + (rowH - item.size.h) / 2,
        }
      }

      const totalContentW = padLeft + maxContentRight + padRight
      const totalContentH = maxContentBottom + padBottom
      laneSizes[p.laneIndex] = { id: p.lane.id, contentW: totalContentW, contentH: totalContentH }
    }
  }

  // ── Phase A: 排列 lane 容器 ──
  if (isHorizontal) {
    // horizontal: lane 从上到下，所有 lane 统一宽度
    const unifiedW = snapSizeByNodeType(Math.max(MIN_LANE_WIDTH, ...laneSizes.map((s) => s.contentW)), 'group')
    let cy = snapToGrid(CANVAS_START_Y, LANE_STACK_STEP)
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]
      const sizeInfo = laneSizes[i]
      const h = snapSizeByNodeType(Math.max(MIN_LANE_HEIGHT, sizeInfo.contentH), 'group')
      lane.position = { x: snapToGrid(CANVAS_START_X, LANE_STACK_STEP), y: cy }
      lane.width = unifiedW
      lane.height = h
      lane.style = { ...(lane.style as any), width: unifiedW, height: h }
      cy = snapToGrid(cy + h + LANE_GAP, LANE_STACK_STEP)
    }
  } else {
    // vertical: lane 从左到右，所有 lane 统一高度
    const unifiedH = snapSizeByNodeType(Math.max(MIN_LANE_HEIGHT, ...laneSizes.map((s) => s.contentH)), 'group')
    let cx = snapToGrid(CANVAS_START_X, LANE_STACK_STEP)
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]
      const sizeInfo = laneSizes[i]
      const w = snapSizeByNodeType(Math.max(MIN_LANE_WIDTH, sizeInfo.contentW), 'group')
      lane.position = { x: cx, y: snapToGrid(CANVAS_START_Y, LANE_STACK_STEP) }
      lane.width = w
      lane.height = unifiedH
      lane.style = { ...(lane.style as any), width: w, height: unifiedH }
      cx = snapToGrid(cx + w + LANE_GAP, LANE_STACK_STEP)
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
