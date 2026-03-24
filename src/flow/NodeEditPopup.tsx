import { useRef, useEffect } from 'react'
import { type Node } from '@xyflow/react'
import { ColorEditor } from './ColorEditor'
import type { QuadShape } from './QuadNode'
import styles from './NodeEditPopup.module.css'

type QuadNodeData = {
  label?: string
  title?: string
  subtitle?: string
  showSubtitle?: boolean
  shape?: QuadShape
  color?: string
  stroke?: string
  strokeWidth?: number
  labelColor?: string
  subtitleColor?: string
  [key: string]: unknown
}

const SHAPE_OPTIONS: { key: QuadShape; label: string }[] = [
  { key: 'rect', label: '矩形' },
  { key: 'circle', label: '圆形' },
  { key: 'diamond', label: '菱形' },
]

type Props = {
  node: Node<QuadNodeData>
  anchor: { x: number; y: number }
  onUpdate: (patch: Partial<QuadNodeData>) => void
  onClose: () => void
}

export function NodeEditPopup({ node, anchor, onUpdate, onClose }: Props) {
  const data = node.data ?? {}
  const ref = useRef<HTMLDivElement | null>(null)

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

  return (
    <div
      ref={ref}
      className={styles.toolbar}
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={(e) => e.stopPropagation()}
      data-node-edit-popup
    >
      <label className={styles.item}>
        <span className={styles.itemLabel}>形状</span>
        <select
          className={styles.select}
          value={(data.shape ?? 'rect') as QuadShape}
          onChange={(e) => onUpdate({ shape: e.target.value as QuadShape })}
        >
          {SHAPE_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.itemCheck}>
        <input
          type="checkbox"
          checked={!!data.showSubtitle}
          onChange={(e) => onUpdate({ showSubtitle: e.target.checked })}
        />
        <span className={styles.itemLabel}>副标题</span>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>填充</span>
        <ColorEditor
          value={(data.color ?? '#ffffff') as string}
          onChange={(v) => onUpdate({ color: v })}
          placeholder="#ffffff"
          showAlpha={true}
          showPicker={true}
          compact={true}
          portalPicker={true}
          focusRetainDataAttr="data-node-edit-popup"
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>描边</span>
        <ColorEditor
          value={(data.stroke ?? '#e2e8f0') as string}
          onChange={(v) => onUpdate({ stroke: v })}
          placeholder="#e2e8f0"
          showAlpha={true}
          showPicker={true}
          compact={true}
          portalPicker={true}
          focusRetainDataAttr="data-node-edit-popup"
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>粗细</span>
        <input
          className={styles.inputNum}
          type="number"
          min={0}
          step={1}
          value={(data.strokeWidth ?? 1) as number}
          onChange={(e) => {
            const num = parseFloat(e.target.value)
            onUpdate({ strokeWidth: Number.isFinite(num) && num >= 0 ? num : 1 })
          }}
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>主标题字色</span>
        <ColorEditor
          value={(data.labelColor ?? 'rgba(0,0,0,0.8)') as string}
          onChange={(v) => onUpdate({ labelColor: v })}
          placeholder="rgba(0,0,0,0.8)"
          showAlpha={true}
          showPicker={true}
          compact={true}
          portalPicker={true}
          focusRetainDataAttr="data-node-edit-popup"
        />
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>副标题字色</span>
        <ColorEditor
          value={(data.subtitleColor ?? '#64748b') as string}
          onChange={(v) => onUpdate({ subtitleColor: v })}
          placeholder="#64748b"
          showAlpha={true}
          showPicker={true}
          compact={true}
          portalPicker={true}
          focusRetainDataAttr="data-node-edit-popup"
        />
      </label>
    </div>
  )
}
