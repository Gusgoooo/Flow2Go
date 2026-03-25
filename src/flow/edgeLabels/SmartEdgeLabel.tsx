import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { EdgeLabelRenderer, useReactFlow, useStore, type ReactFlowState } from '@xyflow/react'
import {
  initialCollisionState,
  resolveEdgeLabelCollisions,
  type CollisionLabelSpec,
} from './edgeLabelCollision'
import type { EdgeLabelAnchors, EdgeLabelCollisionState, EdgeLabelPlacement, FlowRect, SmartEdgeLabelProps } from './types'
import { getNodeExclusionBoxes } from '../layout/routing/exclusion'

type RegistryEntry = {
  id: string
  getElement: () => HTMLElement | null
  anchors: EdgeLabelAnchors
  preferred: EdgeLabelPlacement
  manual: { x: number; y: number }
  enabled: boolean
}

type EdgeLabelLayoutFullContext = {
  getResolved: (id: string, preferred: EdgeLabelPlacement) => EdgeLabelCollisionState
  register: (entry: RegistryEntry) => void
  unregister: (id: string) => void
  /** 锚点/文案等变化时触发，使避让重新计算（不依赖整条边的 zustand 引用） */
  bumpLayout: () => void
}

const EdgeLabelLayoutContext = createContext<EdgeLabelLayoutFullContext | null>(null)

function noopRegister(entry: RegistryEntry) {
  void entry
}
function noopUnregister(id: string) {
  void id
}
function noopBump() {}

function buildNodeObstacles(nodes: Array<any>): FlowRect[] {
  // 复用路由使用的包络盒，避免 label 避让时节点尺寸估计偏小导致“明明重叠却没避开”。
  const boxes = getNodeExclusionBoxes(nodes)
  return boxes.map((b) => ({
    left: b.x,
    top: b.y,
    right: b.x + b.width,
    bottom: b.y + b.height,
  }))
}

function selectLayoutTrigger(s: ReactFlowState) {
  return {
    tx: s.transform[0],
    ty: s.transform[1],
    zoom: s.transform[2],
    edgeSig: s.edges
      .map(
        (e) =>
          `${e.id}:${String(e.label ?? '')}:${JSON.stringify((e.data as { labelLayout?: unknown })?.labelLayout ?? {})}`,
      )
      .join('|'),
    nodeSig: s.nodes
      .map((n) => {
        const na = n as any
        return `${n.id}:${n.type ?? ''}:${n.parentId ?? ''}:${n.hidden ? 1 : 0}:${n.position?.x ?? 0}:${n.position?.y ?? 0}:${
          na.positionAbsolute?.x ?? ''
        }:${na.positionAbsolute?.y ?? ''}:${n.measured?.width ?? n.width ?? ''}:${n.measured?.height ?? n.height ?? ''}`
      })
      .join('|'),
  }
}

/**
 * 放在 ReactFlow 内部。收集标签 DOM 尺寸并在 flow 坐标系下做轻量避让。
 */
function collisionMapsEqual(
  a: Map<string, EdgeLabelCollisionState>,
  b: Map<string, EdgeLabelCollisionState>,
): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    const o = b.get(k)
    if (!o || o.nudgeX !== v.nudgeX || o.nudgeY !== v.nudgeY || o.activeAnchor !== v.activeAnchor) return false
  }
  return true
}

export function EdgeLabelLayoutProvider({ children }: { children: ReactNode }) {
  const rf = useReactFlow()
  const layoutTrigger = useStore(selectLayoutTrigger)
  const registryRef = useRef(new Map<string, RegistryEntry>())
  const [collisionMap, setCollisionMap] = useState(() => new Map<string, EdgeLabelCollisionState>())
  const [layoutEpoch, setLayoutEpoch] = useState(0)

  const register = useCallback((entry: RegistryEntry) => {
    registryRef.current.set(entry.id, entry)
  }, [])

  const unregister = useCallback((id: string) => {
    registryRef.current.delete(id)
  }, [])

  const bumpLayout = useCallback(() => {
    setLayoutEpoch((n) => n + 1)
  }, [])

  // 必须在 layout 后读取各 label 的 getBoundingClientRect；此处更新避让状态属于合法模式
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    const entries = [...registryRef.current.values()].filter((e) => e.enabled)
    if (entries.length === 0) {
      setCollisionMap(new Map())
      return
    }
    const obstacleRects = buildNodeObstacles(rf.getNodes())

    const sizes = new Map<string, { w: number; h: number }>()
    for (const e of entries) {
      const el = e.getElement()
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const p1 = rf.screenToFlowPosition({ x: r.left, y: r.top })
      const p2 = rf.screenToFlowPosition({ x: r.right, y: r.bottom })
      const w = Math.max(4, Math.abs(p2.x - p1.x))
      const h = Math.max(4, Math.abs(p2.y - p1.y))
      sizes.set(e.id, { w, h })
    }

    setCollisionMap((prev) => {
      const specs: CollisionLabelSpec[] = []
      for (const e of entries) {
        if (!sizes.has(e.id)) continue
        const preferred = e.preferred
        const base = prev.get(e.id) ?? initialCollisionState(preferred)
        specs.push({
          id: e.id,
          preferred,
          anchors: e.anchors,
          manual: e.manual,
          state: base,
        })
      }
      if (specs.length === 0) return prev.size === 0 ? prev : new Map()
      const next = resolveEdgeLabelCollisions(specs, sizes, 12, obstacleRects)
      return collisionMapsEqual(prev, next) ? prev : next
    })
  }, [layoutTrigger, rf, layoutEpoch])
  /* eslint-enable react-hooks/set-state-in-effect */

  const value = useMemo<EdgeLabelLayoutFullContext>(
    () => ({
      getResolved: (id: string, preferred: EdgeLabelPlacement) =>
        collisionMap.get(id) ?? initialCollisionState(preferred),
      register,
      unregister,
      bumpLayout,
    }),
    [collisionMap, register, unregister, bumpLayout],
  )

  return <EdgeLabelLayoutContext.Provider value={value}>{children}</EdgeLabelLayoutContext.Provider>
}

function useEdgeLabelLayout(): EdgeLabelLayoutFullContext {
  const v = useContext(EdgeLabelLayoutContext)
  if (!v) {
    return {
      getResolved: (id: string, preferred: EdgeLabelPlacement) => {
        void id
        return initialCollisionState(preferred)
      },
      register: noopRegister,
      unregister: noopUnregister,
      bumpLayout: noopBump,
    }
  }
  return v
}

function computeLabelCenter(
  anchors: EdgeLabelAnchors,
  preferred: EdgeLabelPlacement,
  manual: { x: number; y: number },
  collision: EdgeLabelCollisionState,
): { x: number; y: number } {
  if (preferred === 'manual') {
    return {
      x: anchors.center.x + manual.x + collision.nudgeX,
      y: anchors.center.y + manual.y + collision.nudgeY,
    }
  }
  const a = anchors[collision.activeAnchor]
  return {
    x: a.x + collision.nudgeX,
    y: a.y + collision.nudgeY,
  }
}

export function SmartEdgeLabel(props: SmartEdgeLabelProps) {
  const {
    edgeId,
    anchors,
    labelLayout,
    labelStyle,
    text,
    editing,
    editChildren,
    showWhenEmpty,
    zIndex = 1000,
    className,
    style,
    pointerEvents = 'all',
    onPointerDown,
    onDoubleClick,
    maxLabelWidth = 168,
    textOnly = false,
  } = props

  const { getResolved, register, unregister, bumpLayout } = useEdgeLabelLayout()

  /** 默认沿路径中点；重叠时由 edgeLabelCollision 切换 head/tail 或 nudge */
  const preferred: EdgeLabelPlacement = labelLayout?.placement ?? 'center'
  const manual = useMemo(
    () => ({ x: labelLayout?.offsetX ?? 0, y: labelLayout?.offsetY ?? 0 }),
    [labelLayout?.offsetX, labelLayout?.offsetY],
  )

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const collision = getResolved(edgeId, preferred)
  const { x: cx, y: cy } = computeLabelCenter(anchors, preferred, manual, collision)

  const enabled = editing || Boolean(text?.trim()) || Boolean(showWhenEmpty)

  const anchorKey = useMemo(() => JSON.stringify(anchors), [anchors])
  const regSig = `${anchorKey}|${text ?? ''}|${manual.x}|${manual.y}|${preferred}|${editing ? 1 : 0}`
  const prevRegSig = useRef('')

  useLayoutEffect(() => {
    const entry: RegistryEntry = {
      id: edgeId,
      getElement: () => wrapperRef.current,
      anchors,
      preferred,
      manual,
      enabled,
    }
    register(entry)
    if (prevRegSig.current !== regSig) {
      prevRegSig.current = regSig
      bumpLayout()
    }
    return () => {
      unregister(edgeId)
    }
  }, [register, unregister, bumpLayout, edgeId, regSig, enabled, anchors, preferred, manual, text, editing])

  const fontSize = labelStyle?.fontSize ?? 12
  const fontWeight = labelStyle?.fontWeight ?? '400'
  const color = labelStyle?.color ?? 'rgba(0,0,0,0.88)'

  if (!editing && !text?.trim() && !showWhenEmpty) return null

  return (
    <EdgeLabelRenderer>
      <div
        ref={wrapperRef}
        className={className}
        data-flow2go-edge-label={edgeId}
        style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${cx}px,${cy}px)`,
          pointerEvents,
          zIndex,
          ...style,
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        {editing ? (
          editChildren
        ) : (
          <div
            title={text}
            style={{
              maxWidth: maxLabelWidth,
              padding: textOnly ? '0' : '4px 10px',
              borderRadius: textOnly ? 0 : 8,
              background: textOnly ? 'transparent' : 'rgba(255,255,255,0.5)',
              backdropFilter: textOnly ? 'none' : 'blur(2px)',
              WebkitBackdropFilter: textOnly ? 'none' : 'blur(2px)',
              border: textOnly ? 'none' : '1px solid rgba(148,163,184,0.55)',
              boxShadow: textOnly ? 'none' : '0 1px 3px rgba(15,23,42,0.08)',
              fontSize,
              fontWeight,
              color,
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: 'default',
            }}
          >
            {text}
          </div>
        )}
      </div>
    </EdgeLabelRenderer>
  )
}
