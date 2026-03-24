import { useRef, useEffect } from 'react'
import { type Node } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { ColorEditor } from './ColorEditor'
import type { GroupNodeData } from './GroupNode'
import styles from './NodeEditPopup.module.css'

type Props = {
  node: Node<GroupNodeData>
  anchor: { x: number; y: number }
  onUpdate: (patch: Partial<GroupNodeData>) => void
  /** 底色变更时调用（父层可在此做 12% 默认透明度等） */
  onFillChange?: (value: string) => void
  /** 仅画框：删除画框但保留内部元素 */
  onDeleteFrameKeepContents?: () => void
  onClose: () => void
}

export function GroupEditPopup({ node, anchor, onUpdate, onFillChange, onDeleteFrameKeepContents, onClose }: Props) {
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

  const handleFillChange = (v: string) => {
    if (onFillChange) onFillChange(v)
    else onUpdate({ fill: v })
  }

  return (
    <div
      ref={ref}
      className={styles.toolbar}
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={(e) => e.stopPropagation()}
      data-node-edit-popup
    >
      <label className={styles.item}>
        <span className={styles.itemLabel}>标题</span>
        <input
          className={styles.input}
          value={(data.title ?? '') as string}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="群组标题"
        />
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
        <span className={styles.itemLabel}>标题位置</span>
        <select
          className={styles.select}
          value={(data.titlePosition ?? 'top-center') as string}
          onChange={(e) => onUpdate({ titlePosition: e.target.value as 'top-center' | 'left-center' })}
        >
          <option value="top-center">上方居中</option>
          <option value="left-center">左侧居中</option>
        </select>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>标题颜色</span>
        <ColorEditor
          value={(data.titleColor ?? '') as string}
          onChange={(v) => onUpdate({ titleColor: v })}
          placeholder="rgba(0,0,0,0.8)"
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
          value={(data.stroke ?? '#3b82f6') as string}
          onChange={(v) => onUpdate({ stroke: v })}
          placeholder="#3b82f6"
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
        <span className={styles.itemLabel}>底色</span>
        <ColorEditor
          value={(data.fill ?? '') as string}
          onChange={handleFillChange}
          placeholder="rgba(59,130,246,0.12)"
          showAlpha={true}
          showPicker={true}
          compact={true}
          portalPicker={true}
          focusRetainDataAttr="data-node-edit-popup"
        />
      </label>

      {(data as any)?.role === 'frame' && onDeleteFrameKeepContents && (
        <button
          type="button"
          title="删除画框，保留画框内元素"
          onClick={() => onDeleteFrameKeepContents()}
          style={{
            width: 28,
            height: 28,
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            background: '#fff1f2',
            color: '#b91c1c',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  )
}
