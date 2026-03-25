import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  Position,
  type EdgeProps,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import { getPolylineLabelAnchors } from './edgeLabels/edgeLabelPosition'
import { SmartEdgeLabel } from './edgeLabels/SmartEdgeLabel'
import type { EdgeLabelLayoutConfig, EdgeLabelStyle } from './edgeLabels/types'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'
import { padEdgeEndpoints } from './edgeEndpointPad'
import { doesPolylineIntersectAnyExclusionBox, getNodeExclusionBoxes } from './layout/routing/exclusion'
import { resolveOrthogonalPathAvoidingObstacles } from './layout/routing/orthogonalObstacleDetour'

type SwimlaneEdgeSemanticType = 'normal' | 'crossLane' | 'returnFlow' | 'conditional'

type EdgeData = {
  waypoints?: Point[]
  autoOffset?: number
  routeRef?: {
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
  }
  editingLabel?: boolean
  labelStyle?: EdgeLabelStyle
  labelLayout?: EdgeLabelLayoutConfig
  arrowStyle?: 'none' | 'end' | 'start' | 'both'
  semanticType?: SwimlaneEdgeSemanticType
  sourceLaneId?: string
  targetLaneId?: string
  labelTextOnly?: boolean
}
type Point = { x: number; y: number }

function markerColorFrom(style: EdgeProps['style'], marker: unknown): string {
  const mk = (marker ?? {}) as { color?: string }
  const s = (style ?? {}) as { stroke?: string; ['--xy-edge-stroke']?: string }
  return s['--xy-edge-stroke'] ?? s.stroke ?? mk.color ?? '#94a3b8'
}

function markerKindFrom(marker: unknown): 'closed' | 'open' | null {
  if (!marker || typeof marker !== 'object') return null
  const t = (marker as { type?: unknown }).type
  if (t === MarkerType.ArrowClosed || t === 'arrowclosed') return 'closed'
  if (t === MarkerType.Arrow || t === 'arrow') return 'open'
  return null
}

/**
 * 生成圆角正交折线路径（几何上保持 90 度拐弯方向）
 */
function createRoundedPath(points: Point[], radius: number): string {
  if (points.length < 2) return ''

  let path = `M ${points[0].x} ${points[0].y}`

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]

    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y

    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)

    if (len1 === 0 || len2 === 0) {
      path += ` L ${curr.x} ${curr.y}`
      continue
    }

    const r = Math.min(radius, len1 / 2, len2 / 2)

    const startX = curr.x - (dx1 / len1) * r
    const startY = curr.y - (dy1 / len1) * r
    const endX = curr.x + (dx2 / len2) * r
    const endY = curr.y + (dy2 / len2) * r

    path += ` L ${startX} ${startY}`
    path += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`
  }

  path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`

  return path
}

/**
 * 计算每个线段的信息，用于渲染拖拽手柄
 */
function getSegments(points: Point[]): Array<{
  index: number
  x1: number
  y1: number
  x2: number
  y2: number
  midX: number
  midY: number
  isVertical: boolean
  length: number
}> {
  const segments: Array<{
    index: number
    x1: number
    y1: number
    x2: number
    y2: number
    midX: number
    midY: number
    isVertical: boolean
    length: number
  }> = []
  
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    const dx = Math.abs(p2.x - p1.x)
    const dy = Math.abs(p2.y - p1.y)
    const isVertical = dx < dy // 垂直段: dy 更大
    
    segments.push({
      index: i,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
      isVertical,
      length: Math.sqrt(dx * dx + dy * dy),
    })
  }
  
  return segments
}

/** 让首尾两段与端口方向对齐，避免 in/out 出现斜线 */
function snapEndpointsToPorts(
  points: Point[],
  sourcePosition: Position,
  targetPosition: Position,
): Point[] {
  if (points.length < 3) return points

  const snapped = points.map((p) => ({ ...p }))
  const MIN_INWARD_LEAD = 8

  // 第一段：源节点 → 第一个中间点
  const src = snapped[0]
  const first = snapped[1]
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    // 水平出发：和源节点保持同一条水平线
    first.y = src.y
    // 保证第一拐点后续仍为垂直：第二段应与 first 的 x 对齐
    const next = snapped[2]
    if (next) next.x = first.x
  } else {
    // 垂直出发：和源节点保持同一条竖线
    first.x = src.x
    // 保证第一拐点后续仍为水平：第二段应与 first 的 y 对齐
    const next = snapped[2]
    if (next) next.y = first.y
  }

  // 最后一段：最后一个中间点 → 目标节点
  const tgt = snapped[snapped.length - 1]
  const lastIdx = snapped.length - 2
  const last = snapped[lastIdx]
  if (targetPosition === Position.Left || targetPosition === Position.Right) {
    // 水平进入：和目标节点保持同一条水平线
    last.y = tgt.y
    // 保证「in」方向一定朝节点内侧（Right: 从右往左进入；Left: 从左往右进入）
    if (targetPosition === Position.Left) last.x = Math.min(last.x, tgt.x - MIN_INWARD_LEAD)
    if (targetPosition === Position.Right) last.x = Math.max(last.x, tgt.x + MIN_INWARD_LEAD)
    // 保证最后一个拐点前后仍为正交：倒数第二段需与 last 的 x 对齐
    const prev = snapped[lastIdx - 1]
    if (prev) prev.x = last.x
  } else {
    // 垂直进入：和目标节点保持同一条竖线
    last.x = tgt.x
    // 保证「in」方向一定朝节点内侧（Bottom: 从下往上进入；Top: 从上往下进入）
    if (targetPosition === Position.Top) last.y = Math.min(last.y, tgt.y - MIN_INWARD_LEAD)
    if (targetPosition === Position.Bottom) last.y = Math.max(last.y, tgt.y + MIN_INWARD_LEAD)
    // 保证最后一个拐点前后仍为正交：倒数第二段需与 last 的 y 对齐
    const prev = snapped[lastIdx - 1]
    if (prev) prev.y = last.y
  }

  return snapped
}

function normalizeOrthogonalWaypoints(
  source: Point,
  target: Point,
  waypoints: Point[],
  sourcePosition: Position,
  targetPosition: Position,
): Point[] {
  if (waypoints.length === 0) return []
  const full = [source, ...waypoints.map((p) => ({ ...p })), target]
  let horizontal = sourcePosition === Position.Left || sourcePosition === Position.Right
  for (let i = 1; i < full.length - 1; i += 1) {
    if (horizontal) {
      full[i].y = full[i - 1].y
    } else {
      full[i].x = full[i - 1].x
    }
    horizontal = !horizontal
  }

  const targetHorizontal = targetPosition === Position.Left || targetPosition === Position.Right
  const lastIdx = full.length - 2
  if (lastIdx >= 1) {
    if (targetHorizontal) {
      full[lastIdx].y = full[full.length - 1].y
    } else {
      full[lastIdx].x = full[full.length - 1].x
    }
  }

  const snapped = snapEndpointsToPorts(full, sourcePosition, targetPosition)
  const out = snapped.slice(1, -1)
  if (out.length === 0) return out
  const deduped: Point[] = [out[0]]
  for (let i = 1; i < out.length; i += 1) {
    const prev = deduped[deduped.length - 1]
    const cur = out[i]
    if (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(prev.y - cur.y) < 1e-6) continue
    deduped.push(cur)
  }
  return deduped
}

function adaptWaypointsByRouteRef(
  waypoints: Point[],
  routeRef: EdgeData['routeRef'] | undefined,
  now: { sourceX: number; sourceY: number; targetX: number; targetY: number },
): Point[] {
  if (!routeRef || waypoints.length === 0) return waypoints
  const dsx = now.sourceX - routeRef.sourceX
  const dsy = now.sourceY - routeRef.sourceY
  const dtx = now.targetX - routeRef.targetX
  const dty = now.targetY - routeRef.targetY
  if (Math.abs(dsx) < 1e-6 && Math.abs(dsy) < 1e-6 && Math.abs(dtx) < 1e-6 && Math.abs(dty) < 1e-6) {
    return waypoints
  }
  const n = waypoints.length
  return waypoints.map((p, i) => {
    const t = (i + 1) / (n + 1)
    return {
      x: p.x + dsx * (1 - t) + dtx * t,
      y: p.y + dsy * (1 - t) + dty * t,
    }
  })
}

export function EditableSmoothStepEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerStart,
    markerEnd,
    style,
    interactionWidth,
    label,
    data,
    selected,
  } = props

  const dataTyped = (data ?? {}) as EdgeData
  const labelStyleObj = (dataTyped.labelStyle ?? (props as { labelStyle?: EdgeLabelStyle }).labelStyle) ?? {}
  const labelFontSize = labelStyleObj.fontSize ?? 10
  const labelFontWeight = labelStyleObj.fontWeight ?? '400'
  const labelColor = labelStyleObj.color ?? 'rgba(0,0,0,0.8)'

  const rf = useReactFlow()

  const obstacleBoxes = useStore((state) => getNodeExclusionBoxes(state.nodes))
  const allEdges = useStore((state) => state.edges as Array<EdgeProps>)

  const srcPos = sourcePosition ?? Position.Right
  const tgtPos = targetPosition ?? Position.Left

  const semanticType = dataTyped.semanticType
  const semanticStyle: React.CSSProperties = {}
  if (semanticType === 'returnFlow') {
    semanticStyle.strokeDasharray = '6 3'
    semanticStyle.opacity = 0.7
  }

  const padded = useMemo(
    () =>
      padEdgeEndpoints({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition: srcPos,
        targetPosition: tgtPos,
      }),
    [sourceX, sourceY, targetX, targetY, srcPos, tgtPos],
  )

  // 从 data 中获取保存的路径点，或生成默认路径
  const savedWaypoints: Point[] | undefined = dataTyped.waypoints
  const hasFiniteAutoOffset = typeof dataTyped.autoOffset === 'number' && Number.isFinite(dataTyped.autoOffset)

  const positionToSide = (p: Position | undefined): 'top' | 'right' | 'bottom' | 'left' | null => {
    if (p === Position.Top) return 'top'
    if (p === Position.Right) return 'right'
    if (p === Position.Bottom) return 'bottom'
    if (p === Position.Left) return 'left'
    return null
  }

  const sideFromHandleId = (handleId: unknown): 'top' | 'right' | 'bottom' | 'left' | null => {
    if (typeof handleId !== 'string') return null
    if (handleId.endsWith('-top')) return 'top'
    if (handleId.endsWith('-right')) return 'right'
    if (handleId.endsWith('-bottom')) return 'bottom'
    if (handleId.endsWith('-left')) return 'left'
    return null
  }

  const effectiveAutoOffset = useMemo(() => {
    const baseAutoOffset = hasFiniteAutoOffset ? (dataTyped.autoOffset as number) : 0
    if (hasFiniteAutoOffset) return baseAutoOffset

    const srcSide = sideFromHandleId(sourceHandle) ?? positionToSide(srcPos)
    const tgtSide = sideFromHandleId(targetHandle) ?? positionToSide(tgtPos)
    if (!srcSide || !tgtSide) return baseAutoOffset

    let srcOutgoing = 0
    let srcIncoming = 0
    let tgtOutgoing = 0
    let tgtIncoming = 0
    for (const e of allEdges) {
      const s = sideFromHandleId((e as any).sourceHandle)
      const t = sideFromHandleId((e as any).targetHandle)
      if ((e as any).source === source && s === srcSide) srcOutgoing += 1
      if ((e as any).target === source && t === srcSide) srcIncoming += 1
      if ((e as any).source === target && s === tgtSide) tgtOutgoing += 1
      if ((e as any).target === target && t === tgtSide) tgtIncoming += 1
    }

    const mixedAtSource = srcOutgoing > 0 && srcIncoming > 0
    const mixedAtTarget = tgtOutgoing > 0 && tgtIncoming > 0
    const halfUnit = 12 // 1/2 of LAYOUT_UNIT(24)

    // 对本边来说：source 端一定是 out，target 端一定是 in
    if (mixedAtSource || mixedAtTarget) {
      const extra = halfUnit * (mixedAtSource ? 1 : 0) - halfUnit * (mixedAtTarget ? 1 : 0)
      return baseAutoOffset + Math.max(-halfUnit, Math.min(halfUnit, extra))
    }

    // Fallback: if multiple edges share the same handle side (even without in/out mix),
    // apply a tiny deterministic offset (0, +half, -half ...) so user can visually distinguish them.
    const laneToSigned = (lane: number) => {
      if (lane <= 0) return 0
      const k = Math.ceil(lane / 2)
      return lane % 2 === 1 ? k : -k
    }

    const sameSourceSide = allEdges
      .filter((e) => (e as any).source === source && (sideFromHandleId((e as any).sourceHandle) ?? null) === srcSide)
      .map((e) => String((e as any).id ?? ''))
      .sort()
    const sameTargetSide = allEdges
      .filter((e) => (e as any).target === target && (sideFromHandleId((e as any).targetHandle) ?? null) === tgtSide)
      .map((e) => String((e as any).id ?? ''))
      .sort()

    const myId = String(id ?? '')
    const idxOut = sameSourceSide.indexOf(myId)
    const idxIn = sameTargetSide.indexOf(myId)
    const idx = Math.max(idxOut, idxIn)
    const groupSize = Math.max(sameSourceSide.length, sameTargetSide.length)
    if (groupSize > 1 && idx >= 0) {
      const extra = laneToSigned(idx) * halfUnit
      return baseAutoOffset + Math.max(-halfUnit, Math.min(halfUnit, extra))
    }

    return baseAutoOffset
  }, [
    allEdges,
    dataTyped.autoOffset,
    hasFiniteAutoOffset,
    id,
    source,
    sourceHandle,
    srcPos,
    target,
    targetHandle,
    tgtPos,
  ])

  const autoOffset = effectiveAutoOffset
  const sourcePoint = useMemo(() => ({ x: padded.sourceX, y: padded.sourceY }), [padded.sourceX, padded.sourceY])
  const targetPoint = useMemo(() => ({ x: padded.targetX, y: padded.targetY }), [padded.targetX, padded.targetY])
  const endpointSnapshot = useMemo(
    () => ({
      sourceX: padded.sourceX,
      sourceY: padded.sourceY,
      targetX: padded.targetX,
      targetY: padded.targetY,
    }),
    [padded.sourceX, padded.sourceY, padded.targetX, padded.targetY],
  )
  const effectiveWaypoints = useMemo((): Point[] | undefined => {
    if (!savedWaypoints || savedWaypoints.length === 0) return undefined
    const adapted = adaptWaypointsByRouteRef(savedWaypoints, dataTyped.routeRef, endpointSnapshot)
    return normalizeOrthogonalWaypoints(sourcePoint, targetPoint, adapted, srcPos, tgtPos)
  }, [savedWaypoints, dataTyped.routeRef, endpointSnapshot, sourcePoint, targetPoint, srcPos, tgtPos])
  const endpointMovedSinceRouteRef = useMemo(() => {
    const ref = dataTyped.routeRef
    if (!ref) return true
    const eps = 1e-3
    return (
      Math.abs(ref.sourceX - endpointSnapshot.sourceX) > eps ||
      Math.abs(ref.sourceY - endpointSnapshot.sourceY) > eps ||
      Math.abs(ref.targetX - endpointSnapshot.targetX) > eps ||
      Math.abs(ref.targetY - endpointSnapshot.targetY) > eps
    )
  }, [dataTyped.routeRef, endpointSnapshot])

  const points = useMemo((): Point[] => {
    if (!endpointMovedSinceRouteRef && effectiveWaypoints && effectiveWaypoints.length > 0) {
      const rawPoints = [
        { x: padded.sourceX, y: padded.sourceY },
        ...effectiveWaypoints,
        { x: padded.targetX, y: padded.targetY },
      ]
      const snapped = snapEndpointsToPorts(rawPoints, srcPos, tgtPos)
      const intersects = doesPolylineIntersectAnyExclusionBox(snapped, obstacleBoxes, [String(source), String(target)])
      // 用户手动调过路径后，若后续节点移动导致该路径穿过其它节点，则回退到自动避障路由。
      if (!intersects) return snapped
    }
    const routed = resolveOrthogonalPathAvoidingObstacles({
      sourceX: padded.sourceX,
      sourceY: padded.sourceY,
      targetX: padded.targetX,
      targetY: padded.targetY,
      sourcePosition: srcPos,
      targetPosition: tgtPos,
      offset: 16,
      autoOffset,
      obstacleBoxes,
      sourceNodeId: String(source),
      targetNodeId: String(target),
    })
    return snapEndpointsToPorts(routed, srcPos, tgtPos)
  }, [padded, srcPos, tgtPos, autoOffset, effectiveWaypoints, obstacleBoxes, source, target, endpointMovedSinceRouteRef])

  // 生成圆角路径
  const edgePath = createRoundedPath(points, 12)
  
  // 获取所有线段信息
  const segments = getSegments(points)
  const primaryDragSegmentIdx = useMemo(() => {
    if (segments.length < 3) return -1
    // Prefer the longest non-terminal segment; terminal doglegs (short in/out leads or autoOffset nudges)
    // should not steal the "middle handle" of a Z-path.
    let bestIdx = -1
    let bestLen = -Infinity
    for (let i = 1; i < segments.length - 1; i += 1) {
      const len = segments[i]?.length ?? 0
      if (len > bestLen) {
        bestLen = len
        bestIdx = i
      }
    }
    if (bestIdx >= 0) return bestIdx
    return Math.floor(segments.length / 2)
  }, [segments])

  const anchors = useMemo(() => getPolylineLabelAnchors(points), [points])

  const editing = Boolean(dataTyped.editingLabel)
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 编辑时自动全选文本并调整高度
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px'
    }
  }, [editing])

  // 全局文字编辑锁：边文字编辑开启时，压住其它菜单栏
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: editing } }))
    return () => {
      window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: false } }))
    }
  }, [editing])

  // 兼容历史数据：首次发现 waypoints 且缺 routeRef 时，补一个当前端点快照
  useEffect(() => {
    if (!savedWaypoints || savedWaypoints.length === 0) return
    if (dataTyped.routeRef) return
    rf.setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id !== id) return edge
        const d = (edge.data ?? {}) as EdgeData
        const wps = d.waypoints
        if (!wps || wps.length === 0 || d.routeRef) return edge
        return {
          ...edge,
          data: {
            ...(edge.data ?? {}),
            routeRef: endpointSnapshot,
          },
        }
      }),
    )
  }, [id, rf, savedWaypoints, dataTyped.routeRef, endpointSnapshot])

  // 拖拽某个线段（移动该线段两端的中间点）
  const handleSegmentDrag = useCallback(
    (segIndex: number, seg: { isVertical: boolean }) => (e: React.MouseEvent) => {
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      
      // IMPORTANT:
      // points may contain extra terminal-lead / autoOffset doglegs that are not persisted in data.waypoints.
      // Drag should operate on the rendered polyline and then re-normalize back to orthogonal waypoints.
      const basePoints: Point[] = points.map((p) => ({ ...p }))
      const n = basePoints.length

      const handleMove = (evt: MouseEvent) => {
        const cur = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
        const start = rf.screenToFlowPosition({ x: startX, y: startY })
        const dx = cur.x - start.x
        const dy = cur.y - start.y
        
        const moved = basePoints.map((p) => ({ ...p }))
        const affect = [segIndex, segIndex + 1]
        for (const idx of affect) {
          if (idx <= 0 || idx >= n - 1) continue // never move endpoints
          if (seg.isVertical) moved[idx].x += dx
          else moved[idx].y += dy
        }
        
        const newWaypoints = moved.slice(1, -1)
        const normalized = normalizeOrthogonalWaypoints(sourcePoint, targetPoint, newWaypoints, srcPos, tgtPos)
        rf.setEdges((eds) =>
          eds.map((edge) =>
            edge.id === id
              ? {
                  ...edge,
                  data: {
                    ...(edge.data ?? {}),
                    waypoints: normalized,
                    routeRef: endpointSnapshot,
                  },
                }
              : edge,
          ),
        )
      }

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [id, rf, points, sourcePoint, targetPoint, srcPos, tgtPos, endpointSnapshot],
  )

  const handleLabelDrag = useCallback(
    (e: React.MouseEvent) => {
      if (editing) return
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      const currentWaypoints: Point[] = effectiveWaypoints
        ? effectiveWaypoints.map((p) => ({ ...p }))
        : points.slice(1, -1).map((p: Point) => ({ ...p }))

      const handleMove = (evt: MouseEvent) => {
        const cur = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
        const start = rf.screenToFlowPosition({ x: startX, y: startY })
        const dx = cur.x - start.x
        const dy = cur.y - start.y

        // 移动所有中间点
        const newWaypoints = currentWaypoints.map(wp => ({
          x: wp.x + dx,
          y: wp.y + dy,
        }))
        
        const normalized = normalizeOrthogonalWaypoints(sourcePoint, targetPoint, newWaypoints, srcPos, tgtPos)
        rf.setEdges((eds) =>
          eds.map((edge) =>
            edge.id === id
              ? {
                  ...edge,
                  data: {
                    ...(edge.data ?? {}),
                    waypoints: normalized,
                    routeRef: endpointSnapshot,
                  },
                }
              : edge,
          ),
        )
      }

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [id, rf, editing, effectiveWaypoints, points, sourcePoint, targetPoint, srcPos, tgtPos, endpointSnapshot],
  )

  const commit = (next: string) => {
    const trimmed = next.trim()
    rf.setEdges((eds) =>
      eds.map((e) =>
        e.id === id
          ? {
              ...e,
              label: trimmed || undefined,
              data: { ...(e.data ?? {}), editingLabel: false },
            }
          : e,
      ),
    )
  }

  const markerKey =
    `${id}-${JSON.stringify(markerStart ?? null)}-${JSON.stringify(markerEnd ?? null)}`
  const arrowStyle = dataTyped.arrowStyle ?? 'end'
  const hasReverseEdge = useMemo(
    () => allEdges.some((e) => (e as any).source === target && (e as any).target === source),
    [allEdges, source, target],
  )
  const hasStartArrow =
    arrowStyle === 'start' ||
    arrowStyle === 'both' ||
    (arrowStyle === 'end' && hasReverseEdge) ||
    (arrowStyle == null && Boolean(markerStart))
  const hasEndArrow = arrowStyle === 'end' || arrowStyle === 'both' || (arrowStyle == null && Boolean(markerEnd))
  const startKind = hasStartArrow ? markerKindFrom(markerStart) ?? 'closed' : null
  const endKind = hasEndArrow ? markerKindFrom(markerEnd) ?? 'closed' : null
  const startMarkerId = `${id}-start-marker`
  const endMarkerId = `${id}-end-marker`
  const startMarkerUrl = startKind ? `url(#${startMarkerId})` : undefined
  const endMarkerUrl = endKind ? `url(#${endMarkerId})` : undefined

  return (
    <>
      {(startKind || endKind) && (
        <defs>
          {startKind && (
            <marker
              id={startMarkerId}
              markerWidth={6}
              markerHeight={12}
              viewBox="0 0 10 10"
              preserveAspectRatio="none"
              refX={2}
              refY={5}
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              {startKind === 'closed' ? (
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill={markerColorFrom(style, markerStart)}
                  stroke={markerColorFrom(style, markerStart)}
                  strokeWidth={0.35}
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M 0 0 L 10 5 L 0 10"
                  fill="none"
                  stroke={markerColorFrom(style, markerStart)}
                  strokeWidth={1.5}
                />
              )}
            </marker>
          )}
          {endKind && (
            <marker
              id={endMarkerId}
              markerWidth={6}
              markerHeight={12}
              viewBox="0 0 10 10"
              preserveAspectRatio="none"
              refX={2}
              refY={5}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              {endKind === 'closed' ? (
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill={markerColorFrom(style, markerEnd)}
                  stroke={markerColorFrom(style, markerEnd)}
                  strokeWidth={0.35}
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M 0 0 L 10 5 L 0 10"
                  fill="none"
                  stroke={markerColorFrom(style, markerEnd)}
                  strokeWidth={1.5}
                />
              )}
            </marker>
          )}
        </defs>
      )}
      <BaseEdge
        key={markerKey}
        id={id}
        path={edgePath}
        markerStart={startMarkerUrl}
        markerEnd={endMarkerUrl}
        style={{ ...style, ...semanticStyle } as any}
        interactionWidth={interactionWidth ?? 24}
      />

      {/* 每个线段的拖拽区域 */}
      {segments.map((seg, idx) => {
        const firstSeg = segments[0]
        const lastSeg = segments[segments.length - 1]
        const inOutSameAxis = Boolean(firstSeg && lastSeg && firstSeg.isVertical === lastSeg.isVertical)
        const handleAllowedAxis = inOutSameAxis && firstSeg ? !firstSeg.isVertical : null
        const isPrimarySeg = idx === primaryDragSegmentIdx

        // 至少 3 段才有「非首尾」中间段；常见手动连线为 Z/C 型 3 段，此前误用 >=5 导致手柄永远不出现
        if (segments.length < 3) return null
        // 跳过第一段和最后一段（连接到源/目标节点的段）
        if (idx === 0 || idx === segments.length - 1) return null
        // 仅允许“垂直于 in/out 段方向”的中段出现手柄
        if (!isPrimarySeg && (handleAllowedAxis == null || seg.isVertical !== handleAllowedAxis)) return null
        
        const segLength = seg.length
        if (!isPrimarySeg && segLength < 10) return null // 主段手柄强制保留
        
        const isHovered = hoveredSegment === idx
        
        return (
          <EdgeLabelRenderer key={`seg-${idx}`}>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${seg.midX}px, ${seg.midY}px)`,
                width: seg.isVertical ? 16 : Math.max(segLength - 24, 24),
                height: seg.isVertical ? Math.max(segLength - 24, 24) : 16,
                cursor: seg.isVertical ? 'ew-resize' : 'ns-resize',
                pointerEvents: 'all',
                background: (selected || isHovered) ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                borderRadius: 12,
                transition: 'background 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={() => setHoveredSegment(idx)}
              onMouseLeave={() => setHoveredSegment(null)}
              onMouseDown={handleSegmentDrag(idx, seg)}
            >
              {(selected || isHovered) && (
                <div
                  style={{
                    width: seg.isVertical ? 4 : 24,
                    height: seg.isVertical ? 24 : 4,
                    background: '#3b82f6',
                    borderRadius: 12,
                    opacity: 0.8,
                  }}
                />
              )}
            </div>
          </EdgeLabelRenderer>
        )
      })}

      <SmartEdgeLabel
        edgeId={id}
        anchors={anchors}
        labelLayout={dataTyped.labelLayout}
        labelStyle={labelStyleObj}
        text={typeof label === 'string' ? label : ''}
        editing={editing}
        textOnly={Boolean(dataTyped.semanticType) || Boolean(dataTyped.labelTextOnly)}
        onPointerDown={handleLabelDrag}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!editing) {
            rf.setEdges((eds) =>
              eds.map((edge) =>
                edge.id === id
                  ? { ...edge, data: { ...(edge.data ?? {}), editingLabel: true } }
                  : { ...edge, data: { ...(edge.data ?? {}), editingLabel: false } },
              ),
            )
          }
        }}
        editChildren={
          <>
            <QuickTextStyleToolbar
                anchorRef={inputRef}
                visible={editing}
                onRequestClose={() => {
                  const el = inputRef.current
                  commit(el ? el.value : (label as string) ?? '')
                }}
                fontSize={labelFontSize}
                fontWeight={labelFontWeight}
                onFontSizeChange={(v) => {
                  const next: EdgeLabelStyle = {
                    ...labelStyleObj,
                    fontSize: v,
                    fontWeight: labelFontWeight,
                    color: labelColor,
                  }
                  rf.setEdges((eds) =>
                    eds.map((e) =>
                      e.id === id
                        ? {
                            ...e,
                            labelStyle: next,
                            data: { ...(e.data ?? {}), labelStyle: next },
                          }
                        : e,
                    ),
                  )
                }}
                onFontWeightChange={(v) => {
                  const next: EdgeLabelStyle = {
                    ...labelStyleObj,
                    fontSize: labelFontSize,
                    fontWeight: v,
                    color: labelColor,
                  }
                  rf.setEdges((eds) =>
                    eds.map((e) =>
                      e.id === id
                        ? {
                            ...e,
                            labelStyle: next,
                            data: { ...(e.data ?? {}), labelStyle: next },
                          }
                        : e,
                    ),
                  )
                }}
                textColor={labelColor}
                onTextColorChange={(v) => {
                  const next: EdgeLabelStyle = {
                    ...labelStyleObj,
                    fontSize: labelFontSize,
                    fontWeight: labelFontWeight,
                    color: v,
                  }
                  rf.setEdges((eds) =>
                    eds.map((e) =>
                      e.id === id
                        ? {
                            ...e,
                            labelStyle: next,
                            data: { ...(e.data ?? {}), labelStyle: next },
                          }
                        : e,
                    ),
                  )
                }}
              />
              <textarea
                ref={inputRef}
                autoFocus
                defaultValue={(label as string) ?? ''}
                rows={1}
                style={{
                  fontSize: labelFontSize,
                  fontWeight: labelFontWeight,
                  color: labelColor,
                  padding: '2px 4px',
                  borderRadius: 12,
                  border: '1px solid #e5e7eb',
                  background: '#ffffff',
                  minWidth: 60,
                  resize: 'none',
                  fontFamily: 'inherit',
                  height: 'auto',
                  overflow: 'hidden',
                }}
                onChange={(e) => {
                  e.target.style.height = 'auto'
                  e.target.style.height = e.target.scrollHeight + 'px'
                }}
                onBlur={(e) => {
                  if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
                  commit(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    commit((e.target as HTMLTextAreaElement).value)
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    rf.setEdges((eds) =>
                      eds.map((edge) =>
                        edge.id === id
                          ? { ...edge, data: { ...(edge.data ?? {}), editingLabel: false } }
                          : edge,
                      ),
                    )
                  }
                }}
              />
          </>
        }
      />
    </>
  )
}
