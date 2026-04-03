import { useEffect, useMemo, useRef } from 'react'
import { type Node } from '@xyflow/react'
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react'
import { ColorEditor } from '../style/ColorEditor'
import { type GradientValue } from '../style/GradientColorEditor'
import type { AssetNodeData } from '../nodes/AssetNode'
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

  const solidUiColor = useMemo(() => {
    const g = data.colorOverride
    if (!g?.color) return ''
    if ((g.type ?? 'solid') !== 'solid') return ''
    const alpha = g.alpha ?? 100
    // UI 侧使用 ColorEditor 的字符串格式：alpha=100 用 hex；否则用 rgba
    if (alpha >= 100) return g.color
    const rgb = hexToRgb(g.color)
    if (!rgb) return g.color
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha / 100})`
  }, [data.colorOverride])

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
        <label className={styles.item}>
          <span className={styles.itemLabel}>颜色</span>
          <ColorEditor
            value={solidUiColor}
            onChange={(v) => {
              const trimmed = v.trim()
              if (!trimmed) {
                onUpdate({ colorOverride: { type: 'solid', color: '', alpha: 100 } as GradientValue })
                return
              }
              const rgba = parseRgba(trimmed)
              if (rgba) {
                const hex = rgbToHex(rgba.r, rgba.g, rgba.b)
                const alpha = Math.max(0, Math.min(100, Math.round(rgba.a * 100)))
                onUpdate({ colorOverride: { type: 'solid', color: hex, alpha } as GradientValue })
                return
              }
              // hex or short hex
              const hex = normalizeHexTo6(trimmed)
              onUpdate({ colorOverride: { type: 'solid', color: hex, alpha: 100 } as GradientValue })
            }}
            placeholder="#ffffff"
            showAlpha={true}
            showPicker={true}
            compact={true}
            portalPicker={true}
            focusRetainDataAttr="data-asset-edit-popup"
          />
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

function parseRgba(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i)
  if (!m) return null
  const a = m[4] != null ? Number(m[4]) : 1
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number.isFinite(a) ? a : 1 }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const t = hex.replace(/^#/, '').trim()
  if (t.length === 3) {
    const r = parseInt(t[0] + t[0], 16)
    const g = parseInt(t[1] + t[1], 16)
    const b = parseInt(t[2] + t[2], 16)
    return { r, g, b }
  }
  if (t.length !== 6) return null
  return { r: parseInt(t.slice(0, 2), 16), g: parseInt(t.slice(2, 4), 16), b: parseInt(t.slice(4, 6), 16) }
}

function normalizeHexTo6(s: string): string {
  const t = s.replace(/^#/, '').trim()
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t}`
  if (/^[0-9A-Fa-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`
  return `#${t.slice(0, 6)}`
}

