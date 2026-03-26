import type { Edge, Node } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import { normalizeNodeGeometryToGrid, snapPointToGrid } from './grid'

export type LayoutDirection = 'LR' | 'TB' | 'RL' | 'BT'

/** 仅当需要覆盖 ELK 内置默认时才传入；不传则完全使用 layered 算法的默认间距与 padding */
export type LayoutSpacingOptions = {
  nodesep?: number
  ranksep?: number
  marginx?: number
  marginy?: number
}

const elk = new ELK()

function buildElkLayoutOptions(direction: LayoutDirection, spacing?: LayoutSpacingOptions): Record<string, string> {
  const opts: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': layoutDirectionToElk(direction),
    /** 不连通子图分开摆放，间距用 ELK 默认（org.eclipse.elk.spacing.componentComponent 等），避免手写 tile */
    'org.eclipse.elk.separateConnectedComponents': 'true',
  }
  if (spacing?.nodesep != null) opts['elk.spacing.nodeNode'] = String(spacing.nodesep)
  if (spacing?.ranksep != null) {
    opts['org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers'] = String(spacing.ranksep)
  }
  if (spacing?.marginx != null && spacing?.marginy != null) {
    opts['org.eclipse.elk.padding'] = `[top=${spacing.marginy},left=${spacing.marginx},bottom=${spacing.marginy},right=${spacing.marginx}]`
  } else if (spacing?.marginx != null) {
    const m = spacing.marginx
    opts['org.eclipse.elk.padding'] = `[top=${m},left=${m},bottom=${m},right=${m}]`
  } else if (spacing?.marginy != null) {
    const m = spacing.marginy
    opts['org.eclipse.elk.padding'] = `[top=${m},left=${m},bottom=${m},right=${m}]`
  }
  return opts
}

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
 * 使用 ELK `layered` 布局。未传 `spacing` 时不写 `elk.spacing.*` / `padding`，
 * 间距与画布边距完全遵循 ELK 默认值；需要微调时再传 `LayoutSpacingOptions`。
 * 坐标为左上角，与 React Flow / XYFlow 一致。
 */
export async function autoLayout<NData extends Record<string, unknown>>(
  nodes: Array<Node<NData>>,
  edges: Array<Edge>,
  direction: LayoutDirection,
  spacing?: LayoutSpacingOptions,
): Promise<Array<Node<NData>>> {
  const visibleNodes = nodes.filter((n) => !n.hidden)
  if (visibleNodes.length === 0) return nodes

  const nodeIdSet = new Set(visibleNodes.map((n) => n.id))

  const elkChildren: ElkNode[] = visibleNodes.map((n) => {
    const w = n.measured?.width ?? n.width ?? 180
    const h = n.measured?.height ?? n.height ?? 48
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
    layoutOptions: buildElkLayoutOptions(direction, spacing),
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
    const laid = {
      ...n,
      position: snapPointToGrid({ x: p.x, y: p.y }),
      positionAbsolute: undefined,
    }
    return normalizeNodeGeometryToGrid(laid) as Node<NData>
  })
}
