import { useRef, useEffect } from 'react'
import { type Edge } from '@xyflow/react'
import { ColorEditor } from './ColorEditor'
import { MarkerType } from '@xyflow/react'
import styles from './EdgeEditPopup.module.css'

type ArrowStyle = 'none' | 'end' | 'start' | 'both'
type EdgeLabelStyle = { fontSize?: number; fontWeight?: string; color?: string }
type FlowEdge = Edge<{ arrowStyle?: ArrowStyle }> & { labelStyle?: EdgeLabelStyle }

const DEFAULT_EDGE_COLOR = '#94a3b8'

type Props = {
  edge: FlowEdge
  anchor: { x: number; y: number }
  onUpdate: (patch: Partial<FlowEdge>) => void
  onClose: () => void
}

export function EdgeEditPopup({ edge, anchor, onUpdate, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const data = (edge.data ?? {}) as { arrowStyle?: ArrowStyle; labelStyle?: EdgeLabelStyle }
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

  const applyArrowStyle = (arrowStyle: ArrowStyle, color: string) => {
    let markerStart: typeof edge.markerStart = undefined
    let markerEnd: typeof edge.markerEnd = undefined
    if (arrowStyle === 'start' || arrowStyle === 'both') {
      markerStart = { type: MarkerType.ArrowClosed, color }
    }
    if (arrowStyle === 'end' || arrowStyle === 'both') {
      markerEnd = { type: MarkerType.ArrowClosed, color }
    }
    onUpdate({
      data: { ...(edge.data ?? {}), arrowStyle },
      markerStart,
      markerEnd,
      style: { ...(edge.style ?? {}), stroke: color } as any,
    })
  }

  const strokeColor = ((edge.style as any)?.stroke as string) ?? ''

  return (
    <div
      ref={ref}
      className={styles.toolbar}
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={(e) => e.stopPropagation()}
      data-edge-edit-popup
    >
      {/* 标签：折叠区 */}
      <details className={styles.section} open>
        <summary className={styles.sectionSummary}>标签</summary>
        <div className={styles.sectionContent}>
          <div className={styles.row}>
            <label className={styles.item}>
              <span className={styles.itemLabel}>文字</span>
              <input
                className={styles.input}
                style={{ width: '100%', minWidth: 80 }}
                value={(edge.label as string) ?? ''}
                onChange={(e) => onUpdate({ label: e.target.value })}
                placeholder="Label"
              />
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.item}>
              <span className={styles.itemLabel}>大小</span>
              <input
                className={styles.inputNum}
                type="number"
                min={10}
                max={72}
                placeholder="12"
                value={labelStyle.fontSize ?? ''}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : undefined
                  const next: EdgeLabelStyle = {
                    ...labelStyle,
                    fontSize: Number.isFinite(v) ? v : undefined,
                  }
                  onUpdate({
                    labelStyle: next,
                    data: { ...(edge.data ?? {}), labelStyle: next },
                  } as any)
                }}
              />
            </label>
            <label className={styles.item}>
              <span className={styles.itemLabel}>粗细</span>
              <select
                className={styles.select}
                value={labelStyle.fontWeight ?? '400'}
                onChange={(e) => {
                  const next: EdgeLabelStyle = {
                    ...labelStyle,
                    fontWeight: e.target.value,
                  }
                  onUpdate({
                    labelStyle: next,
                    data: { ...(edge.data ?? {}), labelStyle: next },
                  } as any)
                }}
              >
                <option value="400">常规</option>
                <option value="500">中等</option>
                <option value="600">半粗</option>
                <option value="700">粗体</option>
              </select>
            </label>
            <label className={styles.item}>
              <span className={styles.itemLabel}>颜色</span>
              <ColorEditor
                value={labelStyle.color ?? ''}
                onChange={(v) => {
                  const next: EdgeLabelStyle = { ...labelStyle, color: v }
                  onUpdate({
                    labelStyle: next,
                    data: { ...(edge.data ?? {}), labelStyle: next },
                  } as any)
                }}
                placeholder="#0f172a"
                showAlpha={true}
              />
            </label>
          </div>
        </div>
      </details>

      {/* 线条：折叠区 */}
      <details className={styles.section} open>
        <summary className={styles.sectionSummary}>线条</summary>
        <div className={styles.sectionContent}>
          <div className={styles.row}>
            <label className={styles.item}>
              <span className={styles.itemLabel}>边线样式</span>
              <select
                className={styles.select}
                value={(edge.type as string) ?? 'smoothstep'}
                onChange={(e) => {
                  const v = e.target.value as 'smoothstep' | 'bezier'
                  onUpdate({ type: v })
                }}
              >
                <option value="smoothstep">平滑步进</option>
                <option value="bezier">贝塞尔曲线</option>
              </select>
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.item}>
              <span className={styles.itemLabel}>颜色</span>
              <ColorEditor
                value={strokeColor}
                onChange={(color) => {
                  const arrowStyle = (data.arrowStyle ?? 'end') as ArrowStyle
                  let markerStart = edge.markerStart as any
                  let markerEnd = edge.markerEnd as any
                  if (arrowStyle === 'start' || arrowStyle === 'both') {
                    markerStart = { type: MarkerType.ArrowClosed, color }
                  } else markerStart = undefined
                  if (arrowStyle === 'end' || arrowStyle === 'both') {
                    markerEnd = { type: MarkerType.ArrowClosed, color }
                  } else markerEnd = undefined
                  onUpdate({
                    style: {
                      ...(edge.style ?? {}),
                      stroke: color,
                      '--xy-edge-stroke': color,
                    } as any,
                    markerStart,
                    markerEnd,
                  })
                }}
                placeholder={DEFAULT_EDGE_COLOR}
                showAlpha={true}
              />
            </label>
            <label className={styles.item}>
              <span className={styles.itemLabel}>粗细</span>
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
          </div>
          <div className={styles.row}>
            <span className={styles.itemLabel}>箭头</span>
            <div className={styles.radioGroup}>
              {(
                [
                  { v: 'none' as const, l: '无' },
                  { v: 'end' as const, l: '终点' },
                  { v: 'start' as const, l: '起点' },
                  { v: 'both' as const, l: '双向' },
                ] as const
              ).map(({ v, l }) => (
                <label key={v} className={styles.radioItem}>
                  <input
                    type="radio"
                    name="edge-arrow-popup"
                    checked={(data.arrowStyle ?? 'end') === v}
                    onChange={() =>
                      applyArrowStyle(v, strokeColor || DEFAULT_EDGE_COLOR)
                    }
                  />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </details>

      {/* 动画：单行 */}
      <div className={styles.section}>
        <label className={styles.itemCheck}>
          <input
            type="checkbox"
            checked={Boolean(edge.animated)}
            onChange={(e) => onUpdate({ animated: e.target.checked })}
          />
          <span>Animated</span>
        </label>
      </div>
    </div>
  )
}
