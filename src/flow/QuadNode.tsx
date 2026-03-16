import { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import styles from './quadNode.module.css'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

type QuadNodeData = {
  label?: string
  title?: string
  subtitle?: string
  showSubtitle?: boolean
  labelFontSize?: number
  labelFontWeight?: string
  labelColor?: string
  /** 节点填充色（右侧面板「颜色」） */
  color?: string
  /** 节点描边颜色 */
  stroke?: string
  /** 节点描边粗细 */
  strokeWidth?: number
}

export function QuadNode(props: NodeProps) {
  const data = (props.data ?? {}) as QuadNodeData
  const rf = useReactFlow()

  const isNewTitle = (data.title ?? data.label ?? '').trim() === ''

  const [editingTitle, setEditingTitle] = useState(() => isNewTitle)
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(data.title ?? data.label ?? '')
  const [draftSubtitle, setDraftSubtitle] = useState(data.subtitle ?? '')

  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const subtitleInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editingTitle && !editingSubtitle) {
      setDraftTitle(data.title ?? data.label ?? '')
      setDraftSubtitle(data.subtitle ?? '')
    }
  }, [data.label, data.subtitle, data.title, editingSubtitle, editingTitle])

  // 编辑时自动全选文本并调整高度
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.select()
      // 初始调整高度以匹配内容
      titleInputRef.current.style.height = 'auto'
      titleInputRef.current.style.height = titleInputRef.current.scrollHeight + 'px'
    }
  }, [editingTitle])

  useEffect(() => {
    if (editingSubtitle && subtitleInputRef.current) {
      subtitleInputRef.current.select()
      // 初始调整高度以匹配内容
      subtitleInputRef.current.style.height = 'auto'
      subtitleInputRef.current.style.height = subtitleInputRef.current.scrollHeight + 'px'
    }
  }, [editingSubtitle])

  const commitTitle = useCallback(() => {
    const nextTitle = draftTitle
    rf.setNodes((nds) =>
      nds.map((n) =>
        n.id === props.id
          ? {
              ...n,
              data: { ...(n.data ?? {}), label: nextTitle, title: nextTitle },
            }
          : n,
      ),
    )
    setEditingTitle(false)
  }, [draftTitle, props.id, rf])

  const commitSubtitle = useCallback(() => {
    const nextSubtitle = draftSubtitle
    rf.setNodes((nds) =>
      nds.map((n) =>
        n.id === props.id
          ? {
              ...n,
              data: { ...(n.data ?? {}), subtitle: nextSubtitle || undefined },
            }
          : n,
      ),
    )
    setEditingSubtitle(false)
  }, [draftSubtitle, props.id, rf])

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingTitle(true)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Enter or Cmd/Ctrl+Enter to commit, plain Enter for newline
      if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (editingTitle) commitTitle()
        if (editingSubtitle) commitSubtitle()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setEditingTitle(false)
        setEditingSubtitle(false)
        setDraftTitle(data.title ?? data.label ?? '')
        setDraftSubtitle(data.subtitle ?? '')
      }
    },
    [commitSubtitle, commitTitle, data.label, data.subtitle, data.title, editingSubtitle, editingTitle],
  )

  const title = data.title ?? data.label ?? ''
  const subtitle = data.subtitle ?? ''
  const showSubtitle = !!data.showSubtitle
  const selected = (props as any).selected
  const labelStyle = {
    fontSize: data.labelFontSize ?? 12,
    fontWeight: data.labelFontWeight ?? '700',
    color: data.labelColor ?? 'rgba(0,0,0,0.8)',
  }
  const subtitleStyle = {
    fontSize: Math.max(10, (data.labelFontSize ?? 12) - 1),
    fontWeight: data.labelFontWeight ?? '400',
    color: data.labelColor ?? 'rgba(0,0,0,0.8)',
  }

  const nodeColor = data.color
  const strokeColor = data.stroke
  const strokeWidth = data.strokeWidth
  const nodeStyle: React.CSSProperties = {}
  
  // 描边：支持自定义颜色和粗细，strokeWidth 为 0 时无描边
  if (strokeWidth === 0) {
    nodeStyle.border = 'none'
  } else {
    if (strokeColor) nodeStyle.borderColor = strokeColor
    if (strokeWidth !== undefined) nodeStyle.borderWidth = strokeWidth
  }
  
  // 选中时使用黑色描边
  if (selected) nodeStyle.borderColor = 'rgba(0,0,0,0.8)'
  
  // 填充色
  if (nodeColor) {
    // 透明度完全由 ColorEditor 决定：
    // - 当有透明度时，ColorEditor 输出 rgba(...)，这里直接用 rgba 作为背景
    // - 当透明度为 100% 时，ColorEditor 输出纯 hex，这里也直接用 hex 作为不透明背景
    if (nodeColor.startsWith('rgba') || nodeColor.startsWith('#')) {
      nodeStyle.background = nodeColor
    }
  }

  return (
    <div
      className={`${styles.node} ${editingTitle || editingSubtitle ? 'nodrag' : ''}`}
      onDoubleClick={onDoubleClick}
      style={Object.keys(nodeStyle).length ? nodeStyle : undefined}
    >
      <NodeResizer
        minWidth={120}
        minHeight={44}
        handleStyle={{ width: 12, height: 12, borderRadius: 9999 }}
        isVisible={Boolean((props as any).selected)}
      />
      {editingTitle ? (
        <>
          <QuickTextStyleToolbar
            anchorRef={titleInputRef}
            visible={true}
            onRequestClose={commitTitle}
            fontSize={data.labelFontSize ?? 12}
            fontWeight={data.labelFontWeight ?? '700'}
            textColor={data.labelColor ?? 'rgba(0,0,0,0.8)'}
            onFontSizeChange={(v) =>
              rf.setNodes((nds) =>
                nds.map((n) =>
                  n.id === props.id
                    ? { ...n, data: { ...(n.data ?? {}), labelFontSize: v } }
                    : n,
                ),
              )
            }
            onFontWeightChange={(v) =>
              rf.setNodes((nds) =>
                nds.map((n) =>
                  n.id === props.id
                    ? { ...n, data: { ...(n.data ?? {}), labelFontWeight: v } }
                    : n,
                ),
              )
            }
            onTextColorChange={(v) =>
              rf.setNodes((nds) =>
                nds.map((n) =>
                  n.id === props.id
                    ? { ...n, data: { ...(n.data ?? {}), labelColor: v } }
                    : n,
                ),
              )
            }
          />
          <textarea
            ref={titleInputRef}
            className={`${styles.input} nodrag`}
            autoFocus
            value={draftTitle}
            placeholder="主标题"
            style={{ ...labelStyle, height: 'auto' }}
            rows={1}
            onChange={(e) => {
              setDraftTitle(e.target.value)
              // 自动调整高度
              e.target.style.height = 'auto'
              e.target.style.height = e.target.scrollHeight + 'px'
            }}
            onBlur={(e) => {
              if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
              commitTitle()
            }}
            onKeyDown={onKeyDown}
          />
        </>
      ) : editingSubtitle ? (
        <>
          <QuickTextStyleToolbar
            anchorRef={subtitleInputRef}
            visible={true}
            onRequestClose={commitSubtitle}
            fontSize={data.labelFontSize ?? 12}
            fontWeight={data.labelFontWeight ?? '400'}
            textColor={data.labelColor ?? 'rgba(0,0,0,0.8)'}
            onFontSizeChange={(v) =>
              rf.setNodes((nds) =>
                nds.map((n) =>
                  n.id === props.id
                    ? { ...n, data: { ...(n.data ?? {}), labelFontSize: v } }
                    : n,
                ),
              )
            }
            onFontWeightChange={(v) =>
              rf.setNodes((nds) =>
                nds.map((n) =>
                  n.id === props.id
                    ? { ...n, data: { ...(n.data ?? {}), labelFontWeight: v } }
                    : n,
                ),
              )
            }
            onTextColorChange={(v) =>
              rf.setNodes((nds) =>
                nds.map((n) =>
                  n.id === props.id
                    ? { ...n, data: { ...(n.data ?? {}), labelColor: v } }
                    : n,
                ),
              )
            }
          />
          <div className={styles.label} style={labelStyle}>
            {title}
          </div>
          <textarea
            ref={subtitleInputRef}
            className={`${styles.inputSubtitle} nodrag`}
            autoFocus
            value={draftSubtitle}
            placeholder="副标题（可留空）"
            style={{ ...subtitleStyle, height: 'auto' }}
            rows={1}
            onChange={(e) => {
              setDraftSubtitle(e.target.value)
              // 自动调整高度
              e.target.style.height = 'auto'
              e.target.style.height = e.target.scrollHeight + 'px'
            }}
            onBlur={(e) => {
              if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
              commitSubtitle()
            }}
            onKeyDown={onKeyDown}
          />
        </>
      ) : (
        <>
          <div className={styles.label} style={labelStyle}>
            {title}
          </div>
          {showSubtitle && (
            <div
              className={styles.subtitle}
              style={subtitleStyle}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingSubtitle(true)
              }}
            >
              {subtitle || '副标题（可留空）'}
            </div>
          )}
        </>
      )}

      {/* target handles */}
      <Handle className={styles.handle} type="target" position={Position.Top} id="t-top" />
      <Handle className={styles.handle} type="target" position={Position.Right} id="t-right" />
      <Handle className={styles.handle} type="target" position={Position.Bottom} id="t-bottom" />
      <Handle className={styles.handle} type="target" position={Position.Left} id="t-left" />

      {/* source handles */}
      <Handle className={styles.handle} type="source" position={Position.Top} id="s-top" />
      <Handle className={styles.handle} type="source" position={Position.Right} id="s-right" />
      <Handle className={styles.handle} type="source" position={Position.Bottom} id="s-bottom" />
      <Handle className={styles.handle} type="source" position={Position.Left} id="s-left" />
    </div>
  )
}

