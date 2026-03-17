import { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import styles from './groupNode.module.css'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

export type GroupNodeData = {
  title?: string
  subtitle?: string
  showSubtitle?: boolean
  titlePosition?: 'top-center' | 'left-center'
  stroke?: string
  strokeWidth?: number
  fill?: string
  titleFontSize?: number
  titleFontWeight?: string
  titleColor?: string
  /** 副标题字号（独立于主标题） */
  subtitleFontSize?: number
}

export function GroupNode(props: NodeProps) {
  const data = (props.data ?? {}) as GroupNodeData
  const stroke = data.stroke ?? '#3b82f6'
  const strokeWidth = data.strokeWidth
  const fill = data.fill ?? 'rgba(59, 130, 246, 0.10)'
  const selected = (props as any).selected
  const rf = useReactFlow()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 计算样式
  const groupStyle: React.CSSProperties = {
    background: fill,
  }
  if (strokeWidth === 0) {
    groupStyle.border = 'none'
  } else {
    groupStyle.borderColor = selected ? 'rgba(0,0,0,0.8)' : stroke
    if (strokeWidth !== undefined) groupStyle.borderWidth = strokeWidth
  }

  const [editing, setEditing] = useState(false)
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [draft, setDraft] = useState(data.title ?? '')
  const [draftSubtitle, setDraftSubtitle] = useState(data.subtitle ?? '')
  const subtitleInputRef = useRef<HTMLTextAreaElement>(null)
  const titleStyle = {
    fontSize: data.titleFontSize ?? 13,
    fontWeight: data.titleFontWeight ?? '800',
    color: data.titleColor ?? undefined,
  }
  const subtitleStyle = {
    fontSize: data.subtitleFontSize ?? Math.max(10, (data.titleFontSize ?? 13) - 2),
    fontWeight: '400',
    color: data.titleColor ?? undefined,
  }
  const titlePosition = data.titlePosition ?? 'top-center'
  const isLeftCenter = titlePosition === 'left-center'

  useEffect(() => {
    if (!editing) setDraft(data.title ?? '')
    if (!editingSubtitle) setDraftSubtitle(data.subtitle ?? '')
  }, [data.title, data.subtitle, editing, editingSubtitle])

  // 全局文字编辑锁：群组标题/副标题编辑开启时，压住其它菜单栏
  useEffect(() => {
    const active = editing || editingSubtitle
    window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active } }))
    return () => {
      window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: false } }))
    }
  }, [editing, editingSubtitle])

  // 编辑时自动全选文本并调整高度
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
      // 初始调整高度以匹配内容
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px'
    }
  }, [editing])

  useEffect(() => {
    if (editingSubtitle && subtitleInputRef.current) {
      subtitleInputRef.current.select()
      subtitleInputRef.current.style.height = 'auto'
      subtitleInputRef.current.style.height = subtitleInputRef.current.scrollHeight + 'px'
    }
  }, [editingSubtitle])

  const commit = useCallback(() => {
    const nextTitle = draft
    window.dispatchEvent(
      new CustomEvent('flow2go:group-title', {
        detail: { id: props.id, title: nextTitle },
      }),
    )
    setEditing(false)
  }, [draft, props.id])

  const commitSubtitle = useCallback(() => {
    const nextSubtitle = draftSubtitle
    rf.setNodes((nds) =>
      nds.map((n) =>
        n.id === props.id
          ? { ...n, data: { ...(n.data ?? {}), subtitle: nextSubtitle || undefined } }
          : n,
      ),
    )
    setEditingSubtitle(false)
  }, [draftSubtitle, props.id, rf])

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('flow2go:close-popups-for-text'))
    setEditing(true)
  }, [])

  return (
    <div
      className={styles.group}
      style={groupStyle}
      onDoubleClick={onDoubleClick}
    >
      <NodeResizer
        minWidth={160}
        minHeight={120}
        handleStyle={{ width: 12, height: 12, borderRadius: 9999 }}
        isVisible={Boolean((props as any).selected)}
      />
      {isLeftCenter ? (
        <div className={styles.titleBlockLeft}>
          {editing ? (
            <>
              <QuickTextStyleToolbar
                anchorRef={inputRef}
                visible={editing}
                onRequestClose={commit}
                fontSize={data.titleFontSize ?? 13}
                fontWeight={data.titleFontWeight ?? '800'}
                textColor={data.titleColor ?? '#1e3a8a'}
                onFontSizeChange={(v) =>
                  rf.setNodes((nds) =>
                    nds.map((n) =>
                      n.id === props.id
                        ? { ...n, data: { ...(n.data ?? {}), titleFontSize: v } }
                        : n,
                    ),
                  )
                }
                onFontWeightChange={(v) =>
                  rf.setNodes((nds) =>
                    nds.map((n) =>
                      n.id === props.id
                        ? { ...n, data: { ...(n.data ?? {}), titleFontWeight: v } }
                        : n,
                    ),
                  )
                }
                onTextColorChange={(v) =>
                  rf.setNodes((nds) =>
                    nds.map((n) =>
                      n.id === props.id
                        ? { ...n, data: { ...(n.data ?? {}), titleColor: v } }
                        : n,
                    ),
                  )
                }
              />
              <textarea
                ref={inputRef}
                className={`${styles.titleInputLeft} nodrag`}
                autoFocus
                value={draft}
                placeholder="（可为空）"
                style={{ ...titleStyle, height: 'auto' }}
                rows={1}
                onChange={(e) => {
                  setDraft(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = e.target.scrollHeight + 'px'
                }}
                onBlur={(e) => {
                  if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
                  commit()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    commit()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditing(false)
                    setDraft(data.title ?? '')
                  }
                }}
              />
            </>
          ) : (
            <div className={styles.titleLeft} style={titleStyle}>
              {data.title ?? ''}
            </div>
          )}
          {data.showSubtitle &&
            (editingSubtitle ? (
              <>
                <QuickTextStyleToolbar
                  anchorRef={subtitleInputRef}
                  visible={true}
                  onRequestClose={commitSubtitle}
                fontSize={data.subtitleFontSize ?? Math.max(10, (data.titleFontSize ?? 13) - 2)}
                  fontWeight="400"
                  textColor={data.titleColor ?? '#64748b'}
                  onFontSizeChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleFontSize: v } }
                          : n,
                      ),
                    )
                  }
                  onFontWeightChange={() => {}}
                  onTextColorChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), titleColor: v } }
                          : n,
                      ),
                    )
                  }
                />
                <textarea
                  ref={subtitleInputRef}
                  className={`${styles.subtitleInputLeft} nodrag`}
                  autoFocus
                  value={draftSubtitle}
                  placeholder="副标题"
                  style={{ ...subtitleStyle, height: 'auto' }}
                  rows={1}
                  onChange={(e) => {
                    setDraftSubtitle(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                  }}
                  onBlur={(e) => {
                    if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
                    commitSubtitle()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      commitSubtitle()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingSubtitle(false)
                      setDraftSubtitle(data.subtitle ?? '')
                    }
                  }}
                />
              </>
            ) : (
              <div
                className={styles.subtitleLeft}
                style={subtitleStyle}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingSubtitle(true)
                }}
              >
                {data.subtitle || '双击编辑副标题'}
              </div>
            ))}
        </div>
      ) : (
        <>
          {editing ? (
            <>
              <QuickTextStyleToolbar
                anchorRef={inputRef}
                visible={editing}
                onRequestClose={commit}
                fontSize={data.titleFontSize ?? 13}
                fontWeight={data.titleFontWeight ?? '800'}
                textColor={data.titleColor ?? '#1e3a8a'}
                onFontSizeChange={(v) =>
                  rf.setNodes((nds) =>
                    nds.map((n) =>
                      n.id === props.id
                        ? { ...n, data: { ...(n.data ?? {}), titleFontSize: v } }
                        : n,
                    ),
                  )
                }
                onFontWeightChange={(v) =>
                  rf.setNodes((nds) =>
                    nds.map((n) =>
                      n.id === props.id
                        ? { ...n, data: { ...(n.data ?? {}), titleFontWeight: v } }
                        : n,
                    ),
                  )
                }
                onTextColorChange={(v) =>
                  rf.setNodes((nds) =>
                    nds.map((n) =>
                      n.id === props.id
                        ? { ...n, data: { ...(n.data ?? {}), titleColor: v } }
                        : n,
                    ),
                  )
                }
              />
              <textarea
                ref={inputRef}
                className={`${styles.titleInput} nodrag`}
                autoFocus
                value={draft}
                placeholder="（可为空）"
                style={{ ...titleStyle, height: 'auto' }}
                rows={1}
                onChange={(e) => {
                  setDraft(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = e.target.scrollHeight + 'px'
                }}
                onBlur={(e) => {
                  if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
                  commit()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    commit()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditing(false)
                    setDraft(data.title ?? '')
                  }
                }}
              />
            </>
          ) : (
            <div className={styles.title} style={titleStyle}>
              {data.title ?? ''}
            </div>
          )}
          {data.showSubtitle &&
            (editingSubtitle ? (
              <>
                <QuickTextStyleToolbar
                  anchorRef={subtitleInputRef}
                  visible={true}
                  onRequestClose={commitSubtitle}
                fontSize={data.subtitleFontSize ?? Math.max(10, (data.titleFontSize ?? 13) - 2)}
                  fontWeight="400"
                  textColor={data.titleColor ?? '#64748b'}
                  onFontSizeChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleFontSize: v } }
                          : n,
                      ),
                    )
                  }
                  onFontWeightChange={() => {}}
                  onTextColorChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), titleColor: v } }
                          : n,
                      ),
                    )
                  }
                />
                <textarea
                  ref={subtitleInputRef}
                  className={styles.subtitleInput}
                  autoFocus
                  value={draftSubtitle}
                  placeholder="副标题"
                  style={{ ...subtitleStyle, height: 'auto' }}
                  rows={1}
                  onChange={(e) => {
                    setDraftSubtitle(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                  }}
                  onBlur={(e) => {
                    if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
                    commitSubtitle()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      commitSubtitle()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingSubtitle(false)
                      setDraftSubtitle(data.subtitle ?? '')
                    }
                  }}
                />
              </>
            ) : (
              <div
                className={styles.subtitle}
                style={subtitleStyle}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingSubtitle(true)
                }}
              >
                {data.subtitle || '双击编辑副标题'}
              </div>
            ))}
        </>
      )}

      {/* group 四边可拉线 */}
      <Handle className={styles.handle} type="target" position={Position.Top} id="t-top" />
      <Handle className={styles.handle} type="target" position={Position.Right} id="t-right" />
      <Handle className={styles.handle} type="target" position={Position.Bottom} id="t-bottom" />
      <Handle className={styles.handle} type="target" position={Position.Left} id="t-left" />

      <Handle className={styles.handle} type="source" position={Position.Top} id="s-top" />
      <Handle className={styles.handle} type="source" position={Position.Right} id="s-right" />
      <Handle className={styles.handle} type="source" position={Position.Bottom} id="s-bottom" />
      <Handle className={styles.handle} type="source" position={Position.Left} id="s-left" />
    </div>
  )
}

