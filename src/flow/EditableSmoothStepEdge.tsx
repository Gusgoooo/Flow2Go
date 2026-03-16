import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

type EdgeLabelStyle = { fontSize?: number; fontWeight?: string; color?: string }
type Point = { x: number; y: number }

/**
 * 生成圆角折线路径
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
 * 根据源和目标位置生成默认的正交路径点
 */
function getDefaultOrthogonalPoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  offset: number = 24,
): Point[] {
  const isHorizontalSource = sourcePosition === Position.Left || sourcePosition === Position.Right
  const isHorizontalTarget = targetPosition === Position.Left || targetPosition === Position.Right
  const isCShape = sourcePosition === targetPosition
  
  const source = { x: sourceX, y: sourceY }
  const target = { x: targetX, y: targetY }
  
  if (isHorizontalSource && isHorizontalTarget) {
    if (isCShape) {
      // C 字型 (Right→Right or Left→Left)
      const isRight = sourcePosition === Position.Right
      const outerX = isRight 
        ? Math.max(sourceX, targetX) + offset 
        : Math.min(sourceX, targetX) - offset
      return [
        source,
        { x: outerX, y: sourceY },
        { x: outerX, y: targetY },
        target,
      ]
    } else {
      // Z 字型 (Right→Left or Left→Right)
      const midX = (sourceX + targetX) / 2
      return [
        source,
        { x: midX, y: sourceY },
        { x: midX, y: targetY },
        target,
      ]
    }
  } else if (!isHorizontalSource && !isHorizontalTarget) {
    if (isCShape) {
      // C 字型 (Bottom→Bottom or Top→Top)
      const isBottom = sourcePosition === Position.Bottom
      const outerY = isBottom 
        ? Math.max(sourceY, targetY) + offset 
        : Math.min(sourceY, targetY) - offset
      return [
        source,
        { x: sourceX, y: outerY },
        { x: targetX, y: outerY },
        target,
      ]
    } else {
      // Z 字型 (Bottom→Top or Top→Bottom)
      const midY = (sourceY + targetY) / 2
      return [
        source,
        { x: sourceX, y: midY },
        { x: targetX, y: midY },
        target,
      ]
    }
  } else {
    // L 字型 (混合方向)
    if (isHorizontalSource) {
      // 水平出发，垂直到达：先水平再垂直
      return [
        source,
        { x: targetX, y: sourceY },
        target,
      ]
    } else {
      // 垂直出发，水平到达：先垂直再水平
      return [
        source,
        { x: sourceX, y: targetY },
        target,
      ]
    }
  }
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

  // 第一段：源节点 → 第一个中间点
  const src = snapped[0]
  const first = snapped[1]
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    // 水平出发：和源节点保持同一条水平线
    first.y = src.y
  } else {
    // 垂直出发：和源节点保持同一条竖线
    first.x = src.x
  }

  // 最后一段：最后一个中间点 → 目标节点
  const tgt = snapped[snapped.length - 1]
  const lastIdx = snapped.length - 2
  const last = snapped[lastIdx]
  if (targetPosition === Position.Left || targetPosition === Position.Right) {
    // 水平进入：和目标节点保持同一条水平线
    last.y = tgt.y
  } else {
    // 垂直进入：和目标节点保持同一条竖线
    last.x = tgt.x
  }

  return snapped
}

export function EditableSmoothStepEdge(props: EdgeProps) {
  const {
    id,
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

  const labelStyleObj = ((data as { labelStyle?: EdgeLabelStyle })?.labelStyle ??
    (props as { labelStyle?: EdgeLabelStyle }).labelStyle) ?? {}
  const labelFontSize = labelStyleObj.fontSize ?? 12
  const labelFontWeight = labelStyleObj.fontWeight ?? '400'
  const labelColor = labelStyleObj.color ?? 'rgba(0,0,0,0.8)'

  const rf = useReactFlow()

  const srcPos = sourcePosition ?? Position.Right
  const tgtPos = targetPosition ?? Position.Left
  
  // 从 data 中获取保存的路径点，或生成默认路径
  const dataAny = (data ?? {}) as any
  const savedWaypoints: Point[] | undefined = dataAny.waypoints
  
  // 生成完整的路径点（包含源和目标）
  const defaultPoints = getDefaultOrthogonalPoints(
    sourceX, sourceY, targetX, targetY, srcPos, tgtPos, 24
  )
  
  // 如果有保存的 waypoints，使用它们（中间点），加上当前的源和目标
  let points: Point[]
  if (savedWaypoints && savedWaypoints.length > 0) {
    const rawPoints = [
      { x: sourceX, y: sourceY },
      ...savedWaypoints,
      { x: targetX, y: targetY },
    ]
    // 保证出入节点的线段与端口方向平行
    points = snapEndpointsToPorts(rawPoints, srcPos, tgtPos)
  } else {
    points = defaultPoints
  }
  
  // 生成圆角路径
  const edgePath = createRoundedPath(points, 12)
  
  // 获取所有线段信息
  const segments = getSegments(points)
  
  // 计算标签位置（路径中点）
  const midIndex = Math.floor(points.length / 2)
  const labelX = points.length % 2 === 0 
    ? (points[midIndex - 1].x + points[midIndex].x) / 2
    : points[midIndex].x
  const labelY = points.length % 2 === 0
    ? (points[midIndex - 1].y + points[midIndex].y) / 2
    : points[midIndex].y

  const editing = Boolean((data as any)?.editingLabel)
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

  // 拖拽某个线段（移动该线段两端的中间点）
  const handleSegmentDrag = useCallback(
    (segIndex: number, seg: { isVertical: boolean }) => (e: React.MouseEvent) => {
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      
      // 获取当前的中间点（不包含源和目标）
      const currentWaypoints: Point[] = savedWaypoints 
        ? [...savedWaypoints] 
        : defaultPoints.slice(1, -1).map(p => ({ ...p }))
      
      // segIndex 是 points 数组中的索引，对应 waypoints 的索引是 segIndex-1 和 segIndex
      // 但线段连接的是 points[segIndex] 和 points[segIndex+1]
      // waypoints[i] = points[i+1]  (i = 0 to waypoints.length-1)
      
      const handleMove = (evt: MouseEvent) => {
        const cur = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
        const start = rf.screenToFlowPosition({ x: startX, y: startY })
        const dx = cur.x - start.x
        const dy = cur.y - start.y
        
        const newWaypoints = currentWaypoints.map((wp, i) => {
          // 该线段连接的是 waypoints[segIndex-1] 和 waypoints[segIndex]
          // 所以我们要移动的点可能是：
          // - 如果 segIndex === 0，移动 waypoints[0]
          // - 如果 segIndex === segments.length-1，移动 waypoints[last]
          // - 否则移动 waypoints[segIndex-1] 和 waypoints[segIndex]
          
          // 简化逻辑：对于垂直线段，只调整 x；对于水平线段，只调整 y
          // 该线段连接 points[segIndex] 和 points[segIndex+1]
          // 对应 waypoints 索引是 segIndex-1 和 segIndex
          
          const wpIndex1 = segIndex - 1  // 线段起点对应的 waypoint 索引
          const wpIndex2 = segIndex      // 线段终点对应的 waypoint 索引
          
          if (i === wpIndex1 || i === wpIndex2) {
            if (seg.isVertical) {
              // 垂直线段，左右移动
              return { x: wp.x + dx, y: wp.y }
            } else {
              // 水平线段，上下移动
              return { x: wp.x, y: wp.y + dy }
            }
          }
          return wp
        })
        
        rf.setEdges((eds) =>
          eds.map((edge) =>
            edge.id === id
              ? { ...edge, data: { ...(edge.data ?? {}), waypoints: newWaypoints } }
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
    [id, rf, savedWaypoints, defaultPoints],
  )

  const handleLabelDrag = useCallback(
    (e: React.MouseEvent) => {
      if (editing) return
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      const currentWaypoints: Point[] = savedWaypoints 
        ? [...savedWaypoints] 
        : defaultPoints.slice(1, -1).map(p => ({ ...p }))

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
        
        rf.setEdges((eds) =>
          eds.map((edge) =>
            edge.id === id
              ? { ...edge, data: { ...(edge.data ?? {}), waypoints: newWaypoints } }
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
    [id, rf, editing, savedWaypoints, defaultPoints, labelX, labelY],
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

  return (
    <>
      <BaseEdge
        key={markerKey}
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth ?? 24}
      />

      {/* 每个线段的拖拽区域 */}
      {segments.map((seg, idx) => {
        // 跳过第一段和最后一段（连接到源/目标节点的段）
        if (idx === 0 || idx === segments.length - 1) return null
        
        const segLength = seg.length
        if (segLength < 10) return null // 太短的线段不显示手柄
        
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
                borderRadius: 4,
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
                    borderRadius: 2,
                    opacity: 0.8,
                  }}
                />
              )}
            </div>
          </EdgeLabelRenderer>
        )
      })}

      {/* 标签区域 */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            fontSize: labelFontSize,
            fontWeight: labelFontWeight,
            zIndex: 1000,
          }}
          onMouseDown={handleLabelDrag}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!editing)
              rf.setEdges((eds) =>
                eds.map((edge) =>
                  edge.id === id
                    ? { ...edge, data: { ...(edge.data ?? {}), editingLabel: true } }
                    : { ...edge, data: { ...(edge.data ?? {}), editingLabel: false } },
                ),
              )
          }}
        >
          {editing ? (
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
                  borderRadius: 6,
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
          ) : label ? (
            <span
              style={{
                padding: '2px 4px',
                borderRadius: 6,
                background: '#f8fafc',
                border: '1px solid #e5e7eb',
                fontSize: labelFontSize,
                fontWeight: labelFontWeight,
                color: labelColor,
              }}
            >
              {label as string}
            </span>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

