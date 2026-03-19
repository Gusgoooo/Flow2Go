import { useEffect, useRef, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, Position, getBezierPath, type EdgeProps, useReactFlow } from '@xyflow/react'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

type EdgeLabelStyle = { fontSize?: number; fontWeight?: string; color?: string }

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
  const dataAny = (data ?? {}) as any
  const autoOffset: number = typeof dataAny.autoOffset === 'number' && Number.isFinite(dataAny.autoOffset) ? dataAny.autoOffset : 0

  const srcPos = sourcePosition ?? Position.Right
  const tgtPos = targetPosition ?? Position.Left

  // Apply autoOffset perpendicular to main direction for lane separation.
  const isHorizontal = srcPos === Position.Left || srcPos === Position.Right || tgtPos === Position.Left || tgtPos === Position.Right
  const sx = isHorizontal ? sourceX : sourceX + autoOffset
  const sy = isHorizontal ? sourceY + autoOffset : sourceY
  const tx = isHorizontal ? targetX : targetX + autoOffset
  const ty = isHorizontal ? targetY + autoOffset : targetY

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: srcPos,
    targetX: tx,
    targetY: ty,
    targetPosition: tgtPos,
  })

  const editing = Boolean((data as any)?.editingLabel)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<string>(typeof label === 'string' ? label : '')

  const labelStyleObj = ((data as { labelStyle?: EdgeLabelStyle })?.labelStyle ?? (props as { labelStyle?: EdgeLabelStyle }).labelStyle) ?? {}
  const labelFontSize = labelStyleObj.fontSize ?? 12
  const labelFontWeight = labelStyleObj.fontWeight ?? '400'
  const labelColor = labelStyleObj.color ?? 'rgba(0,0,0,0.8)'

  useEffect(() => {
    if (!editing) setDraft(typeof label === 'string' ? label : '')
  }, [editing, label])

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

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth ?? 24} />
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
        >
          {editing ? (
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
                  rf.setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), labelStyle: next }, labelStyle: next } : e)))
                }}
                onFontWeightChange={(v) => {
                  const next: EdgeLabelStyle = { ...labelStyleObj, fontSize: labelFontSize, fontWeight: v, color: labelColor }
                  rf.setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), labelStyle: next }, labelStyle: next } : e)))
                }}
                onTextColorChange={(v) => {
                  const next: EdgeLabelStyle = { ...labelStyleObj, fontSize: labelFontSize, fontWeight: labelFontWeight, color: v }
                  rf.setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), labelStyle: next }, labelStyle: next } : e)))
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
                    rf.setEdges((eds) => eds.map((edge) => (edge.id === id ? { ...edge, data: { ...(edge.data ?? {}), editingLabel: false } } : edge)))
                  }
                }}
              />
            </>
          ) : label ? (
            <span
              style={{
                padding: '2px 4px',
                borderRadius: 12,
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

