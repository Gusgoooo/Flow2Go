import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFloating, offset, flip, shift } from '@floating-ui/react'
import { ColorEditor } from './ColorEditor'
import styles from './QuickTextStyleToolbar.module.css'

const FONT_WEIGHTS = [
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '600', label: '半粗' },
  { value: '700', label: '粗体' },
  { value: '800', label: '特粗' },
] as const

type Props = {
  anchorRef: React.RefObject<HTMLElement | null>
  fontSize?: number
  fontWeight?: string | number
  textColor?: string
  /** 可选：第二块配色（如泳道标题条底色），与「颜色」共用同一 ColorEditor 形态 */
  fillColor?: string
  onFontSizeChange: (v: number) => void
  onFontWeightChange: (v: string) => void
  onTextColorChange?: (v: string) => void
  onFillColorChange?: (v: string) => void
  visible: boolean
  /** 当点击到工具栏和调色板之外时请求关闭（由调用方结束编辑） */
  onRequestClose?: () => void
}

/** 用于 onBlur 判断焦点是否移到工具栏内，避免一点击工具栏就关闭编辑 */
export const QUICK_TOOLBAR_DATA_ATTR = 'data-quick-toolbar'

export function QuickTextStyleToolbar({
  anchorRef,
  fontSize = 14,
  fontWeight = '400',
  textColor = 'rgba(0,0,0,0.8)',
  fillColor = 'rgba(71, 85, 105, 0.08)',
  onFontSizeChange,
  onFontWeightChange,
  onTextColorChange,
  onFillColorChange,
  visible,
  onRequestClose,
}: Props) {
  const { refs, floatingStyles, update } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  })

  useEffect(() => {
    if (!visible || !anchorRef.current) return
    refs.setReference(anchorRef.current)
    update()
  }, [visible, anchorRef, refs, update])

  useEffect(() => {
    if (!visible) return
    const el = anchorRef.current
    if (!el) return
    const observer = new ResizeObserver(() => update())
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible, anchorRef, update])

  useEffect(() => {
    if (!visible || !onRequestClose) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      // 点击在工具栏或其调色板内部时，不关闭
      if (target.closest(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
      // 点击在锚点（输入框）上，由输入自身的 onBlur 逻辑处理
      if (anchorRef.current && anchorRef.current.contains(target)) return
      onRequestClose()
    }
    document.addEventListener('mousedown', handleClick, true)
    return () => document.removeEventListener('mousedown', handleClick, true)
  }, [visible, onRequestClose, anchorRef])

  const weightStr = String(fontWeight)
  const numFontSize = Number(fontSize)
  const safeFontSize = Number.isFinite(numFontSize) && numFontSize >= 10 && numFontSize <= 72 ? numFontSize : 14

  const handleSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value)
      if (Number.isFinite(v) && v >= 10 && v <= 72) onFontSizeChange(v)
    },
    [onFontSizeChange],
  )

  if (!visible) return null

  const content = (
    <div
      ref={refs.setFloating}
      className={styles.toolbar}
      style={floatingStyles}
      {...{ [QUICK_TOOLBAR_DATA_ATTR]: true }}
    >
      <label className={styles.item}>
        <span className={styles.itemLabel}>字号</span>
        <input
          type="number"
          min={10}
          max={72}
          value={safeFontSize}
          onChange={handleSizeChange}
          className={styles.input}
        />
      </label>
      <label className={styles.item}>
        <span className={styles.itemLabel}>粗细</span>
        <select
          value={weightStr}
          onChange={(e) => onFontWeightChange(e.target.value)}
          className={styles.select}
        >
          {FONT_WEIGHTS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {onTextColorChange && (
        <label className={styles.item}>
          <span className={styles.itemLabel}>颜色</span>
          <ColorEditor
            value={textColor}
            onChange={onTextColorChange}
            showPicker={true}
            showAlpha={true}
            compact={true}
            portalPicker={true}
            focusRetainDataAttr={QUICK_TOOLBAR_DATA_ATTR}
          />
        </label>
      )}
      {onFillColorChange && (
        <label className={styles.item}>
          <span className={styles.itemLabel}>底色</span>
          <ColorEditor
            value={fillColor}
            onChange={onFillColorChange}
            showPicker={true}
            showAlpha={true}
            compact={true}
            portalPicker={true}
            focusRetainDataAttr={QUICK_TOOLBAR_DATA_ATTR}
          />
        </label>
      )}
    </div>
  )

  return createPortal(content, document.body)
}
