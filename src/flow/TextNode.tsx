import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { QuickTextStyleToolbar, QUICK_TOOLBAR_DATA_ATTR } from './QuickTextStyleToolbar'

export type TextNodeData = {
  label?: string
  labelFontSize?: number
  labelFontWeight?: string
  labelColor?: string
}

const DEFAULT_FONT_SIZE = 14

export function TextNode(props: NodeProps) {
  const data = (props.data ?? {}) as TextNodeData
  const rf = useReactFlow()
  const selected = (props as any).selected

  const isNew = (data.label ?? '').trim() === ''
  const [editing, setEditing] = useState(() => isNew)
  const [draft, setDraft] = useState(data.label ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
    setEditing(true)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Enter or Cmd/Ctrl+Enter to commit, plain Enter for newline
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

  return (
    <div
      style={{
        minWidth: 60,
        minHeight: 24,
        padding: 4,
        position: 'relative',
        cursor: editing ? 'text' : 'default',
      }}
      onDoubleClick={onDoubleClick}
      className={editing ? 'nodrag' : ''}
    >
      <NodeResizer
        minWidth={60}
        minHeight={24}
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
            placeholder="输入文字..."
            style={{
              ...textStyle,
              width: '100%',
              height: '100%',
              minHeight: 24,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              padding: 0,
              margin: 0,
              fontFamily: 'inherit',
            }}
          />
        </>
      ) : (
        <div
          style={{
            ...textStyle,
            minHeight: 20,
            color: label ? textColor : '#94a3b8',
          }}
        >
          {label || '双击编辑文字'}
        </div>
      )}
    </div>
  )
}
