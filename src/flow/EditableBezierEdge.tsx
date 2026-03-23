import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseEdge, Position, getBezierPath, type EdgeProps, useReactFlow } from '@xyflow/react'
import { getBezierLabelAnchors } from './edgeLabels/edgeLabelPosition'
import { SmartEdgeLabel } from './edgeLabels/SmartEdgeLabel'
import type { EdgeLabelLayoutConfig, EdgeLabelStyle } from './edgeLabels/types'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'
import { padEdgeEndpoints } from './edgeEndpointPad'

type EdgeData = {
  autoOffset?: number
  editingLabel?: boolean
  labelStyle?: EdgeLabelStyle
  labelLayout?: EdgeLabelLayoutConfig
}

export function EditableBezierEdge(props: EdgeProps) {
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
  } = props

  const rf = useReactFlow()
  const dataTyped = (data ?? {}) as EdgeData
  const autoOffset: number =
    typeof dataTyped.autoOffset === 'number' && Number.isFinite(dataTyped.autoOffset) ? dataTyped.autoOffset : 0

  const srcPos = sourcePosition ?? Position.Right
  const tgtPos = targetPosition ?? Position.Left

  const isHorizontal =
    srcPos === Position.Left || srcPos === Position.Right || tgtPos === Position.Left || tgtPos === Position.Right
  const sx0 = isHorizontal ? sourceX : sourceX + autoOffset
  const sy0 = isHorizontal ? sourceY + autoOffset : sourceY
  const tx0 = isHorizontal ? targetX : targetX + autoOffset
  const ty0 = isHorizontal ? targetY + autoOffset : targetY

  const bezierParams = useMemo(() => {
    const p = padEdgeEndpoints({
      sourceX: sx0,
      sourceY: sy0,
      targetX: tx0,
      targetY: ty0,
      sourcePosition: srcPos,
      targetPosition: tgtPos,
    })
    return {
      sourceX: p.sourceX,
      sourceY: p.sourceY,
      sourcePosition: srcPos,
      targetX: p.targetX,
      targetY: p.targetY,
      targetPosition: tgtPos,
    }
  }, [sx0, sy0, tx0, ty0, srcPos, tgtPos])

  const edgePath = useMemo(() => getBezierPath(bezierParams)[0], [bezierParams])

  const anchors = useMemo(() => getBezierLabelAnchors(bezierParams), [bezierParams])

  const editing = Boolean(dataTyped.editingLabel)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<string>(typeof label === 'string' ? label : '')

  const labelStyleObj =
    (dataTyped.labelStyle ?? (props as { labelStyle?: EdgeLabelStyle }).labelStyle) ?? {}
  const labelFontSize = labelStyleObj.fontSize ?? 12
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
      <BaseEdge id={id} path={edgePath} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth ?? 24} />
      <SmartEdgeLabel
        edgeId={id}
        anchors={anchors}
        labelLayout={dataTyped.labelLayout}
        labelStyle={labelStyleObj}
        text={labelText}
        editing={editing}
        editChildren={editChildren}
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
      />
    </>
  )
}
