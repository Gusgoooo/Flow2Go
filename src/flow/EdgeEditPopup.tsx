import { useRef, useEffect } from 'react'
import { MarkerType, type Edge } from '@xyflow/react'
import { ColorEditor } from './ColorEditor'
import styles from './NodeEditPopup.module.css'

type EdgeLabelStyle = { fontSize?: number; fontWeight?: string; color?: string }
type FlowEdge = Edge<{ arrowStyle?: any }> & { labelStyle?: EdgeLabelStyle }

const DEFAULT_EDGE_COLOR = '#94a3b8'

type Props = {
  edge: FlowEdge
  anchor: { x: number; y: number }
  onUpdate: (patch: Partial<FlowEdge>) => void
  onClose: () => void
}

export function EdgeEditPopup({ edge, anchor, onUpdate, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const data = (edge.data ?? {}) as { labelStyle?: EdgeLabelStyle; arrowStyle?: 'none' | 'end' | 'start' | 'both' }
  const arrowStyle = (data.arrowStyle ?? 'end') as 'none' | 'end' | 'start' | 'both'
  const showLabel = Boolean((edge.label as any) && String(edge.label).trim().length > 0)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as globalThis.Node | null
      if (target && ref.current?.contains(target)) return
      if ((target as Element)?.closest?.('[data-color-editor-portal]')) return
      onClose()
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [onClose])

  const strokeColor = ((edge.style as any)?.stroke as string) ?? ''
  const effectiveStroke = strokeColor || DEFAULT_EDGE_COLOR

  const applyArrowStyle = (next: 'none' | 'end' | 'start' | 'both') => {
    const markerStart =
      next === 'start' || next === 'both'
        ? ({ type: MarkerType.ArrowClosed, color: effectiveStroke } as any)
        : undefined
    const markerEnd =
      next === 'end' || next === 'both'
        ? ({ type: MarkerType.ArrowClosed, color: effectiveStroke } as any)
        : undefined
    onUpdate({
      data: { ...(edge.data ?? {}), arrowStyle: next } as any,
      markerStart,
      markerEnd,
    } as any)
  }

  return (
    <div
      ref={ref}
      className={styles.toolbar}
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={(e) => e.stopPropagation()}
      data-edge-edit-popup
    >
      <label className={styles.itemCheck} title="双击边文字可直接编辑">
        <input
          type="checkbox"
          checked={showLabel}
          onChange={(e) => {
            if (e.target.checked) {
              // 默认给一个占位，用户再双击修改
              onUpdate({ label: (edge.label as string) ?? '标签' } as any)
            } else {
              onUpdate({ label: undefined } as any)
            }
          }}
        />
        <span className={styles.itemLabel}>Label</span>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>类型</span>
        <select
          className={styles.select}
          value={(edge.type as string) ?? 'bezier'}
          onChange={(e) => onUpdate({ type: e.target.value as any })}
        >
          <option value="smoothstep">平滑步进</option>
          <option value="bezier">贝塞尔曲线</option>
        </select>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>箭头</span>
        <select className={styles.select} value={arrowStyle} onChange={(e) => applyArrowStyle(e.target.value as any)}>
          <option value="none">无</option>
          <option value="end">终点</option>
          <option value="start">起点</option>
          <option value="both">双向</option>
        </select>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>颜色</span>
        <ColorEditor
          value={strokeColor}
          onChange={(color) => {
            // 线条颜色变更时，同步更新已有的箭头颜色
            const markerStart = edge.markerStart ? { ...(edge.markerStart as any), color } : edge.markerStart
            const markerEnd = edge.markerEnd ? { ...(edge.markerEnd as any), color } : edge.markerEnd
            onUpdate({
              style: { ...(edge.style ?? {}), stroke: color, '--xy-edge-stroke': color } as any,
              markerStart,
              markerEnd,
            })
          }}
          placeholder={DEFAULT_EDGE_COLOR}
          showAlpha={true}
          showPicker={true}
          compact={true}
          portalPicker={true}
          focusRetainDataAttr="data-edge-edit-popup"
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>线宽</span>
        <input
          className={styles.inputNum}
          type="number"
          min={1}
          max={10}
          step={0.5}
          placeholder="2"
          value={(edge.style as any)?.strokeWidth ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            const num = Number(raw)
            onUpdate({
              style: {
                ...(edge.style ?? {}),
                strokeWidth: !raw ? undefined : Number.isFinite(num) && num > 0 ? num : (edge.style as any)?.strokeWidth,
              },
            })
          }}
        />
      </label>

      <label className={styles.itemCheck}>
        <input type="checkbox" checked={Boolean(edge.animated)} onChange={(e) => onUpdate({ animated: e.target.checked })} />
        <span className={styles.itemLabel}>动画</span>
      </label>
    </div>
  )
}
