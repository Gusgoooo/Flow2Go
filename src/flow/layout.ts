import type { Edge, Node } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'

export type LayoutDirection = 'LR' | 'TB' | 'RL' | 'BT'

export type LayoutSpacingOptions = {
  nodesep?: number
  ranksep?: number
  marginx?: number
  marginy?: number
}

const elk = new ELK()

function layoutDirectionToElk(direction: LayoutDirection): string {
  switch (direction) {
    case 'LR':
      return 'RIGHT'
    case 'TB':
      return 'DOWN'
    case 'RL':
      return 'LEFT'
    case 'BT':
      return 'UP'
    default:
      return 'RIGHT'
  }
}

/**
 * 使用 ELK layered 算法对节点做分层布局（替代原 dagre）。
 * 坐标为左上角，与 React Flow / XYFlow 一致。
 */
export async function autoLayout<NData extends Record<string, unknown>>(
  nodes: Array<Node<NData>>,
  edges: Array<Edge>,
  direction: LayoutDirection,
  spacing?: LayoutSpacingOptions,
): Promise<Array<Node<NData>>> {
  const nodesep = spacing?.nodesep ?? 64
  const ranksep = spacing?.ranksep ?? 96
  const marginx = spacing?.marginx ?? 48
  const marginy = spacing?.marginy ?? 48

  const visibleNodes = nodes.filter((n) => !n.hidden)
  if (visibleNodes.length === 0) return nodes

  const nodeIdSet = new Set(visibleNodes.map((n) => n.id))

  const elkChildren: ElkNode[] = visibleNodes.map((n) => {
    const w = n.measured?.width ?? n.width ?? 180
    const h = n.measured?.height ?? n.height ?? 44
    return {
      id: n.id,
      width: w,
      height: h,
    }
  })

  const elkEdges: ElkExtendedEdge[] = []
  let edgeFallback = 0
  for (const e of edges) {
    if (e.hidden) continue
    if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue
    elkEdges.push({
      id: e.id && e.id.length > 0 ? e.id : `__elk_e_${edgeFallback++}`,
      sources: [e.source],
      targets: [e.target],
    })
  }

  const graph: ElkNode = {
    id: 'flow2go-elk-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': layoutDirectionToElk(direction),
      'elk.spacing.nodeNode': String(nodesep),
      'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': String(ranksep),
      // 与 dagre 的 marginx/marginy 类似：根图内边距
      'org.eclipse.elk.padding': `[top=${marginy},left=${marginx},bottom=${marginy},right=${marginx}]`,
    },
    children: elkChildren,
    edges: elkEdges,
  }

  const laid = await elk.layout(graph)
  const posById = new Map<string, { x: number; y: number }>()
  for (const ch of laid.children ?? []) {
    if (!ch.id) continue
    posById.set(ch.id, { x: ch.x ?? 0, y: ch.y ?? 0 })
  }

  return nodes.map((n) => {
    if (n.hidden) return n
    const p = posById.get(n.id)
    if (!p) return n
    return {
      ...n,
      position: { x: p.x, y: p.y },
      positionAbsolute: undefined,
    }
  })
}
