import { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import styles from './groupNode.module.css'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

export type LaneMeta = {
  laneId: string
  laneIndex: number
  laneAxis: 'row' | 'column'
  headerSize?: number
  padding?: {
    top: number
    right: number
    bottom: number
    left: number
  }
  minLaneWidth?: number
  minLaneHeight?: number
}

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
  /** 副标题：字号 / 字重 / 颜色与标题完全独立 */
  subtitleFontSize?: number
  subtitleFontWeight?: string
  subtitleColor?: string
  /** 泳道标题栏（左侧条 / 顶条整段）背景色；文字本身无独立底色 */
  laneHeaderBackground?: string

  role?: 'frame' | 'lane'
  laneMeta?: LaneMeta
}

const DEFAULT_LANE_HEADER_BG = 'rgba(71, 85, 105, 0.08)'

const DEFAULT_GROUP_TITLE_FS = 13
const DEFAULT_GROUP_SUBTITLE_FS = 10

function groupLineHeightPx(fs: number) {
  return `${Math.round(fs) + 8}px`
}

export function GroupNode(props: NodeProps) {
  const data = (props.data ?? {}) as GroupNodeData
  const stroke =
    data.role === 'lane' ? (data.stroke ?? 'rgba(203, 213, 225, 0.6)') : (data.stroke ?? '#3b82f6')
  const strokeWidth = data.strokeWidth
  const fill = data.fill ?? 'rgba(59, 130, 246, 0.10)'
  const rf = useReactFlow()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 计算样式
  const groupStyle: React.CSSProperties = {
    background: fill,
    border: 'none',
  }
  if (strokeWidth === 0) {
    groupStyle.boxShadow = 'none'
  } else {
    // 统一外描边：不挤占 group/lane 内部布局空间。
    const defaultStrokeWidth = data.role === 'lane' ? 1 : 2
    const effectiveStrokeWidth = Number.isFinite(strokeWidth as number) ? Math.max(0, Number(strokeWidth)) : defaultStrokeWidth
    groupStyle.boxShadow = `0 0 0 ${effectiveStrokeWidth}px ${stroke}`
  }

  const [editing, setEditing] = useState(false)
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [draft, setDraft] = useState(data.title ?? '')
  const [draftSubtitle, setDraftSubtitle] = useState(data.subtitle ?? '')
  const subtitleInputRef = useRef<HTMLTextAreaElement>(null)
  const titleFs = data.titleFontSize ?? DEFAULT_GROUP_TITLE_FS
  const subtitleFs = data.subtitleFontSize ?? DEFAULT_GROUP_SUBTITLE_FS
  const titleStyle = {
    fontSize: titleFs,
    fontWeight: data.titleFontWeight ?? '800',
    color: data.titleColor ?? '#1e3a8a',
    lineHeight: groupLineHeightPx(titleFs),
    letterSpacing: '0px' as const,
  }
  const subtitleStyle = {
    fontSize: subtitleFs,
    fontWeight: data.subtitleFontWeight ?? '400',
    color: data.subtitleColor ?? '#64748b',
    lineHeight: groupLineHeightPx(subtitleFs),
    letterSpacing: '0px' as const,
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

  const isLane = data.role === 'lane'

  if (isLane) {
    const laneHeaderH = data.laneMeta?.headerSize ?? 48
    const laneTitlePosition = data.titlePosition ?? 'top-center'
    const laneHeaderOnLeft = laneTitlePosition === 'left-center'
    const laneHeaderBg = data.laneHeaderBackground ?? DEFAULT_LANE_HEADER_BG
    const laneHeaderStyle: React.CSSProperties = laneHeaderOnLeft
      ? { width: laneHeaderH, height: '100%', background: laneHeaderBg }
      : { height: laneHeaderH, background: laneHeaderBg }

    return (
      <div
        className={`${styles.group} ${styles.laneNode} ${laneHeaderOnLeft ? styles.laneNodeLeft : ''}`}
        style={groupStyle}
      >
        <NodeResizer
          minWidth={200}
          minHeight={laneHeaderH + 48}
          handleStyle={{ width: 8, height: 8, borderRadius: 9999 }}
          isVisible={Boolean((props as any).selected)}
        />
        <div className={`${styles.laneHeader} ${laneHeaderOnLeft ? styles.laneHeaderLeft : ''}`} style={laneHeaderStyle}>
          {editing ? (
            <>
              <QuickTextStyleToolbar
                anchorRef={inputRef}
                visible={editing}
                onRequestClose={commit}
                fontSize={titleFs}
                fontWeight={data.titleFontWeight ?? '800'}
                textColor={data.titleColor ?? '#334155'}
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
                className={`${styles.laneHeaderInput} ${laneHeaderOnLeft ? styles.laneHeaderInputVertical : ''} nodrag`}
                autoFocus
                value={draft}
                placeholder="泳道名称"
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
            <div
              className={`${styles.laneHeaderTitle} ${laneHeaderOnLeft ? styles.laneHeaderTitleVertical : ''}`}
              style={titleStyle}
              onDoubleClick={(e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('flow2go:close-popups-for-text'))
                setEditing(true)
              }}
            >
              {data.title ?? ''}
            </div>
          )}
        </div>
        <div className={styles.laneBody} />

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

  return (
    <div
      className={styles.group}
      style={groupStyle}
      onDoubleClick={onDoubleClick}
    >
      <NodeResizer
        // 允许 group/subgroup 容器继续收缩，避免最小宽度过大影响排版。
        minWidth={36}
        minHeight={32}
        handleStyle={{ width: 8, height: 8, borderRadius: 9999 }}
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
                fontSize={titleFs}
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
                  fontSize={subtitleFs}
                  fontWeight={data.subtitleFontWeight ?? '400'}
                  textColor={data.subtitleColor ?? '#64748b'}
                  onFontSizeChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleFontSize: v } }
                          : n,
                      ),
                    )
                  }
                  onFontWeightChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleFontWeight: v } }
                          : n,
                      ),
                    )
                  }
                  onTextColorChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleColor: v } }
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
        <div className={styles.titleStackTop}>
          {editing ? (
            <>
              <QuickTextStyleToolbar
                anchorRef={inputRef}
                visible={editing}
                onRequestClose={commit}
                fontSize={titleFs}
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
                wrap="off"
                value={draft}
                placeholder="（可为空）"
                style={{ ...titleStyle, height: 'auto' }}
                rows={1}
                onWheelCapture={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
                onTouchMoveCapture={(e) => {
                  e.stopPropagation()
                }}
                onMouseDownCapture={(e) => {
                  e.stopPropagation()
                }}
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
                  fontSize={subtitleFs}
                  fontWeight={data.subtitleFontWeight ?? '400'}
                  textColor={data.subtitleColor ?? '#64748b'}
                  onFontSizeChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleFontSize: v } }
                          : n,
                      ),
                    )
                  }
                  onFontWeightChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleFontWeight: v } }
                          : n,
                      ),
                    )
                  }
                  onTextColorChange={(v) =>
                    rf.setNodes((nds) =>
                      nds.map((n) =>
                        n.id === props.id
                          ? { ...n, data: { ...(n.data ?? {}), subtitleColor: v } }
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
        </div>
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
