import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

export type TextNodeData = {
  label?: string
  labelFontSize?: number
  labelFontWeight?: string
  labelColor?: string
}

const DEFAULT_FONT_SIZE = 14
const PAD = 4
const PAD_TOTAL = PAD * 2
const MIN_W = 60
const MIN_H = 24

export function TextNode(props: NodeProps) {
  const data = (props.data ?? {}) as TextNodeData
  const rf = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const selected = (props as any).selected

  const isNew = (data.label ?? '').trim() === ''
  const [editing, setEditing] = useState(() => isNew)
  const [draft, setDraft] = useState(data.label ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  /** 用户用 NodeResizer 拖过则保持其尺寸，避免展示态把框「缩回去」；进入编辑时重新跟随内容 */
  const manualSizingRef = useRef(false)
  const lastAppliedRef = useRef({ w: 0, h: 0 })

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
    manualSizingRef.current = false
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
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  }

  const measureMirrorStyle: React.CSSProperties = {
    ...textStyle,
    position: 'absolute',
    left: -9999,
    top: 0,
    visibility: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    boxSizing: 'border-box',
    padding: 0,
    margin: 0,
    fontFamily: 'inherit',
    overflow: 'hidden',
  }

  // 按「当前内容区宽度」测量软折行后的高度，外框增高而不是 textarea 内部滚动（与 textarea 布局一致）
  useLayoutEffect(() => {
    if (!measureRef.current) return
    if (!editing && manualSizingRef.current) return

    const raw = editing ? draft : label
    const el = measureRef.current
    el.textContent = raw.length > 0 ? raw : '\u200b'

    const nodeOuterW = typeof props.width === 'number' && props.width > 0 ? props.width : MIN_W
    let innerW = Math.max(1, nodeOuterW - PAD_TOTAL)
    el.style.width = `${innerW}px`

    let mh = el.scrollHeight
    let sw = el.scrollWidth
    // 极长无空格串等：需要放宽宽度，否则会出现横向裁剪/滚动
    if (sw > innerW + 1) {
      innerW = Math.ceil(sw)
      el.style.width = `${innerW}px`
      mh = el.scrollHeight
    }

    const w = Math.max(MIN_W, Math.ceil(innerW + PAD_TOTAL))
    const h = Math.max(MIN_H, Math.ceil(mh + PAD_TOTAL))

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

      <NodeResizer
        minWidth={MIN_W}
        minHeight={MIN_H}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 9999,
          background: '#3b82f6',
          border: '2px solid #fff',
        }}
        lineStyle={{
          border: '1px dashed #3b82f6',
        }}
        isVisible={selected}
        onResizeEnd={() => {
          manualSizingRef.current = true
        }}
      />

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
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              if ((e.relatedTarget as HTMLElement)?.closest?.(`[${QUICK_TOOLBAR_DATA_ATTR}]`)) return
              commit()
            }}
            onKeyDown={onKeyDown}
            placeholder="输入文字…"
            style={{
              ...textStyle,
              display: 'block',
              width: '100%',
              height: '100%',
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
