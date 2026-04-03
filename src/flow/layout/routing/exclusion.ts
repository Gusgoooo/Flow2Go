import type { Node } from '@xyflow/react'

import { ROUTING_PAD_X, ROUTING_PAD_Y, DEFAULT_SIZE_BY_KIND } from '../../constants'

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type NodeExclusionBox = Rect & {
  nodeId: string
}

export { ROUTING_PAD_X, ROUTING_PAD_Y } from '../../constants'

function estimateNodeSize(node: Node<any>): { width: number; height: number } {
  const style = (node.style ?? {}) as Record<string, unknown>
  const width =
    node.measured?.width ??
    node.width ??
    (typeof style.width === 'number' ? style.width : undefined)
  const height =
    node.measured?.height ??
    node.height ??
    (typeof style.height === 'number' ? style.height : undefined)
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    return { width, height }
  }
  const shape = String((node.data as any)?.shape ?? '')
  if (shape === 'circle') return DEFAULT_SIZE_BY_KIND.circle
  if (shape === 'diamond') return DEFAULT_SIZE_BY_KIND.diamond
  if (node.type === 'text') return DEFAULT_SIZE_BY_KIND.text
  if (node.type === 'asset') {
    const aw = Number((node.data as any)?.assetWidth)
    const ah = Number((node.data as any)?.assetHeight)
    if (Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0) {
      return { width: aw, height: ah }
    }
    return DEFAULT_SIZE_BY_KIND.asset
  }
  return DEFAULT_SIZE_BY_KIND.rect
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

export function getNodeExclusionBox(node: Node<any>): NodeExclusionBox {
  const { width, height } = estimateNodeSize(node)
  const x = node.position?.x ?? 0
  const y = node.position?.y ?? 0
  return {
    nodeId: node.id,
    x: x - ROUTING_PAD_X,
    y: y - ROUTING_PAD_Y,
    width: width + ROUTING_PAD_X * 2,
    height: height + ROUTING_PAD_Y * 2,
  }
}

export function getNodeExclusionBoxes(nodes: Node<any>[]): NodeExclusionBox[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return nodes
    .filter((n) => n.type === 'quad' || n.type === 'asset' || n.type === 'text')
    .map((n) => {
      const abs = absolutePosition(n, byId)
      const { width, height } = estimateNodeSize(n)
      return {
        nodeId: n.id,
        x: abs.x - ROUTING_PAD_X,
        y: abs.y - ROUTING_PAD_Y,
        width: width + ROUTING_PAD_X * 2,
        height: height + ROUTING_PAD_Y * 2,
      }
    })
}

function isPointInsideRect(p: { x: number; y: number }, rect: Rect): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(v) < 1e-9) return 0
  return v > 0 ? 1 : 2
}

function onSegment(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean {
  return (
    Math.min(a.x, c.x) <= b.x &&
    b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y &&
    b.y <= Math.max(a.y, c.y)
  )
}

function segmentsIntersect(
  p1: { x: number; y: number },
  q1: { x: number; y: number },
  p2: { x: number; y: number },
  q2: { x: number; y: number },
): boolean {
  const o1 = orientation(p1, q1, p2)
  const o2 = orientation(p1, q1, q2)
  const o3 = orientation(p2, q2, p1)
  const o4 = orientation(p2, q2, q1)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(p1, p2, q1)) return true
  if (o2 === 0 && onSegment(p1, q2, q1)) return true
  if (o3 === 0 && onSegment(p2, p1, q2)) return true
  if (o4 === 0 && onSegment(p2, q1, q2)) return true
  return false
}

export function doesSegmentIntersectRect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rect: Rect,
): boolean {
  if (isPointInsideRect(p1, rect) || isPointInsideRect(p2, rect)) return true
  const r1 = { x: rect.x, y: rect.y }
  const r2 = { x: rect.x + rect.width, y: rect.y }
  const r3 = { x: rect.x + rect.width, y: rect.y + rect.height }
  const r4 = { x: rect.x, y: rect.y + rect.height }
  return (
    segmentsIntersect(p1, p2, r1, r2) ||
    segmentsIntersect(p1, p2, r2, r3) ||
    segmentsIntersect(p1, p2, r3, r4) ||
    segmentsIntersect(p1, p2, r4, r1)
  )
}

export function doesPolylineIntersectAnyExclusionBox(
  points: Array<{ x: number; y: number }>,
  boxes: NodeExclusionBox[],
  ignoreNodeIds: string[] = [],
): boolean {
  if (points.length < 2 || boxes.length === 0) return false
  const ignore = new Set(ignoreNodeIds)
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    for (const box of boxes) {
      if (ignore.has(box.nodeId)) continue
      if (doesSegmentIntersectRect(p1, p2, box)) return true
    }
  }
  return false
}
