/**
 * Swimlane 专用自动布局。
 * 两阶段：A) 排列 lane 容器  B) 布局 lane 内节点
 * 不依赖 ELK / Dagre，纯规则布局，保证结果稳定。
 */
import type { Edge, Node } from '@xyflow/react'
import type { FlowDirection } from '../mermaid/types'
import { doesPolylineIntersectAnyExclusionBox, getNodeExclusionBoxes } from '../layout/routing/exclusion'
import {
  GRID_UNIT,
  HANDLE_ALIGN_UNIT,
  SIZE_STEP_RATIO,
  normalizeNodeGeometryToGrid,
  normalizeWaypointsToGrid,
  snapSizeByNodeType,
  snapToGrid,
} from '../grid'
import { DEFAULT_NODE_SIZES } from '../constants'

const LANE_HEADER_SIZE = 48
// 泳道容器（group）按 handle 对齐网格走 16 的半步（8px），
// 这样在后续 normalize 到网格时不会把间距“吃掉”成 0。
const LANE_STACK_STEP = Math.max(1, HANDLE_ALIGN_UNIT * SIZE_STEP_RATIO)
const LANE_GAP = LANE_STACK_STEP
const LANE_TOP_HEADER_NODE_GAP = LANE_STACK_STEP
const LANE_PADDING = { top: 24, right: 24, bottom: 24, left: 24 }
const MIN_LANE_WIDTH = 912
/** 无节点或内容极矮时的兜底高度；真实高度主要由 lane 内行/列与节点尺寸决定，不宜过大以免单行泳道虚高 */
const MIN_LANE_HEIGHT_FLOOR = 88
const CANVAS_START_X = 80
const CANVAS_START_Y = 80
const NODE_GAP_X = 48
const NODE_GAP_Y = 32

function median(values: number[]): number {
  if (!Array.isArray(values) || values.length === 0) return 0
  const a = [...values].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  if (a.length % 2 === 1) return a[mid]
  return (a[mid - 1] + a[mid]) / 2
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
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

type HorizontalLayoutItem = {
  child: Node<any>
  size: { w: number; h: number }
  row: number
  col: number
}

/**
 * 同一泳道同一行内若多条节点共享 laneCol，落点公式会得到相同 x/y → 完全重叠。
 * 按行分组后对 laneCol 做严格递增修正（保留稀疏列意图，仅消除重复与逆序）。
 */
function dedupeLaneColWithinEachRow(layoutItems: HorizontalLayoutItem[]) {
  if (layoutItems.length <= 1) return
  const byRow = new Map<number, HorizontalLayoutItem[]>()
  for (const it of layoutItems) {
    const list = byRow.get(it.row)
    if (list) list.push(it)
    else byRow.set(it.row, [it])
  }
  for (const items of byRow.values()) {
    if (items.length <= 1) continue
    items.sort((a, b) => {
      if (a.col !== b.col) return a.col - b.col
      const ao = (a.child.data as any)?.nodeOrder
      const bo = (b.child.data as any)?.nodeOrder
      if (ao != null && bo != null) return ao - bo
      return String(a.child.id).localeCompare(String(b.child.id))
    })
    for (let i = 1; i < items.length; i++) {
      if (items[i].col <= items[i - 1].col) {
        items[i].col = items[i - 1].col + 1
      }
    }
  }
}

/**
 * 相邻行号 r 与 r+1 且两行的列集合不相交 → 多为误拆行，合并到上一行（近似同一行对齐）。
 */
function mergeAdjacentRowsWhenColsDisjoint(layoutItems: HorizontalLayoutItem[]) {
  if (layoutItems.length <= 1) return
  for (;;) {
    const rows = Array.from(new Set(layoutItems.map((it) => it.row))).sort((a, b) => a - b)
    let merged = false
    for (let i = 0; i + 1 < rows.length; i++) {
      const r0 = rows[i]
      const r1 = rows[i + 1]
      if (r1 - r0 !== 1) continue
      const cols0 = new Set(layoutItems.filter((it) => it.row === r0).map((it) => it.col))
      const cols1 = new Set(layoutItems.filter((it) => it.row === r1).map((it) => it.col))
      let overlap = false
      for (const c of cols1) {
        if (cols0.has(c)) {
          overlap = true
          break
        }
      }
      if (overlap) continue
      for (const it of layoutItems) {
        if (it.row === r1) it.row = r0
      }
      merged = true
      break
    }
    if (!merged) break
  }
}

/**
 * 相邻列号 c 与 c+1 且两列的行集合不相交 → 多为误分列，合并到左列（列泳道内近似同列对齐）。
 */
function mergeAdjacentColsWhenRowsDisjoint(layoutItems: HorizontalLayoutItem[]) {
  if (layoutItems.length <= 1) return
  for (;;) {
    const cols = Array.from(new Set(layoutItems.map((it) => it.col))).sort((a, b) => a - b)
    let merged = false
    for (let i = 0; i + 1 < cols.length; i++) {
      const c0 = cols[i]
      const c1 = cols[i + 1]
      if (c1 - c0 !== 1) continue
      const rows0 = new Set(layoutItems.filter((it) => it.col === c0).map((it) => it.row))
      const rows1 = new Set(layoutItems.filter((it) => it.col === c1).map((it) => it.row))
      let overlap = false
      for (const r of rows1) {
        if (rows0.has(r)) {
          overlap = true
          break
        }
      }
      if (overlap) continue
      for (const it of layoutItems) {
        if (it.col === c1) it.col = c0
      }
      merged = true
      break
    }
    if (!merged) break
  }
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

  type LaneGridPending = {
    laneIndex: number
    lane: Node<any>
    layoutItems: Array<{ child: Node<any>; size: { w: number; h: number }; row: number; col: number }>
    padTop: number
    padLeft: number
    padRight: number
    padBottom: number
    laneGapY: number
  }
  const laneGridPending: LaneGridPending[] = []

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

    // LR / TB 泳道共用网格；TB 未写 laneCol 时默认为单列（自上而下），未写 laneRow 时按顺序占行
    const layoutItems = ordered.map((child, index) => {
      const size = estimateNodeSize(child)
      const d = (child.data as any) ?? {}
      if (isHorizontal) {
        const row = gridIndex(d.laneRow, 0)
        const col = gridIndex(d.laneCol, index)
        return { child, size, row, col }
      }
      const row = Number.isFinite(Number(d.laneRow)) ? gridIndex(d.laneRow, 0) : index
      const col = Number.isFinite(Number(d.laneCol)) ? gridIndex(d.laneCol, 0) : 0
      return { child, size, row, col }
    })
    const laneIndex = laneSizes.length
    laneSizes.push({ id: lane.id, contentW: 0, contentH: 0 })
    laneGridPending.push({ laneIndex, lane, layoutItems, padTop, padLeft, padRight, padBottom, laneGapY })
  }

  // 泳道内网格：跨泳道统一「列宽 + 列距」「行高 + 行距」
  if (laneGridPending.length > 0) {
    // 各泳道内 laneRow 可能从非 0 开始（草稿/识图），先按泳道归零，避免「每行泳道虚高递增」且同列错位
    for (const p of laneGridPending) {
      if (p.layoutItems.length === 0) continue
      const rmin = Math.min(...p.layoutItems.map((it) => it.row))
      for (const it of p.layoutItems) {
        it.row = it.row - rmin
      }
    }

    for (const p of laneGridPending) {
      mergeAdjacentRowsWhenColsDisjoint(p.layoutItems)
      mergeAdjacentColsWhenRowsDisjoint(p.layoutItems)
      dedupeLaneColWithinEachRow(p.layoutItems)
    }

    const globalColWidth = new Map<number, number>()
    const globalRowHeight = new Map<number, number>()
    for (const p of laneGridPending) {
      for (const item of p.layoutItems) {
        globalColWidth.set(item.col, Math.max(globalColWidth.get(item.col) ?? 0, item.size.w))
        globalRowHeight.set(item.row, Math.max(globalRowHeight.get(item.row) ?? 0, item.size.h))
      }
    }
    const maxLaneGapExtraAll = Math.max(
      0,
      ...laneGridPending.map((p) => laneLabelGapExtra.get(p.lane.id) ?? 0),
    )
    const globalLaneGapX = NODE_GAP_X + maxLaneGapExtraAll
    // 行距取各泳道最大附加间距，避免某一泳道边标签较宽时与其它泳道行带错位
    const globalRowGapY = Math.max(NODE_GAP_Y, ...laneGridPending.map((p) => p.laneGapY))

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

    for (const p of laneGridPending) {
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

        // 最后一步「微调对齐」：
        // - 同行节点：默认中心对齐；当高度差很小（<= HANDLE_ALIGN_UNIT）时，改为顶边对齐，视觉更“齐”。
        // - 同列节点：默认中心对齐；当宽度差很小（<= HANDLE_ALIGN_UNIT）时，改为左边对齐，减少细微左右抖动。
        const MICRO_ALIGN_THRESHOLD = GRID_UNIT * 3
        const microTopAlign = rowH - item.size.h <= MICRO_ALIGN_THRESHOLD
        const microLeftAlign = colW - item.size.w <= MICRO_ALIGN_THRESHOLD
        item.child.position = {
          x: padLeft + colStartRel + (microLeftAlign ? 0 : (colW - item.size.w) / 2),
          y: rowStart + (microTopAlign ? 0 : (rowH - item.size.h) / 2),
        }
      }

      const totalContentW = padLeft + maxContentRight + padRight
      const totalContentH = maxContentBottom + padBottom
      laneSizes[p.laneIndex] = { id: p.lane.id, contentW: totalContentW, contentH: totalContentH }
    }
  }

  // 水平泳道：全局仅使用第 0 行时，各泳道内容高度应对齐为同一值（避免「都是一行但泳道高度不一」）
  let horizontalSingleRowOnly = false
  if (laneGridPending.length > 0) {
    let globalMaxRowIndex = -1
    for (const p of laneGridPending) {
      for (const item of p.layoutItems) {
        globalMaxRowIndex = Math.max(globalMaxRowIndex, item.row)
      }
    }
    horizontalSingleRowOnly = globalMaxRowIndex <= 0
  }

  const laneHeightNeeded = (contentH: number) =>
    snapSizeByNodeType(Math.max(MIN_LANE_HEIGHT_FLOOR, contentH), 'group')

  // ── Phase A: 排列 lane 容器 ──
  if (isHorizontal) {
    // horizontal: lane 从上到下，所有 lane 统一宽度
    const unifiedW = snapSizeByNodeType(Math.max(MIN_LANE_WIDTH, ...laneSizes.map((s) => s.contentW)), 'group')
    const perLaneH = laneSizes.map((s) => Math.max(MIN_LANE_HEIGHT_FLOOR, s.contentH))
    const unifiedHorizontalH = horizontalSingleRowOnly
      ? snapSizeByNodeType(Math.max(...perLaneH), 'group')
      : undefined
    let cy = snapToGrid(CANVAS_START_Y, LANE_STACK_STEP)
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]
      const sizeInfo = laneSizes[i]
      const h =
        horizontalSingleRowOnly && unifiedHorizontalH != null
          ? unifiedHorizontalH
          : laneHeightNeeded(sizeInfo.contentH)
      lane.position = { x: snapToGrid(CANVAS_START_X, LANE_STACK_STEP), y: cy }
      lane.width = unifiedW
      lane.height = h
      lane.style = { ...(lane.style as any), width: unifiedW, height: h }
      cy = snapToGrid(cy + h + LANE_GAP, LANE_STACK_STEP)
    }
  } else {
    // vertical: lane 从左到右，所有 lane 统一高度
    const unifiedH = snapSizeByNodeType(Math.max(MIN_LANE_HEIGHT_FLOOR, ...laneSizes.map((s) => s.contentH)), 'group')
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

  // ── Phase B2: 跨泳道近似对齐（微调） ──
  // horizontal（泳道从上到下）：对齐“近似同一列”的节点（绝对 centerX）
  // vertical（泳道从左到右）：对齐“近似同一行”的节点（绝对 centerY）
  // 仅当一个簇跨越 >=2 个泳道时触发，避免单泳道内部被过度干预。
  if (laneGridPending.length > 1) {
    const MICRO_CROSS_LANE_THRESHOLD = GRID_UNIT * 3
    const laneGeom = new Map<
      string,
      { padLeft: number; padRight: number; padTop: number; padBottom: number; absX: number; absY: number; w: number; h: number }
    >()
    for (const p of laneGridPending) {
      const lane = p.lane
      const absX = Number(lane.position?.x) || 0
      const absY = Number(lane.position?.y) || 0
      const w = Number(lane.width ?? (lane.style as any)?.width) || 0
      const h = Number(lane.height ?? (lane.style as any)?.height) || 0
      laneGeom.set(String(lane.id), { padLeft: p.padLeft, padRight: p.padRight, padTop: p.padTop, padBottom: p.padBottom, absX, absY, w, h })
    }

    type ItemRef = { node: Node<any>; laneId: string; center: number }
    const items: ItemRef[] = []
    for (const p of laneGridPending) {
      for (const it of p.layoutItems) {
        const laneId = String(p.lane.id)
        const g = laneGeom.get(laneId)
        if (!g) continue
        const nx = Number(it.child.position?.x) || 0
        const ny = Number(it.child.position?.y) || 0
        const w = Number(it.child.width ?? (it.child.style as any)?.width) || it.size.w
        const h = Number(it.child.height ?? (it.child.style as any)?.height) || it.size.h
        const absCenter = isHorizontal ? g.absX + nx + w / 2 : g.absY + ny + h / 2
        items.push({ node: it.child, laneId, center: absCenter })
      }
    }
    items.sort((a, b) => a.center - b.center)
    const clusters: ItemRef[][] = []
    for (const it of items) {
      const last = clusters[clusters.length - 1]
      if (!last) {
        clusters.push([it])
        continue
      }
      const lastCenter = last[last.length - 1].center
      if (Math.abs(it.center - lastCenter) <= MICRO_CROSS_LANE_THRESHOLD) last.push(it)
      else clusters.push([it])
    }
    for (const cluster of clusters) {
      const laneSet = new Set(cluster.map((c) => c.laneId))
      if (laneSet.size < 2) continue
      const targetCenter = snapToGrid(median(cluster.map((c) => c.center)), GRID_UNIT)
      for (const c of cluster) {
        const g = laneGeom.get(c.laneId)
        if (!g) continue
        const w = Number(c.node.width ?? (c.node.style as any)?.width) || 160
        const h = Number(c.node.height ?? (c.node.style as any)?.height) || 48
        if (isHorizontal) {
          const minX = g.padLeft
          const maxX = Math.max(minX, g.w - g.padRight - w)
          const nextLocalX = clamp(snapToGrid(targetCenter - g.absX - w / 2, GRID_UNIT), minX, maxX)
          c.node.position = { ...(c.node.position ?? { x: 0, y: 0 }), x: nextLocalX }
        } else {
          const minY = g.padTop
          const maxY = Math.max(minY, g.h - g.padBottom - h)
          const nextLocalY = clamp(snapToGrid(targetCenter - g.absY - h / 2, GRID_UNIT), minY, maxY)
          c.node.position = { ...(c.node.position ?? { x: 0, y: 0 }), y: nextLocalY }
        }
      }
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
