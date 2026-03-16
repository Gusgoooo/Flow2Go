import { useEffect, useRef } from 'react'
import styles from './flowEditor.module.css'

type InlineInspectorProps = {
  anchor: { x: number; y: number } | null
  kind: 'node' | 'group' | 'edge' | null
  node?: any
  edge?: any
  onChangeNode?: (patch: Partial<any>) => void
  onChangeGroup?: (patch: Partial<any>) => void
  onChangeEdge?: (patch: Partial<any>) => void
  onClose: () => void
}

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
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
              value={(node.data?.title ?? node.data?.label ?? '') as string}
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
              value={(node.data?.title ?? '') as string}
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
        </>
      )}
    </div>
  )
}

