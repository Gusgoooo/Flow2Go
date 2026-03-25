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

function countTurns(points: OrthogonalPoint[]): number {
  if (points.length < 3) return 0
  let turns = 0
  // direction is encoded by whether segment is horizontal or vertical
  let prevDir: 'h' | 'v' | null = null
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    // If any diagonal segment sneaks in, treat it as "very bad" so it will never win.
    if (dx > 1e-6 && dy > 1e-6) return Number.POSITIVE_INFINITY
    const dir: 'h' | 'v' = dx > dy ? 'h' : 'v'
    if (prevDir && dir !== prevDir) turns += 1
    prevDir = dir
  }
  return turns
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
  const effLead = Math.max(8, lead)
  const tgt = points[points.length - 1]
  const prev = points[points.length - 2]
  const prefix = points.slice(0, -2)
  const out: OrthogonalPoint[] = [...prefix, prev]

  if (targetPosition === Position.Left || targetPosition === Position.Right) {
    const desiredX = targetPosition === Position.Left ? tgt.x - effLead : tgt.x + effLead
    const tailStart = out[out.length - 1]
    if (Math.abs(tailStart.x - desiredX) > 1e-6 && Math.abs(tailStart.y - tgt.y) > 1e-6) {
      out.push({ x: desiredX, y: tailStart.y })
    }
    out.push({ x: desiredX, y: tgt.y }, tgt)
    return simplifyOrthogonal(out)
  }

  const desiredY = targetPosition === Position.Top ? tgt.y - effLead : tgt.y + effLead
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
  const effLead = Math.max(8, lead)
  const src = points[0]
  const next = points[1]
  const suffix = points.slice(2)
  const out: OrthogonalPoint[] = [src]

  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    const desiredX = sourcePosition === Position.Left ? src.x - effLead : src.x + effLead
    if (Math.abs(next.x - desiredX) > 1e-6 && Math.abs(next.y - src.y) > 1e-6) {
      out.push({ x: desiredX, y: src.y })
    }
    out.push({ x: desiredX, y: next.y }, ...suffix)
    return simplifyOrthogonal(out)
  }

  const desiredY = sourcePosition === Position.Top ? src.y - effLead : src.y + effLead
  if (Math.abs(next.y - desiredY) > 1e-6 && Math.abs(next.x - src.x) > 1e-6) {
    out.push({ x: src.x, y: desiredY })
  }
  out.push({ x: next.x, y: desiredY }, ...suffix)
  return simplifyOrthogonal(out)
}

function applyTerminalAutoOffset(
  points: OrthogonalPoint[],
  sourcePosition: Position,
  targetPosition: Position,
  autoOffset: number,
): OrthogonalPoint[] {
  if (!Number.isFinite(autoOffset) || Math.abs(autoOffset) < 1e-6) return points
  if (points.length < 2) return points

  // Keep it tiny to preserve readability (and match swimlane offset requirements).
  const delta = Math.max(-12, Math.min(12, autoOffset))
  const src = points[0]

  let out: OrthogonalPoint[] = [...points]

  // Source: insert a short perpendicular dogleg right after leaving the port direction.
  // This guarantees the offset is visible even when the rest of the path uses obstacle candidates
  // that otherwise ignore autoOffset.
  if (out.length >= 3) {
    const p1 = out[1]
    const p2 = out[2]

    // If the first turn already makes the offset visible, don't add extra bends.
    if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
      // Horizontal out of the source.
      const alreadyVisible = Math.abs(p2.y - src.y) > 1e-6 || Math.abs(p1.y - src.y) > 1e-6
      if (!alreadyVisible && Math.abs(p1.x - src.x) > 1e-6) {
        // Build a strictly orthogonal "jog" that also keeps continuity with p2:
        // src -> (p1.x, src.y) -> (p1.x, src.y+delta) -> (p2.x, src.y+delta) -> p2 -> ...
        out = simplifyOrthogonal([
          src,
          { x: p1.x, y: src.y },
          { x: p1.x, y: src.y + delta },
          { x: p2.x, y: src.y + delta },
          p2,
          ...out.slice(3),
        ])
      }
    } else {
      // Vertical out of the source.
      const alreadyVisible = Math.abs(p2.x - src.x) > 1e-6 || Math.abs(p1.x - src.x) > 1e-6
      if (!alreadyVisible && Math.abs(p1.y - src.y) > 1e-6) {
        // src -> (src.x, p1.y) -> (src.x+delta, p1.y) -> (src.x+delta, p2.y) -> p2 -> ...
        out = simplifyOrthogonal([
          src,
          { x: src.x, y: p1.y },
          { x: src.x + delta, y: p1.y },
          { x: src.x + delta, y: p2.y },
          p2,
          ...out.slice(3),
        ])
      }
    }
  }

  return out
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
  const isCShape = sourcePosition === targetPosition
  const MIN_TERMINAL_LEAD = 8
  // 当两个端点在对应方向上的间距不足以容纳 lead 时，不要强行维持过长 in/out；
  // 这样可以避免形态切换时出现不自然的折入/非预期几何。
  // 但并排同侧（C 形）时，in/out 短边是可读性关键：不要被压成 0。
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    if (targetPosition === Position.Left || targetPosition === Position.Right) {
      if (!isCShape) terminalLead = Math.min(terminalLead, Math.abs(targetX - sourceX) / 2)
    } else if (targetPosition === Position.Top || targetPosition === Position.Bottom) {
      terminalLead = Math.min(terminalLead, Math.abs(targetY - sourceY) / 2)
    }
  } else if (sourcePosition === Position.Top || sourcePosition === Position.Bottom) {
    if (targetPosition === Position.Left || targetPosition === Position.Right) {
      terminalLead = Math.min(terminalLead, Math.abs(targetX - sourceX) / 2)
    } else if (targetPosition === Position.Top || targetPosition === Position.Bottom) {
      if (!isCShape) terminalLead = Math.min(terminalLead, Math.abs(targetY - sourceY) / 2)
    }
  }
  terminalLead = Math.max(MIN_TERMINAL_LEAD, terminalLead)
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
    return applyTerminalAutoOffset(
      enforceTerminalDirections(defaultPts, sourcePosition, targetPosition, terminalLead),
      sourcePosition,
      targetPosition,
      autoOffset,
    )
  }

  // Hard trigger: if the straight segment between endpoints intersects any obstacle,
  // we MUST attempt a detour even if the default polyline happens not to collide.
  const straight = [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }]
  const straightHits = getIntersectingBoxes(straight as any, obstacleBoxes, ignore)

  if (straightHits.length === 0 && !doesPolylineIntersectAnyExclusionBox(defaultPts, obstacleBoxes, ignore)) {
    return applyTerminalAutoOffset(
      enforceTerminalDirections(defaultPts, sourcePosition, targetPosition, terminalLead),
      sourcePosition,
      targetPosition,
      autoOffset,
    )
  }

  const s = defaultPts[0]
  const t = defaultPts[defaultPts.length - 1]
  const isHorizontalSource = sourcePosition === Position.Left || sourcePosition === Position.Right
  const isHorizontalTarget = targetPosition === Position.Left || targetPosition === Position.Right
  const isCShape2 = sourcePosition === targetPosition

  // 只根据「当前默认路径实际撞到的节点」确定绕行外廊，避免全局最值导致过度绕远。
  const hitBoxes = getIntersectingBoxes(defaultPts, obstacleBoxes, ignore)
  const scopeBoxes = (straightHits.length > 0 ? straightHits : hitBoxes).length > 0 ? (straightHits.length > 0 ? straightHits : hitBoxes) : obstacleBoxes

  const east = maxRight(scopeBoxes) + ROUTE_CLEAR
  const west = minLeft(scopeBoxes) - ROUTE_CLEAR
  const south = maxBottom(scopeBoxes) + ROUTE_CLEAR
  const north = minTop(scopeBoxes) - ROUTE_CLEAR

  const candidates: OrthogonalPoint[][] = []

  // ─── 水平 Z：Right↔Left（或 Left↔Right）→ 从左右两侧「外廊」绕行，再沿底/顶横穿 ───
  if (isHorizontalSource && isHorizontalTarget && !isCShape2) {
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
  if (!isHorizontalSource && !isHorizontalTarget && !isCShape2) {
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
  let bestTurns = Infinity
  let bestLen = Infinity
  for (const pts of uniquePaths(candidates)) {
    if (pts.length < 3) continue
    const fixed = enforceTerminalDirections(pts, sourcePosition, targetPosition, terminalLead)
    if (doesPolylineIntersectAnyExclusionBox(fixed, obstacleBoxes, ignore)) continue
    const turns = countTurns(fixed)
    const len = polylineLength(fixed)
    if (turns < bestTurns || (turns === bestTurns && len < bestLen)) {
      best = fixed
      bestTurns = turns
      bestLen = len
      if (bestTurns <= 1) break
    }
  }
  if (best) return applyTerminalAutoOffset(best, sourcePosition, targetPosition, autoOffset)

  return applyTerminalAutoOffset(
    enforceTerminalDirections(defaultPts, sourcePosition, targetPosition, terminalLead),
    sourcePosition,
    targetPosition,
    autoOffset,
  )
}
