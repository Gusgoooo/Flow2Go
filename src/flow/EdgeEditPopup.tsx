import { useRef, useEffect } from 'react'
import { type Edge } from '@xyflow/react'
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
  const data = (edge.data ?? {}) as { labelStyle?: EdgeLabelStyle }
  const labelStyle = (edge as FlowEdge).labelStyle ?? data?.labelStyle ?? {}

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

  return (
    <div
      ref={ref}
      className={styles.toolbar}
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={(e) => e.stopPropagation()}
      data-edge-edit-popup
    >
      <label className={styles.item}>
        <span className={styles.itemLabel}>文字</span>
        <input
          className={styles.input}
          style={{ width: '100%', minWidth: 160 }}
          value={(edge.label as string) ?? ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Label"
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>字号</span>
        <input
          className={styles.inputNum}
          type="number"
          min={10}
          max={72}
          placeholder="12"
          value={labelStyle.fontSize ?? ''}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : undefined
            const next: EdgeLabelStyle = { ...labelStyle, fontSize: Number.isFinite(v) ? v : undefined }
            onUpdate({ labelStyle: next, data: { ...(edge.data ?? {}), labelStyle: next } } as any)
          }}
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>字重</span>
        <select
          className={styles.select}
          value={labelStyle.fontWeight ?? '400'}
          onChange={(e) => {
            const next: EdgeLabelStyle = { ...labelStyle, fontWeight: e.target.value }
            onUpdate({ labelStyle: next, data: { ...(edge.data ?? {}), labelStyle: next } } as any)
          }}
        >
          <option value="400">常规</option>
          <option value="500">中等</option>
          <option value="600">半粗</option>
          <option value="700">粗体</option>
        </select>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>字色</span>
        <ColorEditor
          value={labelStyle.color ?? ''}
          onChange={(v) => {
            const next: EdgeLabelStyle = { ...labelStyle, color: v }
            onUpdate({ labelStyle: next, data: { ...(edge.data ?? {}), labelStyle: next } } as any)
          }}
          placeholder="#0f172a"
          showAlpha={true}
          showPicker={true}
          compact={true}
          portalPicker={true}
          focusRetainDataAttr="data-edge-edit-popup"
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>类型</span>
        <select
          className={styles.select}
          value={(edge.type as string) ?? 'smoothstep'}
          onChange={(e) => onUpdate({ type: e.target.value as any })}
        >
          <option value="smoothstep">平滑步进</option>
          <option value="bezier">贝塞尔曲线</option>
        </select>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>颜色</span>
        <ColorEditor
          value={strokeColor}
          onChange={(color) => {
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
