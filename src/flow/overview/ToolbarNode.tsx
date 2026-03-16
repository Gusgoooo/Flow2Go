import { useMemo } from 'react'
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import styles from './overviewNodes.module.css'

type ToolbarData = { label?: string }

export function ToolbarNode(props: NodeProps) {
  const data = (props.data ?? {}) as ToolbarData
  const isSelected = Boolean((props as any).selected)

  const buttons = useMemo(
    () => [
      { key: 'a', label: '动作 A' },
      { key: 'b', label: '动作 B' },
      { key: 'c', label: '动作 C' },
    ],
    [],
  )

  return (
    <div className={styles.tools}>
      <NodeToolbar isVisible={isSelected} position={Position.Top} offset={10}>
        <div className={styles.toolbar}>
          {buttons.map((b) => (
            <button key={b.key} className={styles.toolbarBtn} type="button" onClick={() => window.alert(`${b.label}（示例）`)}>
              {b.label}
            </button>
          ))}
        </div>
      </NodeToolbar>
      <div className={styles.toolsTitle}>{data.label ?? 'Toolbar Node'}</div>
      <div className={styles.toolsHint}>选中后显示 NodeToolbar</div>
    </div>
  )
}

