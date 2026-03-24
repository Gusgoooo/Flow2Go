import type { Edge, Node } from '@xyflow/react'
import {
  doesPolylineIntersectAnyExclusionBox,
  getNodeExclusionBoxes,
} from './exclusion'

type Point = { x: number; y: number }

export type RouteCrossLaneArgs = {
  edge: Edge
  sourceNode: Node
  targetNode: Node
  sourceLane: Node
  targetLane: Node
  allNodes: Node[]
  corridorGap?: number
}

const SOURCE_LEAD = 20
const TARGET_LEAD = 20
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

function rightHandlePoint(node: Node<any>, byId: Map<string, Node<any>>): Point {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  return { x: pos.x + s.width, y: pos.y + s.height / 2 }
}

function leftHandlePoint(node: Node<any>, byId: Map<string, Node<any>>): Point {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  return { x: pos.x, y: pos.y + s.height / 2 }
}

function laneRight(node: Node<any>, byId: Map<string, Node<any>>): number {
  const pos = absolutePosition(node, byId)
  const s = nodeSize(node)
  return pos.x + s.width
}

function buildCorridorPolyline(
  src: Point,
  tgt: Point,
  corridorX: number,
): Point[] {
  return [
    { x: src.x, y: src.y },
    { x: src.x + SOURCE_LEAD, y: src.y },
    { x: corridorX, y: src.y },
    { x: corridorX, y: tgt.y },
    { x: tgt.x - TARGET_LEAD, y: tgt.y },
    { x: tgt.x, y: tgt.y },
  ]
}

export function routeCrossLaneEdge(args: RouteCrossLaneArgs): {
  type: 'smoothstep'
  waypoints: Point[]
} {
  const { sourceNode, targetNode, sourceLane, targetLane, allNodes } = args
  const corridorGap = Number.isFinite(args.corridorGap) ? Number(args.corridorGap) : 32
  const byId = new Map(allNodes.map((n) => [n.id, n]))
  const src = rightHandlePoint(sourceNode, byId)
  const tgt = leftHandlePoint(targetNode, byId)
  let corridorX = Math.max(laneRight(sourceLane, byId), laneRight(targetLane, byId)) + corridorGap

  const boxes = getNodeExclusionBoxes(allNodes)
  let best = buildCorridorPolyline(src, tgt, corridorX)
  for (let i = 0; i <= MAX_CORRIDOR_SHIFT_TRIES; i++) {
    const polyline = buildCorridorPolyline(src, tgt, corridorX)
    best = polyline
    const hasCollision = doesPolylineIntersectAnyExclusionBox(
      polyline,
      boxes,
      [sourceNode.id, targetNode.id],
    )
    if (!hasCollision) break
    corridorX += CORRIDOR_SHIFT_STEP
  }

  // waypoints 仅保留中间点（起终点由 edge 渲染层自动补齐）
  return {
    type: 'smoothstep',
    waypoints: best.slice(1, -1),
  }
}
