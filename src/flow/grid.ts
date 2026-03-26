export const GRID_UNIT = 8
export const HANDLE_ALIGN_UNIT = GRID_UNIT * 2
export const SIZE_STEP_RATIO = 0.5

export type GridPoint = { x: number; y: number }

type NodeLike = {
  type?: string
  position?: { x: number; y: number }
  width?: number
  height?: number
  style?: any
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isHandleAlignedNodeType(nodeType: unknown): boolean {
  return nodeType === 'quad' || nodeType === 'group'
}

export function snapToGrid(value: number, unit: number = GRID_UNIT): number {
  if (!Number.isFinite(value)) return 0
  if (unit <= 0) return value
  return Math.round(value / unit) * unit
}

export function snapPointToGrid<T extends GridPoint>(point: T, unit: number = GRID_UNIT): T {
  return {
    ...point,
    x: snapToGrid(point.x, unit),
    y: snapToGrid(point.y, unit),
  }
}

export function snapSizeToGrid(value: number, unit: number = GRID_UNIT * SIZE_STEP_RATIO): number {
  if (!Number.isFinite(value)) return unit
  return Math.max(unit, snapToGrid(value, unit))
}

export function snapSizeByNodeType(value: number, nodeType: unknown): number {
  const baseUnit = isHandleAlignedNodeType(nodeType) ? HANDLE_ALIGN_UNIT : GRID_UNIT
  const stepUnit = Math.max(1, baseUnit * SIZE_STEP_RATIO)
  if (!Number.isFinite(value)) return baseUnit
  return Math.max(baseUnit, snapToGrid(value, stepUnit))
}

export function simplifyOrthogonalPolyline(points: GridPoint[]): GridPoint[] {
  if (points.length <= 2) return points
  const deduped: GridPoint[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = deduped[deduped.length - 1]
    const cur = points[i]
    if (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(prev.y - cur.y) < 1e-6) continue
    deduped.push(cur)
  }
  if (deduped.length <= 2) return deduped
  const out: GridPoint[] = [deduped[0]]
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const a = out[out.length - 1]
    const b = deduped[i]
    const c = deduped[i + 1]
    const collinearX = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6
    const collinearY = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6
    if (collinearX || collinearY) continue
    out.push(b)
  }
  out.push(deduped[deduped.length - 1])
  return out
}

export function snapOrthogonalPolyline(points: GridPoint[], unit: number = GRID_UNIT): GridPoint[] {
  return simplifyOrthogonalPolyline(points.map((p) => snapPointToGrid(p, unit)))
}

export function normalizeWaypointsToGrid(points: GridPoint[], unit: number = GRID_UNIT): GridPoint[] {
  if (points.length === 0) return points
  return snapOrthogonalPolyline(points, unit)
}

export function normalizeNodeGeometryToGrid<T extends NodeLike>(node: T): T {
  const next = { ...node } as T
  const style = (node.style ?? {}) as Record<string, unknown>
  let changed = false

  if (node.position && isFiniteNumber(node.position.x) && isFiniteNumber(node.position.y)) {
    const snappedPos = snapPointToGrid(node.position)
    if (snappedPos.x !== node.position.x || snappedPos.y !== node.position.y) {
      ;(next as any).position = snappedPos
      changed = true
    }
  }

  const rawWidth = isFiniteNumber(node.width) ? node.width : isFiniteNumber(style.width) ? Number(style.width) : undefined
  const rawHeight = isFiniteNumber(node.height) ? node.height : isFiniteNumber(style.height) ? Number(style.height) : undefined

  if (rawWidth != null) {
    const snappedWidth = snapSizeByNodeType(rawWidth, node.type)
    if (!isFiniteNumber(node.width) || Math.abs(snappedWidth - node.width) > 1e-6) {
      ;(next as any).width = snappedWidth
      changed = true
    }
    const styleWidth = isFiniteNumber(style.width) ? Number(style.width) : undefined
    if ((isFiniteNumber(style.width) || isFiniteNumber(node.width)) && Math.abs((styleWidth ?? snappedWidth) - snappedWidth) > 1e-6) {
      ;(next as any).style = { ...(next.style as Record<string, unknown> ?? {}), width: snappedWidth }
      changed = true
    }
  }

  if (rawHeight != null) {
    const snappedHeight = snapSizeByNodeType(rawHeight, node.type)
    if (!isFiniteNumber(node.height) || Math.abs(snappedHeight - node.height) > 1e-6) {
      ;(next as any).height = snappedHeight
      changed = true
    }
    const styleHeight = isFiniteNumber(style.height) ? Number(style.height) : undefined
    if ((isFiniteNumber(style.height) || isFiniteNumber(node.height)) && Math.abs((styleHeight ?? snappedHeight) - snappedHeight) > 1e-6) {
      ;(next as any).style = { ...(next.style as Record<string, unknown> ?? {}), height: snappedHeight }
      changed = true
    }
  }

  return changed ? next : node
}
