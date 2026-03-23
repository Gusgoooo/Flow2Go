/**
 * SwimlaneDraft: 泳道图中间结构。
 * LLM / 外部输入只需产出此结构，由 swimlaneDraftToGraphBatchPayload 转为 GraphBatchPayload。
 */
import type { GraphBatchPayload, GraphOperation } from './mermaid/types'

export type SwimlaneDraftNode = {
  id: string
  title: string
  subtitle?: string
  shape?: 'rect' | 'circle' | 'diamond'
  laneId: string
  semanticType?: 'start' | 'task' | 'decision' | 'end' | 'data'
  order?: number
}

export type SwimlaneDraftEdge = {
  id: string
  source: string
  target: string
  label?: string
  semanticType?: 'normal' | 'crossLane' | 'returnFlow' | 'conditional'
}

export type SwimlaneDraft = {
  title?: string
  direction: 'horizontal' | 'vertical'
  lanes: Array<{
    id: string
    title: string
    order: number
  }>
  nodes: SwimlaneDraftNode[]
  edges: SwimlaneDraftEdge[]
}

function inferShape(semanticType?: string): 'rect' | 'circle' | 'diamond' | undefined {
  if (!semanticType) return undefined
  if (semanticType === 'start' || semanticType === 'end') return 'circle'
  if (semanticType === 'decision') return 'diamond'
  return 'rect'
}

export function swimlaneDraftToGraphBatchPayload(
  draft: SwimlaneDraft,
): GraphBatchPayload {
  const ops: GraphOperation[] = []

  // lanes -> createFrame (排序后按 order)
  const sortedLanes = [...draft.lanes].sort((a, b) => a.order - b.order)
  for (const lane of sortedLanes) {
    ops.push({
      op: 'graph.createFrame',
      params: {
        id: lane.id,
        title: lane.title,
      },
    })
  }

  // nodes -> createNodeQuad
  for (const node of draft.nodes) {
    const shape = node.shape ?? inferShape(node.semanticType)
    ops.push({
      op: 'graph.createNodeQuad',
      params: {
        id: node.id,
        title: node.title,
        subtitle: node.subtitle,
        shape,
        parentId: node.laneId,
        style: {
          ...(node.semanticType ? { semanticType: node.semanticType } : {}),
          ...(node.order != null ? { nodeOrder: node.order } : {}),
        } as any,
      },
    })
  }

  // edges -> createEdge
  for (const edge of draft.edges) {
    ops.push({
      op: 'graph.createEdge',
      params: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        style: {
          ...(edge.semanticType ? { semanticType: edge.semanticType } : {}),
        } as any,
      },
    })
  }

  // autoLayout
  ops.push({
    op: 'graph.autoLayout',
    params: {
      direction: draft.direction === 'horizontal' ? 'LR' : 'TB',
      scope: 'all',
    },
  })

  return {
    version: '1.0',
    source: 'swimlane-draft',
    graphType: 'swimlane',
    direction: draft.direction === 'horizontal' ? 'LR' : 'TB',
    operations: ops,
    meta: {
      layoutProfile: 'swimlane',
      swimlaneDirection: draft.direction,
    },
  }
}
