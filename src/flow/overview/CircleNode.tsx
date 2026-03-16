import type { NodeProps } from '@xyflow/react'
import styles from './overviewNodes.module.css'

type CircleData = { label?: string }

export function CircleNode(props: NodeProps) {
  const data = (props.data ?? {}) as CircleData
  return <div className={styles.circleLabel}>{data.label ?? 'Circle'}</div>
}

