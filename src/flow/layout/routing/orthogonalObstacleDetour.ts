import { Position } from '@xyflow/react'
import { getDefaultOrthogonalPoints, type OrthogonalPoint } from './defaultOrthogonalPath'
import { doesPolylineIntersectAnyExclusionBox, doesSegmentIntersectRect, type NodeExclusionBox } from './exclusion'

/** 绕行线与节点包络的额外间隙（保持正值，避免“看起来可走 2 弯却被迫 4 弯”） */
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
    // 只有在 b 位于 a 与 c 之间时，才可安全删去共线中间点；
    // 若 b 在外侧（方向反转的折返点），必须保留。
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

function isExtremeOuterCorridorCase(args: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
}): boolean {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  } = args
  const EPS = 1e-6
  // 仅保护两个已验证会被“过度压弯”导致埋线的极端场景：
  // 1) A 在 B 左上，Top -> Bottom
  if (
    sourcePosition === Position.Top &&
    targetPosition === Position.Bottom &&
    sourceX <= targetX - EPS &&
    sourceY <= targetY - EPS
  ) {
    return true
  }
  // 2) A 在 B 左上，Left -> Right
  if (
    sourcePosition === Position.Left &&
    targetPosition === Position.Right &&
    sourceX <= targetX - EPS &&
    sourceY <= targetY - EPS
  ) {
    return true
  }
  // 3) B 在 A 右上，Right -> Left（source 在 target 右上）
  // 该场景若被压成少弯，容易出现贴节点/埋线，需保留外廊多弯。
  if (
    sourcePosition === Position.Right &&
    targetPosition === Position.Left &&
    sourceX >= targetX + EPS &&
    sourceY <= targetY - EPS
  ) {
    return true
  }
  return false
}

/**
 * Z 型 4 弯压缩：
 * 当出现 [seg2 || seg4] 且 seg3 垂直于它们时，尝试删除 seg3 并合并 seg2+seg4，
 * 将 4 弯（5 段）压缩为 2 弯（3 段），前提是不会撞节点。
 */
function collapseZFourTurnsToTwo(
  points: OrthogonalPoint[],
  obstacleBoxes: NodeExclusionBox[],
  ignoreNodeIds: string[],
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

      // Match Z window: seg2 // seg4, seg3 ⟂ seg2, and terminal seg1/seg5 aligned.
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
      if (doesPolylineIntersectAnyExclusionBox(candidate, obstacleBoxes, ignoreNodeIds)) continue

      path = candidate
      changed = true
      break
    }
  }

  return path
}

/**
 * 在默认 Z/C/L 与节点包络相交时，尝试「多一折」的正交绕行（常见为 5 段 / 4 个弯）。
 * 无用户 waypoints 时在边渲染层调用，随节点拖动每帧更新，保证连续。
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
  /**
   * 仅用于特定调用场景（如 AI 生成泳道图）：
   * 关闭“极端象限外廊保护”，允许回到更少弯策略。
   */
  disableExtremeOuterCorridor?: boolean
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
    disableExtremeOuterCorridor = false,
  } = args

  const ignore = [sourceNodeId, targetNodeId]
  const protectExtremeOuterCorridor = !disableExtremeOuterCorridor &&
    isExtremeOuterCorridorCase({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    })
  const defaultPts = simplifyOrthogonal(
    getDefaultOrthogonalPoints(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset, 0),
  )
  const defaultBase = orthogonalizePolyline(defaultPts)
  const defaultOrtho = protectExtremeOuterCorridor
    ? defaultBase
    : collapseZFourTurnsToTwo(defaultBase, obstacleBoxes, ignore)

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

  // 只根据「当前默认路径实际撞到的节点」确定绕行外廊，避免全局最值导致过度绕远。
  const hitBoxes = getIntersectingBoxes(defaultOrtho, obstacleBoxes, ignore)
  const scopeBoxes = hitBoxes.length > 0 ? hitBoxes : obstacleBoxes

  const east = maxRight(scopeBoxes) + ROUTE_CLEAR
  const west = minLeft(scopeBoxes) - ROUTE_CLEAR
  const south = maxBottom(scopeBoxes) + ROUTE_CLEAR
  const north = minTop(scopeBoxes) - ROUTE_CLEAR

  const candidates: OrthogonalPoint[][] = []

  // ─── 水平 Z：Right↔Left（或 Left↔Right）→ 从左右两侧「外廊」绕行，再沿底/顶横穿 ───
  if (isHorizontalSource && isHorizontalTarget && !isCShape2) {
    if (sourcePosition === Position.Right && targetPosition === Position.Left) {
      // 优先尝试 2 弯：同一条外廊竖线（很多场景足够，不需要强行 3 弯）
      const xFar = Math.max(east, s.x + offset, t.x + offset)
      const xEast = Math.max(s.x, east)
      const xWest = Math.min(s.x, west)
      candidates.push(
        ...(protectExtremeOuterCorridor ? [] : [[s, { x: xFar, y: s.y }, { x: xFar, y: t.y }, t] as OrthogonalPoint[]]),
        [s, { x: xEast, y: s.y }, { x: xEast, y: south }, { x: t.x, y: south }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: north }, { x: t.x, y: north }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: south }, { x: t.x, y: south }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: north }, { x: t.x, y: north }, t],
      )
    } else if (sourcePosition === Position.Left && targetPosition === Position.Right) {
      // 优先尝试 2 弯：同一条外廊竖线
      const xFar = Math.min(west, s.x - offset, t.x - offset)
      const xWest = Math.min(s.x, west)
      const xEast = Math.max(s.x, east)
      candidates.push(
        ...(protectExtremeOuterCorridor ? [] : [[s, { x: xFar, y: s.y }, { x: xFar, y: t.y }, t] as OrthogonalPoint[]]),
        [s, { x: xWest, y: s.y }, { x: xWest, y: south }, { x: t.x, y: south }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: north }, { x: t.x, y: north }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: south }, { x: t.x, y: south }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: north }, { x: t.x, y: north }, t],
      )
    }
  }

  // ─── 垂直 Z：Bottom↔Top → 上下外廊 + 左右横穿 ───
  if (!isHorizontalSource && !isHorizontalTarget && !isCShape2) {
    // Bottom 出发先向下；Top 出发先向上，避免第一段与端口方向相反
    if (sourcePosition === Position.Bottom && targetPosition === Position.Top) {
      // 优先尝试 2 弯：同一条中间水平线（若区间可行）
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
      // 优先尝试 2 弯：同一条中间水平线（若区间可行）
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

  // ─── C 型：把外廓再推远一层 ───
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

  // ─── L 型：先尝试「绕远角」的 5 点折线 ───
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
    if (protectExtremeOuterCorridor && countTurns(fixed) < 4) continue
    if (doesPolylineIntersectAnyExclusionBox(fixed, obstacleBoxes, ignore)) continue
    const len = polylineLength(fixed)
    if (len < bestLen) {
      best = fixed
      bestLen = len
    }
  }
  if (best) return protectExtremeOuterCorridor ? best : collapseZFourTurnsToTwo(best, obstacleBoxes, ignore)

  return defaultOrtho
}
