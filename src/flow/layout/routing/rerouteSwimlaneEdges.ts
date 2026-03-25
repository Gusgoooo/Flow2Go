import type { Edge, Node } from '@xyflow/react'
import { routeCrossLaneEdge } from './crossLaneRouter'

type SwimlaneEdgeSemanticType = 'normal' | 'crossLane' | 'returnFlow' | 'conditional'
type HandlePair = { sourceHandle: string; targetHandle: string }
const RETURN_FLOW_AUTO_ANIMATED_KEY = 'autoReturnFlowAnimated'

const LONG_RETURN_ORDER_GAP = 2
const LONG_RETURN_X_GAP = 280

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

function nodeSize(node: Node<any>): { width: number; height: number } {
  const style = (node.style ?? {}) as any
  const width = node.measured?.width ?? node.width ?? (typeof style?.width === 'number' ? style.width : 140)
  const height = node.measured?.height ?? node.height ?? (typeof style?.height === 'number' ? style.height : 56)
  return { width, height }
}

function absolutePosition(node: Node<any>, byId: Map<string, Node<any>>): { x: number; y: number } {
  let x = node.position?.x ?? 0
  let y = node.position?.y ?? 0
  let cur = node
  const seen = new Set<string>()
  while (cur.parentId) {
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    const parent = byId.get(cur.parentId)
    if (!parent) break
    x += parent.position?.x ?? 0
    y += parent.position?.y ?? 0
    cur = parent
  }
  return { x, y }
}

function centerX(node: Node<any>, byId: Map<string, Node<any>>): number {
  const pos = absolutePosition(node, byId)
  const size = nodeSize(node)
  return pos.x + size.width / 2
}

function chooseOrdinarySwimlaneHandles(
  semantic: SwimlaneEdgeSemanticType,
  srcNode: Node<any>,
  tgtNode: Node<any>,
  sourceLane: Node<any> | undefined,
  byId: Map<string, Node<any>>,
): HandlePair {
  if (semantic !== 'returnFlow') {
    return { sourceHandle: 's-right', targetHandle: 't-left' }
  }

  const laneAxis = (sourceLane?.data as any)?.laneMeta?.laneAxis as 'row' | 'column' | undefined
  if (laneAxis === 'column') {
    return { sourceHandle: 's-bottom', targetHandle: 't-top' }
  }

  const srcOrder = Number((srcNode.data as any)?.nodeOrder ?? 0)
  const tgtOrder = Number((tgtNode.data as any)?.nodeOrder ?? 0)
  const orderGap = Math.abs(srcOrder - tgtOrder)
  const xGap = Math.abs(centerX(srcNode, byId) - centerX(tgtNode, byId))
  const isLongReturn = orderGap >= LONG_RETURN_ORDER_GAP || xGap >= LONG_RETURN_X_GAP

  if (isLongReturn) {
    // Long loops are routed to keep visual stability, but avoid "in/out on the same handle".
    // Note: laneAxis=column is already handled above (returns s-bottom -> t-top), so here laneAxis is row/undefined.
    return { sourceHandle: 's-left', targetHandle: 't-right' }
  }

  // For short backward edges, mirror handles so the arrow enters from the geometric travel side.
  return { sourceHandle: 's-left', targetHandle: 't-right' }
}

function applyReturnFlowAnimation(
  edge: Edge<any>,
  semantic: SwimlaneEdgeSemanticType,
  edgeData: Record<string, any>,
): { animated: boolean | undefined; data: Record<string, any> } {
  const hadAutoAnimated = Boolean((edge.data as any)?.[RETURN_FLOW_AUTO_ANIMATED_KEY])

  if (semantic === 'returnFlow') {
    return {
      animated: true,
      data: {
        ...edgeData,
        [RETURN_FLOW_AUTO_ANIMATED_KEY]: true,
      },
    }
  }

  const { [RETURN_FLOW_AUTO_ANIMATED_KEY]: _removed, ...cleaned } = edgeData
  if (hadAutoAnimated) {
    // Only clear the animation we auto-attached before; keep user-set animation untouched otherwise.
    return { animated: false, data: cleaned }
  }
  return { animated: edge.animated, data: cleaned }
}

export function rerouteSwimlaneEdges(nodes: Node<any>[], edges: Edge<any>[]): Edge<any>[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const occupiedRouteSignatures = new Set<string>()

  return edges.map((edge) => {
    const srcNode = nodeById.get(edge.source)
    const tgtNode = nodeById.get(edge.target)
    if (!srcNode || !tgtNode) return edge

    const srcLaneId = laneIdOf(srcNode)
    const tgtLaneId = laneIdOf(tgtNode)
    const semantic = semanticOf(edge, srcLaneId, tgtLaneId, srcNode, tgtNode)
    const sourceLane = srcLaneId ? nodeById.get(srcLaneId) : undefined
    const targetLane = tgtLaneId ? nodeById.get(tgtLaneId) : undefined

    const sourceIsOrdinarySwimlane = isOrdinarySwimlaneNode(srcNode)
    const targetIsOrdinarySwimlane = isOrdinarySwimlaneNode(tgtNode)
    const ordinaryPair = sourceIsOrdinarySwimlane && targetIsOrdinarySwimlane
      ? chooseOrdinarySwimlaneHandles(semantic, srcNode, tgtNode, sourceLane, nodeById)
      : null
    const sourceHandle = sourceIsOrdinarySwimlane
      ? (ordinaryPair?.sourceHandle ?? 's-right')
      : (edge.sourceHandle ?? 's-right')
    const targetHandle = targetIsOrdinarySwimlane
      ? (ordinaryPair?.targetHandle ?? 't-left')
      : (edge.targetHandle ?? 't-left')

    const sideOpposite: Record<string, string> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
    const sourceSide = sourceHandle.split('-')[1]
    const targetSide = targetHandle.split('-')[1]
    const fixedTargetHandle =
      sourceIsOrdinarySwimlane && targetIsOrdinarySwimlane && sourceSide && targetSide && sourceSide === targetSide
        ? `t-${sideOpposite[targetSide] ?? targetSide}`
        : targetHandle

    const srcDecision = isDecisionNode(srcNode)
    const tgtDecision = isDecisionNode(tgtNode)
    const decisionInvolved = srcDecision || tgtDecision
    // decision 节点：强制使用左右句柄，避免 yes/no 判断从上/下穿出。
    const dx = centerX(tgtNode, nodeById) - centerX(srcNode, nodeById)
    const forcedSourceHandle = dx >= 0 ? 's-right' : 's-left'
    const forcedTargetHandle = dx >= 0 ? 't-left' : 't-right'
    const sourceHandle2 = srcDecision ? forcedSourceHandle : sourceHandle
    const targetHandle2 = tgtDecision ? forcedTargetHandle : fixedTargetHandle

    const laneAxis = (sourceLane?.data as any)?.laneMeta?.laneAxis as 'row' | 'column' | undefined
    // 同一行跨节点出线（例如 A -> C 且跳过 B）：
    // - 让它走 smoothedge（即 smoothstep），并交给正交避障保证不会穿过中间节点。
    const srcOrder = Number((srcNode.data as any)?.nodeOrder ?? 0)
    const tgtOrder = Number((tgtNode.data as any)?.nodeOrder ?? 0)
    const isRowLaneSkip =
      semantic === 'normal' && laneAxis === 'row' && sourceIsOrdinarySwimlane && targetIsOrdinarySwimlane && Math.abs(srcOrder - tgtOrder) > 1

    if (semantic === 'crossLane' && isLaneNode(sourceLane) && isLaneNode(targetLane)) {
      const routed = routeCrossLaneEdge({
        edge,
        sourceNode: srcNode,
        targetNode: tgtNode,
        sourceLane,
        targetLane,
        allNodes: nodes,
        occupiedRouteSignatures,
      })
      if (routed.signature) occupiedRouteSignatures.add(routed.signature)
      const crossLaneData = {
        ...(edge.data as any),
        semanticType: 'crossLane',
        sourceLaneId: sourceLane.id,
        targetLaneId: targetLane.id,
        waypoints: routed.waypoints,
      }
      const animatedPatch = applyReturnFlowAnimation(edge, 'crossLane', crossLaneData)
      return {
        ...edge,
        type: routed.type,
        sourceHandle: routed.sourceHandle ?? sourceHandle2,
        targetHandle: routed.targetHandle ?? targetHandle2,
        animated: animatedPatch.animated,
        data: animatedPatch.data,
      }
    }

    const nextStyle = { ...(edge.style as any) }
    if (semantic === 'returnFlow') {
      nextStyle.strokeWidth = 1
      nextStyle.opacity = 0.95
    }

    const normalData = {
      ...(edge.data as any),
      semanticType: semantic,
      sourceLaneId: srcLaneId,
      targetLaneId: tgtLaneId,
    }
    const animatedPatch = applyReturnFlowAnimation(edge, semantic, normalData)
    return {
      ...edge,
      sourceHandle: sourceHandle2,
      targetHandle: targetHandle2,
      animated: animatedPatch.animated,
      ...(semantic === 'returnFlow'
        ? { type: 'smoothstep', style: nextStyle }
        : decisionInvolved
          ? { type: 'smoothstep' }
          : isRowLaneSkip
          ? { type: 'smoothstep' }
          : {}),
      data: animatedPatch.data,
    }
  })
}
