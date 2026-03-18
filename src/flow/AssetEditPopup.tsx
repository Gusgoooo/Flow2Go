import { useEffect, useMemo, useRef } from 'react'
import { type Node } from '@xyflow/react'
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react'
import { GradientColorEditor, type GradientValue } from './GradientColorEditor'
import type { AssetNodeData } from './AssetNode'
import styles from './NodeEditPopup.module.css'

type Props = {
  node: Node<AssetNodeData>
  anchor: { x: number; y: number }
  onUpdate: (patch: Partial<AssetNodeData>) => void
  onClose: () => void
}

const STEP = 45

export function AssetEditPopup({ node, anchor, onUpdate, onClose }: Props) {
  const data = (node.data ?? {}) as AssetNodeData
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

  const rotation = useMemo(() => {
    const r = Number.isFinite(data.rotation) ? Number(data.rotation) : 0
    // 归一化到 [-180, 180) 便于阅读
    const n = ((r % 360) + 360) % 360
    return n >= 180 ? n - 360 : n
  }, [data.rotation])

  const isSvg = data.assetType === 'svg'
  const flipX = Boolean((data as any).flipX)
  const flipY = Boolean((data as any).flipY)

  return (
    <div
      ref={ref}
      className={styles.toolbar}
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={(e) => e.stopPropagation()}
      data-asset-edit-popup
    >
      <label className={styles.item}>
        <span className={styles.itemLabel}>旋转</span>
        <button
          type="button"
          title="逆时针 45°"
          onClick={() => onUpdate({ rotation: rotation - STEP })}
          style={iconBtnStyle}
        >
          <RotateCcw size={16} />
        </button>
        <input className={styles.inputNum} value={rotation} readOnly title="角度（度）" />
        <button
          type="button"
          title="顺时针 45°"
          onClick={() => onUpdate({ rotation: rotation + STEP })}
          style={iconBtnStyle}
        >
          <RotateCw size={16} />
        </button>
      </label>

      <label className={styles.item}>
        <span className={styles.itemLabel}>翻转</span>
        <button
          type="button"
          title="水平翻转"
          onClick={() => onUpdate({ flipX: !flipX } as any)}
          style={{ ...iconBtnStyle, background: flipX ? '#eff6ff' : '#ffffff' }}
        >
          <FlipHorizontal2 size={16} />
        </button>
        <button
          type="button"
          title="垂直翻转"
          onClick={() => onUpdate({ flipY: !flipY } as any)}
          style={{ ...iconBtnStyle, background: flipY ? '#eff6ff' : '#ffffff' }}
        >
          <FlipVertical2 size={16} />
        </button>
      </label>

      {isSvg && (
        <label className={styles.item} style={{ alignItems: 'flex-start' }}>
          <span className={styles.itemLabel} style={{ paddingTop: 6 }}>
            颜色
          </span>
          <div style={{ minWidth: 220 }}>
            <GradientColorEditor
              value={(data.colorOverride ?? { type: 'solid', color: '', alpha: 100 }) as GradientValue}
              onChange={(v) => onUpdate({ colorOverride: v })}
            />
          </div>
        </label>
      )}
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  background: '#ffffff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#0f172a',
}

