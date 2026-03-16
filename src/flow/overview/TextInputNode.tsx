import { useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import styles from './overviewNodes.module.css'

type TextInputData = {
  label?: string
  value?: string
}

export function TextInputNode(props: NodeProps) {
  const data = (props.data ?? {}) as TextInputData

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      props.data && ((props as any).updateNodeData?.(props.id, { value: e.target.value }) as void)
    },
    [props],
  )

  return (
    <div className={styles.textInput}>
      <div className={styles.textInputTitle}>{data.label ?? 'Text Input'}</div>
      <input className={styles.textInputField} value={data.value ?? ''} placeholder="输入一些内容…" onChange={onChange} />
      <div className={styles.textInputHint}>这个节点演示“节点内部可编辑状态”。</div>
    </div>
  )
}

