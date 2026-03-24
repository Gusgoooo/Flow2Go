import { useEffect, useRef } from 'react'
import type { EdgeLabelLayoutConfig, EdgeLabelPlacement } from './edgeLabels/types'
import styles from './flowEditor.module.css'

type InlineInspectorProps = {
  anchor: { x: number; y: number } | null
  kind: 'node' | 'group' | 'edge' | null
  node?: Record<string, unknown>
  edge?: Record<string, unknown>
  onChangeNode?: (patch: Record<string, unknown>) => void
  onChangeGroup?: (patch: Record<string, unknown>) => void
  onChangeEdge?: (patch: Record<string, unknown>) => void
  onClose: () => void
}

const PLACEMENTS: EdgeLabelPlacement[] = ['center', 'head', 'tail', 'manual']

export function InlineInspector({
  anchor,
  kind,
  node,
  edge,
  onChangeNode,
  onChangeGroup,
  onChangeEdge,
  onClose,
}: InlineInspectorProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!anchor) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handle, true)
    return () => document.removeEventListener('mousedown', handle, true)
  }, [anchor, onClose])

  if (!anchor || !kind) return null

  return (
    <div
      ref={ref}
      className={styles.inlineInspector}
      style={{
        left: anchor.x,
        top: anchor.y,
      }}
    >
      {kind === 'node' && node && onChangeNode && (
        <>
          <label className={styles.label}>
            <div className={styles.labelText}>标题</div>
            <input
              className={styles.input}
              value={(node.data as { title?: string; label?: string } | undefined)?.title ?? (node.data as { label?: string })?.label ?? ''}
              onChange={(e) => onChangeNode({ title: e.target.value, label: e.target.value })}
            />
          </label>
        </>
      )}

      {kind === 'group' && node && onChangeGroup && (
        <>
          <label className={styles.label}>
            <div className={styles.labelText}>群组标题</div>
            <input
              className={styles.input}
              value={(node.data as { title?: string } | undefined)?.title ?? ''}
              onChange={(e) => onChangeGroup({ title: e.target.value })}
            />
          </label>
        </>
      )}

      {kind === 'edge' && edge && onChangeEdge && (
        <>
          <label className={styles.label}>
            <div className={styles.labelText}>Label</div>
            <input
              className={styles.input}
              value={(edge.label as string) ?? ''}
              onChange={(e) => onChangeEdge({ label: e.target.value })}
            />
          </label>
          <EdgeLabelLayoutFields edge={edge} onChangeEdge={onChangeEdge} />
        </>
      )}
    </div>
  )
}

function EdgeLabelLayoutFields({
  edge,
  onChangeEdge,
}: {
  edge: Record<string, unknown>
  onChangeEdge: (patch: Record<string, unknown>) => void
}) {
  const data = (edge.data ?? {}) as { labelLayout?: EdgeLabelLayoutConfig }
  const layout = data.labelLayout ?? {}

  const setLayout = (next: EdgeLabelLayoutConfig) => {
    onChangeEdge({
      data: {
        ...data,
        labelLayout: next,
      },
    })
  }

  return (
    <>
      <label className={styles.label}>
        <div className={styles.labelText}>标签位置</div>
        <select
          className={styles.input}
          value={layout.placement ?? 'center'}
          onChange={(e) => {
            const placement = e.target.value as EdgeLabelPlacement
            setLayout({ ...layout, placement })
          }}
        >
          {PLACEMENTS.map((p) => (
            <option key={p} value={p}>
              {p === 'center' ? '居中' : p === 'head' ? '靠近起点' : p === 'tail' ? '靠近终点' : '手动偏移'}
            </option>
          ))}
        </select>
      </label>
      {(layout.placement ?? 'center') === 'manual' && (
        <>
          <label className={styles.label}>
            <div className={styles.labelText}>offsetX（flow）</div>
            <input
              className={styles.input}
              type="number"
              value={layout.offsetX ?? 0}
              onChange={(e) =>
                setLayout({
                  ...layout,
                  placement: 'manual',
                  offsetX: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <label className={styles.label}>
            <div className={styles.labelText}>offsetY（flow）</div>
            <input
              className={styles.input}
              type="number"
              value={layout.offsetY ?? 0}
              onChange={(e) =>
                setLayout({
                  ...layout,
                  placement: 'manual',
                  offsetX: layout.offsetX ?? 0,
                  offsetY: Number(e.target.value) || 0,
                })
              }
            />
          </label>
        </>
      )}
    </>
  )
}
