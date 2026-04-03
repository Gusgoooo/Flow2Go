import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloating, offset, flip, shift } from '@floating-ui/react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import styles from './ColorEditor.module.css'
import { PRESET_COLORS, RECENT_COLORS_MAX } from '../constants'

export { PRESET_COLORS, AI_SCENE_CAPSULE_ACCENT_COLORS, RECENT_COLORS_MAX } from '../constants'

const RECENT_STORAGE_KEY = 'flow2go-color-recent'

type RecentEntry = { color: string; usedAt: number }

function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentEntry[]
    return Array.isArray(parsed)
      ? [...parsed].sort((a, b) => b.usedAt - a.usedAt).slice(0, RECENT_COLORS_MAX)
      : []
  } catch {
    return []
  }
}

function saveRecent(entries: RecentEntry[]) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries.slice(0, RECENT_COLORS_MAX)))
  } catch {}
}

/** 用于去重：转为小写 #rrggbb 或 rgba 字符串 */
function colorKey(c: string): string {
  const t = c.trim()
  if (t.startsWith('rgba')) return t.replace(/\s/g, '')
  const h = t.replace(/^#/, '')
  if (h.length === 6) return '#' + h.toLowerCase()
  if (h.length === 3) return '#' + h.toLowerCase().split('').map((x) => x + x).join('')
  return t
}

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** 是否显示拾色器（否则仅输入框 + 预设） */
  showPicker?: boolean
  /** 是否显示透明度滑块 */
  showAlpha?: boolean
  /** 紧凑模式：只显示色块，不显示十六进制输入（如工具栏） */
  compact?: boolean
  /** 调色板以 portal 挂到 body，并定位在触发色块下方（用于工具栏等，避免被父容器裁剪） */
  portalPicker?: boolean
  /** portal 时挂上的 data 属性，用于父级失焦判断（如 data-quick-toolbar，点击调色板不关文字菜单） */
  focusRetainDataAttr?: string
}

const normalizeHex = (s: string): string => {
  const t = s.replace(/^#/, '').trim()
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t}`
  if (/^[0-9A-Fa-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`
  return s ? `#${t.slice(0, 6)}` : ''
}

function parseRgba(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i)
  if (!m) return null
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] != null ? Number(m[4]) : 1,
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const t = hex.replace(/^#/, '')
  if (t.length !== 6 && t.length !== 3) return null
  if (t.length === 3) {
    const r = parseInt(t[0] + t[0], 16)
    const g = parseInt(t[1] + t[1], 16)
    const b = parseInt(t[2] + t[2], 16)
    return { r, g, b }
  }
  return {
    r: parseInt(t.slice(0, 2), 16),
    g: parseInt(t.slice(2, 4), 16),
    b: parseInt(t.slice(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
}

function formatRgbaCss(r: number, g: number, b: number, a: number): string {
  const rr = Math.max(0, Math.min(255, Math.round(r)))
  const gg = Math.max(0, Math.min(255, Math.round(g)))
  const bb = Math.max(0, Math.min(255, Math.round(b)))
  const aa = Math.max(0, Math.min(1, a))
  const rounded = Math.round(aa * 1000) / 1000
  return `rgba(${rr}, ${gg}, ${bb}, ${rounded})`
}

/** 宽松解析用户在 RGBA 输入框中的文本 */
function parseRgbaLoose(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.trim().match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (!m) return null
  const a = m[4] != null ? Number(m[4]) : 1
  if (!Number.isFinite(a)) return null
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a }
}

export function ColorEditor({
  value,
  onChange,
  placeholder = 'rgba(0,0,0,0.8)',
  showPicker = true,
  showAlpha = true,
  compact = false,
  portalPicker = false,
  focusRetainDataAttr,
}: Props) {
  const [open, setOpen] = useState(false)
  const [valueMode, setValueMode] = useState<'hex' | 'rgba'>('hex')
  /** 弹层内 HEX/RGBA 文本：编辑中用本地串，避免受控值每键归一化导致光标跳动 */
  const [hexFieldDraft, setHexFieldDraft] = useState('')
  const [rgbaFieldDraft, setRgbaFieldDraft] = useState('')
  const [hexFieldFocused, setHexFieldFocused] = useState(false)
  const [rgbaFieldFocused, setRgbaFieldFocused] = useState(false)
  const [recentColors, setRecentColors] = useState<RecentEntry[]>(loadRecent)
  const popoverRef = useRef<HTMLDivElement>(null)
  const swatchRef = useRef<HTMLButtonElement>(null)

  const { refs, floatingStyles, update } = useFloating({
    placement: 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  })

  const addToRecent = useCallback((color: string) => {
    const trimmed = color.trim()
    if (!trimmed) return
    const next = loadRecent().filter((e) => colorKey(e.color) !== colorKey(trimmed))
    next.unshift({ color: trimmed, usedAt: Date.now() })
    const sliced = next.slice(0, RECENT_COLORS_MAX)
    saveRecent(sliced)
    setRecentColors(sliced)
  }, [])

  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const { hex, alpha } = useMemo(() => {
    const rgba = parseRgba(value)
    if (rgba) {
      const hex = rgbToHex(rgba.r, rgba.g, rgba.b)
      return { hex, alpha: Math.round(rgba.a * 100) }
    }
    const h = value && value.startsWith('#') ? value : value ? `#${value}` : ''
    const rgb = h ? hexToRgb(h) : null
    // 空值时默认用白色，保证与默认节点视觉一致
    const fallbackHex = '#ffffff'
    return {
      hex: h || fallbackHex,
      alpha: rgb ? 100 : 100,
    }
  }, [value])

  const pickerColor = hex || '#ffffff'
  const inputColor = hex || '#ffffff'
  const rgbaDisplay = useMemo(() => {
    const rgba = parseRgba(value)
    if (rgba) return formatRgbaCss(rgba.r, rgba.g, rgba.b, rgba.a)
    const rgb = hexToRgb(pickerColor)
    if (rgb) return formatRgbaCss(rgb.r, rgb.g, rgb.b, alpha / 100)
    return formatRgbaCss(255, 255, 255, 1)
  }, [value, pickerColor, alpha])
  const hexForCopy = useMemo(() => {
    const h = normalizeHex(pickerColor) || pickerColor
    if (!h) return '#ffffff'
    return h.startsWith('#') ? h.slice(0, 7) : `#${h}`.slice(0, 8)
  }, [pickerColor])
  const swatchBackground =
    alpha < 100
      ? (() => {
          const rgb = hexToRgb(pickerColor)
          return rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha / 100})` : pickerColor
        })()
      : pickerColor

  useEffect(() => {
    if (open && portalPicker && swatchRef.current) refs.setReference(swatchRef.current)
    if (!open && portalPicker) refs.setReference(null)
  }, [open, portalPicker, refs])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (swatchRef.current?.contains(target)) return
      if ((e.target as Element)?.closest?.('.react-colorful')) return
      const current = valueRef.current?.trim()
      if (current) addToRecent(current)
      setOpen(false)
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [open, addToRecent])

  useEffect(() => {
    if (open && portalPicker) update()
  }, [open, portalPicker, update])

  // 拾色器/滑块/外部 value 变化时同步文本草稿（编辑中不同步）
  useEffect(() => {
    if (!open || !showPicker) return
    if (!hexFieldFocused && valueMode === 'hex') {
      setHexFieldDraft(hexForCopy)
    }
  }, [open, showPicker, value, alpha, valueMode, hexFieldFocused, hexForCopy])

  useEffect(() => {
    if (!open || !showPicker) return
    if (!rgbaFieldFocused && valueMode === 'rgba') {
      setRgbaFieldDraft(rgbaDisplay)
    }
  }, [open, showPicker, value, valueMode, rgbaFieldFocused, rgbaDisplay])

  const handleHexChange = useCallback(
    (v: string) => {
      const normalized = normalizeHex(v)
      if (!normalized) {
        onChange(v)
        return
      }
      if (alpha >= 100) {
        onChange(normalized)
      } else {
        const rgb = hexToRgb(normalized)
        if (rgb) onChange(`rgba(${rgb.r},${rgb.g},${rgb.b},${alpha / 100})`)
      }
    },
    [onChange, alpha],
  )

  const handleAlphaChange = useCallback(
    (percent: number) => {
      const rgb = hexToRgb(pickerColor)
      if (!rgb) return
      if (percent >= 100) {
        onChange(rgbToHex(rgb.r, rgb.g, rgb.b))
      } else {
        onChange(`rgba(${rgb.r},${rgb.g},${rgb.b},${percent / 100})`)
      }
    },
    [onChange, pickerColor],
  )

  const handlePresetClick = useCallback(
    (presetHex: string) => {
      setHexFieldFocused(false)
      setRgbaFieldFocused(false)
      onChange(presetHex)
      addToRecent(presetHex)
      setOpen(false)
    },
    [onChange, addToRecent],
  )

  const handleRecentClick = useCallback(
    (entry: RecentEntry) => {
      setHexFieldFocused(false)
      setRgbaFieldFocused(false)
      onChange(entry.color)
      addToRecent(entry.color)
      setOpen(false)
    },
    [onChange, addToRecent],
  )

  const commitHexFieldDraft = useCallback(() => {
    const raw = hexFieldDraft.trim().replace(/^#/, '')
    if (/^[0-9A-Fa-f]{6}$/i.test(raw) || /^[0-9A-Fa-f]{3}$/i.test(raw)) {
      handleHexChange(hexFieldDraft.trim().startsWith('#') ? hexFieldDraft.trim() : `#${hexFieldDraft.trim()}`)
      return
    }
    setHexFieldDraft(hexForCopy)
  }, [handleHexChange, hexFieldDraft, hexForCopy])

  const commitRgbaFieldDraft = useCallback(() => {
    const p = parseRgbaLoose(rgbaFieldDraft.trim())
    if (p) onChange(formatRgbaCss(p.r, p.g, p.b, p.a))
  }, [rgbaFieldDraft, onChange])

  const handleCopyValue = useCallback(() => {
    const text = valueMode === 'hex' ? hexFieldDraft || hexForCopy : rgbaFieldDraft || rgbaDisplay
    void navigator.clipboard.writeText(text)
  }, [valueMode, hexFieldDraft, hexForCopy, rgbaFieldDraft, rgbaDisplay])

  const valueModeRow = (
    <div className={styles.valueRow}>
      <div className={styles.valueModeToggle}>
        <button
          type="button"
          className={`${styles.modeBtn} ${valueMode === 'hex' ? styles.modeBtnActive : ''}`}
          onClick={() => setValueMode('hex')}
        >
          HEX
        </button>
        <button
          type="button"
          className={`${styles.modeBtn} ${valueMode === 'rgba' ? styles.modeBtnActive : ''}`}
          onClick={() => setValueMode('rgba')}
        >
          RGBA
        </button>
      </div>
      <div className={styles.valueInputRow}>
        <input
          type="text"
          className={styles.valueInput}
          spellCheck={false}
          autoComplete="off"
          value={valueMode === 'hex' ? hexFieldDraft : rgbaFieldDraft}
          onChange={(e) => {
            if (valueMode === 'hex') setHexFieldDraft(e.target.value)
            else setRgbaFieldDraft(e.target.value)
          }}
          onFocus={() => {
            if (valueMode === 'hex') {
              setHexFieldFocused(true)
              setHexFieldDraft(hexForCopy)
            } else {
              setRgbaFieldFocused(true)
              setRgbaFieldDraft(rgbaDisplay)
            }
          }}
          onBlur={() => {
            if (valueMode === 'hex') {
              commitHexFieldDraft()
              setHexFieldFocused(false)
            } else {
              commitRgbaFieldDraft()
              setRgbaFieldFocused(false)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          aria-label={valueMode === 'hex' ? '十六进制颜色' : 'RGBA 颜色'}
        />
        <button type="button" className={styles.copyBtn} onClick={handleCopyValue}>
          复制
        </button>
      </div>
    </div>
  )

  const pickerContent = (
    <div
      ref={(node) => {
        ;(popoverRef as React.MutableRefObject<HTMLDivElement | null>).current = node
        if (portalPicker && node) refs.setFloating(node)
      }}
      className={styles.pickerPopover}
      style={portalPicker ? floatingStyles : undefined}
      data-color-editor-portal
      {...(focusRetainDataAttr ? { [focusRetainDataAttr]: true } : {})}
    >
      <HexColorPicker color={pickerColor} onChange={handleHexChange} />
      {showAlpha && (
        <div className={styles.alphaRow}>
          <span className={styles.alphaLabel}>透明度</span>
          <input
            type="range"
            min={0}
            max={100}
            value={alpha}
            onChange={(e) => handleAlphaChange(Number(e.target.value))}
            className={styles.alphaSlider}
          />
          <span className={styles.alphaValue}>{alpha}%</span>
        </div>
      )}
      {valueModeRow}
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
      <div className={styles.presetSection}>
        <span className={styles.presetSectionTitle}>最近使用</span>
        <div className={styles.presets}>
          {Array.from({ length: RECENT_COLORS_MAX }, (_, i) => {
            const entry = recentColors[i]
            return entry ? (
              <button
                key={`${entry.usedAt}-${entry.color}`}
                type="button"
                className={styles.presetSwatch}
                style={{ background: entry.color }}
                onClick={() => handleRecentClick(entry)}
                title={entry.color}
              />
            ) : (
              <span key={`empty-${i}`} className={styles.presetSwatchEmpty} aria-hidden />
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.inputRow}>
        <button
          ref={(el) => {
            ;(swatchRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
            if (portalPicker && el) refs.setReference(el)
          }}
          type="button"
          className={styles.swatch}
          style={{ background: swatchBackground }}
          onClick={() => setOpen((o) => !o)}
          aria-label="选择颜色"
        />
        {!compact && (
          <HexColorInput
            className={styles.input}
            color={inputColor}
            onChange={handleHexChange}
            placeholder={placeholder}
            prefixed
          />
        )}
      </div>
      {showPicker && open && portalPicker && createPortal(pickerContent, document.body)}
      {showPicker && open && !portalPicker && (
        <div ref={popoverRef} className={styles.pickerPopover}>
          <HexColorPicker color={pickerColor} onChange={handleHexChange} />
          {showAlpha && (
            <div className={styles.alphaRow}>
              <span className={styles.alphaLabel}>透明度</span>
              <input
                type="range"
                min={0}
                max={100}
                value={alpha}
                onChange={(e) => handleAlphaChange(Number(e.target.value))}
                className={styles.alphaSlider}
              />
              <span className={styles.alphaValue}>{alpha}%</span>
            </div>
          )}
          {valueModeRow}
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
          <div className={styles.presetSection}>
            <span className={styles.presetSectionTitle}>最近使用</span>
            <div className={styles.presets}>
              {Array.from({ length: RECENT_COLORS_MAX }, (_, i) => {
                const entry = recentColors[i]
                return entry ? (
                  <button
                    key={`${entry.usedAt}-${entry.color}`}
                    type="button"
                    className={styles.presetSwatch}
                    style={{ background: entry.color }}
                    onClick={() => handleRecentClick(entry)}
                    title={entry.color}
                  />
                ) : (
                  <span key={`empty-${i}`} className={styles.presetSwatchEmpty} aria-hidden />
                )
              })}
            </div>
          </div>
        </div>
      )}
      {!showPicker && (
        <>
          <div className={styles.presetSection}>
            <span className={styles.presetSectionTitle}>预设</span>
            <div className={styles.presets}>
              {PRESET_COLORS.map((presetHex) => (
                <button
                  key={presetHex}
                  type="button"
                  className={styles.presetSwatch}
                  style={{ background: presetHex }}
                  onClick={() => { onChange(presetHex); addToRecent(presetHex) }}
                  title={presetHex}
                />
              ))}
            </div>
          </div>
          <div className={styles.presetSection}>
            <span className={styles.presetSectionTitle}>最近使用</span>
            <div className={styles.presets}>
              {Array.from({ length: RECENT_COLORS_MAX }, (_, i) => {
                const entry = recentColors[i]
                return entry ? (
                  <button
                    key={`${entry.usedAt}-${entry.color}`}
                    type="button"
                    className={styles.presetSwatch}
                    style={{ background: entry.color }}
                    onClick={() => { onChange(entry.color); addToRecent(entry.color) }}
                    title={entry.color}
                  />
                ) : (
                  <span key={`empty-${i}`} className={styles.presetSwatchEmpty} aria-hidden />
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
