/**
 * Business Big Map — 紧凑填充矩形布局引擎
 *
 * 核心目标：最终输出是一个完整矩形，没有凸字形。
 *
 * 策略：
 *  1. 自底向上计算每个容器的"最小尺寸"
 *  2. 按 semanticRole 分层带，取最宽层带作为 targetWidth
 *  3. 每个层带的容器按比例拉伸到 targetWidth
 *  4. 自顶向下布局子节点：
 *     - 叶子节点根据可用宽度**自动计算列数**，多列网格排列
 *     - 避免叶子被过度拉伸成超宽条形
 *  5. 自底向上回缩高度（多列排列后容器变矮）
 *  6. 同层带等高 → 完整矩形
 */

import { GRID_UNIT, snapToGrid } from '../grid'
import type { SemanticRole, BigMapLayoutNode, BigMapLayoutResult } from './types'
import {
  CONTAINER_HEADER_HEIGHT,
  CONTAINER_PADDING_TOP,
  CONTAINER_PADDING_SIDE,
  CONTAINER_PADDING_BOTTOM,
  CHILD_GAP,
  SIBLING_GAP,
  LEAF_HEIGHT,
} from './sizing'

const BAND_GAP = GRID_UNIT * 2
const BAND_ITEM_GAP = GRID_UNIT * 2

const ROLE_PRIORITY: Record<SemanticRole, number> = {
  domain: 0,
  module: 1,
  capability: 2,
  feature: 3,
  service: 4,
  component: 5,
  unknown: 6,
}

// ─── 主入口 ───

export async function layoutWithELK(nodes: BigMapLayoutNode[]): Promise<BigMapLayoutResult> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rootIds = findRootIds(nodes)

  // Phase 1: 自底向上计算最小尺寸
  for (const id of rootIds) {
    computeSizeBottomUp(id, byId)
  }

  // Phase 2: 分层带，计算自然宽度
  const bands = groupIntoBands(rootIds, byId)
  const bandNaturalWidths = bands.map((band) => {
    const ns = band.ids.map((id) => byId.get(id)!)
    return ns.reduce((s, n) => s + n.width, 0) + (ns.length - 1) * BAND_ITEM_GAP
  })

  // Phase 3: targetWidth = 最宽层带
  const targetWidth = snapToGrid(Math.max(...bandNaturalWidths))

  // Phase 4: 拉伸每层带容器到 targetWidth
  for (let bi = 0; bi < bands.length; bi++) {
    const band = bands[bi]
    const ns = band.ids.map((id) => byId.get(id)!).sort((a, b) => a.order - b.order)
    if (ns.length === 0) continue

    const totalGap = (ns.length - 1) * BAND_ITEM_GAP
    const availForNodes = targetWidth - totalGap
    const naturalSum = ns.reduce((s, n) => s + n.width, 0)

    if (naturalSum > 0 && availForNodes > naturalSum) {
      const ratio = availForNodes / naturalSum
      let usedW = 0
      for (let i = 0; i < ns.length; i++) {
        if (i === ns.length - 1) {
          ns[i].width = snapToGrid(availForNodes - usedW)
        } else {
          ns[i].width = snapToGrid(ns[i].width * ratio)
          usedW += ns[i].width
        }
      }
    }
  }

  // Phase 5: 排列
  let currentY = 0
  for (const band of bands) {
    const ns = band.ids.map((id) => byId.get(id)!).sort((a, b) => a.order - b.order)
    let cx = 0
    for (const n of ns) {
      n.x = snapToGrid(cx)
      n.y = snapToGrid(currentY)
      cx = snapToGrid(cx + n.width + BAND_ITEM_GAP)
    }
    const maxH = Math.max(...ns.map((n) => n.height))
    for (const n of ns) n.height = snapToGrid(maxH)
    currentY = snapToGrid(currentY + maxH + BAND_GAP)
  }

  // Phase 6: 自顶向下布局子节点（多列网格）
  for (const id of rootIds) {
    layoutChildrenTopDown(id, byId)
  }

  // Phase 7: 自底向上回缩高度（多列布局后容器实际需要的高度可能变小）
  for (const id of rootIds) {
    recalcHeightBottomUp(id, byId)
  }

  // Phase 8: 同层带等高
  for (const band of bands) {
    const ns = band.ids.map((id) => byId.get(id)!).filter(Boolean)
    if (ns.length <= 1) continue
    const maxH = Math.max(...ns.map((n) => n.height))
    for (const n of ns) n.height = snapToGrid(maxH)
  }

  // Phase 9: 根据等高后结果重排 Y 坐标
  currentY = 0
  for (const band of bands) {
    const ns = band.ids.map((id) => byId.get(id)!).sort((a, b) => a.order - b.order)
    for (const n of ns) n.y = snapToGrid(currentY)
    currentY = snapToGrid(currentY + ns[0].height + BAND_GAP)
  }

  let totalHeight = snapToGrid(currentY - BAND_GAP)

  const resultNodes = nodes.map((n) => {
    const u = byId.get(n.id)
    return u ? { ...u } : { ...n }
  })

  return {
    nodes: resultNodes,
    totalWidth: snapToGrid(targetWidth),
    totalHeight: snapToGrid(Math.max(totalHeight, 100)),
  }
}

// ─── 自底向上计算最小尺寸 ───

function computeSizeBottomUp(id: string, byId: Map<string, BigMapLayoutNode>) {
  const n = byId.get(id)!
  if (n.type !== 'container' || n.children.length === 0) return

  const childIds = n.children.filter((c) => byId.has(c))
  for (const cid of childIds) computeSizeBottomUp(cid, byId)

  const children = childIds.map((c) => byId.get(c)!)
  const containerKids = children.filter((c) => c.type === 'container')
  const leafKids = children.filter((c) => c.type === 'node')

  const contentTop = CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING_TOP
  let contentW = 0
  let contentH = 0

  if (leafKids.length > 0) {
    const maxLeafMinW = Math.max(...leafKids.map((l) => l.width))
    contentW = Math.max(contentW, maxLeafMinW)
    contentH += leafKids.length * LEAF_HEIGHT + (leafKids.length - 1) * CHILD_GAP
  }

  if (containerKids.length > 0) {
    if (leafKids.length > 0) contentH += CHILD_GAP * 2
    const totalContainerW = containerKids.reduce((s, c) => s + c.width, 0)
      + (containerKids.length - 1) * SIBLING_GAP
    contentW = Math.max(contentW, totalContainerW)
    contentH += Math.max(...containerKids.map((c) => c.height))
  }

  n.width = snapToGrid(Math.max(n.width, contentW + CONTAINER_PADDING_SIDE * 2))
  n.height = snapToGrid(Math.max(n.height, contentTop + contentH + CONTAINER_PADDING_BOTTOM))
}

// ─── 自顶向下布局子节点（自动多列网格） ───

function layoutChildrenTopDown(id: string, byId: Map<string, BigMapLayoutNode>) {
  const n = byId.get(id)!
  if (n.type !== 'container' || n.children.length === 0) return

  const childIds = n.children.filter((c) => byId.has(c))
  const children = childIds.map((c) => byId.get(c)!)
  const containerKids = children.filter((c) => c.type === 'container').sort((a, b) => a.order - b.order)
  const leafKids = children.filter((c) => c.type === 'node').sort((a, b) => a.order - b.order)

  const availW = n.width - CONTAINER_PADDING_SIDE * 2
  let curY = snapToGrid(CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING_TOP)

  // 叶子节点：自动计算列数，网格排列
  if (leafKids.length > 0) {
    const maxLeafNatW = Math.max(...leafKids.map((l) => l.width))
    const cols = Math.max(1, Math.min(
      leafKids.length,
      Math.floor((availW + CHILD_GAP) / (maxLeafNatW + CHILD_GAP)),
    ))
    const colW = snapToGrid((availW - (cols - 1) * CHILD_GAP) / cols)
    const rows = Math.ceil(leafKids.length / cols)

    for (let i = 0; i < leafKids.length; i++) {
      const row = Math.floor(i / cols)
      const col = i % cols
      const leaf = leafKids[i]
      leaf.x = snapToGrid(CONTAINER_PADDING_SIDE + col * (colW + CHILD_GAP))
      leaf.y = snapToGrid(curY + row * (LEAF_HEIGHT + CHILD_GAP))
      leaf.width = snapToGrid(colW)
      leaf.height = snapToGrid(LEAF_HEIGHT)
    }

    curY = snapToGrid(curY + rows * (LEAF_HEIGHT + CHILD_GAP))
  }

  // 子容器：横向并排、均分宽度
  if (containerKids.length > 0) {
    if (leafKids.length > 0) curY = snapToGrid(curY + CHILD_GAP)

    const totalGap = (containerKids.length - 1) * SIBLING_GAP
    const perW = snapToGrid((availW - totalGap) / containerKids.length)
    const maxH = Math.max(...containerKids.map((c) => c.height))

    let cx = CONTAINER_PADDING_SIDE
    for (const c of containerKids) {
      c.x = snapToGrid(cx)
      c.y = snapToGrid(curY)
      c.width = snapToGrid(perW)
      c.height = snapToGrid(maxH)
      cx = snapToGrid(cx + perW + SIBLING_GAP)
    }
    curY = snapToGrid(curY + maxH + CHILD_GAP)
  }

  n.height = snapToGrid(Math.max(n.height, curY + CONTAINER_PADDING_BOTTOM))

  for (const c of containerKids) {
    layoutChildrenTopDown(c.id, byId)
  }
}

// ─── 自底向上回缩容器高度 ───

function recalcHeightBottomUp(id: string, byId: Map<string, BigMapLayoutNode>) {
  const n = byId.get(id)!
  if (n.type !== 'container' || n.children.length === 0) return

  const childIds = n.children.filter((c) => byId.has(c))
  for (const cid of childIds) recalcHeightBottomUp(cid, byId)

  const childNodes = childIds.map((c) => byId.get(c)!).filter(Boolean)
  if (childNodes.length === 0) return

  const maxBottom = Math.max(...childNodes.map((c) => c.y + c.height))
  n.height = snapToGrid(maxBottom + CONTAINER_PADDING_BOTTOM)
}

// ─── 层带分组 ───

interface Band {
  role: SemanticRole
  priority: number
  ids: string[]
}

function groupIntoBands(rootIds: string[], byId: Map<string, BigMapLayoutNode>): Band[] {
  const roleMap = new Map<SemanticRole, string[]>()
  for (const id of rootIds) {
    const n = byId.get(id)!
    const arr = roleMap.get(n.semanticRole) ?? []
    arr.push(id)
    roleMap.set(n.semanticRole, arr)
  }
  const bands: Band[] = []
  for (const [role, ids] of roleMap) {
    bands.push({ role, priority: ROLE_PRIORITY[role] ?? 99, ids })
  }
  bands.sort((a, b) => a.priority - b.priority)
  return bands
}

function findRootIds(nodes: BigMapLayoutNode[]): string[] {
  const childSet = new Set<string>()
  for (const n of nodes) for (const c of n.children) childSet.add(c)
  return nodes.filter((n) => !childSet.has(n.id)).map((n) => n.id)
}
