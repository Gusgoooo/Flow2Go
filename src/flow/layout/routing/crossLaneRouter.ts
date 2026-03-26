import type { Edge, Node } from '@xyflow/react'
import {
  doesPolylineIntersectAnyExclusionBox,
  getNodeExclusionBoxes,
} from './exclusion'
import { buildPolylineSignature } from './polylineUtils'
import { snapPointToGrid } from '../../grid'

type Point = { x: number; y: number }
type LaneAxis = 'row' | 'column'
type NodeSide = 'top' | 'right' | 'bottom' | 'left'

export type RouteCrossLaneArgs = {
  edge: Edge
  sourceNode: Node
  targetNode: Node
  sourceLane: Node
  targetLane: Node
  allNodes: Node[]
  corridorGap?: number
  occupiedRouteSignatures?: Set<string>
}

const SOURCE_LEAD = 24
const TARGET_LEAD = 24
const CORRIDOR_SHIFT_STEP = 24
const MAX_CORRIDOR_SHIFT_TRIES = 12

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

function laneRight(node: Node<any>, byId: Map<string, Node<any>>): number {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  return pos.x + s.width
}

export function routeCrossLaneEdge(args: RouteCrossLaneArgs): {
  type: 'smoothstep'
  waypoints: Point[]
  sourceHandle: string
  targetHandle: string
  signature: string
} {
  const { sourceNode, targetNode, sourceLane, targetLane, allNodes } = args
  const corridorGap = Number.isFinite(args.corridorGap) ? Number(args.corridorGap) : 32
  const byId = new Map(allNodes.map((n) => [n.id, n]))
  const boxes = getNodeExclusionBoxes(allNodes)
  const laneAxis = inferLaneAxis(sourceLane, targetLane, byId)
  const occupiedSignatures = args.occupiedRouteSignatures

  let bestPoints: Point[] = []
  let sourceHandle = 's-right'
  let targetHandle = 't-left'

  if (laneAxis === 'row') {
    const downward = laneCenterY(targetLane, byId) >= laneCenterY(sourceLane, byId)
    const sourceSide: NodeSide = downward ? 'bottom' : 'top'
    const targetSide: NodeSide = downward ? 'top' : 'bottom'
    sourceHandle = `s-${sourceSide}`
    targetHandle = `t-${targetSide}`

    const src = handlePoint(sourceNode, byId, sourceSide)
    const tgt = handlePoint(targetNode, byId, targetSide)
    const sourceLeadY = downward ? src.y + SOURCE_LEAD : src.y - SOURCE_LEAD
    const targetLeadY = downward ? tgt.y - TARGET_LEAD : tgt.y + TARGET_LEAD
    const betweenY = downward
      ? midpointOrFallback(laneBottom(sourceLane, byId), laneTop(targetLane, byId), sourceLeadY, targetLeadY)
      : midpointOrFallback(laneBottom(targetLane, byId), laneTop(sourceLane, byId), targetLeadY, sourceLeadY)

    const candidateYs = corridorCandidates(
      betweenY,
      downward ? sourceLeadY + 8 : targetLeadY + 8,
      downward ? targetLeadY - 8 : sourceLeadY - 8,
    )

    let firstNodeSafe: Point[] | null = null
    let selectedUnique = false
    for (const corridorY of candidateYs) {
      const polyline = buildRowCorridorPolyline(src, tgt, sourceLeadY, targetLeadY, corridorY).map((p) => snapPointToGrid(p))
      bestPoints = polyline
      const hasCollision = doesPolylineIntersectAnyExclusionBox(
        polyline,
        boxes,
        [sourceNode.id, targetNode.id],
      )
      const overlapped = occupiedSignatures?.has(buildPolylineSignature(polyline)) ?? false
      if (!hasCollision && !firstNodeSafe) firstNodeSafe = polyline
      if (!hasCollision && !overlapped) {
        bestPoints = polyline
        selectedUnique = true
        break
      }
    }
    if (!selectedUnique && firstNodeSafe) bestPoints = firstNodeSafe
  } else {
    const moveRight = laneCenterX(targetLane, byId) >= laneCenterX(sourceLane, byId)
    const sourceSide: NodeSide = moveRight ? 'right' : 'left'
    const targetSide: NodeSide = moveRight ? 'left' : 'right'
    sourceHandle = `s-${sourceSide}`
    targetHandle = `t-${targetSide}`

    const src = handlePoint(sourceNode, byId, sourceSide)
    const tgt = handlePoint(targetNode, byId, targetSide)
    let corridorX = moveRight
      ? Math.max(laneRight(sourceLane, byId), laneRight(targetLane, byId)) + corridorGap
      : Math.min(laneLeft(sourceLane, byId), laneLeft(targetLane, byId)) - corridorGap

    let firstNodeSafe: Point[] | null = null
    let selectedUnique = false
    for (let i = 0; i <= MAX_CORRIDOR_SHIFT_TRIES; i++) {
      const polyline = buildColumnCorridorPolyline(src, tgt, moveRight, corridorX).map((p) => snapPointToGrid(p))
      bestPoints = polyline
      const hasCollision = doesPolylineIntersectAnyExclusionBox(
        polyline,
        boxes,
        [sourceNode.id, targetNode.id],
      )
      const overlapped = occupiedSignatures?.has(buildPolylineSignature(polyline)) ?? false
      if (!hasCollision && !firstNodeSafe) firstNodeSafe = polyline
      if (!hasCollision && !overlapped) {
        bestPoints = polyline
        selectedUnique = true
        break
      }
      corridorX += moveRight ? CORRIDOR_SHIFT_STEP : -CORRIDOR_SHIFT_STEP
    }
    if (!selectedUnique && firstNodeSafe) bestPoints = firstNodeSafe
  }

  // waypoints 仅保留中间点（起终点由 edge 渲染层自动补齐）
  const signature = buildPolylineSignature(bestPoints)
  return {
    type: 'smoothstep',
    waypoints: bestPoints.slice(1, -1),
    sourceHandle,
    targetHandle,
    signature,
  }
}

function laneCenterX(node: Node<any>, byId: Map<string, Node<any>>): number {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  return pos.x + s.width / 2
}

function laneCenterY(node: Node<any>, byId: Map<string, Node<any>>): number {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  return pos.y + s.height / 2
}

function laneTop(node: Node<any>, byId: Map<string, Node<any>>): number {
  return absolutePosition(node, byId).y
}

function laneBottom(node: Node<any>, byId: Map<string, Node<any>>): number {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  return pos.y + s.height
}

function laneLeft(node: Node<any>, byId: Map<string, Node<any>>): number {
  return absolutePosition(node, byId).x
}

function inferLaneAxis(sourceLane: Node<any>, targetLane: Node<any>, byId: Map<string, Node<any>>): LaneAxis {
  const explicitSource = (sourceLane.data as any)?.laneMeta?.laneAxis
  const explicitTarget = (targetLane.data as any)?.laneMeta?.laneAxis
  if (explicitSource === 'row' || explicitSource === 'column') return explicitSource
  if (explicitTarget === 'row' || explicitTarget === 'column') return explicitTarget

  const dx = Math.abs(laneCenterX(sourceLane, byId) - laneCenterX(targetLane, byId))
  const dy = Math.abs(laneCenterY(sourceLane, byId) - laneCenterY(targetLane, byId))
  return dy >= dx ? 'row' : 'column'
}

function handlePoint(node: Node<any>, byId: Map<string, Node<any>>, side: NodeSide): Point {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  if (side === 'left') return { x: pos.x, y: pos.y + s.height / 2 }
  if (side === 'right') return { x: pos.x + s.width, y: pos.y + s.height / 2 }
  if (side === 'top') return { x: pos.x + s.width / 2, y: pos.y }
  return { x: pos.x + s.width / 2, y: pos.y + s.height }
}

function corridorCandidates(base: number, min: number, max: number): number[] {
  const clampedBase = Math.max(min, Math.min(max, base))
  const candidates: number[] = [clampedBase]
  for (let i = 1; i <= MAX_CORRIDOR_SHIFT_TRIES; i++) {
    const pos = clampedBase + i * CORRIDOR_SHIFT_STEP
    const neg = clampedBase - i * CORRIDOR_SHIFT_STEP
    if (pos <= max) candidates.push(pos)
    if (neg >= min) candidates.push(neg)
  }
  if (candidates.length === 0) return [clampedBase]
  return candidates
}

function midpointOrFallback(a: number, b: number, floor: number, ceil: number): number {
  if (b > a) return (a + b) / 2
  return (floor + ceil) / 2
}

function buildRowCorridorPolyline(
  src: Point,
  tgt: Point,
  sourceLeadY: number,
  targetLeadY: number,
  corridorY: number,
): Point[] {
  return [
    { x: src.x, y: src.y },
    { x: src.x, y: sourceLeadY },
    { x: src.x, y: corridorY },
    { x: tgt.x, y: corridorY },
    { x: tgt.x, y: targetLeadY },
    { x: tgt.x, y: tgt.y },
  ]
}

function buildColumnCorridorPolyline(
  src: Point,
  tgt: Point,
  moveRight: boolean,
  corridorX: number,
): Point[] {
  if (moveRight) {
    return [
      { x: src.x, y: src.y },
      { x: src.x + SOURCE_LEAD, y: src.y },
      { x: corridorX, y: src.y },
      { x: corridorX, y: tgt.y },
      { x: tgt.x - TARGET_LEAD, y: tgt.y },
      { x: tgt.x, y: tgt.y },
    ]
  }
  return [
    { x: src.x, y: src.y },
    { x: src.x - SOURCE_LEAD, y: src.y },
    { x: corridorX, y: src.y },
    { x: corridorX, y: tgt.y },
    { x: tgt.x + TARGET_LEAD, y: tgt.y },
    { x: tgt.x, y: tgt.y },
  ]
}
