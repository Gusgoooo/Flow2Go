import type { NodeProps } from '@xyflow/react'
import styles from './overviewNodes.module.css'

type AnnotationData = {
  label?: string
  level?: 'info' | 'warning'
}

export function AnnotationNode(props: NodeProps) {
  const data = (props.data ?? {}) as AnnotationData

  return (
    <div className={styles.annotation}>
      <div className={styles.annotationTitle}>{data.level === 'warning' ? '提示' : '说明'}</div>
      <div className={styles.annotationBody}>{data.label ?? ''}</div>
    </div>
  )
}

