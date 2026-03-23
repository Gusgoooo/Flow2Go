import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import type { LayoutDirection } from './layout'

function mapRankDir(direction: LayoutDirection): 'LR' | 'TB' | 'RL' | 'BT' {
  if (direction === 'TB') return 'TB'
  if (direction === 'RL') return 'RL'
  if (direction === 'BT') return 'BT'
  return 'LR'
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
  g.setGraph({
    rankdir: mapRankDir(direction),
  })

  for (const n of visibleNodes) {
    const w = n.measured?.width ?? n.width ?? 180
    const h = n.measured?.height ?? n.height ?? 44
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
    return {
      ...n,
      position: { x: d.x - d.width / 2, y: d.y - d.height / 2 },
      positionAbsolute: undefined,
    }
  })
}
