import { Position } from '@xyflow/react'
import { getDefaultOrthogonalPoints, type OrthogonalPoint } from './defaultOrthogonalPath'
import { doesPolylineIntersectAnyExclusionBox, doesSegmentIntersectRect, type NodeExclusionBox } from './exclusion'

/** 绕行线与节点包络的额外间隙（可为负值：允许更贴近包络） */
const ROUTE_CLEAR = -8
const TERMINAL_LEAD = 0

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
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1]
    const b = dedup[i]
    const c = dedup[i + 1]
    const sameX = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6
    const sameY = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6
    if (sameX || sameY) continue
    out.push(b)
  }
  out.push(dedup[dedup.length - 1])
  return out
}

function enforceTargetInward(
  points: OrthogonalPoint[],
  targetPosition: Position,
  lead: number = TERMINAL_LEAD,
): OrthogonalPoint[] {
  if (points.length < 2) return points
  const tgt = points[points.length - 1]
  const prev = points[points.length - 2]
  const prefix = points.slice(0, -2)
  const out: OrthogonalPoint[] = [...prefix, prev]

  if (targetPosition === Position.Left || targetPosition === Position.Right) {
    const desiredX = targetPosition === Position.Left ? tgt.x - lead : tgt.x + lead
    const tailStart = out[out.length - 1]
    if (Math.abs(tailStart.x - desiredX) > 1e-6 && Math.abs(tailStart.y - tgt.y) > 1e-6) {
      out.push({ x: desiredX, y: tailStart.y })
    }
    out.push({ x: desiredX, y: tgt.y }, tgt)
    return simplifyOrthogonal(out)
  }

  const desiredY = targetPosition === Position.Top ? tgt.y - lead : tgt.y + lead
  const tailStart = out[out.length - 1]
  if (Math.abs(tailStart.y - desiredY) > 1e-6 && Math.abs(tailStart.x - tgt.x) > 1e-6) {
    out.push({ x: tailStart.x, y: desiredY })
  }
  out.push({ x: tgt.x, y: desiredY }, tgt)
  return simplifyOrthogonal(out)
}

function enforceSourceOutward(
  points: OrthogonalPoint[],
  sourcePosition: Position,
  lead: number,
): OrthogonalPoint[] {
  if (points.length < 2) return points
  const src = points[0]
  const next = points[1]
  const suffix = points.slice(2)
  const out: OrthogonalPoint[] = [src]

  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    const desiredX = sourcePosition === Position.Left ? src.x - lead : src.x + lead
    if (Math.abs(next.x - desiredX) > 1e-6 && Math.abs(next.y - src.y) > 1e-6) {
      out.push({ x: desiredX, y: src.y })
    }
    out.push({ x: desiredX, y: next.y }, ...suffix)
    return simplifyOrthogonal(out)
  }

  const desiredY = sourcePosition === Position.Top ? src.y - lead : src.y + lead
  if (Math.abs(next.y - desiredY) > 1e-6 && Math.abs(next.x - src.x) > 1e-6) {
    out.push({ x: src.x, y: desiredY })
  }
  out.push({ x: next.x, y: desiredY }, ...suffix)
  return simplifyOrthogonal(out)
}

function enforceTerminalDirections(
  points: OrthogonalPoint[],
  sourcePosition: Position,
  targetPosition: Position,
  lead: number,
): OrthogonalPoint[] {
  const withSource = enforceSourceOutward(points, sourcePosition, lead)
  const withTarget = enforceTargetInward(withSource, targetPosition, lead)
  return simplifyOrthogonal(withTarget)
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
  autoOffset: number
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
    autoOffset,
    obstacleBoxes,
    sourceNodeId,
    targetNodeId,
  } = args

  const ignore = [sourceNodeId, targetNodeId]
  let terminalLead = Math.max(offset, TERMINAL_LEAD)
  // 当两个端点在对应方向上的间距不足以容纳 lead 时，不要强行维持过长 in/out；
  // 这样可以避免形态切换时出现不自然的折入/非预期几何。
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    if (targetPosition === Position.Left || targetPosition === Position.Right) {
      terminalLead = Math.min(terminalLead, Math.abs(targetX - sourceX) / 2)
    } else if (targetPosition === Position.Top || targetPosition === Position.Bottom) {
      terminalLead = Math.min(terminalLead, Math.abs(targetY - sourceY) / 2)
    }
  } else if (sourcePosition === Position.Top || sourcePosition === Position.Bottom) {
    if (targetPosition === Position.Left || targetPosition === Position.Right) {
      terminalLead = Math.min(terminalLead, Math.abs(targetX - sourceX) / 2)
    } else if (targetPosition === Position.Top || targetPosition === Position.Bottom) {
      terminalLead = Math.min(terminalLead, Math.abs(targetY - sourceY) / 2)
    }
  }
  const defaultPts = getDefaultOrthogonalPoints(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    offset,
    autoOffset,
  )

  if (obstacleBoxes.length === 0) {
    return enforceTerminalDirections(defaultPts, sourcePosition, targetPosition, terminalLead)
  }
  if (!doesPolylineIntersectAnyExclusionBox(defaultPts, obstacleBoxes, ignore)) {
    return enforceTerminalDirections(defaultPts, sourcePosition, targetPosition, terminalLead)
  }

  const s = defaultPts[0]
  const t = defaultPts[defaultPts.length - 1]
  const isHorizontalSource = sourcePosition === Position.Left || sourcePosition === Position.Right
  const isHorizontalTarget = targetPosition === Position.Left || targetPosition === Position.Right
  const isCShape = sourcePosition === targetPosition

  // 只根据「当前默认路径实际撞到的节点」确定绕行外廊，避免全局最值导致过度绕远。
  const hitBoxes = getIntersectingBoxes(defaultPts, obstacleBoxes, ignore)
  const scopeBoxes = hitBoxes.length > 0 ? hitBoxes : obstacleBoxes

  const east = maxRight(scopeBoxes) + ROUTE_CLEAR
  const west = minLeft(scopeBoxes) - ROUTE_CLEAR
  const south = maxBottom(scopeBoxes) + ROUTE_CLEAR
  const north = minTop(scopeBoxes) - ROUTE_CLEAR

  const candidates: OrthogonalPoint[][] = []

  // ─── 水平 Z：Right↔Left（或 Left↔Right）→ 从左右两侧「外廊」绕行，再沿底/顶横穿 ───
  if (isHorizontalSource && isHorizontalTarget && !isCShape) {
    if (sourcePosition === Position.Right && targetPosition === Position.Left) {
      const xEast = Math.max(s.x, east)
      const xWest = Math.min(s.x, west)
      candidates.push(
        [s, { x: xEast, y: s.y }, { x: xEast, y: south }, { x: t.x, y: south }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: north }, { x: t.x, y: north }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: south }, { x: t.x, y: south }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: north }, { x: t.x, y: north }, t],
      )
    } else if (sourcePosition === Position.Left && targetPosition === Position.Right) {
      const xWest = Math.min(s.x, west)
      const xEast = Math.max(s.x, east)
      candidates.push(
        [s, { x: xWest, y: s.y }, { x: xWest, y: south }, { x: t.x, y: south }, t],
        [s, { x: xWest, y: s.y }, { x: xWest, y: north }, { x: t.x, y: north }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: south }, { x: t.x, y: south }, t],
        [s, { x: xEast, y: s.y }, { x: xEast, y: north }, { x: t.x, y: north }, t],
      )
    }
  }

  // ─── 垂直 Z：Bottom↔Top → 上下外廊 + 左右横穿 ───
  if (!isHorizontalSource && !isHorizontalTarget && !isCShape) {
    // Bottom 出发先向下；Top 出发先向上，避免第一段与端口方向相反
    if (sourcePosition === Position.Bottom && targetPosition === Position.Top) {
      const ySouth = Math.max(s.y, south)
      const xEast = Math.max(s.x, east)
      const xWest = Math.min(s.x, west)
      candidates.push(
        [s, { x: s.x, y: ySouth }, { x: xEast, y: ySouth }, { x: xEast, y: t.y }, t],
        [s, { x: s.x, y: ySouth }, { x: xWest, y: ySouth }, { x: xWest, y: t.y }, t],
      )
    } else if (sourcePosition === Position.Top && targetPosition === Position.Bottom) {
      const yNorth = Math.min(s.y, north)
      const xEast = Math.max(s.x, east)
      const xWest = Math.min(s.x, west)
      candidates.push(
        [s, { x: s.x, y: yNorth }, { x: xEast, y: yNorth }, { x: xEast, y: t.y }, t],
        [s, { x: s.x, y: yNorth }, { x: xWest, y: yNorth }, { x: xWest, y: t.y }, t],
      )
    }
  }

  // ─── C 型：把外廓再推远一层 ───
  if (isCShape && isHorizontalSource) {
    const isRight = sourcePosition === Position.Right
    const outerFar = isRight ? maxRight(scopeBoxes) + offset + ROUTE_CLEAR : minLeft(scopeBoxes) - offset - ROUTE_CLEAR
    candidates.push(
      [s, { x: outerFar, y: s.y }, { x: outerFar, y: t.y }, t],
      [s, { x: outerFar, y: s.y }, { x: outerFar, y: south }, { x: t.x, y: south }, t],
      [s, { x: outerFar, y: s.y }, { x: outerFar, y: north }, { x: t.x, y: north }, t],
    )
  }
  if (isCShape && !isHorizontalSource) {
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

  for (const pts of uniquePaths(candidates)) {
    if (pts.length < 3) continue
    const fixed = enforceTerminalDirections(pts, sourcePosition, targetPosition, terminalLead)
    if (!doesPolylineIntersectAnyExclusionBox(fixed, obstacleBoxes, ignore)) {
      return fixed
    }
  }

  return enforceTerminalDirections(defaultPts, sourcePosition, targetPosition, terminalLead)
}
