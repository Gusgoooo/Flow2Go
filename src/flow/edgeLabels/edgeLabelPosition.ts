import { Position, getBezierPath, type GetBezierPathParams } from '@xyflow/react'
import type { EdgeLabelAnchors } from './types'

type XY = { x: number; y: number }

/** 与 @xyflow/system getBezierPath 内 getControlWithCurvature 一致，用于在任意 t 取点 */
function calculateControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) {
    return 0.5 * distance
  }
  return curvature * 25 * Math.sqrt(-distance)
}

function getControlWithCurvature(
  pos: Position,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  c: number,
): [number, number] {
  switch (pos) {
    case Position.Left:
      return [x1 - calculateControlOffset(x1 - x2, c), y1]
    case Position.Right:
      return [x1 + calculateControlOffset(x2 - x1, c), y1]
    case Position.Top:
      return [x1, y1 - calculateControlOffset(y1 - y2, c)]
    case Position.Bottom:
      return [x1, y1 + calculateControlOffset(y2 - y1, c)]
    default:
      return [x1, y1]
  }
}

function cubicBezierXY(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): XY {
  const u = 1 - t
  const u2 = u * u
  const u3 = u2 * u
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: u3 * x0 + 3 * u2 * t * x1 + 3 * u * t2 * x2 + t3 * x3,
    y: u3 * y0 + 3 * u2 * t * y1 + 3 * u * t2 * y2 + t3 * y3,
  }
}

/**
 * Bezier 边：center 与 getBezierPath 返回值一致；head/tail 取 t≈0.22 / 0.78。
 */
export function getBezierLabelAnchors(params: GetBezierPathParams): EdgeLabelAnchors {
  const curvature = params.curvature ?? 0.25
  const [sourceControlX, sourceControlY] = getControlWithCurvature(
    params.sourcePosition ?? Position.Bottom,
    params.sourceX,
    params.sourceY,
    params.targetX,
    params.targetY,
    curvature,
  )
  const [targetControlX, targetControlY] = getControlWithCurvature(
    params.targetPosition ?? Position.Top,
    params.targetX,
    params.targetY,
    params.sourceX,
    params.sourceY,
    curvature,
  )
  const [, cx, cy] = getBezierPath(params)
  return {
    center: { x: cx, y: cy },
    head: cubicBezierXY(
      0.22,
      params.sourceX,
      params.sourceY,
      sourceControlX,
      sourceControlY,
      targetControlX,
      targetControlY,
      params.targetX,
      params.targetY,
    ),
    tail: cubicBezierXY(
      0.78,
      params.sourceX,
      params.sourceY,
      sourceControlX,
      sourceControlY,
      targetControlX,
      targetControlY,
      params.targetX,
      params.targetY,
    ),
  }
}

function segmentLen(a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 折线（含正交路径点列）：按路径长度比例取点。
 */
export function getPolylineLabelAnchors(points: ReadonlyArray<XY>): EdgeLabelAnchors {
  if (points.length === 0) {
    const z = { x: 0, y: 0 }
    return { center: z, head: z, tail: z }
  }
  if (points.length === 1) {
    const p = points[0]
    return { center: { ...p }, head: { ...p }, tail: { ...p } }
  }

  const segLens: number[] = []
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const L = segmentLen(points[i], points[i + 1])
    segLens.push(L)
    total += L
  }

  if (total <= 0) {
    const p = points[0]
    return { center: { ...p }, head: { ...p }, tail: { ...p } }
  }

  const atRatio = (r: number): XY => {
    const target = Math.max(0, Math.min(1, r)) * total
    let acc = 0
    for (let i = 0; i < segLens.length; i += 1) {
      const L = segLens[i]
      if (acc + L >= target || i === segLens.length - 1) {
        const t = L <= 0 ? 0 : (target - acc) / L
        const a = points[i]
        const b = points[i + 1]
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      }
      acc += L
    }
    const last = points[points.length - 1]
    return { ...last }
  }

  return {
    center: atRatio(0.5),
    head: atRatio(0.22),
    tail: atRatio(0.78),
  }
}
