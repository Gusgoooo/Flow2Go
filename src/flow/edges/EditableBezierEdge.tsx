import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseEdge, MarkerType, Position, getBezierPath, type EdgeProps, useReactFlow, useStore } from '@xyflow/react'
import { getBezierLabelAnchors } from '../edgeLabels/edgeLabelPosition'
import { SmartEdgeLabel } from '../edgeLabels/SmartEdgeLabel'
import type { EdgeLabelLayoutConfig, EdgeLabelStyle } from '../edgeLabels/types'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from '../style/QuickTextStyleToolbar'
import { padEdgeEndpoints } from './edgeEndpointPad'
import { GRID_UNIT, SIZE_STEP_RATIO, snapToGrid } from '../grid'

type SwimlaneEdgeSemanticType = 'normal' | 'crossLane' | 'returnFlow' | 'conditional'

type EdgeData = {
  layoutProfile?: string
  editingLabel?: boolean
  labelStyle?: EdgeLabelStyle
  labelLayout?: EdgeLabelLayoutConfig
  arrowStyle?: 'none' | 'end' | 'start' | 'both'
  semanticType?: SwimlaneEdgeSemanticType
  sourceLaneId?: string
  targetLaneId?: string
  labelTextOnly?: boolean
  labelSettingsUnlocked?: boolean
}

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

export function EditableBezierEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
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
    animated,
  } = props
  const rf = useReactFlow()
  const dataTyped = (data ?? {}) as EdgeData
  const semanticType = dataTyped.semanticType
  const allEdges = useStore((state) => state.edges as any[])

  const allNodes = useStore((state) => state.nodes as any[])
  const isMindMapEdge = useMemo(() => {
    if (dataTyped.layoutProfile === 'mind-map') return true
    const srcNode = allNodes.find((n) => String(n.id) === String(source))
    const tgtNode = allNodes.find((n) => String(n.id) === String(target))
    const srcSide = (srcNode?.data as any)?.mindMapSide
    const tgtSide = (tgtNode?.data as any)?.mindMapSide
    return Boolean(srcSide || tgtSide)
  }, [allNodes, dataTyped.layoutProfile, source, target])

  const srcPos = sourcePosition ?? Position.Right
  const tgtPos = targetPosition ?? Position.Left

  const pathEdgeStyle = useMemo(() => {
    const merged = { ...(style as React.CSSProperties) }
    if (semanticType === 'returnFlow') {
      merged.opacity = 0.75
      if (!animated) merged.strokeDasharray = '6 3'
    }
    if (animated && semanticType === 'returnFlow') {
      delete (merged as { strokeDasharray?: string }).strokeDasharray
    }
    return merged
  }, [style, semanticType, animated])

  const edgeStep = Math.max(1, GRID_UNIT * SIZE_STEP_RATIO)
  const sx0 = snapToGrid(sourceX, edgeStep)
  const sy0 = snapToGrid(sourceY, edgeStep)
  const tx0 = snapToGrid(targetX, edgeStep)
  const ty0 = snapToGrid(targetY, edgeStep)

  const bezierParams = useMemo(() => {
    const p = padEdgeEndpoints({
      sourceX: sx0,
      sourceY: sy0,
      targetX: tx0,
      targetY: ty0,
      sourcePosition: srcPos,
      targetPosition: tgtPos,
      // 思维导图强制从 handle 直接出线，不做端点外移。
      pad: isMindMapEdge ? 0 : undefined,
    })
    return {
      sourceX: p.sourceX,
      sourceY: p.sourceY,
      sourcePosition: srcPos,
      targetX: p.targetX,
      targetY: p.targetY,
      targetPosition: tgtPos,
    }
  }, [sx0, sy0, tx0, ty0, srcPos, tgtPos, isMindMapEdge])

  const edgePath = useMemo(() => getBezierPath(bezierParams)[0], [bezierParams])

  const anchors = useMemo(() => getBezierLabelAnchors(bezierParams), [bezierParams])

  const editing = Boolean(dataTyped.editingLabel)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<string>(typeof label === 'string' ? label : '')

  const labelStyleObj =
    (dataTyped.labelStyle ?? (props as { labelStyle?: EdgeLabelStyle }).labelStyle) ?? {}
  const labelFontSize = labelStyleObj.fontSize ?? 10
  const labelFontWeight = labelStyleObj.fontWeight ?? '400'
  const labelColor = labelStyleObj.color ?? 'rgba(0,0,0,0.8)'

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!editing) setDraft(typeof label === 'string' ? label : '')
  }, [editing, label])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: editing } }))
    return () => {
      window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: false } }))
    }
  }, [editing])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px'
    }
  }, [editing])

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

  const labelText = typeof label === 'string' ? label : ''
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
  const markerWidth = 4
  const markerHeight = 8
  const markerRefX = 1.5
  const startMarkerUrl = startKind ? `url(#${startMarkerId})` : undefined
  const endMarkerUrl = endKind ? `url(#${endMarkerId})` : undefined

  const editChildren = (
    <>
      <QuickTextStyleToolbar
        anchorRef={inputRef}
        visible={editing}
        onRequestClose={() => commit(draft)}
        fontSize={labelFontSize}
        fontWeight={labelFontWeight}
        textColor={labelColor}
        onFontSizeChange={(v) => {
          const next: EdgeLabelStyle = { ...labelStyleObj, fontSize: v, fontWeight: labelFontWeight, color: labelColor }
          rf.setEdges((eds) =>
            eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), labelStyle: next }, labelStyle: next } : e)),
          )
        }}
        onFontWeightChange={(v) => {
          const next: EdgeLabelStyle = { ...labelStyleObj, fontSize: labelFontSize, fontWeight: v, color: labelColor }
          rf.setEdges((eds) =>
            eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), labelStyle: next }, labelStyle: next } : e)),
          )
        }}
        onTextColorChange={(v) => {
          const next: EdgeLabelStyle = { ...labelStyleObj, fontSize: labelFontSize, fontWeight: labelFontWeight, color: v }
          rf.setEdges((eds) =>
            eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), labelStyle: next }, labelStyle: next } : e)),
          )
        }}
      />
      <textarea
        ref={inputRef}
        autoFocus
        value={draft}
        rows={1}
        style={{
          fontSize: labelFontSize,
          fontWeight: labelFontWeight,
          color: labelColor,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          background: '#ffffff',
          minWidth: 60,
          maxWidth: 280,
          resize: 'none',
          fontFamily: 'inherit',
          height: 'auto',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = e.target.scrollHeight + 'px'
        }}
        onBlur={(e) => {
          if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
          commit(e.currentTarget.value)
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
                edge.id === id ? { ...edge, data: { ...(edge.data ?? {}), editingLabel: false } } : edge,
              ),
            )
          }
        }}
      />
    </>
  )

  return (
    <>
      {(startKind || endKind) && (
        <defs>
          {startKind && (
            <marker
              id={startMarkerId}
              markerWidth={markerWidth}
              markerHeight={markerHeight}
              viewBox="0 0 10 10"
              preserveAspectRatio="none"
              refX={markerRefX}
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
              markerWidth={markerWidth}
              markerHeight={markerHeight}
              viewBox="0 0 10 10"
              preserveAspectRatio="none"
              refX={markerRefX}
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
        id={id}
        path={edgePath}
        markerStart={startMarkerUrl}
        markerEnd={endMarkerUrl}
        style={pathEdgeStyle as any}
        interactionWidth={interactionWidth ?? 24}
      />
      <SmartEdgeLabel
        edgeId={id}
        anchors={anchors}
        labelLayout={dataTyped.labelLayout}
        labelStyle={labelStyleObj}
        text={labelText}
        editing={editing}
        editChildren={editChildren}
        textOnly={Boolean(dataTyped.semanticType) || Boolean(dataTyped.labelTextOnly)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!editing) {
            rf.setEdges((eds) =>
              eds.map((edge) =>
                edge.id === id
                  ? { ...edge, data: { ...(edge.data ?? {}), editingLabel: true, labelSettingsUnlocked: true } }
                  : { ...edge, data: { ...(edge.data ?? {}), editingLabel: false } },
              ),
            )
          }
        }}
      />
    </>
  )
}
