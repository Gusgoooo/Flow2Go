import type { Edge, Node } from '@xyflow/react'
import { routeCrossLaneEdge } from './crossLaneRouter'

type SwimlaneEdgeSemanticType = 'normal' | 'crossLane' | 'returnFlow' | 'conditional'

function isLaneNode(node: Node<any> | undefined): node is Node<any> {
  return Boolean(node && node.type === 'group' && (node.data as any)?.role === 'lane')
}

function laneIdOf(node: Node<any> | undefined): string | undefined {
  if (!node) return undefined
  return (node.data as any)?.laneId ?? node.parentId
}

function isDecisionNode(node: Node<any> | undefined): boolean {
  if (!node) return false
  const semantic = (node.data as any)?.semanticType
  const shape = (node.data as any)?.shape
  return semantic === 'decision' || shape === 'diamond'
}

function isOrdinarySwimlaneNode(node: Node<any> | undefined): boolean {
  if (!node) return false
  if (!laneIdOf(node)) return false
  if (isDecisionNode(node)) return false
  const semantic = (node.data as any)?.semanticType
  const shape = (node.data as any)?.shape
  if (semantic && ['start', 'task', 'end', 'data'].includes(String(semantic))) return true
  if (shape && ['rect', 'circle'].includes(String(shape))) return true
  return true
}

function semanticOf(edge: Edge<any>, srcLaneId?: string, tgtLaneId?: string, srcNode?: Node<any>, tgtNode?: Node<any>): SwimlaneEdgeSemanticType {
  const explicit = (edge.data as any)?.semanticType as SwimlaneEdgeSemanticType | undefined
  if (explicit) return explicit
  if (srcLaneId && tgtLaneId && srcLaneId !== tgtLaneId) return 'crossLane'
  const srcOrder = Number((srcNode?.data as any)?.nodeOrder ?? 0)
  const tgtOrder = Number((tgtNode?.data as any)?.nodeOrder ?? 0)
  if (srcLaneId && tgtLaneId && srcLaneId === tgtLaneId && srcOrder > tgtOrder) return 'returnFlow'
  return 'normal'
}

export function rerouteSwimlaneEdges(nodes: Node<any>[], edges: Edge<any>[]): Edge<any>[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  return edges.map((edge) => {
    const srcNode = nodeById.get(edge.source)
    const tgtNode = nodeById.get(edge.target)
    if (!srcNode || !tgtNode) return edge

    const srcLaneId = laneIdOf(srcNode)
    const tgtLaneId = laneIdOf(tgtNode)
    const semantic = semanticOf(edge, srcLaneId, tgtLaneId, srcNode, tgtNode)
    const sourceLane = srcLaneId ? nodeById.get(srcLaneId) : undefined
    const targetLane = tgtLaneId ? nodeById.get(tgtLaneId) : undefined

    const sourceHandle =
      isOrdinarySwimlaneNode(srcNode) ? 's-right' : (edge.sourceHandle ?? 's-right')
    const targetHandle =
      isOrdinarySwimlaneNode(tgtNode) ? 't-left' : (edge.targetHandle ?? 't-left')

    if (semantic === 'crossLane' && isLaneNode(sourceLane) && isLaneNode(targetLane)) {
      const routed = routeCrossLaneEdge({
        edge,
        sourceNode: srcNode,
        targetNode: tgtNode,
        sourceLane,
        targetLane,
        allNodes: nodes,
      })
      return {
        ...edge,
        type: routed.type,
        sourceHandle,
        targetHandle,
        data: {
          ...(edge.data as any),
          semanticType: 'crossLane',
          sourceLaneId: sourceLane.id,
          targetLaneId: targetLane.id,
          waypoints: routed.waypoints,
          autoOffset: 0,
        },
      }
    }

    const nextStyle = { ...(edge.style as any) }
    if (semantic === 'returnFlow') {
      nextStyle.strokeWidth = 1
      nextStyle.opacity = 0.95
    }
    return {
      ...edge,
      sourceHandle,
      targetHandle,
      ...(semantic === 'returnFlow' ? { type: 'smoothstep', style: nextStyle } : {}),
      data: {
        ...(edge.data as any),
        semanticType: semantic,
        sourceLaneId: srcLaneId,
        targetLaneId: tgtLaneId,
        autoOffset: 0,
      },
    }
  })
}
