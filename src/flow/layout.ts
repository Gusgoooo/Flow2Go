import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'

export type LayoutDirection = 'LR' | 'TB'

export function autoLayout<NData extends Record<string, unknown>>(
  nodes: Array<Node<NData>>,
  edges: Array<Edge>,
  direction: LayoutDirection,
) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))

  g.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 70,
    marginx: 30,
    marginy: 30,
  })

  for (const n of nodes) {
    if (n.hidden) continue
    const w = n.measured?.width ?? n.width ?? 180
    const h = n.measured?.height ?? n.height ?? 44
    g.setNode(n.id, { width: w, height: h })
  }

  for (const e of edges) {
    if (e.hidden) continue
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  const nextNodes = nodes.map((n) => {
    if (n.hidden) return n
    const p = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined
    if (!p) return n
    return {
      ...n,
      position: { x: p.x - p.width / 2, y: p.y - p.height / 2 },
      positionAbsolute: undefined,
    }
  })

  return nextNodes
}

