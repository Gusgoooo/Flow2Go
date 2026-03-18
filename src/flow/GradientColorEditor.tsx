import { useCallback, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import styles from './ColorEditor.module.css'
import { PRESET_COLORS } from './ColorEditor'

export type GradientValue = {
  type: 'solid' | 'linear'
  color?: string // solid color or start color
  alpha?: number // 0-100
  endColor?: string
  endAlpha?: number // 0-100
  angle?: number // degrees, default 0 (top to bottom)
}

type Props = {
  value: GradientValue
  onChange: (value: GradientValue) => void
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace(/^#/, '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha / 100})`
}

function normalizeHex(s: string): string {
  const t = s.replace(/^#/, '').trim()
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t}`
  if (/^[0-9A-Fa-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`
  return 'rgba(0,0,0,0.8)'
}

const ANGLE_OPTIONS = [
  { value: 0, label: '↓ 上到下' },
  { value: 90, label: '→ 左到右' },
  { value: 180, label: '↑ 下到上' },
  { value: 270, label: '← 右到左' },
  { value: 45, label: '↘ 左上到右下' },
  { value: 135, label: '↙ 右上到左下' },
  { value: 225, label: '↖ 右下到左上' },
  { value: 315, label: '↗ 左下到右上' },
]

export function GradientColorEditor({ value, onChange }: Props) {
  const [activeStop, setActiveStop] = useState<'start' | 'end'>('start')
  const [showPicker, setShowPicker] = useState(false)

  const type = value.type ?? 'solid'
  const color = normalizeHex(value.color || 'rgba(0,0,0,0.8)')
  const alpha = value.alpha ?? 100
  const endColor = normalizeHex(value.endColor || '#ffffff')
  const endAlpha = value.endAlpha ?? 100
  const angle = value.angle ?? 0

  const activeColor = activeStop === 'start' ? color : endColor
  const activeAlpha = activeStop === 'start' ? alpha : endAlpha

  const handleTypeChange = useCallback(
    (newType: 'solid' | 'linear') => {
      onChange({ ...value, type: newType })
    },
    [value, onChange],
  )

  const handleColorChange = useCallback(
    (hex: string) => {
      const normalized = normalizeHex(hex)
      if (type === 'solid' || activeStop === 'start') {
        onChange({ ...value, color: normalized })
      } else {
        onChange({ ...value, endColor: normalized })
      }
    },
    [value, onChange, type, activeStop],
  )

  const handleAlphaChange = useCallback(
    (newAlpha: number) => {
      if (type === 'solid' || activeStop === 'start') {
        onChange({ ...value, alpha: newAlpha })
      } else {
        onChange({ ...value, endAlpha: newAlpha })
      }
    },
    [value, onChange, type, activeStop],
  )

  const handleAngleChange = useCallback(
    (newAngle: number) => {
      onChange({ ...value, angle: newAngle })
    },
    [value, onChange],
  )

  const handlePresetClick = useCallback(
    (presetHex: string) => {
      handleColorChange(presetHex)
    },
    [handleColorChange],
  )

  // 生成预览背景
  const previewBg =
    type === 'solid'
      ? hexToRgba(color, alpha)
      : `linear-gradient(${angle}deg, ${hexToRgba(color, alpha)}, ${hexToRgba(endColor, endAlpha)})`

  return (
    <div className={styles.wrap}>
      {/* 类型切换 Toggle */}
      <div
        style={{
          display: 'flex',
          background: '#f1f5f9',
          borderRadius: 12,
          padding: 3,
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          onClick={() => handleTypeChange('solid')}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: 12,
            border: 'none',
            background: type === 'solid' ? '#fff' : 'transparent',
            color: type === 'solid' ? '#0f172a' : '#64748b',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: type === 'solid' ? 600 : 400,
            boxShadow: type === 'solid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          纯色
        </button>
        <button
          type="button"
          onClick={() => handleTypeChange('linear')}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: 12,
            border: 'none',
            background: type === 'linear' ? '#fff' : 'transparent',
            color: type === 'linear' ? '#0f172a' : '#64748b',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: type === 'linear' ? 600 : 400,
            boxShadow: type === 'linear' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          渐变
        </button>
      </div>

      {/* 预览条 */}
      <div
        style={{
          height: 32,
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          background: previewBg,
          marginBottom: 12,
        }}
      />

      {/* 渐变时显示色标选择 */}
      {type === 'linear' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setActiveStop('start')}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 12,
                border: activeStop === 'start' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                background: hexToRgba(color, alpha),
                cursor: 'pointer',
                fontSize: 12,
                color: alpha > 50 ? '#fff' : '#000',
                textShadow: alpha > 50 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              起点颜色
            </button>
            <button
              type="button"
              onClick={() => setActiveStop('end')}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 12,
                border: activeStop === 'end' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                background: hexToRgba(endColor, endAlpha),
                cursor: 'pointer',
                fontSize: 12,
                color: endAlpha > 50 ? '#fff' : '#000',
                textShadow: endAlpha > 50 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              终点颜色
            </button>
          </div>

          {/* 渐变方向 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>渐变方向</div>
            <select
              value={angle}
              onChange={(e) => handleAngleChange(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {ANGLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* 色块触发器 */}
      <div className={styles.inputRow}>
        <button
          type="button"
          className={styles.swatch}
          style={{ background: hexToRgba(activeColor, activeAlpha) }}
          onClick={() => setShowPicker((o) => !o)}
          aria-label="选择颜色"
        />
        <input
          type="text"
          className={styles.input}
          value={activeColor}
          onChange={(e) => handleColorChange(e.target.value)}
          placeholder="rgba(0,0,0,0.8)"
        />
      </div>

      {/* 拾色器 */}
      {showPicker && (
        <div className={styles.pickerPopover} style={{ position: 'relative', zIndex: 10 }}>
          <HexColorPicker color={activeColor} onChange={handleColorChange} />

          {/* 透明度 */}
          <div className={styles.alphaRow}>
            <span className={styles.alphaLabel}>透明度</span>
            <input
              type="range"
              min={0}
              max={100}
              value={activeAlpha}
              onChange={(e) => handleAlphaChange(Number(e.target.value))}
              className={styles.alphaSlider}
            />
            <span className={styles.alphaValue}>{activeAlpha}%</span>
          </div>

          {/* 预设颜色 */}
          <div className={styles.presetSection}>
            <span className={styles.presetSectionTitle}>预设</span>
            <div className={styles.presets}>
              {PRESET_COLORS.map((presetHex) => (
                <button
                  key={presetHex}
                  type="button"
                  className={styles.presetSwatch}
                  style={{ background: presetHex }}
                  onClick={() => handlePresetClick(presetHex)}
                  title={presetHex}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 清除颜色按钮 */}
      <button
        type="button"
        onClick={() => onChange({ type: 'solid', color: '', alpha: 100 })}
        style={{
          marginTop: 8,
          padding: '8px 12px',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
          cursor: 'pointer',
          fontSize: 13,
          color: '#64748b',
        }}
      >
        清除颜色覆盖
      </button>
    </div>
  )
}

/** 将 GradientValue 转为 CSS 值，用于 SVG filter 或背景 */
export function gradientToCss(g: GradientValue): string | null {
  if (!g.color) return null
  const color = normalizeHex(g.color)
  const alpha = g.alpha ?? 100

  if (g.type === 'solid') {
    return hexToRgba(color, alpha)
  }

  const endColor = normalizeHex(g.endColor || '#ffffff')
  const endAlpha = g.endAlpha ?? 100
  const angle = g.angle ?? 0

  return `linear-gradient(${angle}deg, ${hexToRgba(color, alpha)}, ${hexToRgba(endColor, endAlpha)})`
}

/** 生成 SVG defs 中的 linearGradient，返回 gradient id */
export function generateSvgGradientId(nodeId: string): string {
  return `gradient-${nodeId}`
}
