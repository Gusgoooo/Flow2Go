import { Position } from '@xyflow/react'
import { getDefaultOrthogonalPoints, type OrthogonalPoint } from './defaultOrthogonalPath'
import { doesPolylineIntersectAnyExclusionBox, doesSegmentIntersectRect, type NodeExclusionBox } from './exclusion'

/** 绕行线与节点包络的额外间隙（保持正值，避免"看起来可走 2 弯却被迫 4 弯"） */
const ROUTE_CLEAR = 8

function getIntersectingBoxes(
  points: OrthogonalPoint[],
  boxes: NodeExclusionBox[],
  ignoreNodeIds: string[],
): NodeExclusionBox[] {
  if (points.length < 2 || boxes.length === 0) return []
  const ignore = new Set(ignoreNodeIds)
  const hit = new Map<string, NodeExclusionBox>()
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    for (const box of boxes) {
      if (ignore.has(box.nodeId)) continue
      if (!hit.has(box.nodeId) && doesSegmentIntersectRect(p1, p2, box)) {
        hit.set(box.nodeId, box)
      }
    }
  }
  return Array.from(hit.values())
}

function maxRight(boxes: NodeExclusionBox[]): number {
  let m = -Infinity
  for (const b of boxes) m = Math.max(m, b.x + b.width)
  return m
}

function minLeft(boxes: NodeExclusionBox[]): number {
  let m = Infinity
  for (const b of boxes) m = Math.min(m, b.x)
  return m
}

function maxBottom(boxes: NodeExclusionBox[]): number {
  let m = -Infinity
  for (const b of boxes) m = Math.max(m, b.y + b.height)
  return m
}

function minTop(boxes: NodeExclusionBox[]): number {
  let m = Infinity
  for (const b of boxes) m = Math.min(m, b.y)
  return m
}

function uniquePaths(paths: OrthogonalPoint[][]): OrthogonalPoint[][] {
  const seen = new Set<string>()
  const out: OrthogonalPoint[][] = []
  for (const p of paths) {
    const key = p.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function polylineLength(points: OrthogonalPoint[]): number {
  let len = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    len += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
  }
  return len
}

function segmentDirection(a: OrthogonalPoint, b: OrthogonalPoint): 'h' | 'v' | null {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  if (dx < 1e-6 && dy < 1e-6) return null
  if (dx < 1e-6) return 'v'
  if (dy < 1e-6) return 'h'
  return null
}

export function orthogonalizePolyline(points: OrthogonalPoint[]): OrthogonalPoint[] {
  if (points.length < 2) return points
  const out: OrthogonalPoint[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const a = out[out.length - 1]
    const b = points[i]
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    if (dx < 1e-6 || dy < 1e-6) {
      out.push(b)
      continue
    }
    const prev = out.length >= 2 ? out[out.length - 2] : null
    const next = i + 1 < points.length ? points[i + 1] : null
    const prevDir = prev ? segmentDirection(prev, a) : null
    const nextDir = next ? segmentDirection(b, next) : null

    const elbowHV: OrthogonalPoint = { x: b.x, y: a.y } // A->elbow: h, elbow->B: v
    const elbowVH: OrthogonalPoint = { x: a.x, y: b.y } // A->elbow: v, elbow->B: h

    const score = (first: 'h' | 'v', second: 'h' | 'v'): number => {
      let turns = 1 // elbow itself
      if (prevDir && prevDir !== first) turns += 1
      if (nextDir && second !== nextDir) turns += 1
      return turns
    }

    const scoreHV = score('h', 'v')
    const scoreVH = score('v', 'h')
    out.push(scoreHV <= scoreVH ? elbowHV : elbowVH, b)
  }
  return simplifyOrthogonal(out)
}

function simplifyOrthogonal(points: OrthogonalPoint[]): OrthogonalPoint[] {
  if (points.length <= 2) return points
  const dedup: OrthogonalPoint[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = dedup[dedup.length - 1]
    const cur = points[i]
    if (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(prev.y - cur.y) < 1e-6) continue
    dedup.push(cur)
  }
  if (dedup.length <= 2) return dedup
  const out: OrthogonalPoint[] = [dedup[0]]
  const isBetween1D = (a: number, b: number, c: number): boolean => {
    const lo = Math.min(a, c) - 1e-6
    const hi = Math.max(a, c) + 1e-6
    return b >= lo && b <= hi
  }
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1]
    const b = dedup[i]
    const c = dedup[i + 1]
    const sameX = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6
    const sameY = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6
    if (sameX && isBetween1D(a.y, b.y, c.y)) continue
    if (sameY && isBetween1D(a.x, b.x, c.x)) continue
    out.push(b)
  }
  out.push(dedup[dedup.length - 1])
  return out
}

function countTurns(points: OrthogonalPoint[]): number {
  if (points.length < 3) return 0
  let turns = 0
  let prevDir: 'h' | 'v' | null = null
  for (let i = 0; i < points.length - 1; i += 1) {
    const dir = segmentDirection(points[i], points[i + 1])
    if (!dir) continue
    if (prevDir && dir !== prevDir) turns += 1
    prevDir = dir
  }
  return turns
}

/**
 * Verify that the first/last segments of a path are on-axis and outward/inward
 * relative to the source/target port direction. Prevents collapse from producing
 * paths that go backward through the source or target node body.
 */
function isTerminalDirectionValid(
  points: OrthogonalPoint[],
  sourcePosition: Position,
  targetPosition: Position,
): boolean {
  if (points.length < 2) return true
  const EPS = 1e-6
  const s = points[0]
  const first = points[1]
  const t = points[points.length - 1]
  const last = points[points.length - 2]

  const sourceHoriz = sourcePosition === Position.Left || sourcePosition === Position.Right
  if (sourceHoriz) {
    if (Math.abs(first.y - s.y) > EPS) return false
    if (sourcePosition === Position.Right && first.x < s.x - EPS) return false
    if (sourcePosition === Position.Left && first.x > s.x + EPS) return false
  } else {
    if (Math.abs(first.x - s.x) > EPS) return false
    if (sourcePosition === Position.Bottom && first.y < s.y - EPS) return false
    if (sourcePosition === Position.Top && first.y > s.y + EPS) return false
  }

  const targetHoriz = targetPosition === Position.Left || targetPosition === Position.Right
  if (targetHoriz) {
    if (Math.abs(last.y - t.y) > EPS) return false
    if (targetPosition === Position.Left && last.x > t.x + EPS) return false
    if (targetPosition === Position.Right && last.x < t.x - EPS) return false
  } else {
    if (Math.abs(last.x - t.x) > EPS) return false
    if (targetPosition === Position.Top && last.y > t.y + EPS) return false
    if (targetPosition === Position.Bottom && last.y < t.y - EPS) return false
  }

  return true
}

function hasUTurn(points: OrthogonalPoint[]): boolean {
  for (let i = 0; i < points.length - 2; i++) {
    const a = points[i]
    const b = points[i + 1]
    const c = points[i + 2]
    const d1 = segmentDirection(a, b)
    const d2 = segmentDirection(b, c)
    if (d1 && d2 && d1 === d2) {
      if (d1 === 'h') {
        const s1 = Math.sign(b.x - a.x)
        const s2 = Math.sign(c.x - b.x)
        if (s1 !== 0 && s2 !== 0 && s1 !== s2) return true
      } else {
        const s1 = Math.sign(b.y - a.y)
        const s2 = Math.sign(c.y - b.y)
        if (s1 !== 0 && s2 !== 0 && s1 !== s2) return true
      }
    }
  }
  return false
}

/**
 * Z-shape 4-turn compression:
 * When [seg2 || seg4] and seg3 is perpendicular, try to merge seg2+seg4,
 * compressing 4 turns (5 segments) to 2 turns (3 segments),
 * provided the result doesn't hit obstacles, respects terminal directions,
 * and doesn't introduce U-turns (direction reversals on the same axis).
 */
function collapseZFourTurnsToTwo(
  points: OrthogonalPoint[],
  obstacleBoxes: NodeExclusionBox[],
  ignoreNodeIds: string[],
  sourcePosition: Position,
  targetPosition: Position,
): OrthogonalPoint[] {
  let path = simplifyOrthogonal(orthogonalizePolyline(points))
  if (path.length < 6) return path

  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i <= path.length - 6; i += 1) {
      const p0 = path[i]
      const p1 = path[i + 1]
      const p2 = path[i + 2]
      const p3 = path[i + 3]
      const p4 = path[i + 4]
      const p5 = path[i + 5]

      const d0 = segmentDirection(p0, p1)
      const d1 = segmentDirection(p1, p2)
      const d2 = segmentDirection(p2, p3)
      const d3 = segmentDirection(p3, p4)
      const d4 = segmentDirection(p4, p5)
      if (!d0 || !d1 || !d2 || !d3 || !d4) continue

      // Match Z window: seg2 // seg4, seg3 perpendicular to seg2, and terminal seg1/seg5 aligned.
      if (d1 !== d3) continue
      if (d2 === d1) continue
      if (d0 !== d4) continue
      if (d0 === d1) continue

      const mergedMid: OrthogonalPoint =
        d1 === 'v'
          ? { x: p1.x, y: p4.y }
          : { x: p4.x, y: p1.y }

      const beforeTurns = countTurns(path)
      const candidateRaw = [...path.slice(0, i + 2), mergedMid, ...path.slice(i + 4)]
      const candidate = simplifyOrthogonal(orthogonalizePolyline(candidateRaw))
      const afterTurns = countTurns(candidate)

      if (afterTurns !== 2 || afterTurns >= beforeTurns) continue
      if (candidate.length >= path.length) continue
      if (!isTerminalDirectionValid(candidate, sourcePosition, targetPosition)) continue
      if (hasUTurn(candidate)) continue
      if (doesPolylineIntersectAnyExclusionBox(candidate, obstacleBoxes, ignoreNodeIds)) continue

      path = candidate
      changed = true
      break
    }
  }

  return path
}

/**
 * When the default Z/C/L path intersects node exclusion boxes, try orthogonal
 * detour alternatives (typically 5-segment / 4-turn). Called without user
 * waypoints in the edge render layer, updated every frame as nodes are dragged.
 */
export function resolveOrthogonalPathAvoidingObstacles(args: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  offset: number
  obstacleBoxes: NodeExclusionBox[]
  sourceNodeId: string
  targetNodeId: string
}): OrthogonalPoint[] {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    offset,
    obstacleBoxes,
    sourceNodeId,
    targetNodeId,
  } = args

  const ignore = [sourceNodeId, targetNodeId]
  const defaultPts = simplifyOrthogonal(
    getDefaultOrthogonalPoints(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset, 0),
  )
  const defaultBase = orthogonalizePolyline(defaultPts)
  const defaultOrtho = collapseZFourTurnsToTwo(defaultBase, obstacleBoxes, ignore, sourcePosition, targetPosition)

  if (obstacleBoxes.length === 0) {
    return defaultOrtho
  }

  const defaultIntersects = doesPolylineIntersectAnyExclusionBox(defaultOrtho, obstacleBoxes, ignore)
  if (!defaultIntersects) {
    return defaultOrtho
  }

  const s = defaultOrtho[0]
  const t = defaultOrtho[defaultOrtho.length - 1]
  const isHorizontalSource = sourcePosition === Position.Left || sourcePosition === Position.Right
  const isHorizontalTarget = targetPosition === Position.Left || targetPosition === Position.Right
  const isCShape2 = sourcePosition === targetPosition

  const hitBoxes = getIntersectingBoxes(defaultOrtho, obstacleBoxes, ignore)
  const scopeBoxes = hitBoxes.length > 0 ? hitBoxes : obstacleBoxes

  const east = maxRight(scopeBoxes) + ROUTE_CLEAR
  const west = minLeft(scopeBoxes) - ROUTE_CLEAR
  const south = maxBottom(scopeBoxes) + ROUTE_CLEAR
  const north = minTop(scopeBoxes) - ROUTE_CLEAR

  const candidates: OrthogonalPoint[][] = []

  if (isHorizontalSource && isHorizontalTarget && !isCShape2) {
    if (sourcePosition === Position.Right && targetPosition === Position.Left) {
      const xFar = Math.max(east, s.x + offset, t.x + offset)
      const xEast = Math.max(s.x, east)
      const xWest = Math.min(s.x, west)
      candidates.push(
        [s, { x: xFar, y: s.y }, { x: xFar, y: t.y }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: south }, { x: t.x, y: south }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: north }, { x: t.x, y: north }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: south }, { x: t.x, y: south }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: north }, { x: t.x, y: north }, t],
      )
    } else if (sourcePosition === Position.Left && targetPosition === Position.Right) {
      const xFar = Math.min(west, s.x - offset, t.x - offset)
      const xWest = Math.min(s.x, west)
      const xEast = Math.max(s.x, east)
      candidates.push(
        [s, { x: xFar, y: s.y }, { x: xFar, y: t.y }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: south }, { x: t.x, y: south }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: north }, { x: t.x, y: north }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: south }, { x: t.x, y: south }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: north }, { x: t.x, y: north }, t],
      )
    }
  }

  if (!isHorizontalSource && !isHorizontalTarget && !isCShape2) {
    if (sourcePosition === Position.Bottom && targetPosition === Position.Top) {
      const yNear = (s.y + t.y) / 2
      const yFar = Math.min(t.y - offset, Math.max(s.y + offset, yNear))
      const ySouth = Math.max(s.y, south)
      const xEast = Math.max(s.x, east)
      const xWest = Math.min(s.x, west)
      candidates.push(
        ...(yFar > s.y + 1e-6 && yFar < t.y - 1e-6 ? [[s, { x: s.x, y: yFar }, { x: t.x, y: yFar }, t] as OrthogonalPoint[]] : []),
        [s, { x: s.x, y: ySouth }, { x: xEast, y: ySouth }, { x: xEast, y: t.y }, t],
        [s, { x: s.x, y: ySouth }, { x: xWest, y: ySouth }, { x: xWest, y: t.y }, t],
      )
    } else if (sourcePosition === Position.Top && targetPosition === Position.Bottom) {
      const yNear = (s.y + t.y) / 2
      const yFar = Math.max(t.y + offset, Math.min(s.y - offset, yNear))
      const yNorth = Math.min(s.y, north)
      const xEast = Math.max(s.x, east)
      const xWest = Math.min(s.x, west)
      candidates.push(
        ...(yFar < s.y - 1e-6 && yFar > t.y + 1e-6 ? [[s, { x: s.x, y: yFar }, { x: t.x, y: yFar }, t] as OrthogonalPoint[]] : []),
        [s, { x: s.x, y: yNorth }, { x: xEast, y: yNorth }, { x: xEast, y: t.y }, t],
        [s, { x: s.x, y: yNorth }, { x: xWest, y: yNorth }, { x: xWest, y: t.y }, t],
      )
    }
  }

  if (isCShape2 && isHorizontalSource) {
    const isRight = sourcePosition === Position.Right
    const outerFar = isRight ? maxRight(scopeBoxes) + offset + ROUTE_CLEAR : minLeft(scopeBoxes) - offset - ROUTE_CLEAR
    candidates.push(
      [s, { x: outerFar, y: s.y }, { x: outerFar, y: t.y }, t],
      [s, { x: outerFar, y: s.y }, { x: outerFar, y: south }, { x: t.x, y: south }, t],
      [s, { x: outerFar, y: s.y }, { x: outerFar, y: north }, { x: t.x, y: north }, t],
    )
  }
  if (isCShape2 && !isHorizontalSource) {
    const isBottom = sourcePosition === Position.Bottom
    const outerFar = isBottom ? maxBottom(scopeBoxes) + offset + ROUTE_CLEAR : minTop(scopeBoxes) - offset - ROUTE_CLEAR
    candidates.push(
      [s, { x: s.x, y: outerFar }, { x: t.x, y: outerFar }, t],
      [s, { x: s.x, y: outerFar }, { x: east, y: outerFar }, { x: east, y: t.y }, t],
      [s, { x: s.x, y: outerFar }, { x: west, y: outerFar }, { x: west, y: t.y }, t],
    )
  }

  if (isHorizontalSource !== isHorizontalTarget) {
    if (isHorizontalSource) {
      candidates.push(
        [s, { x: east, y: s.y }, { x: east, y: south }, { x: t.x, y: south }, t],
        [s, { x: west, y: s.y }, { x: west, y: south }, { x: t.x, y: south }, t],
        [s, { x: east, y: s.y }, { x: east, y: north }, { x: t.x, y: north }, t],
        [s, { x: west, y: s.y }, { x: west, y: north }, { x: t.x, y: north }, t],
      )
    } else {
      candidates.push(
        [s, { x: s.x, y: south }, { x: east, y: south }, { x: east, y: t.y }, t],
        [s, { x: s.x, y: south }, { x: west, y: south }, { x: west, y: t.y }, t],
        [s, { x: s.x, y: north }, { x: east, y: north }, { x: east, y: t.y }, t],
        [s, { x: s.x, y: north }, { x: west, y: north }, { x: west, y: t.y }, t],
      )
    }
  }

  let best: OrthogonalPoint[] | null = null
  let bestLen = Infinity
  for (const pts of uniquePaths(candidates)) {
    if (pts.length < 3) continue
    const fixed = orthogonalizePolyline(simplifyOrthogonal(pts))
    if (doesPolylineIntersectAnyExclusionBox(fixed, obstacleBoxes, ignore)) continue
    const len = polylineLength(fixed)
    if (len < bestLen) {
      best = fixed
      bestLen = len
    }
  }
  if (best) return collapseZFourTurnsToTwo(best, obstacleBoxes, ignore, sourcePosition, targetPosition)

  return defaultOrtho
}
