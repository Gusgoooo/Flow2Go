import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import styles from './quadNode.module.css'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

export type QuadShape = 'rect' | 'circle' | 'diamond'

type QuadNodeData = {
  label?: string
  title?: string
  subtitle?: string
  showSubtitle?: boolean
  labelFontSize?: number
  labelFontWeight?: string
  labelColor?: string
  /** 副标题：字号 / 字重 / 颜色与主标题完全独立 */
  subtitleFontSize?: number
  subtitleFontWeight?: string
  subtitleColor?: string
  /** 节点填充色（右侧面板「颜色」） */
  color?: string
  /** 节点描边颜色 */
  stroke?: string
  /** 节点描边粗细 */
  strokeWidth?: number
  /**
   * 思维导图模式：只保留左右句柄，隐藏上下句柄。
   * 其它模式默认渲染全部句柄。
   */
  handleMode?: 'leftRight' | 'all'
  /** 节点形状（点击节点弹出工具栏可切换） */
  shape?: QuadShape
}

const DEFAULT_TITLE_FS = 12
const DEFAULT_SUBTITLE_FS = 11
const QUAD_MIN_W = 80
const QUAD_MIN_H = 44
const QUAD_MAX_W = 200

/** 行高 = 字号 + 8px（与主副标题各自字号同步） */
function lineHeightForFontSizePx(fs: number) {
  return `${Math.round(fs) + 8}px`
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
  const measureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editingTitle && !editingSubtitle) {
      setDraftTitle(data.title ?? data.label ?? '')
      setDraftSubtitle(data.subtitle ?? '')
    }
  }, [data.label, data.subtitle, data.title, editingSubtitle, editingTitle])

  // 全局文字编辑锁：任何标题/副标题编辑开启时，压住其它菜单栏
  useEffect(() => {
    const active = editingTitle || editingSubtitle
    window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active } }))
    return () => {
      // 组件卸载时确保解锁（避免残留锁）
      window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: false } }))
    }
  }, [editingTitle, editingSubtitle])

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

  const onDoubleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('flow2go:close-popups-for-text'))
    setEditingTitle(true)
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
  const showSubtitle = !!data.showSubtitle || !!subtitle
  const showLeftRightHandles = data.handleMode === 'leftRight'
  const titleFs = data.labelFontSize ?? DEFAULT_TITLE_FS
  const subtitleFs = data.subtitleFontSize ?? DEFAULT_SUBTITLE_FS
  const labelStyle: CSSProperties = {
    fontSize: titleFs,
    fontWeight: data.labelFontWeight ?? '700',
    color: data.labelColor ?? 'rgba(0,0,0,0.8)',
    lineHeight: lineHeightForFontSizePx(titleFs),
  }
  const subtitleStyle: CSSProperties = {
    fontSize: subtitleFs,
    fontWeight: data.subtitleFontWeight ?? '400',
    color: data.subtitleColor ?? '#64748b',
    lineHeight: lineHeightForFontSizePx(subtitleFs),
  }

  const propsAny = props as any
  const baseWRaw =
    (typeof props.width === 'number' ? props.width : undefined) ??
    (typeof propsAny.measured?.width === 'number' ? propsAny.measured.width : undefined) ??
    (typeof propsAny.style?.width === 'number' ? propsAny.style.width : undefined) ??
    160
  const targetW = Math.min(QUAD_MAX_W, Math.max(QUAD_MIN_W, Math.round(baseWRaw)))
  const displayTitle = editingTitle ? draftTitle : title
  const displaySubtitle = editingSubtitle ? draftSubtitle : subtitle

  // 根据文本真实换行测量高度（含主/副标题），并把宽度钳制到 <= 200。
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const measuredH = Math.ceil(el.getBoundingClientRect().height)
    const nextH = Math.max(QUAD_MIN_H, measuredH)
    rf.setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== props.id) return n
        const curW =
          (typeof n.width === 'number' ? n.width : undefined) ??
          (typeof n.measured?.width === 'number' ? n.measured?.width : undefined) ??
          (typeof (n.style as any)?.width === 'number' ? (n.style as any).width : undefined) ??
          targetW
        const curH =
          (typeof n.height === 'number' ? n.height : undefined) ??
          (typeof n.measured?.height === 'number' ? n.measured?.height : undefined) ??
          (typeof (n.style as any)?.height === 'number' ? (n.style as any).height : undefined) ??
          nextH
        const finalW = Math.min(QUAD_MAX_W, Math.max(QUAD_MIN_W, Math.round(curW)))
        const widthChanged = Math.abs(finalW - curW) > 0.5
        const heightChanged = Math.abs(nextH - curH) > 0.5
        if (!widthChanged && !heightChanged) return n
        return {
          ...n,
          width: finalW,
          height: nextH,
          style: {
            ...(n.style as any),
            width: finalW,
            height: nextH,
            maxWidth: QUAD_MAX_W,
          },
        }
      }),
    )
  }, [
    rf,
    props.id,
    targetW,
    displayTitle,
    displaySubtitle,
    showSubtitle,
    titleFs,
    subtitleFs,
    data.labelFontWeight,
    data.labelColor,
    data.subtitleFontWeight,
    data.subtitleColor,
  ])

  const nodeColor = data.color
  const strokeColor = data.stroke
  const strokeWidth = data.strokeWidth
  const shape = data.shape ?? 'rect'
  const nodeStyle: CSSProperties = {}

  // 形状：圆形 / 菱形；描边贴合图形
  if (shape === 'circle') {
    nodeStyle.borderRadius = '50%'
  } else if (shape === 'diamond') {
    nodeStyle.borderRadius = 0
    nodeStyle.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
  }
  // rect 保持默认圆角

  // 描边：支持自定义颜色和粗细，strokeWidth 为 0 时无描边
  if (strokeWidth === 0) {
    nodeStyle.border = 'none'
  } else {
    if (strokeColor) nodeStyle.borderColor = strokeColor
    if (strokeWidth !== undefined) nodeStyle.borderWidth = strokeWidth
  }

  // 选中时不强制黑色描边：保持用户设置的 stroke 颜色

  // 填充色
  if (nodeColor) {
    // 透明度完全由 ColorEditor 决定：
    // - 当有透明度时, ColorEditor 输出 rgba(...)，这里直接用 rgba 作为背景
    // - 当透明度为 100% 时, ColorEditor 输出纯 hex，这里也直接用 hex 作为不透明背景
    if (nodeColor.startsWith('rgba') || nodeColor.startsWith('#')) {
      nodeStyle.background = nodeColor
    }
  }

  return (
    <div
      className={`${styles.node} ${editingTitle || editingSubtitle ? 'nodrag' : ''}`}
      onDoubleClick={onDoubleClick}
    >
      <NodeResizer
        // Business Big Map: want quad nodes to be shrinkable down to ~3 layout units.
        // Business inner unit = 12px => 3 units = 36px.
        // Previously this was hard-coded to 80px, preventing further shrinking.
        minWidth={QUAD_MIN_W}
        minHeight={QUAD_MIN_H}
        maxWidth={QUAD_MAX_W}
        handleStyle={{ width: 12, height: 12, borderRadius: 9999 }}
        isVisible={Boolean((props as any).selected)}
        keepAspectRatio={shape === 'circle'}
      />
      <div
        className={styles.nodeInner}
        style={Object.keys(nodeStyle).length ? { ...nodeStyle, maxWidth: QUAD_MAX_W } : { maxWidth: QUAD_MAX_W }}
      >
        {editingTitle ? (
          <>
            <QuickTextStyleToolbar
              anchorRef={titleInputRef}
              visible={true}
              onRequestClose={commitTitle}
              fontSize={titleFs}
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
                  window.dispatchEvent(new CustomEvent('flow2go:close-popups-for-text'))
                  setEditingSubtitle(true)
                }}
              >
                {subtitle || '副标题（可留空）'}
              </div>
            )}
          </>
        )}
      </div>
      <div ref={measureRef} className={styles.measureBox} style={{ width: targetW }}>
        <div className={styles.label} style={labelStyle}>
          {displayTitle || ' '}
        </div>
        {showSubtitle && (
          <div className={styles.subtitle} style={subtitleStyle}>
            {displaySubtitle || ' '}
          </div>
        )}
      </div>

      {/* target handles - 与 nodeInner 平级，不被 clip-path 裁剪 */}
      {showLeftRightHandles ? (
        <>
          <Handle className={styles.handle} type="target" position={Position.Right} id="t-right" />
          <Handle className={styles.handle} type="target" position={Position.Left} id="t-left" />
        </>
      ) : (
        <>
          <Handle className={styles.handle} type="target" position={Position.Top} id="t-top" />
          <Handle className={styles.handle} type="target" position={Position.Right} id="t-right" />
          <Handle className={styles.handle} type="target" position={Position.Bottom} id="t-bottom" />
          <Handle className={styles.handle} type="target" position={Position.Left} id="t-left" />
        </>
      )}

      {/* source handles */}
      {showLeftRightHandles ? (
        <>
          <Handle className={styles.handle} type="source" position={Position.Right} id="s-right" />
          <Handle className={styles.handle} type="source" position={Position.Left} id="s-left" />
        </>
      ) : (
        <>
          <Handle className={styles.handle} type="source" position={Position.Top} id="s-top" />
          <Handle className={styles.handle} type="source" position={Position.Right} id="s-right" />
          <Handle className={styles.handle} type="source" position={Position.Bottom} id="s-bottom" />
          <Handle className={styles.handle} type="source" position={Position.Left} id="s-left" />
        </>
      )}
    </div>
  )
}

