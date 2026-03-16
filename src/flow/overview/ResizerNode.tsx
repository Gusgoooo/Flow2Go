import { NodeResizer, type NodeProps } from '@xyflow/react'
import styles from './overviewNodes.module.css'

type ResizerData = { label?: string }

export function ResizerNode(props: NodeProps) {
  const data = (props.data ?? {}) as ResizerData
  const selected = Boolean((props as any).selected)

  return (
    <div className={styles.resizer}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={80} />
      <div className={styles.resizerTitle}>{data.label ?? 'Resizer Node'}</div>
      <div className={styles.resizerHint}>选中后出现 Resizer 控点</div>
    </div>
  )
}

