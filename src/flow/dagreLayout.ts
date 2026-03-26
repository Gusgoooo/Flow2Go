import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import type { LayoutDirection } from './layout'
import { normalizeNodeGeometryToGrid, snapPointToGrid } from './grid'

function mapRankDir(direction: LayoutDirection): 'LR' | 'TB' | 'RL' | 'BT' {
  if (direction === 'TB') return 'TB'
  if (direction === 'RL') return 'RL'
  if (direction === 'BT') return 'BT'
  return 'LR'
}

function edgeLabelLength(edge: Edge): number {
  const text = typeof edge.label === 'string' ? edge.label.trim() : ''
  return text.length
}

const BASE_DAGRE_RANKSEP = 96
const BASE_DAGRE_NODESEP = 64
const BASE_DAGRE_EDGESEP = 32

function resolveLabelAwareDagreSpacing(
  edges: Array<Edge>,
  nodeIdSet: Set<string>,
): { ranksep: number; nodesep: number; edgesep: number } {
  let maxLabelLen = 0
  for (const e of edges) {
    if (e.hidden) continue
    if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue
    const len = edgeLabelLength(e)
    if (len <= 0) continue
    maxLabelLen = Math.max(maxLabelLen, len)
  }
  if (maxLabelLen <= 0) {
    return {
      ranksep: BASE_DAGRE_RANKSEP,
      nodesep: BASE_DAGRE_NODESEP,
      edgesep: BASE_DAGRE_EDGESEP,
    }
  }

  // 标签越长，主链 rank 间距越大；nodesep 同步小幅增加，避免相邻边标签互挤。
  const labelExtra = Math.min(120, Math.max(36, Math.round(maxLabelLen * 6)))
  return {
    ranksep: BASE_DAGRE_RANKSEP + labelExtra,
    nodesep: BASE_DAGRE_NODESEP + Math.round(labelExtra * 0.45),
    edgesep: BASE_DAGRE_EDGESEP,
  }
}

/**
 * Dagre 布局：返回左上角坐标（dagre 内部是中心点坐标）。
 */
export async function autoLayoutDagre<NData extends Record<string, unknown>>(
  nodes: Array<Node<NData>>,
  edges: Array<Edge>,
  direction: LayoutDirection,
): Promise<Array<Node<NData>>> {
  const visibleNodes = nodes.filter((n) => !n.hidden)
  if (visibleNodes.length === 0) return nodes

  const nodeIdSet = new Set(visibleNodes.map((n) => n.id))
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: false })
  g.setDefaultEdgeLabel(() => ({}))
  const labelSpacing = resolveLabelAwareDagreSpacing(edges, nodeIdSet)
  g.setGraph({
    rankdir: mapRankDir(direction),
    ...labelSpacing,
  })

  for (const n of visibleNodes) {
    const w = n.measured?.width ?? n.width ?? 180
    const h = n.measured?.height ?? n.height ?? 48
    g.setNode(n.id, { width: w, height: h })
  }

  let idx = 0
  for (const e of edges) {
    if (e.hidden) continue
    if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue
    g.setEdge(e.source, e.target, {}, e.id || `__dagre_e_${idx++}`)
  }

  dagre.layout(g)

  return nodes.map((n) => {
    if (n.hidden) return n
    const d = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined
    if (!d) return n
    const laid = {
      ...n,
      position: snapPointToGrid({ x: d.x - d.width / 2, y: d.y - d.height / 2 }),
      positionAbsolute: undefined,
    }
    return normalizeNodeGeometryToGrid(laid) as Node<NData>
  })
}
