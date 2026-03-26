import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { orthogonalizePolyline, resolveOrthogonalPathAvoidingObstacles } from '../orthogonalObstacleDetour'

type Pt = { x: number; y: number }

function simplify(points: Pt[]): Pt[] {
  if (points.length <= 2) return points
  const dedup: Pt[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = dedup[dedup.length - 1]
    const cur = points[i]
    if (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(prev.y - cur.y) < 1e-6) continue
    dedup.push(cur)
  }
  if (dedup.length <= 2) return dedup
  const out: Pt[] = [dedup[0]]
  for (let i = 1; i < dedup.length - 1; i += 1) {
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

function countTurns(points: Pt[]): number {
  const path = simplify(points)
  if (path.length < 3) return 0
  let turns = 0
  let prevDir: 'h' | 'v' | null = null
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]
    const b = path[i + 1]
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    const dir: 'h' | 'v' = dx >= dy ? 'h' : 'v'
    if (prevDir && prevDir !== dir) turns += 1
    prevDir = dir
  }
  return turns
}

function hasDiagonal(points: Pt[]): boolean {
  const path = simplify(points)
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]
    const b = path[i + 1]
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) return true
  }
  return false
}

describe('orthogonalObstacleDetour', () => {
  it('orthogonalizePolyline removes diagonal segments deterministically', () => {
    const path = orthogonalizePolyline([
      { x: 200, y: 120 },
      { x: 64, y: 128 },
      { x: 80, y: 120 },
    ])
    expect(hasDiagonal(path)).toBe(false)
  })

  it('keeps 2-turn candidate when a clear outer corridor exists (non-protected quadrant)', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 100,
      sourceY: 220,
      targetX: 60,
      targetY: 100,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      offset: 16,
      obstacleBoxes: [{ nodeId: 'mid', x: 70, y: 140, width: 20, height: 60 }],
      sourceNodeId: 'S',
      targetNodeId: 'T',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeLessThanOrEqual(2)
  })

  it('keeps the default route orthogonal when no obstacle exists', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 200,
      sourceY: 120,
      targetX: 80,
      targetY: 120,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'S',
      targetNodeId: 'T',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeGreaterThanOrEqual(2)
  })

  it('does not force extra bends when opposite horizontal handles are aligned and non-conflicting', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 100,
      sourceY: 160,
      targetX: 108,
      targetY: 160,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'S',
      targetNodeId: 'T',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeLessThanOrEqual(1)
  })

  it('keeps source-out and target-in for mixed orientation to avoid crossing target body', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 120,
      sourceY: 100,
      targetX: 240,
      targetY: 180,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Right,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'A',
      targetNodeId: 'B',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(points.length).toBeGreaterThanOrEqual(4)
    expect(points[1].y).toBeGreaterThan(points[0].y)
    expect(points[points.length - 2].x).toBeGreaterThan(points[points.length - 1].x)
  })

  it('collapses Z-like 4-turn polyline to 2 turns when seg2/seg4 are parallel (non-protected quadrant)', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 200,
      sourceY: 180,
      targetX: 80,
      targetY: 140,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'A',
      targetNodeId: 'B',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBe(2)
  })

  it('keeps straight line when horizontal out/in directions are naturally aligned', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 80,
      sourceY: 120,
      targetX: 220,
      targetY: 120,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'A',
      targetNodeId: 'B',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeLessThanOrEqual(1)
  })

  it('preserves outer-corridor multi-bend for extreme Top->Bottom (source is upper-left of target)', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 100,
      sourceY: 100,
      targetX: 260,
      targetY: 220,
      sourcePosition: Position.Top,
      targetPosition: Position.Bottom,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'A',
      targetNodeId: 'B',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeGreaterThanOrEqual(4)
    expect(points[1].y).toBeLessThanOrEqual(points[0].y)
    expect(points[points.length - 2].y).toBeGreaterThanOrEqual(points[points.length - 1].y)
  })

  it('preserves outer-corridor multi-bend for extreme Left->Right (source is upper-left of target)', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 100,
      sourceY: 100,
      targetX: 260,
      targetY: 220,
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'A',
      targetNodeId: 'B',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeGreaterThanOrEqual(4)
    expect(points[1].x).toBeLessThanOrEqual(points[0].x)
    expect(points[points.length - 2].x).toBeGreaterThanOrEqual(points[points.length - 1].x)
  })

  it('preserves outer-corridor multi-bend for extreme Right->Left (source is upper-right of target)', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 260,
      sourceY: 100,
      targetX: 100,
      targetY: 220,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'B',
      targetNodeId: 'A',
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeGreaterThanOrEqual(4)
    expect(points[1].x).toBeGreaterThanOrEqual(points[0].x)
    expect(points[points.length - 2].x).toBeLessThanOrEqual(points[points.length - 1].x)
  })

  it('can relax extreme outer-corridor protection for generated swimlane edges', () => {
    const points = resolveOrthogonalPathAvoidingObstacles({
      sourceX: 260,
      sourceY: 100,
      targetX: 100,
      targetY: 220,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      offset: 16,
      obstacleBoxes: [],
      sourceNodeId: 'B',
      targetNodeId: 'A',
      disableExtremeOuterCorridor: true,
    })
    expect(hasDiagonal(points)).toBe(false)
    expect(countTurns(points)).toBeLessThanOrEqual(2)
  })
})
