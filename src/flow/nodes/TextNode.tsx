import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from '../style/QuickTextStyleToolbar'
import { snapSizeToGrid } from '../grid'

export type TextNodeData = {
  label?: string
  labelFontSize?: number
  labelFontWeight?: string
  labelColor?: string
  /** 仅新建当次生效：自动进入编辑态，进入后会被清除 */
  autoEdit?: boolean
}

const DEFAULT_FONT_SIZE = 14
const PAD = 4
const PAD_TOTAL = PAD * 2
const MIN_W = 64
const MIN_H = 24

export function TextNode(props: NodeProps) {
  const data = (props.data ?? {}) as TextNodeData
  const rf = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  const autoEdit = Boolean(data.autoEdit)
  const [editing, setEditing] = useState(() => autoEdit)
  const [draft, setDraft] = useState(data.label ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const lastAppliedRef = useRef({ w: 0, h: 0 })
  const autoEditClearedRef = useRef(false)

  // autoEdit 仅触发一次；立即清除，避免下次重进画布再次进入编辑态
  useEffect(() => {
    if (!autoEdit || autoEditClearedRef.current) return
    autoEditClearedRef.current = true
    rf.setNodes((nds) =>
      nds.map((n) =>
        n.id === props.id
          ? { ...n, data: { ...(n.data ?? {}), autoEdit: false } }
          : n,
      ),
    )
  }, [autoEdit, props.id, rf])

  useEffect(() => {
    if (!editing) {
      setDraft(data.label ?? '')
    }
  }, [data.label, editing])

  // 全局文字编辑锁：文本节点编辑开启时，压住其它菜单栏
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: editing } }))
    return () => {
      window.dispatchEvent(new CustomEvent('flow2go:text-editing', { detail: { active: false } }))
    }
  }, [editing])

  // Auto focus and select all when start editing
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = useCallback(() => {
    const next = draft
    rf.setNodes((nds) =>
      nds.map((n) =>
        n.id === props.id
          ? { ...n, data: { ...(n.data ?? {}), label: next } }
          : n,
      ),
    )
    setEditing(false)
  }, [draft, props.id, rf])

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('flow2go:close-popups-for-text'))
    lastAppliedRef.current = { w: 0, h: 0 }
    setEditing(true)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Enter or Cmd/Ctrl+Enter to commit, plain Enter for newline（类 Figma：换行即折行）
      if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        commit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setEditing(false)
        setDraft(data.label ?? '')
      }
    },
    [commit, data.label],
  )

  const label = data.label ?? ''
  const fontSize = data.labelFontSize ?? DEFAULT_FONT_SIZE
  const fontWeight = data.labelFontWeight ?? '400'
  const textColor = data.labelColor ?? 'rgba(0,0,0,0.8)'

  const textStyle: React.CSSProperties = {
    fontSize,
    fontWeight,
    color: textColor,
    lineHeight: 1.4,
    wordBreak: 'normal',
    whiteSpace: 'pre',
  }

  const measureMirrorStyle: React.CSSProperties = {
    ...textStyle,
    position: 'absolute',
    left: -9999,
    top: 0,
    visibility: 'hidden',
    pointerEvents: 'none',
    display: 'inline-block',
    whiteSpace: 'pre',
    wordBreak: 'normal',
    boxSizing: 'border-box',
    padding: 0,
    margin: 0,
    fontFamily: 'inherit',
    overflow: 'hidden',
  }

  // 文字节点：宽度跟随最长行（仅用户手动换行），避免容器裁剪/软折行。
  useLayoutEffect(() => {
    if (!measureRef.current) return

    const raw = editing ? draft : label
    const el = measureRef.current
    el.textContent = raw.length > 0 ? raw : '\u200b'

    el.style.width = 'max-content'
    const sw = el.scrollWidth
    const mh = el.scrollHeight

    const w = snapSizeToGrid(Math.max(MIN_W, Math.ceil(sw + PAD_TOTAL)))
    const h = snapSizeToGrid(Math.max(MIN_H, Math.ceil(mh + PAD_TOTAL)))

    if (Math.abs(w - lastAppliedRef.current.w) <= 1 && Math.abs(h - lastAppliedRef.current.h) <= 1) return
    lastAppliedRef.current = { w, h }

    rf.setNodes((nds) =>
      nds.map((n) =>
        n.id === props.id
          ? {
              ...n,
              width: w,
              height: h,
              style: { ...((n.style as React.CSSProperties) ?? {}), width: w, height: h },
            }
          : n,
      ),
    )
    updateNodeInternals(props.id)
  }, [
    draft,
    editing,
    fontSize,
    fontWeight,
    label,
    props.id,
    props.width,
    rf,
    textColor,
    updateNodeInternals,
  ])

  const nodeW = typeof props.width === 'number' && props.width > 0 ? props.width : MIN_W
  const nodeH = typeof props.height === 'number' && props.height > 0 ? props.height : MIN_H

  return (
    <div
      style={{
        width: nodeW,
        height: nodeH,
        minWidth: MIN_W,
        minHeight: MIN_H,
        padding: PAD,
        position: 'relative',
        boxSizing: 'border-box',
        cursor: editing ? 'text' : 'default',
      }}
      onDoubleClick={onDoubleClick}
      className={editing ? 'nodrag' : ''}
    >
      <div ref={measureRef} aria-hidden style={measureMirrorStyle} />

      {editing ? (
        <>
          <QuickTextStyleToolbar
            anchorRef={inputRef}
            visible={true}
            onRequestClose={commit}
            fontSize={fontSize}
            fontWeight={fontWeight}
            textColor={textColor}
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
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              // textarea 的 overflow 在多数浏览器会被当成 auto；这里通过自适应高度+强制归零滚动来避免出现系统滚动条
              e.currentTarget.style.height = 'auto'
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
              e.currentTarget.scrollTop = 0
              e.currentTarget.scrollLeft = 0
            }}
            onWheelCapture={(e) => {
              // 避免滚轮把事件冒泡到 ReactFlow / 页面，导致画布平移或出现页面滚动条。
              e.stopPropagation()
              e.preventDefault()
            }}
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop !== 0) el.scrollTop = 0
              if (el.scrollLeft !== 0) el.scrollLeft = 0
            }}
            onTouchMoveCapture={(e) => {
              e.stopPropagation()
            }}
            onMouseDownCapture={(e) => {
              e.stopPropagation()
            }}
            onBlur={(e) => {
              if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
              commit()
            }}
            onKeyDown={onKeyDown}
            placeholder="输入文字…"
            wrap="off"
            style={{
              ...textStyle,
              display: 'block',
              width: '100%',
              height: 'auto',
              minHeight: MIN_H - PAD_TOTAL,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              overflow: 'hidden',
              padding: 0,
              margin: 0,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </>
      ) : (
        <div
          style={{
            ...textStyle,
            minHeight: MIN_H - PAD_TOTAL,
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            color: label ? textColor : '#94a3b8',
          }}
        >
          {label || '双击编辑文字'}
        </div>
      )}
    </div>
  )
}
