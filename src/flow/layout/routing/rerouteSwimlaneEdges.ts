import type { Edge, Node } from '@xyflow/react'
import { routeCrossLaneEdge } from './crossLaneRouter'

type SwimlaneEdgeSemanticType = 'normal' | 'crossLane' | 'returnFlow' | 'conditional'
type HandlePair = { sourceHandle: string; targetHandle: string }
type Side = 'top' | 'right' | 'bottom' | 'left'
const RETURN_FLOW_AUTO_ANIMATED_KEY = 'autoReturnFlowAnimated'

function sideToSourceHandle(side: Side): string {
  return `s-${side}`
}

function dominantSideFromDelta(dx: number, dy: number): Side {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function oppositeSide(side: Side): Side {
  if (side === 'top') return 'bottom'
  if (side === 'bottom') return 'top'
  if (side === 'left') return 'right'
  return 'left'
}

function emptySideUsage(): Record<Side, number> {
  return { top: 0, right: 0, bottom: 0, left: 0 }
}

function chooseLeastUsedDistinctSide(
  preferred: Side,
  usage: Record<Side, number>,
  blocked?: Side,
): Side {
  const sequence: Side[] = [
    preferred,
    oppositeSide(preferred),
    'right',
    'left',
    'bottom',
    'top',
  ]
  const unique: Side[] = []
  for (const side of sequence) {
    if (blocked && side === blocked) continue
    if (!unique.includes(side)) unique.push(side)
  }
  let best = unique[0] ?? preferred
  let bestCount = usage[best] ?? 0
  for (const side of unique) {
    const count = usage[side] ?? 0
    if (count < bestCount) {
      best = side
      bestCount = count
    }
  }
  return best
}

function classifyDecisionBranch(edge: Edge<any>): 'yes' | 'no' | null {
  const text = typeof edge.label === 'string' ? edge.label.trim() : ''
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'yes' || /\byes\b/i.test(lower) || /(是|通过|同意|成功|允许|确认)/.test(text)) return 'yes'
  if (lower === 'no' || /\bno\b/i.test(lower) || /(否|不通过|不同意|失败|拒绝|取消)/.test(text)) return 'no'
  return null
}

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

function semanticOf(
  edge: Edge<any>,
  srcLaneId?: string,
  tgtLaneId?: string,
  srcNode?: Node<any>,
  tgtNode?: Node<any>,
  byId?: Map<string, Node<any>>,
): SwimlaneEdgeSemanticType {
  const explicit = (edge.data as any)?.semanticType as SwimlaneEdgeSemanticType | undefined
  if (explicit) return explicit
  if (srcLaneId && tgtLaneId && srcLaneId !== tgtLaneId) return 'crossLane'
  if (!srcLaneId || !tgtLaneId || srcLaneId !== tgtLaneId) return 'normal'
  if (!srcNode || !tgtNode) return 'normal'

  const srcCol = (srcNode.data as any)?.laneCol as number | undefined
  const tgtCol = (tgtNode.data as any)?.laneCol as number | undefined
  const srcRow = (srcNode.data as any)?.laneRow as number | undefined
  const tgtRow = (tgtNode.data as any)?.laneRow as number | undefined
  const hasGridInfo = srcCol != null && tgtCol != null

  if (hasGridInfo) {
    if (srcCol !== tgtCol) return srcCol > tgtCol ? 'returnFlow' : 'normal'
    if (srcRow != null && tgtRow != null && srcRow !== tgtRow) return srcRow > tgtRow ? 'returnFlow' : 'normal'
  }

  if (byId && srcNode && tgtNode) {
    const sCx = centerX(srcNode, byId)
    const tCx = centerX(tgtNode, byId)
    const dx = tCx - sCx
    if (Math.abs(dx) > 1) return dx < 0 ? 'returnFlow' : 'normal'
  }

  const srcOrder = Number((srcNode.data as any)?.nodeOrder ?? 0)
  const tgtOrder = Number((tgtNode.data as any)?.nodeOrder ?? 0)
  if (srcOrder > tgtOrder) return 'returnFlow'
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

function centerY(node: Node<any>, byId: Map<string, Node<any>>): number {
  const pos = absolutePosition(node, byId)
  const size = nodeSize(node)
  return pos.y + size.height / 2
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

  // 列泳道：主流程自上而下，回流用「上出下进 / 下出上进」或水平正交拐角，避免同侧平行贴边
  if (laneAxis === 'column') {
    const dx = centerX(tgtNode, byId) - centerX(srcNode, byId)
    const dy = centerY(tgtNode, byId) - centerY(srcNode, byId)
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (dy <= 0) return { sourceHandle: 's-top', targetHandle: 't-bottom' }
      return { sourceHandle: 's-bottom', targetHandle: 't-top' }
    }
    if (dx <= 0) return { sourceHandle: 's-left', targetHandle: 't-right' }
    return { sourceHandle: 's-right', targetHandle: 't-left' }
  }

  // 行泳道：主流程自左而右，回流用水平「左出右进」或垂直与水平正交拐角（左上/左下/右上/右下）
  const dx = centerX(tgtNode, byId) - centerX(srcNode, byId)
  const dy = centerY(tgtNode, byId) - centerY(srcNode, byId)
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx <= 0) {
      return {
        sourceHandle: 's-left',
        targetHandle: dy < 0 ? 't-top' : 't-bottom',
      }
    }
    return {
      sourceHandle: 's-right',
      targetHandle: dy < 0 ? 't-top' : 't-bottom',
    }
  }
  if (dy <= 0) {
    return {
      sourceHandle: 's-top',
      targetHandle: dx < 0 ? 't-left' : 't-right',
    }
  }
  return {
    sourceHandle: 's-bottom',
    targetHandle: dx < 0 ? 't-left' : 't-right',
  }
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
  const decisionOutUsage = new Map<string, Record<Side, number>>()
  const decisionBranchSideByLabel = new Map<string, { yes?: Side; no?: Side }>()

  return edges.map((edge) => {
    const srcNode = nodeById.get(edge.source)
    const tgtNode = nodeById.get(edge.target)
    if (!srcNode || !tgtNode) return edge

    const srcLaneId = laneIdOf(srcNode)
    const tgtLaneId = laneIdOf(tgtNode)
    const semantic = semanticOf(edge, srcLaneId, tgtLaneId, srcNode, tgtNode, nodeById)
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
    const sameSideReturnParallel =
      semantic === 'returnFlow' &&
      sourceIsOrdinarySwimlane &&
      targetIsOrdinarySwimlane &&
      Boolean(sourceSide && targetSide && sourceSide === targetSide)
    const fixedTargetHandle =
      sourceIsOrdinarySwimlane &&
      targetIsOrdinarySwimlane &&
      sourceSide &&
      targetSide &&
      sourceSide === targetSide &&
      !sameSideReturnParallel
        ? `t-${sideOpposite[targetSide] ?? targetSide}`
        : targetHandle

    const srcDecision = isDecisionNode(srcNode)
    const tgtDecision = isDecisionNode(tgtNode)
    const decisionInvolved = srcDecision || tgtDecision
    // decision 节点：yes/no 必须走不同 handle；不再写死左右。
    const dx = centerX(tgtNode, nodeById) - centerX(srcNode, nodeById)
    const dy = centerY(tgtNode, nodeById) - centerY(srcNode, nodeById)
    let forcedSourceHandle = sideToSourceHandle(dominantSideFromDelta(dx, dy))
    if (srcDecision) {
      const branch = classifyDecisionBranch(edge)
      const usage = decisionOutUsage.get(srcNode.id) ?? emptySideUsage()
      const preferred = dominantSideFromDelta(dx, dy)
      if (branch) {
        const pair = decisionBranchSideByLabel.get(srcNode.id) ?? {}
        const current = branch === 'yes' ? pair.yes : pair.no
        const chosen = current ?? chooseLeastUsedDistinctSide(preferred, usage, branch === 'yes' ? pair.no : pair.yes)
        if (branch === 'yes') pair.yes = chosen
        else pair.no = chosen
        decisionBranchSideByLabel.set(srcNode.id, pair)
        forcedSourceHandle = sideToSourceHandle(chosen)
      } else {
        const chosen = chooseLeastUsedDistinctSide(preferred, usage)
        forcedSourceHandle = sideToSourceHandle(chosen)
      }
      const side = (forcedSourceHandle.split('-')[1] as Side) || 'right'
      const nextUsage = {
        ...usage,
        [side]: (usage[side] ?? 0) + 1,
      }
      decisionOutUsage.set(srcNode.id, nextUsage)
    }
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
