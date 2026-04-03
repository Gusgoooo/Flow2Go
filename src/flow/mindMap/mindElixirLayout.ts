/**
 * 思维导图布局：基于 Mind Elixir 的 SSR 布局入口 `layoutSSR` 做左右分支分配，
 * 再使用经典「左右展开 + 子树垂直居中」几何算法计算坐标（与 Mind Elixir 视觉习惯一致）。
 *
 * 依赖：mind-elixir 官方子路径导出（与 https://github.com/SSShooter/mind-elixir-core 同源）
 * @see https://github.com/SSShooter/mind-elixir-core
 */
import { layoutSSR } from 'mind-elixir/LayoutSsr'
import type { Edge, Node } from '@xyflow/react'
import { LAYOUT_UNIT } from '../constants'

const H_GAP = LAYOUT_UNIT * 2.5
const V_GAP = LAYOUT_UNIT * 0.75

export type MindMapSide = 'L' | 'R'

type MeNode = {
  id: string
  topic: string
  direction?: number
  children?: MeNode[]
}

function readSize(n: Node<any>): { w: number; h: number } {
  const sw = (n.style as any)?.width
  const sh = (n.style as any)?.height
  const w =
    typeof n.width === 'number' && Number.isFinite(n.width)
      ? n.width
      : typeof sw === 'number'
        ? sw
        : typeof sw === 'string'
          ? parseFloat(sw) || 160
          : 160
  const h =
    typeof n.height === 'number' && Number.isFinite(n.height)
      ? n.height
      : typeof sh === 'number'
        ? sh
        : typeof sh === 'string'
          ? parseFloat(sh) || 48
          : 48
  return { w: Math.max(1, w), h: Math.max(1, h) }
}

function labelOf(n: Node<any>): string {
  const d = (n.data ?? {}) as any
  return String(d.title ?? d.label ?? n.id).trim() || n.id
}

function buildAdjacency(
  quadIds: Set<string>,
  edges: Edge[],
): { out: Map<string, string[]>; indeg: Map<string, number> } {
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of quadIds) {
    out.set(id, [])
    indeg.set(id, 0)
  }
  for (const e of edges) {
    if (!quadIds.has(e.source) || !quadIds.has(e.target)) continue
    out.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  return { out, indeg }
}

function toMeTree(rootId: string, out: Map<string, string[]>, quadIds: Set<string>, nodeById: Map<string, Node<any>>): MeNode {
  const visit = (id: string): MeNode => {
    const n = nodeById.get(id)
    const topic = n ? labelOf(n) : id
    const nexts = (out.get(id) ?? []).filter((x) => quadIds.has(x))
    if (nexts.length === 0) return { id, topic }
    return { id, topic, children: nexts.map(visit) }
  }
  return visit(rootId)
}

function collectSidesFromSplit(
  leftNodes: MeNode[],
  rightNodes: MeNode[],
  sides: Map<string, MindMapSide>,
) {
  const walk = (n: MeNode, side: MindMapSide) => {
    sides.set(n.id, side)
    for (const c of n.children ?? []) walk(c, side)
  }
  for (const n of leftNodes) walk(n, 'L')
  for (const n of rightNodes) walk(n, 'R')
}

function subtreeHeight(n: MeNode, sizes: Map<string, { w: number; h: number }>): number {
  const h = sizes.get(n.id)?.h ?? 48
  const ch = n.children ?? []
  if (ch.length === 0) return h
  const sum = ch.reduce((acc, c) => acc + subtreeHeight(c, sizes), 0) + (ch.length - 1) * V_GAP
  return Math.max(h, sum)
}

/** 右侧：子节点在父节点右侧列，父节点相对子树块垂直居中 */
function placeRight(n: MeNode, x: number, yBlockTop: number, positions: Map<string, { x: number; y: number }>, sizes: Map<string, { w: number; h: number }>) {
  const { w, h } = sizes.get(n.id) ?? { w: 160, h: 48 }
  const ch = n.children ?? []
  if (ch.length === 0) {
    positions.set(n.id, { x, y: yBlockTop })
    return
  }
  const heights = ch.map((c) => subtreeHeight(c, sizes))
  const blockH = heights.reduce((a, b) => a + b, 0) + (ch.length - 1) * V_GAP
  const ySelf = yBlockTop + (blockH - h) / 2
  positions.set(n.id, { x, y: ySelf })
  const childX = x + w + H_GAP
  let y = yBlockTop
  for (let i = 0; i < ch.length; i += 1) {
    placeRight(ch[i], childX, y, positions, sizes)
    y += heights[i] + V_GAP
  }
}

/**
 * 左侧：子节点在父节点左侧；attachX 为父框左边缘 x，子节点右缘与父左缘之间留 GAP。
 */
function placeLeft(n: MeNode, attachX: number, yBlockTop: number, positions: Map<string, { x: number; y: number }>, sizes: Map<string, { w: number; h: number }>) {
  const { w, h } = sizes.get(n.id) ?? { w: 160, h: 48 }
  const xSelf = attachX - H_GAP - w
  const ch = n.children ?? []
  if (ch.length === 0) {
    positions.set(n.id, { x: xSelf, y: yBlockTop })
    return
  }
  const heights = ch.map((c) => subtreeHeight(c, sizes))
  const blockH = heights.reduce((a, b) => a + b, 0) + (ch.length - 1) * V_GAP
  const ySelf = yBlockTop + (blockH - h) / 2
  positions.set(n.id, { x: xSelf, y: ySelf })
  const childAttachX = xSelf
  let y = yBlockTop
  for (let i = 0; i < ch.length; i += 1) {
    placeLeft(ch[i], childAttachX, y, positions, sizes)
    y += heights[i] + V_GAP
  }
}

function placeForestRight(nodes: MeNode[], x: number, yStart: number, positions: Map<string, { x: number; y: number }>, sizes: Map<string, { w: number; h: number }>) {
  let y = yStart
  for (const n of nodes) {
    const sh = subtreeHeight(n, sizes)
    placeRight(n, x, y, positions, sizes)
    y += sh + V_GAP
  }
}

function placeForestLeft(nodes: MeNode[], attachX: number, yStart: number, positions: Map<string, { x: number; y: number }>, sizes: Map<string, { w: number; h: number }>) {
  let y = yStart
  for (const n of nodes) {
    const sh = subtreeHeight(n, sizes)
    placeLeft(n, attachX, y, positions, sizes)
    y += sh + V_GAP
  }
}

/**
 * 对思维导图 quad 节点计算位置，并写入 mindMapSide（L/R）供连线句柄强制为左右。
 */
export function layoutMindMapMindElixirStyle(
  quadNodes: Array<Node<any>>,
  edges: Array<Edge<any>>,
): { positions: Map<string, { x: number; y: number }>; sides: Map<string, MindMapSide> } {
  const positions = new Map<string, { x: number; y: number }>()
  const sides = new Map<string, MindMapSide>()

  if (quadNodes.length === 0) return { positions, sides }

  const nodeById = new Map(quadNodes.map((n) => [n.id, n]))
  const quadIds = new Set(quadNodes.map((n) => n.id))
  const { out, indeg } = buildAdjacency(quadIds, edges)

  const roots = quadNodes.filter((n) => (indeg.get(n.id) ?? 0) === 0)
  let meRoot: MeNode
  let logicalRootId: string

  if (roots.length === 1) {
    logicalRootId = roots[0].id
    meRoot = toMeTree(logicalRootId, out, quadIds, nodeById)
  } else {
    logicalRootId = '__flow2go_mind_virtual_root__'
    const children = roots.map((r) => toMeTree(r.id, out, quadIds, nodeById))
    meRoot = { id: logicalRootId, topic: ' ', children }
  }

  // direction: 2 与 Mind Elixir 默认「双侧」一致（见 mind-elixir LayoutSsr）
  const split = layoutSSR(meRoot, { direction: 2 })
  const leftForest = (split.leftNodes ?? []) as MeNode[]
  const rightForest = (split.rightNodes ?? []) as MeNode[]
  collectSidesFromSplit(leftForest, rightForest, sides)

  const sizes = new Map<string, { w: number; h: number }>()
  for (const n of quadNodes) sizes.set(n.id, readSize(n))
  if (logicalRootId === '__flow2go_mind_virtual_root__') sizes.set(logicalRootId, { w: 0, h: 0 })

  const rootW = sizes.get(logicalRootId)?.w ?? 160
  const rootH = sizes.get(logicalRootId)?.h ?? 48

  const leftH = leftForest.reduce((acc, n) => acc + subtreeHeight(n, sizes) + V_GAP, 0) - (leftForest.length > 0 ? V_GAP : 0)
  const rightH = rightForest.reduce((acc, n) => acc + subtreeHeight(n, sizes) + V_GAP, 0) - (rightForest.length > 0 ? V_GAP : 0)
  const totalH = Math.max(rootH, leftH, rightH, 1)

  const rootY = (totalH - rootH) / 2
  positions.set(logicalRootId, { x: 0, y: rootY })

  const leftY = (totalH - leftH) / 2
  const rightY = (totalH - rightH) / 2

  if (rightForest.length > 0) placeForestRight(rightForest, rootW + H_GAP, rightY, positions, sizes)
  if (leftForest.length > 0) placeForestLeft(leftForest, 0, leftY, positions, sizes)

  // 平移到第一象限，便于画布展示（与原先 mind-map 的 padding 行为一致）
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const [, p] of positions) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
  }
  if (!Number.isFinite(minX)) minX = 0
  if (!Number.isFinite(minY)) minY = 0
  const PAD = LAYOUT_UNIT * 0.9
  const sx = PAD - minX
  const sy = PAD - minY
  for (const [id, p] of positions) {
    positions.set(id, { x: p.x + sx, y: p.y + sy })
  }

  positions.delete('__flow2go_mind_virtual_root__')

  return { positions, sides }
}
