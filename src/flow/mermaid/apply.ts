import type { Edge, Node } from '@xyflow/react'
import { autoLayoutDagre } from '../dagreLayout'
import {
  doesPolylineIntersectAnyExclusionBox,
  getNodeExclusionBoxes,
} from '../layout/routing/exclusion'
import { buildPolylineSignature } from '../layout/routing/polylineUtils'
import { layoutMindMapMindElixirStyle } from '../mindMap/mindElixirLayout'
import { autoLayoutSwimlane } from '../swimlaneLayout'
import { GRID_UNIT, normalizeNodeGeometryToGrid, normalizeWaypointsToGrid } from '../grid'
import type { FlowDirection, GraphBatchPayload, GraphOperation } from './types'

export type ApplyMermaidContext = {
  /**
   * 这里接你项目现有的图操作能力。
   * 优先复用已有：
   * - pushHistory
   * - addFrameAtPosition
   * - setNodes / setEdges
   * - autoLayout
   * - batch apply
   */
  graph: {
    batch?: (args: { reason: string; operations: GraphOperation[] }) => void | Promise<void>
    applyOperation?: (op: GraphOperation) => void | Promise<void>
  }
}

export type Flow2GoSnapshot = {
  nodes: Array<Node<any>>
  edges: Array<Edge<any>>
}

export type ApplyToFlow2GoContext = {
  /** 当前画布（用于 replace=false 时合并） */
  getSnapshot: () => Flow2GoSnapshot
  /** 应用后的画布状态 */
  setSnapshot: (next: Flow2GoSnapshot) => void
  /** 一次性入历史栈 */
  pushHistory: (next: Flow2GoSnapshot, reason: string) => void
}

export async function applyGraphBatchPayload(
  payload: GraphBatchPayload,
  ctx: ApplyMermaidContext
): Promise<void> {
  if (ctx.graph.batch) {
    await ctx.graph.batch({
      reason: 'ai-apply',
      operations: payload.operations,
    })
    return
  }

  if (!ctx.graph.applyOperation) {
    throw new Error(
      'No graph.batch or graph.applyOperation implementation found in ApplyMermaidContext',
    )
  }

  for (const op of payload.operations) {
    await ctx.graph.applyOperation(op)
  }
}

function dirToLayoutDirection(dir: FlowDirection) {
  // Dagre rankdir 映射 LR/TB/RL/BT
  return dir as any
}

/** 与 GroupNode 泳道标题一致；泳道 createFrame 时强制使用，避免沿用 frame 默认 #64748b */
const DEFAULT_LANE_TITLE_TEXT_COLOR = '#334155'

function frameDefaults(title: string) {
  return {
    width: 640,
    height: 416,
    data: {
      title,
      stroke: '#e2e8f0',
      strokeWidth: 1,
      fill: 'rgba(226, 232, 240, 0.20)',
      titleFontSize: 14,
      titleColor: '#64748b',
      role: 'frame',
    },
  }
}

const LAYOUT_UNIT = 24
const LEGACY_COMPACT_INNER_UNIT = 12
const NODE_MIN_WIDTH_UNITS = 3
const LEGACY_COMPACT_CHAPTER_W_70 = LAYOUT_UNIT * 70
const LEGACY_COMPACT_CHAPTER_W_90 = LAYOUT_UNIT * 90
const LEGACY_COMPACT_CHAPTER_W_120 = LAYOUT_UNIT * 120
const LEGACY_COMPACT_CHAPTER_W_140 = LAYOUT_UNIT * 140
const TOP_FRAME_THEME_COLORS = ['#4d9ef5', '#33d8ea', '#c059ff', '#ff6cc4']

function hexToRgba(hex: string, alpha: number) {
  const t = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(t)) return `rgba(59, 130, 246, ${alpha})`
  const full = t.length === 3 ? `${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}` : t
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function quadDefaults(title: string, shape: 'rect' | 'circle' | 'diamond' | undefined) {
  return {
    width: 160,
    height: 48,
    data: {
      title,
      label: title,
      shape: shape ?? 'rect',
    },
  }
}

const SEMANTIC_END_NODE_FILL = 'rgba(226, 232, 240, 0.8)'
const SEMANTIC_DECISION_NODE_FILL = '#FFB100'

function withSemanticNodeStyleDefaults(
  rawStyle: Record<string, any>,
  opts?: { skipPresetSemanticColors?: boolean },
): Record<string, any> {
  const next = { ...rawStyle }
  const semantic = String(rawStyle.semanticType ?? '').toLowerCase()
  const hasUserFill = typeof next.color === 'string' && next.color.trim().length > 0
  const hasUserStrokeWidth = typeof next.strokeWidth === 'number' && Number.isFinite(next.strokeWidth)
  const skipColor = opts?.skipPresetSemanticColors

  if (semantic === 'end' && !hasUserFill && !skipColor) {
    next.color = SEMANTIC_END_NODE_FILL
  }
  if (semantic === 'decision') {
    if (!hasUserFill && !skipColor) next.color = SEMANTIC_DECISION_NODE_FILL
    if (!hasUserStrokeWidth) next.strokeWidth = 0
  }
  return next
}

function normalizeNodesForGrid(nodes: Array<Node<any>>): Array<Node<any>> {
  return nodes.map((n) => normalizeNodeGeometryToGrid(n) as Node<any>)
}

function normalizeEdgesForGrid(edges: Array<Edge<any>>): Array<Edge<any>> {
  return edges.map((e) => {
    const waypoints = ((e.data ?? {}) as any)?.waypoints as Array<{ x: number; y: number }> | undefined
    if (!Array.isArray(waypoints) || waypoints.length === 0) return e
    return {
      ...e,
      data: {
        ...(e.data ?? {}),
        waypoints: normalizeWaypointsToGrid(waypoints),
      },
    }
  })
}

async function layoutWithinFrame(
  allNodes: Array<Node<any>>,
  allEdges: Array<Edge<any>>,
  frameId: string,
  direction: FlowDirection,
) {
  const children = allNodes.filter((n) => n.parentId === frameId)
  if (children.length === 0) return allNodes
  const childIds = new Set(children.map((n) => n.id))
  const internalEdges = allEdges.filter((e) => childIds.has(e.source) && childIds.has(e.target))
  const laid = await autoLayoutDagre(children, internalEdges as any, dirToLayoutDirection(direction))
  const byId = new Map(laid.map((n) => [n.id, n.position]))
  return allNodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n))
}

async function layoutTopLevel(
  allNodes: Array<Node<any>>,
  allEdges: Array<Edge<any>>,
  direction: FlowDirection,
) {
  const top = allNodes.filter((n) => !n.parentId)
  if (top.length === 0) return allNodes
  const topIds = new Set(top.map((n) => n.id))
  const subEdges = allEdges.filter((e) => topIds.has(e.source) && topIds.has(e.target))
  const laid = await autoLayoutDagre(top, subEdges as any, dirToLayoutDirection(direction))
  const byId = new Map(laid.map((n) => [n.id, n.position]))
  return allNodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n))
}

function wrapFramesToContents(allNodes: Array<Node<any>>, compactLegacyMode: boolean) {
  const TITLE_H = 32
  const MIN_W_DEFAULT = 224
  const MIN_H = 144
  const UNIT = compactLegacyMode ? LEGACY_COMPACT_INNER_UNIT : LAYOUT_UNIT
  const HALF_UNIT = Math.max(1, Math.round(UNIT * 0.5))
  const FRAME_GAP = HALF_UNIT
  const MIN_NODE_W = Math.round(UNIT * NODE_MIN_WIDTH_UNITS)
  const NODE_GAP = HALF_UNIT
  const MAX_COLS = compactLegacyMode ? 6 : 6

  const nodeById = new Map(allNodes.map((n) => [n.id, n]))
  const childrenByParent = new Map<string, Array<Node<any>>>()
  for (const n of allNodes) {
    if (!n.parentId) continue
    const arr = childrenByParent.get(n.parentId) ?? []
    arr.push(n)
    childrenByParent.set(n.parentId, arr)
  }

  const isFrame = (n: Node<any>) => n.type === 'group' && (n.data as any)?.role === 'frame'

    const resizeQuadChildrenToWidth = (container: Node<any>, targetW: number) => {
      if (!container?.id) return
      const quads = (childrenByParent.get(container.id) ?? []).filter((n) => n.type === 'quad') as Array<Node<any>>
      if (quads.length === 0) return
      for (const q of quads) {
        q.width = targetW
        q.style = { ...(q.style as any), width: targetW }
        ;(q as any).measured = undefined
      }
    }

  // Legacy compact frame mode: chapter width is unified by the largest bucket.
  // Rule:
  // - Top-level chapter chooses width tier by (direct child frames, grandchild frames).
  // - Global chapter width is unified to the MAX tier across all top-level chapters.
  //
  // Tier thresholds (default):
  // - directChildFrames <= 2 => 30
  // - directChildFrames == 3:
  //   - grandchildFrames == 0 => 50
  //   - grandchildFrames 1..2 => 70  (3 子画框且子画框还包含子画框，原 50 容易不够)
  //   - grandchildFrames 3..5 => 90
  //   - grandchildFrames >= 6 => 120
  const calcBusinessUnifiedTopChapterWidth = (): number => {
    const topFrames = allNodes.filter((n) => isFrame(n) && !n.parentId)

    // Leaf required width is derived from:
    // - innermost frame's quad layout uses 2 columns
    // - each column cell width target is 1.5 "units"
    //
    // We then propagate this minimum to parent frames based on how they tile child frames
    // (cols = min(3, childFrames.length)).
    //
    // This avoids the previous overestimation that caused too often selecting the max tier.
    const targetNodeCellW = UNIT * 3
    const leafCols = 2
    const leafAvailableWRequired = (leafCols - 1) * NODE_GAP + leafCols * targetNodeCellW
    const BASE_LEAF_FRAME_W = leafAvailableWRequired + 2 * HALF_UNIT

    const memo = new Map<string, number>()
    const visiting = new Set<string>()

    const requiredWidthForFrame = (frameId: string): number => {
      const cached = memo.get(frameId)
      if (cached != null) return cached
      if (visiting.has(frameId)) {
        // Defensive: break potential cycles; fall back to base.
        return BASE_LEAF_FRAME_W
      }
      visiting.add(frameId)

      const childFrames = (childrenByParent.get(frameId) ?? []).filter(isFrame)
      if (childFrames.length === 0) {
        memo.set(frameId, BASE_LEAF_FRAME_W)
        visiting.delete(frameId)
        return BASE_LEAF_FRAME_W
      }

      // layoutBusinessFrame places direct child frames with:
      // cols = min(3, childFrames.length), and each child frame width ~= cellW.
      const cols = Math.max(1, Math.min(3, childFrames.length))
      const requiredChildW = Math.max(...childFrames.map((cf) => requiredWidthForFrame(cf.id)))

      // parentW needs to satisfy:
      // cellW = floor((availableW - (cols - 1) * UNIT) / cols)
      // with availableW = parentW - 2 * padX, padX = UNIT.
      // => parentW >= 2*padX + (cols-1)*UNIT + cols*requiredChildW
      const padX = HALF_UNIT
      const parentW = 2 * padX + (cols - 1) * HALF_UNIT + cols * requiredChildW

      memo.set(frameId, parentW)
      visiting.delete(frameId)
      return parentW
    }

    let globalNeed = 0
    for (const chapter of topFrames) {
      globalNeed = Math.max(globalNeed, requiredWidthForFrame(chapter.id))
    }

    const tiers = [
      { w: LEGACY_COMPACT_CHAPTER_W_70, label: 70 },
      { w: LEGACY_COMPACT_CHAPTER_W_90, label: 90 },
      { w: LEGACY_COMPACT_CHAPTER_W_120, label: 120 },
      { w: LEGACY_COMPACT_CHAPTER_W_140, label: 140 },
    ]

    // 选择“最小可容纳档位”，避免无谓放大到更宽档。
    const firstFitIdx = tiers.findIndex((t) => t.w >= globalNeed)
    if (firstFitIdx === -1) return LEGACY_COMPACT_CHAPTER_W_140
    return tiers[firstFitIdx].w
  }
  const compactUnifiedTopChapterWidth = calcBusinessUnifiedTopChapterWidth()
  const getCompactChapterWidth = (isTop: boolean): number => (isTop ? compactUnifiedTopChapterWidth : LEGACY_COMPACT_CHAPTER_W_70)

  const frames = allNodes.filter(isFrame)

  const depthOf = (id: string) => {
    let d = 0
    let cur = nodeById.get(id)
    const seen = new Set<string>()
    while (cur?.parentId) {
      if (seen.has(cur.id)) break
      seen.add(cur.id)
      d += 1
      cur = nodeById.get(cur.parentId)
    }
    return d
  }

  // bottom-up so inner frames get sized before outer
  frames.sort((a, b) => depthOf(b.id) - depthOf(a.id))

  const chooseCols = (count: number) => Math.max(1, Math.min(MAX_COLS, Math.ceil(Math.sqrt(count))))

  const stretchChildrenToWidth = (
    parentW: number,
    padX: number,
    items: Array<Node<any>>,
    originY: number,
    stretchWidth: boolean,
  ) => {
    const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id))
    if (ordered.length === 0) return { maxBottom: originY }
    const cols = chooseCols(ordered.length)
    const availableW = Math.max(1, parentW - padX * 2)
    const gap = compactLegacyMode ? HALF_UNIT : UNIT
    const cellW = Math.max(MIN_NODE_W, Math.floor((availableW - (cols - 1) * gap) / cols))
    let maxBottom = originY
    for (let i = 0; i < ordered.length; i += 1) {
      const it = ordered[i]
      const { h } = getNodeSize(it)
      const col = i % cols
      const row = Math.floor(i / cols)
      // Important: do not stretch child frame width at parent level.
      // Nodes should always stretch in their direct parent's coordinate system.
      if (stretchWidth) {
        it.width = cellW
        it.style = { ...(it.style as any), width: cellW }
        // Ensure later bounds calculations use the updated width.
        ;(it as any).measured = undefined
      }
      it.position = { x: col * (cellW + gap), y: originY + row * (h + gap) }
      maxBottom = Math.max(maxBottom, originY + row * (h + gap) + h)
    }
    return { maxBottom }
  }

  if (compactLegacyMode) {

    const isDescendantFrame = (ancestorId: string, nodeId: string): boolean => {
      let cur = nodeById.get(nodeId)
      const seen = new Set<string>()
      while (cur?.parentId) {
        if (seen.has(cur.id)) break
        seen.add(cur.id)
        if (cur.parentId === ancestorId) return true
        cur = nodeById.get(cur.parentId)
      }
      return false
    }

    const reparentFrame = (child: Node<any>, newParentId: string) => {
      const prevParentId = child.parentId
      if (!prevParentId || prevParentId === newParentId) return
      const prevArr = childrenByParent.get(prevParentId)
      if (prevArr) {
        const idx = prevArr.findIndex((n) => n.id === child.id)
        if (idx >= 0) prevArr.splice(idx, 1)
      }
      const nextArr = childrenByParent.get(newParentId) ?? []
      nextArr.push(child)
      childrenByParent.set(newParentId, nextArr)
      child.parentId = newParentId
    }

    // Hard constraint:
    // Never allow a parent frame to directly contain more than 2 child frames.
    // If exceeded, move extra child frames under the first two child frames in turn,
    // and iterate until every parent satisfies the cap.
    const enforceMaxNestedFrames = (rootFrameId: string, maxChildren = 3) => {
      const queue: string[] = [rootFrameId]
      const guard = new Set<string>()
      while (queue.length > 0) {
        const parentId = queue.shift()!
        const loopGuardKey = `${parentId}:${queue.length}`
        if (guard.has(loopGuardKey)) continue
        guard.add(loopGuardKey)

        const directFrames = (childrenByParent.get(parentId) ?? [])
          .filter(isFrame)
          .sort((a, b) => a.id.localeCompare(b.id))
        if (directFrames.length <= maxChildren) {
          for (const cf of directFrames) queue.push(cf.id)
          continue
        }

        const keepers = directFrames.slice(0, maxChildren)
        const extras = directFrames.slice(maxChildren)
        for (let i = 0; i < extras.length; i += 1) {
          const extra = extras[i]
          const preferred = keepers[i % keepers.length]
          const fallback = keepers[(i + 1) % keepers.length]
          const target =
            !isDescendantFrame(extra.id, preferred.id) && preferred.id !== extra.id
              ? preferred
              : !isDescendantFrame(extra.id, fallback.id) && fallback.id !== extra.id
                ? fallback
                : null
          if (!target) continue
          reparentFrame(extra, target.id)
        }

        // Re-check current parent and all its direct children after mutation.
        queue.push(parentId)
        const nextDirectFrames = (childrenByParent.get(parentId) ?? []).filter(isFrame)
        for (const cf of nextDirectFrames) queue.push(cf.id)
      }
    }

    const layoutBusinessFrame = (frame: Node<any>, forcedWidth: number | undefined) => {
      // 高密输入下放宽上限，避免过度重挂载导致宽度估计失真。
      enforceMaxNestedFrames(frame.id, 3)

      const kids = childrenByParent.get(frame.id) ?? []
      const childFrames = kids.filter(isFrame).sort((a, b) => a.id.localeCompare(b.id))
      const childNodes = kids.filter((k) => !isFrame(k)).sort((a, b) => a.id.localeCompare(b.id))

      const padX = HALF_UNIT
      const padBottom = HALF_UNIT
      const padTop = TITLE_H + Math.round(UNIT * 1.35)
      const isTop = !frame.parentId
      // Top chapter width is selected by the generated structure.
      // Nested frames follow the width allocated by their parent.
      // Non-top frames must strictly follow recursive parent allocation.
      // Avoid forcing MIN_W_DEFAULT here, otherwise shallow mixed nesting will break the "recursive unit width" contract.
      let targetW = isTop ? getCompactChapterWidth(true) : forcedWidth ?? MIN_W_DEFAULT
      const MAX_EXPAND_ROUNDS = 1
      for (let round = 0; round < MAX_EXPAND_ROUNDS; round += 1) {
        const availableW = Math.max(1, targetW - padX * 2)

        // 1) 先递归并布局子画框（优先横向平铺）
        let yCursor = 0
        if (childFrames.length > 0) {
          // 横向优先，超出后换行；每行最多3个子画框
          const cols = Math.max(1, Math.min(3, childFrames.length))
          const cellW = Math.max(MIN_NODE_W, Math.floor((availableW - (cols - 1) * FRAME_GAP) / cols))

          // 先把宽度下发给子画框，再递归布局子画框内部节点
          for (const cf of childFrames) {
            cf.width = cellW
            cf.style = { ...(cf.style as any), width: cellW }
            ;(cf as any).measured = undefined
            layoutBusinessFrame(cf, cellW)
          }

          // 再按子画框实际高度排版位置
          let maxBottom = 0
          for (let i = 0; i < childFrames.length; i += 1) {
            const cf = childFrames[i]
            const { h } = getNodeSize(cf)
            const col = i % cols
            const row = Math.floor(i / cols)
            const x = col * (cellW + FRAME_GAP)
            const y = row * (h + FRAME_GAP)
            cf.position = { x, y }
            maxBottom = Math.max(maxBottom, y + h)
          }
          yCursor = maxBottom
        }

        // 2) 再布局当前画框内的直接子节点（最多2列）
        if (childNodes.length > 0) {
          if (childFrames.length > 0) yCursor += HALF_UNIT
          // 节点统一采用竖向“倒N”排列：先上下，再换列（最多2行）
          const rows = Math.max(1, Math.min(2, childNodes.length))
          const cols = Math.max(1, Math.ceil(childNodes.length / rows))
          const cellW = Math.max(MIN_NODE_W, Math.floor((availableW - (cols - 1) * NODE_GAP) / cols))
          for (let i = 0; i < childNodes.length; i += 1) {
            const n = childNodes[i]
            const { h } = getNodeSize(n)
            const col = Math.floor(i / rows)
            const row = i % rows
            n.width = cellW
            n.style = { ...(n.style as any), width: cellW }
            ;(n as any).measured = undefined
            // If this direct child is a subgroup container, keep quads inside aligned with its width.
            // Otherwise quads may keep their default 160px width and ignore our min-unit shrink logic.
            resizeQuadChildrenToWidth(n, cellW)
            n.position = { x: col * (cellW + NODE_GAP), y: yCursor + row * (h + NODE_GAP) }
          }
        }

        // 3) 包裹当前画框并统一 padding（父级内部坐标系）
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const k of kids) {
          const { w, h } = getNodeSize(k)
          const x = k.position?.x ?? 0
          const y = k.position?.y ?? 0
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x + w)
          maxY = Math.max(maxY, y + h)
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
          frame.width = targetW
          frame.height = Math.max(MIN_H, TITLE_H + UNIT * 3)
          frame.style = { ...(frame.style as any), width: frame.width, height: frame.height }
          return
        }
        const contentW = maxX - minX
        const contentH = maxY - minY
        const neededW = Math.max(MIN_NODE_W + padX * 2, Math.ceil((contentW + padX * 2) * 1.06))
        const overflowX = neededW > targetW + 1

        if (overflowX && round < MAX_EXPAND_ROUNDS - 1) {
          const growStep = Math.max(UNIT * 4, Math.ceil((neededW - targetW) * 1.1))
          targetW = targetW + growStep
          continue
        }

        const nextW = Math.max(targetW, neededW)
        const nextH = Math.max(MIN_H, contentH + padTop + padBottom)
        const dx = -minX + padX
        const dy = -minY + padTop
        for (const k of kids) {
          k.position = { x: (k.position?.x ?? 0) + dx, y: (k.position?.y ?? 0) + dy }
        }
        frame.width = nextW
        frame.height = nextH
        frame.style = { ...(frame.style as any), width: nextW, height: nextH }
        return
      }
    }

    const topFrames = frames.filter((f) => !f.parentId).sort((a, b) => a.id.localeCompare(b.id))
    for (const tf of topFrames) {
      layoutBusinessFrame(tf, getCompactChapterWidth(true))
    }
    return allNodes
  }

  for (const f of frames) {
    const kids = childrenByParent.get(f.id) ?? []
    if (kids.length === 0) continue

    // Business mode:
    // - Frames are tiled horizontally (wrap rows if needed)
    // - Child nodes prefer vertical stacking; if >2 nodes, wrap into 2-row columns.
    //
    // Default mode: nested frames tile horizontally with wrap; nodes use a grid below frames.
    const childFrames = kids.filter(isFrame)
    const childNodes = kids.filter((k) => !isFrame(k))
    const isTop = !f.parentId
    // Business mode：UNIT=12px；普通流程图：UNIT=24px。均只用 1 个 UNIT 作内边距，不在此人为拉大顶层画框「章节感」；框间距交给 ELK 默认。
    const padX = compactLegacyMode ? HALF_UNIT : UNIT
    const padBottom = compactLegacyMode ? HALF_UNIT : UNIT
    const padTop = compactLegacyMode ? TITLE_H + Math.round(UNIT * 1.35) : TITLE_H + UNIT
    // Only top-level "chapter" frames should be clamped to the chapter width.
    // Inner frames must stay compact; otherwise horizontal padding becomes huge.
    // compute bounds AFTER any relayout to keep children in parent's local coordinate system
    const computeBounds = () => {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const k of kids) {
        const { w, h } = getNodeSize(k)
        const x = k.position?.x ?? 0
        const y = k.position?.y ?? 0
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + w)
        maxY = Math.max(maxY, y + h)
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
      return { minX, minY, maxX, maxY, contentW: maxX - minX, contentH: maxY - minY }
    }

    const initialBounds = computeBounds()
    if (!initialBounds) continue
    // Business mode:
    // - Top-level frames clamp to selected chapter width.
    // - Inner frames should follow recursive parent allocation; do not force MIN_W_DEFAULT.
    const minW = compactLegacyMode ? (isTop ? getCompactChapterWidth(true) : 0) : MIN_W_DEFAULT
    let nextW = Math.max(minW, initialBounds.contentW + padX * 2)
    let nextH = Math.max(MIN_H, initialBounds.contentH + padTop + padBottom)

    // Business mode: stable auto-stretch, no special-case math.
    // - Keep paddings/gaps uniform (1 unit)
    // - Stretch children to fill width under the same parent
    if (compactLegacyMode) {
      // Atomic rule v0:
      // When a frame directly contains exactly ONE node (no child frames),
      // clamp frame width to <= 26 grid units, and stretch the node to fill
      // remaining width with 0.5-grid-unit paddings on both sides.
      if (childFrames.length === 0 && childNodes.length === 1) {
        // Atomic rule v0 (single-node frame):
        // Only apply an upper clamp by selected global max tier.
        // The actual unit width must be derived from recursion + stretchChildrenToWidth,
        // not from an explicit "3 units first" rule.
        const curW =
          typeof f.width === 'number'
            ? (f.width as number)
            : Math.round(initialBounds.contentW + padX * 2)
        const targetW = Math.min(compactUnifiedTopChapterWidth, curW)
        f.width = targetW
        f.style = { ...(f.style as any), width: targetW }
        // Ensure the single quad node can reach the recursive min width (3 units).
        const n = childNodes[0]
        const nodeW = Math.max(MIN_NODE_W, targetW - padX * 2)
        n.width = nodeW
        n.style = { ...(n.style as any), width: nodeW }
        ;(n as any).measured = undefined
        // If this single child is a subgroup container, shrink quads inside too.
        resizeQuadChildrenToWidth(n, nodeW)
        nextW = targetW
      }

      let maxBottom = 0
      if (childFrames.length > 0) {
        const res = stretchChildrenToWidth(nextW, padX, childFrames, 0, false)
        maxBottom = Math.max(maxBottom, res.maxBottom)
      }
      if (childNodes.length > 0) {
        const res = stretchChildrenToWidth(
          nextW,
          padX,
          childNodes,
          childFrames.length > 0 ? maxBottom + (compactLegacyMode ? HALF_UNIT : UNIT) : 0,
          true,
        )
        maxBottom = Math.max(maxBottom, res.maxBottom)
      }
    }

    const bounds = computeBounds()
    if (!bounds) continue
    nextW = Math.max(nextW, bounds.contentW + padX * 2)
    nextH = Math.max(nextH, bounds.contentH + padTop + padBottom)

    // shift children into padded area (keep relative ordering).
    // When MIN_W expands frame width (common in single-column business blocks),
    // distribute extra horizontal slack evenly so left/right paddings stay symmetric.
    const extraX = Math.max(0, nextW - (bounds.contentW + padX * 2))
    const dx = -bounds.minX + padX + extraX / 2
    const dy = -bounds.minY + padTop
    for (const k of kids) {
      k.position = { x: (k.position?.x ?? 0) + dx, y: (k.position?.y ?? 0) + dy }
    }

    f.width = nextW
    f.height = nextH
    f.style = { ...(f.style as any), width: nextW, height: nextH }
  }

  return allNodes
}

function getNodeSize(n: Node<any>) {
  const w = n.measured?.width ?? n.width ?? (typeof (n.style as any)?.width === 'number' ? (n.style as any).width : undefined) ?? 160
  const h = n.measured?.height ?? n.height ?? (typeof (n.style as any)?.height === 'number' ? (n.style as any).height : undefined) ?? 48
  return { w, h }
}

function getAbsolutePosition(nodeId: string, nodeById: Map<string, Node<any>>) {
  let x = 0
  let y = 0
  let current = nodeById.get(nodeId)
  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    x += current.position?.x ?? 0
    y += current.position?.y ?? 0
    if (!current.parentId) break
    current = nodeById.get(current.parentId)
  }
  return { x, y }
}

function inferHandlesForEdge(
  sourceId: string,
  targetId: string,
  nodeById: Map<string, Node<any>>,
): { sourceHandle: string; targetHandle: string } | null {
  const s = nodeById.get(sourceId)
  const t = nodeById.get(targetId)
  if (!s || !t) return null

  const sAbs = getAbsolutePosition(sourceId, nodeById)
  const tAbs = getAbsolutePosition(targetId, nodeById)
  const sSize = getNodeSize(s)
  const tSize = getNodeSize(t)

  const sCx = sAbs.x + sSize.w / 2
  const sCy = sAbs.y + sSize.h / 2
  const tCx = tAbs.x + tSize.w / 2
  const tCy = tAbs.y + tSize.h / 2

  const dx = tCx - sCx
  const dy = tCy - sCy

  // Choose axis by dominant delta; ties prefer horizontal (usually better in LR/RL layouts)
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) return { sourceHandle: 's-right', targetHandle: 't-left' }
    return { sourceHandle: 's-left', targetHandle: 't-right' }
  }

  if (dy >= 0) return { sourceHandle: 's-bottom', targetHandle: 't-top' }
  return { sourceHandle: 's-top', targetHandle: 't-bottom' }
}

function isBidirectionalArrowEdge(edge: Edge<any>): boolean {
  const arrowStyle = String(((edge.data ?? {}) as any)?.arrowStyle ?? '').toLowerCase()
  if (arrowStyle === 'both') return true
  return Boolean(edge.markerStart && edge.markerEnd)
}

/**
 * Flowchart 特判（仅双向箭头）：
 * - 当两节点主要是左右关系（LR）时，优先用「上 -> 上」，避免出现左节点上连右节点下的“反直觉”折线。
 *   该规则与 source/target 顺序无关，仅依赖几何关系。
 */
function inferBidirectionalDiagonalHandlesForFlowchart(
  edge: Edge<any>,
  nodeById: Map<string, Node<any>>,
): { sourceHandle: string; targetHandle: string } | null {
  if (!isBidirectionalArrowEdge(edge)) return null
  const centers = getCenters(edge.source, edge.target, nodeById)
  if (!centers) return null
  const dx = centers.tCx - centers.sCx
  const dy = centers.tCy - centers.sCy
  const EPS = 1e-6
  if (Math.abs(dx) <= EPS || Math.abs(dy) <= EPS) return null
  // 仅在确实形成“对角”时触发（dx、dy 都非 0）。
  // 对于左右主导的场景，统一用 top/top 更符合流程图阅读习惯（两条双向边也更稳定）。
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { sourceHandle: 's-top', targetHandle: 't-top' }
  }
  // 上下主导时，维持同侧以减少穿越（左/右由左右相对位置决定）
  const side: 'left' | 'right' = centers.sCx < centers.tCx ? 'right' : 'left'
  return { sourceHandle: `s-${side}`, targetHandle: `t-${side}` }
}

type Side = 'top' | 'right' | 'bottom' | 'left'
type RoutePoint = { x: number; y: number }

function handleToSide(handleId: unknown): Side | null {
  if (typeof handleId !== 'string') return null
  if (handleId.endsWith('-top')) return 'top'
  if (handleId.endsWith('-right')) return 'right'
  if (handleId.endsWith('-bottom')) return 'bottom'
  if (handleId.endsWith('-left')) return 'left'
  return null
}

function sideToSourceHandle(side: Side) {
  return `s-${side}` as const
}

function sideToTargetHandle(side: Side) {
  return `t-${side}` as const
}

function oppositeSide(side: Side): Side {
  if (side === 'top') return 'bottom'
  if (side === 'bottom') return 'top'
  if (side === 'left') return 'right'
  return 'left'
}

function dominantSideFromDelta(dx: number, dy: number): Side {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function emptySideUsage(): Record<Side, number> {
  return { top: 0, right: 0, bottom: 0, left: 0 }
}

function chooseLeastUsedDistinctSide(
  preferred: Side,
  usage: Record<Side, number>,
  blocked?: Side,
): Side {
  const sequence: Side[] = [
    preferred,
    oppositeSide(preferred),
    'right',
    'left',
    'bottom',
    'top',
  ]
  const unique: Side[] = []
  for (const side of sequence) {
    if (blocked && side === blocked) continue
    if (!unique.includes(side)) unique.push(side)
  }
  let best = unique[0] ?? preferred
  let bestCount = usage[best] ?? 0
  for (const side of unique) {
    const count = usage[side] ?? 0
    if (count < bestCount) {
      best = side
      bestCount = count
    }
  }
  return best
}

const FLOW_ROUTE_LEAD = 24
const FLOW_ROUTE_SHIFT_STEP = 24
const FLOW_ROUTE_MAX_SHIFT_TRIES = 18

function shiftSequence(step: number, maxTries: number): number[] {
  const seq = [0]
  for (let i = 1; i <= maxTries; i += 1) {
    seq.push(i * step)
    seq.push(-i * step)
  }
  return seq
}

function withLead(p: RoutePoint, side: Side, lead: number): RoutePoint {
  if (side === 'left') return { x: p.x - lead, y: p.y }
  if (side === 'right') return { x: p.x + lead, y: p.y }
  if (side === 'top') return { x: p.x, y: p.y - lead }
  return { x: p.x, y: p.y + lead }
}

function simplifyPolyline(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= 2) return points
  const deduped: RoutePoint[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = deduped[deduped.length - 1]
    const cur = points[i]
    if (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(prev.y - cur.y) < 1e-6) continue
    deduped.push(cur)
  }
  if (deduped.length <= 2) return deduped
  const out: RoutePoint[] = [deduped[0]]
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const a = out[out.length - 1]
    const b = deduped[i]
    const c = deduped[i + 1]
    const collinearX = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6
    const collinearY = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6
    if (collinearX || collinearY) continue
    out.push(b)
  }
  out.push(deduped[deduped.length - 1])
  return out
}

function resolveHandlePoint(nodeId: string, side: Side, nodeById: Map<string, Node<any>>): RoutePoint | null {
  const n = nodeById.get(nodeId)
  if (!n) return null
  const abs = getAbsolutePosition(nodeId, nodeById)
  const size = getNodeSize(n)
  if (side === 'left') return { x: abs.x, y: abs.y + size.h / 2 }
  if (side === 'right') return { x: abs.x + size.w, y: abs.y + size.h / 2 }
  if (side === 'top') return { x: abs.x + size.w / 2, y: abs.y }
  return { x: abs.x + size.w / 2, y: abs.y + size.h }
}

function buildRoutePoints(
  sourcePoint: RoutePoint,
  targetPoint: RoutePoint,
  sourceSide: Side,
  targetSide: Side,
  shift: number,
  mode: 'auto' | 'horizontal' | 'vertical' = 'auto',
): RoutePoint[] {
  const srcLead = withLead(sourcePoint, sourceSide, FLOW_ROUTE_LEAD)
  const tgtLead = withLead(targetPoint, targetSide, FLOW_ROUTE_LEAD)
  const horizontalPair =
    (sourceSide === 'left' || sourceSide === 'right') &&
    (targetSide === 'left' || targetSide === 'right')
  const verticalPair =
    (sourceSide === 'top' || sourceSide === 'bottom') &&
    (targetSide === 'top' || targetSide === 'bottom')
  const mixedPair = !horizontalPair && !verticalPair

  const viaCorridorY = (corridorY: number) =>
    simplifyPolyline([
      sourcePoint,
      srcLead,
      { x: srcLead.x, y: corridorY },
      { x: tgtLead.x, y: corridorY },
      tgtLead,
      targetPoint,
    ])

  const viaCorridorX = (corridorX: number) =>
    simplifyPolyline([
      sourcePoint,
      srcLead,
      { x: corridorX, y: srcLead.y },
      { x: corridorX, y: tgtLead.y },
      tgtLead,
      targetPoint,
    ])

  const score = (pts: RoutePoint[]) => {
    let len = 0
    for (let i = 1; i < pts.length; i += 1) {
      len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y)
    }
    // 拐点更少优先，其次更短；避免“下右下右”这种多弯
    return pts.length * 1000 + len
  }

  // Mixed pair（如 s-bottom -> t-left）：
  // corridor 方案会“写死”一条中线并插入额外拐点，容易出现多弯且末段无法与 in 视觉合并。
  // 这里严格只生成正交路径，并优先让最后一段与 targetSide 对齐：
  // - targetSide 为 left/right：最后应水平进入 tgtLead → 优先 corridorX
  // - targetSide 为 top/bottom：最后应垂直进入 tgtLead → 优先 corridorY
  if (mixedPair) {
    // 先尝试「不带 lead」的单拐角 L 形路径：只要没有碰撞，这就是你期望的“向下再向右（或相反）”。
    // 注意：这里不强行拉出 24px lead，否则会把 L 形强拆成“下右下右”，用户也无法通过拖拽合并。
    const cornerVH: RoutePoint = { x: sourcePoint.x, y: targetPoint.y + shift }
    const cornerHV: RoutePoint = { x: targetPoint.x + shift, y: sourcePoint.y }
    const l1 = simplifyPolyline([sourcePoint, cornerVH, targetPoint])
    const l2 = simplifyPolyline([sourcePoint, cornerHV, targetPoint])

    const preferCorridorX = targetSide === 'left' || targetSide === 'right'
    const baseX = preferCorridorX ? tgtLead.x : srcLead.x
    const baseY = preferCorridorX ? srcLead.y : tgtLead.y

    const candA = preferCorridorX ? viaCorridorX(baseX + shift) : viaCorridorY(baseY + shift)
    const candB = preferCorridorX ? viaCorridorX(baseX - shift) : viaCorridorY(baseY - shift)
    const candC = preferCorridorX
      ? viaCorridorX((srcLead.x + tgtLead.x) / 2 + shift)
      : viaCorridorY((srcLead.y + tgtLead.y) / 2 + shift)
    const candD = preferCorridorX
      ? viaCorridorX((srcLead.x + tgtLead.x) / 2 - shift)
      : viaCorridorY((srcLead.y + tgtLead.y) / 2 - shift)

    if (mode === 'horizontal') {
      const bestL = score(l1) <= score(l2) ? l1 : l2
      const bestC = score(candA) <= score(candB) ? candA : candB
      return score(bestL) <= score(bestC) ? bestL : bestC
    }
    if (mode === 'vertical') {
      const bestL = score(l1) <= score(l2) ? l1 : l2
      const bestC = score(candC) <= score(candD) ? candC : candD
      return score(bestL) <= score(bestC) ? bestL : bestC
    }
    const all = [l1, l2, candA, candB, candC, candD]
    let best = all[0]
    let bestScore = score(best)
    for (const c of all) {
      const s = score(c)
      if (s < bestScore) {
        best = c
        bestScore = s
      }
    }
    return best
  }

  const useHorizontal =
    mode === 'horizontal' ||
    (mode === 'auto' &&
      (horizontalPair || (!verticalPair && Math.abs(srcLead.x - tgtLead.x) >= Math.abs(srcLead.y - tgtLead.y))))

  if (useHorizontal) {
    const corridorY = (srcLead.y + tgtLead.y) / 2 + shift
    return viaCorridorY(corridorY)
  }

  const corridorX = (srcLead.x + tgtLead.x) / 2 + shift
  return viaCorridorX(corridorX)
}

function getCenters(
  sourceId: string,
  targetId: string,
  nodeById: Map<string, Node<any>>,
): { sCx: number; sCy: number; tCx: number; tCy: number } | null {
  const s = nodeById.get(sourceId)
  const t = nodeById.get(targetId)
  if (!s || !t) return null
  const sAbs = getAbsolutePosition(sourceId, nodeById)
  const tAbs = getAbsolutePosition(targetId, nodeById)
  const sSize = getNodeSize(s)
  const tSize = getNodeSize(t)
  return {
    sCx: sAbs.x + sSize.w / 2,
    sCy: sAbs.y + sSize.h / 2,
    tCx: tAbs.x + tSize.w / 2,
    tCy: tAbs.y + tSize.h / 2,
  }
}

function scoreSideForVector(
  dx: number,
  dy: number,
  penalties: Partial<Record<Side, number>>,
): (side: Side) => number {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  const denom = ax + ay + 1e-6

  // Lower is better.
  return (side: Side) => {
    let base = 0
    if (side === 'right') {
      base += dx >= 0 ? 0 : 1
      base += ay / denom
    } else if (side === 'left') {
      base += dx <= 0 ? 0 : 1
      base += ay / denom
    } else if (side === 'bottom') {
      base += dy >= 0 ? 0 : 1
      base += ax / denom
    } else {
      base += dy <= 0 ? 0 : 1
      base += ax / denom
    }

    base += penalties[side] ?? 0
    return base
  }
}

function shouldPreferLeftToRightByComplexity(payload: GraphBatchPayload): boolean {
  const nodeCount = payload.operations.filter((op) => op.op === 'graph.createNodeQuad').length
  const edgeCount = payload.operations.filter((op) => op.op === 'graph.createEdge').length
  if (nodeCount <= 0) return false
  // 麻花风险兜底：边显著多于节点时，优先改为 LR，通常可减少交叉感。
  return edgeCount > Math.max(8, Math.floor(nodeCount * 1.2))
}

function applyInferredEdgeHandles(nodes: Array<Node<any>>, edges: Array<Edge<any>>) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const sides: Side[] = ['right', 'left', 'bottom', 'top']
  const rootFrameCache = new Map<string, string | null>()
  const getRootFrameId = (nodeId: string): string | null => {
    if (rootFrameCache.has(nodeId)) return rootFrameCache.get(nodeId) ?? null
    let cur = nodeById.get(nodeId)
    if (!cur) {
      rootFrameCache.set(nodeId, null)
      return null
    }
    let root: string | null = null
    const seen = new Set<string>()
    while (cur?.parentId) {
      if (seen.has(cur.id)) break
      seen.add(cur.id)
      root = cur.parentId
      cur = nodeById.get(cur.parentId)
    }
    rootFrameCache.set(nodeId, root)
    return root
  }

  // Occupancy maps:
  // - incomingByTargetSide: nodeId -> side -> count  (edges entering node)
  // - anySourceSide: nodeId -> side -> count (edges leaving node)
  const incomingByTargetSide = new Map<string, Record<Side, number>>()
  const anySourceSide = new Map<string, Record<Side, number>>()
  // Pair occupancy reduces repeated "same lane" overlaps between same source/target.
  const laneByPair = new Map<string, number>()
  // Undirected occupancy further reduces A<->B bi-direction overlaps.
  const laneByUndirectedPair = new Map<string, number>()
  // Swimlane decision 节点出边使用计数：用于分散拥堵，并保证 yes/no 分支不走同一 handle。
  const decisionOutUsage = new Map<string, Record<Side, number>>()
  const decisionBranchSideByLabel = new Map<string, { yes?: Side; no?: Side }>()

  const classifyDecisionBranch = (edge: Edge<any>): 'yes' | 'no' | null => {
    const text = typeof edge.label === 'string' ? edge.label.trim() : ''
    if (!text) return null
    const lower = text.toLowerCase()
    if (lower === 'yes' || /\byes\b/i.test(lower) || /(是|通过|同意|成功|允许|确认)/.test(text)) return 'yes'
    if (lower === 'no' || /\bno\b/i.test(lower) || /(否|不通过|不同意|失败|拒绝|取消)/.test(text)) return 'no'
    return null
  }

  const bump = (m: Map<string, Record<Side, number>>, id: string, side: Side) => {
    const rec = m.get(id) ?? { top: 0, right: 0, bottom: 0, left: 0 }
    rec[side] += 1
    m.set(id, rec)
  }

  // decision 节点 yes/no 出口：不再按 out-going 几何直接选 left/right，
  // 而是先根据“入边从哪个 handle 进来”推断分支坐标轴与 next 出口。
  //
  // 规则（仅 swimlane decision）：
  // - 左进（入边从 left 进入）=> yes/no 分别从 top/bottom 出；next 从 right 出
  // - 上进（入边从 top 进入）=> yes/no 分别从 left/right 出；next 从 bottom 出
  // 其余入边方向按对称关系补全：right-in => next-left, bottom-in => next-top
  const decisionIds = new Set(
    nodes
      .filter((n) => {
        const laneId = (n.data as any)?.laneId ?? n.parentId
        if (!laneId) return false
        const semantic = String((n.data as any)?.semanticType ?? '')
        const shape = String((n.data as any)?.shape ?? '')
        return semantic === 'decision' || shape === 'diamond'
      })
      .map((n) => n.id),
  )

  const decisionEntrySideCounts = new Map<string, Record<Side, number>>()
  for (const e of edges) {
    if (!decisionIds.has(e.target)) continue
    const centers = getCenters(e.source, e.target, nodeById)
    if (!centers) continue
    const dxIn = centers.tCx - centers.sCx
    const dyIn = centers.tCy - centers.sCy
    // from source -> decision vector：vector 指向 right => 边从 left 进入 decision
    const entrySide = oppositeSide(dominantSideFromDelta(dxIn, dyIn))
    bump(decisionEntrySideCounts, e.target, entrySide)
  }

  const decisionEntrySide = new Map<string, Side>()
  const tieOrder: Side[] = ['left', 'right', 'top', 'bottom']
  for (const id of decisionIds) {
    const rec = decisionEntrySideCounts.get(id) ?? { top: 0, right: 0, bottom: 0, left: 0 }
    let best: Side = tieOrder[0]
    let bestCount = rec[best] ?? 0
    for (const s of tieOrder) {
      const c = rec[s] ?? 0
      if (c > bestCount) {
        best = s
        bestCount = c
      }
    }
    // 没有任何入边时，默认按“左进”兜底（对应 next=right，yes/no=top/bottom）。
    decisionEntrySide.set(id, bestCount > 0 ? best : 'left')
  }

  type DecisionBranchMapping = { yes?: Side; no?: Side; next: Side }
  const decisionBranchMappingById = new Map<string, DecisionBranchMapping>()
  for (const decisionId of decisionIds) {
    const entry = decisionEntrySide.get(decisionId) ?? 'left'
    const nextSide = oppositeSide(entry)
    const axisIsY = entry === 'left' || entry === 'right' // 左进/右进 => top/bottom；上进/下进 => left/right

    const yesEdge = edges.find((e) => e.source === decisionId && classifyDecisionBranch(e) === 'yes')
    const noEdge = edges.find((e) => e.source === decisionId && classifyDecisionBranch(e) === 'no')

    let yesSide: Side | undefined
    let noSide: Side | undefined

    if (yesEdge && noEdge) {
      const yC = getCenters(decisionId, yesEdge.target, nodeById)
      const nC = getCenters(decisionId, noEdge.target, nodeById)
      if (yC && nC) {
        if (axisIsY) {
          // 上下由目标相对位置判断：y 更小者在 top。
          if (yC.tCy <= nC.tCy) {
            yesSide = 'top'
            noSide = 'bottom'
          } else {
            yesSide = 'bottom'
            noSide = 'top'
          }
        } else {
          // 左右由目标相对位置判断：x 更小者在 left。
          if (yC.tCx <= nC.tCx) {
            yesSide = 'left'
            noSide = 'right'
          } else {
            yesSide = 'right'
            noSide = 'left'
          }
        }
      }
    }

    if (!yesSide && yesEdge) {
      const yC = getCenters(decisionId, yesEdge.target, nodeById)
      if (yC) {
        if (axisIsY) yesSide = yC.tCy <= yC.sCy ? 'top' : 'bottom'
        else yesSide = yC.tCx <= yC.sCx ? 'left' : 'right'
      }
    }
    if (!noSide && noEdge) {
      const nC = getCenters(decisionId, noEdge.target, nodeById)
      if (nC) {
        if (axisIsY) noSide = nC.tCy <= nC.sCy ? 'top' : 'bottom'
        else noSide = nC.tCx <= nC.sCx ? 'left' : 'right'
      }
    }

    decisionBranchMappingById.set(decisionId, { yes: yesSide, no: noSide, next: nextSide })
  }

  return edges.map((e) => {
    const dataTyped = (e.data ?? {}) as {
      semanticType?: unknown
      waypoints?: unknown
      autoGeneratedSwimlane?: unknown
      layoutProfile?: unknown
    }
    const isSwimlaneEdge = dataTyped.semanticType != null
    const isAutoGeneratedSwimlane = isSwimlaneEdge && dataTyped.autoGeneratedSwimlane === true
    const isSwimlaneLayoutEdge = isSwimlaneEdge && (isAutoGeneratedSwimlane || dataTyped.layoutProfile === 'swimlane')
    const hasSavedWaypoints = Array.isArray(dataTyped.waypoints) && dataTyped.waypoints.length > 0
    // If a cross-lane route already has explicit waypoints, changing handles can desync the path.
    // So: only enforce handle cap when we can safely rely on auto-routing.
    const enforceHandleCap = isSwimlaneEdge && !hasSavedWaypoints && !isAutoGeneratedSwimlane
    const maxEdgesPerHandleSide = 3

    const existingSourceHandle = (e as any).sourceHandle as unknown
    const existingTargetHandle = (e as any).targetHandle as unknown
    const existingSrcSide = handleToSide(existingSourceHandle)
    const existingTgtSide = handleToSide(existingTargetHandle)

    const totalOnNodeSide = (nodeId: string, side: Side): number => {
      const inc = incomingByTargetSide.get(nodeId)?.[side] ?? 0
      const out = anySourceSide.get(nodeId)?.[side] ?? 0
      return inc + out
    }

    const centers = getCenters(e.source, e.target, nodeById)
    if (!centers) {
      const fallback = inferHandlesForEdge(e.source, e.target, nodeById)
      if (!fallback) return e
      return { ...e, sourceHandle: fallback.sourceHandle, targetHandle: fallback.targetHandle }
    }

    const dx = centers.tCx - centers.sCx
    const dy = centers.tCy - centers.sCy
    const srcNode = nodeById.get(e.source)
    const srcSemantic = String((srcNode?.data as any)?.semanticType ?? '')
    const srcShape = String((srcNode?.data as any)?.shape ?? '')
    const srcLaneId = (srcNode?.data as any)?.laneId ?? srcNode?.parentId
    const srcIsSwimlaneDecision =
      isSwimlaneLayoutEdge &&
      Boolean(srcLaneId) &&
      (srcSemantic === 'decision' || srcShape === 'diamond')
    let forcedDecisionSourceSide: Side | null = null
    const decisionBranch = srcIsSwimlaneDecision ? classifyDecisionBranch(e) : null
    if (srcIsSwimlaneDecision) {
      // 用入边推断的 yes/no 出口映射强制 decision 出边 handle。
      const mapping = decisionBranchMappingById.get(e.source)
      const entryFallback = decisionEntrySide.get(e.source) ?? 'left'
      const nextFallback = oppositeSide(entryFallback)
      if (decisionBranch === 'yes') forcedDecisionSourceSide = mapping?.yes ?? 'top'
      else if (decisionBranch === 'no') forcedDecisionSourceSide = mapping?.no ?? 'bottom'
      else {
        // 无 label（decisionBranch=null）时：仍需给两条 outgoing 边分配到不同的分支 handle，
        // 避免同侧平行贴边/重叠；这里按入边决定分支轴并选择“使用次数更少”的那一侧。
        const usage = decisionOutUsage.get(e.source) ?? emptySideUsage()
        const axisSides: Side[] = entryFallback === 'left' || entryFallback === 'right' ? ['top', 'bottom'] : ['left', 'right']
        let best = axisSides[0]
        let bestCount = usage[best] ?? 0
        for (const s of axisSides) {
          const c = usage[s] ?? 0
          if (c < bestCount) {
            best = s
            bestCount = c
          }
        }
        forcedDecisionSourceSide = best || mapping?.next || nextFallback
      }
    }

    const incoming = incomingByTargetSide.get(e.source) ?? { top: 0, right: 0, bottom: 0, left: 0 }
    const outUsed = anySourceSide.get(e.source) ?? { top: 0, right: 0, bottom: 0, left: 0 }

    // Penalty rules:
    // - Prefer geometry
    // - Avoid using a side on source if that same side already has incoming edges
    // - Softly avoid reusing the same source side for many outgoing edges
    const sourcePenalties: Partial<Record<Side, number>> = {
      // Strongly avoid having BOTH in+out on the same side (unless geometry makes it unavoidable).
      top: (incoming.top > 0 ? 0.9 : 0) + (incoming.top > 0 && outUsed.top > 0 ? 1.2 : 0) + outUsed.top * 0.15,
      right: (incoming.right > 0 ? 0.9 : 0) + (incoming.right > 0 && outUsed.right > 0 ? 1.2 : 0) + outUsed.right * 0.15,
      bottom:
        (incoming.bottom > 0 ? 0.9 : 0) + (incoming.bottom > 0 && outUsed.bottom > 0 ? 1.2 : 0) + outUsed.bottom * 0.15,
      left: (incoming.left > 0 ? 0.9 : 0) + (incoming.left > 0 && outUsed.left > 0 ? 1.2 : 0) + outUsed.left * 0.15,
    }

    const targetIncoming = incomingByTargetSide.get(e.target) ?? { top: 0, right: 0, bottom: 0, left: 0 }
    const targetSourceUsed = anySourceSide.get(e.target) ?? { top: 0, right: 0, bottom: 0, left: 0 }
    const sRoot = getRootFrameId(e.source)
    const tRoot = getRootFrameId(e.target)
    const isCrossFrame = sRoot !== tRoot
    const targetPenalties: Partial<Record<Side, number>> = {
      top:
        (targetSourceUsed.top > 0 ? 0.55 : 0) +
        (targetIncoming.top > 1 ? targetIncoming.top * 0.22 : targetIncoming.top * 0.1),
      right:
        (targetSourceUsed.right > 0 ? 0.55 : 0) +
        (targetIncoming.right > 1 ? targetIncoming.right * 0.22 : targetIncoming.right * 0.1),
      bottom:
        (targetSourceUsed.bottom > 0 ? 0.55 : 0) +
        (targetIncoming.bottom > 1 ? targetIncoming.bottom * 0.22 : targetIncoming.bottom * 0.1),
      left:
        (targetSourceUsed.left > 0 ? 0.55 : 0) +
        (targetIncoming.left > 1 ? targetIncoming.left * 0.22 : targetIncoming.left * 0.1),
    }

    const sourceScore = scoreSideForVector(dx, dy, sourcePenalties)
    // Target vector is reversed: target chooses side that "faces" source.
    const targetScore = scoreSideForVector(-dx, -dy, targetPenalties)
    const shouldKeepExistingHandles =
      Boolean(existingSourceHandle) &&
      Boolean(existingTargetHandle) &&
      existingSrcSide != null &&
      existingTgtSide != null &&
      !srcIsSwimlaneDecision &&
      (isAutoGeneratedSwimlane ||
        !enforceHandleCap ||
        (totalOnNodeSide(e.source, existingSrcSide) < maxEdgesPerHandleSide &&
          totalOnNodeSide(e.target, existingTgtSide) < maxEdgesPerHandleSide))

    let srcSide: Side = existingSrcSide ?? 'right'
    let tgtSide: Side = existingTgtSide ?? 'left'

    const scorePair = (sSide: Side, tSide: Side) => {
      // Keep geometric readability first: opposite-side pairs are still preferred,
      // then occupancy/lane penalties diversify when congestion appears.
      const preferOpposite = tSide === oppositeSide(sSide) ? -0.55 : 0
      const pairKey = `${e.source}->${e.target}:${sSide}:${tSide}`
      const undirectedKey =
        e.source <= e.target
          ? `${e.source}<->${e.target}:${sSide}:${tSide}`
          : `${e.target}<->${e.source}:${tSide}:${sSide}`
      const lanePenalty = (laneByPair.get(pairKey) ?? 0) * 0.7
      const undirectedLanePenalty = (laneByUndirectedPair.get(undirectedKey) ?? 0) * 0.45
      // In dense cross-frame flows, prefer left/right so lines cross frame borders less.
      const crossFramePenalty = isCrossFrame && (sSide === 'top' || sSide === 'bottom' || tSide === 'top' || tSide === 'bottom') ? 0.38 : 0

      const capPenalty = (() => {
        if (!enforceHandleCap) return 0
        const totalSrc = totalOnNodeSide(e.source, sSide)
        const totalTgt = totalOnNodeSide(e.target, tSide)
        const wouldExceed = totalSrc >= maxEdgesPerHandleSide || totalTgt >= maxEdgesPerHandleSide
        return wouldExceed ? 1e6 : 0
      })()

      return sourceScore(sSide) + targetScore(tSide) + preferOpposite + lanePenalty + undirectedLanePenalty + crossFramePenalty + capPenalty
    }

    if (shouldKeepExistingHandles && existingSrcSide != null && existingTgtSide != null) {
      srcSide = existingSrcSide
      tgtSide = existingTgtSide
    } else {
      let bestPairScore = Number.POSITIVE_INFINITY
      let foundStrictPair = false
      const sourceIncomingRec = incomingByTargetSide.get(e.source) ?? { top: 0, right: 0, bottom: 0, left: 0 }
      const targetOutgoingRec = anySourceSide.get(e.target) ?? { top: 0, right: 0, bottom: 0, left: 0 }

      // Pass 1 (strict):
      // - source outgoing side must not already have incoming on same side
      // - target incoming side must not already have outgoing on same side
      for (const sCandidate of sides) {
        if (forcedDecisionSourceSide && sCandidate !== forcedDecisionSourceSide) continue
        for (const tCandidate of sides) {
          if ((sourceIncomingRec[sCandidate] ?? 0) > 0) continue
          if ((targetOutgoingRec[tCandidate] ?? 0) > 0) continue
          const score = scorePair(sCandidate, tCandidate)
          if (score < bestPairScore) {
            foundStrictPair = true
            bestPairScore = score
            srcSide = sCandidate
            tgtSide = tCandidate
          }
        }
      }

      // Pass 2 (fallback): if strict impossible, allow mixed in/out side
      // but still choose nearest geometric pair.
      if (!foundStrictPair) {
        bestPairScore = Number.POSITIVE_INFINITY
        for (const sCandidate of sides) {
          if (forcedDecisionSourceSide && sCandidate !== forcedDecisionSourceSide) continue
          for (const tCandidate of sides) {
            const score = scorePair(sCandidate, tCandidate)
            if (score < bestPairScore) {
              bestPairScore = score
              srcSide = sCandidate
              tgtSide = tCandidate
            }
          }
        }
      }
    }

    const next = { ...e, sourceHandle: sideToSourceHandle(srcSide), targetHandle: sideToTargetHandle(tgtSide) }

    // Update occupancy for subsequent edges in the same batch
    bump(anySourceSide, e.source, srcSide)
    bump(incomingByTargetSide, e.target, tgtSide)
    const laneKey = `${e.source}->${e.target}:${srcSide}:${tgtSide}`
    laneByPair.set(laneKey, (laneByPair.get(laneKey) ?? 0) + 1)
    const undirectedLaneKey =
      e.source <= e.target
        ? `${e.source}<->${e.target}:${srcSide}:${tgtSide}`
        : `${e.target}<->${e.source}:${tgtSide}:${srcSide}`
    laneByUndirectedPair.set(undirectedLaneKey, (laneByUndirectedPair.get(undirectedLaneKey) ?? 0) + 1)
    if (srcIsSwimlaneDecision) {
      const usage = decisionOutUsage.get(e.source) ?? emptySideUsage()
      usage[srcSide] += 1
      decisionOutUsage.set(e.source, usage)
      if (decisionBranch) {
        const pair = decisionBranchSideByLabel.get(e.source) ?? {}
        if (decisionBranch === 'yes') pair.yes = srcSide
        else pair.no = srcSide
        decisionBranchSideByLabel.set(e.source, pair)
      }
    }

    return next
  })
}

/** 思维导图森林：按入度为 0 的根做 BFS 深度（用于主题色分层）。 */
function computeMindMapForestDepth(quadNodes: Array<Node<any>>, edges: Array<Edge<any>>): Map<string, number> {
  const ids = new Set(quadNodes.map((n) => n.id))
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of ids) {
    out.set(id, [])
    indeg.set(id, 0)
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    out.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  const roots = quadNodes.filter((n) => (indeg.get(n.id) ?? 0) === 0)
  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const r of roots) {
    depth.set(r.id, 0)
    queue.push(r.id)
  }
  if (queue.length === 0 && quadNodes.length > 0) {
    depth.set(quadNodes[0].id, 0)
    queue.push(quadNodes[0].id)
  }
  while (queue.length > 0) {
    const cur = queue.shift()!
    const d = depth.get(cur) ?? 0
    for (const nxt of out.get(cur) ?? []) {
      const nextDepth = d + 1
      const prev = depth.get(nxt)
      if (prev === undefined || nextDepth < prev) {
        depth.set(nxt, nextDepth)
        queue.push(nxt)
      }
    }
  }
  return depth
}

/**
 * 思维导图：按节点侧向（L/R）规范句柄，强制使用左右 handle，避免出现上/下或斜向入边。
 */
function applyMindMapHorizontalHandles(nodes: Array<Node<any>>, edges: Array<Edge<any>>): Array<Edge<any>> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  return edges.map((e) => {
    const src = nodeById.get(e.source)
    const tgt = nodeById.get(e.target)
    const srcSide = (src?.data as any)?.mindMapSide as 'L' | 'R' | undefined
    const tgtSide = (tgt?.data as any)?.mindMapSide as 'L' | 'R' | undefined

    // 稳定规则：
    // - source: 永远从自身侧向外发出（R->s-right, L->s-left）
    // - target: 永远从自身侧向内接收（R->t-left, L->t-right）
    if (srcSide && tgtSide) {
      const sourceHandle = srcSide === 'R' ? 's-right' : 's-left'
      const targetHandle = tgtSide === 'R' ? 't-left' : 't-right'
      return { ...e, sourceHandle, targetHandle }
    }

    // 兜底：若 side 丢失则根据 x 几何关系回退到水平 handle。
    const sx = src?.position?.x ?? 0
    const tx = tgt?.position?.x ?? 0
    if (tx >= sx) return { ...e, sourceHandle: 's-right', targetHandle: 't-left' }
    return { ...e, sourceHandle: 's-left', targetHandle: 't-right' }
  })
}

/**
 * 流程图：强制边从规范 handle 出入，避免布局后出现“看起来不贴 handle”的情况。
 */
function applyFlowchartStrictHandles(
  nodes: Array<Node<any>>,
  edges: Array<Edge<any>>,
  direction: FlowDirection,
): Array<Edge<any>> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const boxes = getNodeExclusionBoxes(nodes)
  const shifts = shiftSequence(FLOW_ROUTE_SHIFT_STEP, FLOW_ROUTE_MAX_SHIFT_TRIES)
  const occupiedRouteSignatures = new Set<string>()
  const decisionOutUsage = new Map<string, Record<Side, number>>()
  const decisionBranchSideByLabel = new Map<string, { yes?: Side; no?: Side }>()
  void direction
  const isReturnLabel = (text: unknown): boolean => {
    const t = String(text ?? '').trim()
    if (!t) return false
    return /(回流|驳回|退回|重试|回退|返回)/.test(t)
  }
  return edges.map((e) => {
    let sourceHandle = e.sourceHandle
    let targetHandle = e.targetHandle

    const srcNode = nodeById.get(e.source)
    const tgtNode = nodeById.get(e.target)
    const srcSemantic = String((srcNode?.data as any)?.semanticType ?? '')
    const srcShape = String((srcNode?.data as any)?.shape ?? '')
    const tgtSemantic = String((tgtNode?.data as any)?.semanticType ?? '')
    const tgtShape = String((tgtNode?.data as any)?.shape ?? '')
    const srcIsDecision = srcSemantic === 'decision' || srcShape === 'diamond'
    const tgtIsDecision = tgtSemantic === 'decision' || tgtShape === 'diamond'
    const edgeLabel = typeof e.label === 'string' ? e.label.trim() : ''
    const edgeLabelLower = edgeLabel.toLowerCase()
    const isYes =
      edgeLabelLower === 'yes' ||
      /(是|通过|同意|成功|允许|确认)/.test(edgeLabel) ||
      /\byes\b/i.test(edgeLabelLower)
    const isNo =
      edgeLabelLower === 'no' ||
      /(否|不通过|不同意|失败|拒绝|取消)/.test(edgeLabel) ||
      /\bno\b/i.test(edgeLabelLower)

    const existingSemantic = String(((e.data ?? {}) as any)?.semanticType ?? ((e.style ?? {}) as any)?.semanticType ?? '').toLowerCase()
    const isReturnFlow = existingSemantic === 'returnflow' || isReturnLabel(edgeLabel)

    // 回流边（流程图）：优先用与主流程正交的上下/左右 handle，避免出现“左进右出”这类低效且怪异的连接。
    // 同时自动开启动画，确保回流语义可见。
    if (isReturnFlow && srcNode && tgtNode) {
      const centers = getCenters(e.source, e.target, nodeById)
      const dy = centers ? centers.tCy - centers.sCy : 0
      // effectiveDirection 在外层已兜底为 LR/其它，但这里仅用来决定“回流优先走哪条轴”
      const preferVertical = direction === 'LR' || direction === 'RL'
      if (preferVertical) {
        // 主要走上下：向上回流用 top->bottom，向下回流用 bottom->top；同水平时默认走 top->top（更像“回到上一步”）
        if (Math.abs(dy) <= GRID_UNIT * 2) {
          sourceHandle = 's-top'
          targetHandle = 't-top'
        } else if (dy < 0) {
          sourceHandle = 's-top'
          targetHandle = 't-bottom'
        } else {
          sourceHandle = 's-bottom'
          targetHandle = 't-top'
        }
      } else {
        // 主要走左右（主流程上下时，回流用左右绕开）
        const centers2 = centers ?? { sCx: 0, tCx: 0 }
        const dx = centers2.tCx - centers2.sCx
        if (Math.abs(dx) <= GRID_UNIT * 2) {
          sourceHandle = 's-left'
          targetHandle = 't-left'
        } else if (dx < 0) {
          sourceHandle = 's-left'
          targetHandle = 't-right'
        } else {
          sourceHandle = 's-right'
          targetHandle = 't-left'
        }
      }
    }

    // 流程图双向箭头对角特判：不影响 decision 既有出边策略。
    if (!isReturnFlow && !srcIsDecision && !tgtIsDecision) {
      const bidirectionalForced = inferBidirectionalDiagonalHandlesForFlowchart(e, nodeById)
      if (bidirectionalForced) {
        sourceHandle = bidirectionalForced.sourceHandle
        targetHandle = bidirectionalForced.targetHandle
      }
    }

    // 决策节点：yes/no 必须走不同 handle；方向由几何自动推断，不写死左右。
    if (srcIsDecision) {
      const inferred = inferHandlesForEdge(e.source, e.target, nodeById)
      const inferredSide = handleToSide(inferred?.sourceHandle) ?? 'right'
      const usage = decisionOutUsage.get(e.source) ?? emptySideUsage()
      const branch: 'yes' | 'no' | null = isYes ? 'yes' : isNo ? 'no' : null
      let chosenSide: Side
      if (branch) {
        const pair = decisionBranchSideByLabel.get(e.source) ?? {}
        const current = branch === 'yes' ? pair.yes : pair.no
        if (current) {
          chosenSide = current
        } else {
          const other = branch === 'yes' ? pair.no : pair.yes
          chosenSide = chooseLeastUsedDistinctSide(inferredSide, usage, other)
          if (branch === 'yes') pair.yes = chosenSide
          else pair.no = chosenSide
          decisionBranchSideByLabel.set(e.source, pair)
        }
      } else {
        chosenSide = chooseLeastUsedDistinctSide(inferredSide, usage)
      }
      usage[chosenSide] += 1
      decisionOutUsage.set(e.source, usage)
      sourceHandle = sideToSourceHandle(chosenSide)
    }

    if (!sourceHandle || !targetHandle) {
      const inferred = inferHandlesForEdge(e.source, e.target, nodeById)
      if (inferred) {
        sourceHandle = sourceHandle ?? inferred.sourceHandle
        targetHandle = targetHandle ?? inferred.targetHandle
      }
    }
    const d = { ...((e.data ?? {}) as any) }
    if (isReturnFlow) d.semanticType = 'returnFlow'
    const sourceSide = sourceHandle ? handleToSide(sourceHandle) : null
    const targetSide = targetHandle ? handleToSide(targetHandle) : null
    if (!sourceSide || !targetSide) {
      return {
        ...e,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        ...(isReturnFlow ? { animated: true } : {}),
        data: d,
      }
    }

    const srcPoint = resolveHandlePoint(e.source, sourceSide, nodeById)
    const tgtPoint = resolveHandlePoint(e.target, targetSide, nodeById)
    if (!srcPoint || !tgtPoint) {
      return {
        ...e,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        ...(isReturnFlow ? { animated: true } : {}),
        data: d,
      }
    }

    const basePolyline = buildRoutePoints(srcPoint, tgtPoint, sourceSide, targetSide, 0, 'auto')
    const baseCollision = doesPolylineIntersectAnyExclusionBox(basePolyline, boxes, [e.source, e.target])
    const baseSignature = buildPolylineSignature(basePolyline)
    const baseFullOverlap = baseSignature ? occupiedRouteSignatures.has(baseSignature) : false
    if (!baseCollision && !baseFullOverlap) {
      if (baseSignature) occupiedRouteSignatures.add(baseSignature)
      return {
        ...e,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        ...(isReturnFlow ? { animated: true } : {}),
        data: d,
      }
    }

    const routeModes: Array<'auto' | 'horizontal' | 'vertical'> = ['auto', 'horizontal', 'vertical']
    const candidates: RoutePoint[][] = []
    for (const mode of routeModes) {
      for (const shift of shifts) {
        candidates.push(buildRoutePoints(srcPoint, tgtPoint, sourceSide, targetSide, shift, mode))
      }
    }

    let selected = candidates[0]
    let bestNodeSafe: RoutePoint[] | null = null
    let bestNodeSafeNoOverlap: RoutePoint[] | null = null

    for (const candidate of candidates) {
      const collision = doesPolylineIntersectAnyExclusionBox(candidate, boxes, [e.source, e.target])
      const sig = buildPolylineSignature(candidate)
      const fullOverlap = sig ? occupiedRouteSignatures.has(sig) : false
      if (!collision && !bestNodeSafe) bestNodeSafe = candidate
      if (!collision && !fullOverlap) {
        bestNodeSafeNoOverlap = candidate
        break
      }
    }

    selected = bestNodeSafeNoOverlap ?? bestNodeSafe ?? selected
    const routedWaypoints = selected.slice(1, -1)
    const selectedSignature = buildPolylineSignature(selected)
    if (selectedSignature) occupiedRouteSignatures.add(selectedSignature)
    return {
      ...e,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
      type: routedWaypoints.length >= 2 ? 'smoothstep' : e.type,
      ...(isReturnFlow ? { animated: true } : {}),
      data: { ...d, waypoints: routedWaypoints },
    }
  })
}

function quickReviewAndFixFlowchartRoutes(
  nodes: Array<Node<any>>,
  edges: Array<Edge<any>>,
  direction: FlowDirection,
): Array<Edge<any>> {
  if (!Array.isArray(edges) || edges.length === 0) return edges
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const boxes = getNodeExclusionBoxes(nodes)
  void direction

  const edgeKey = (a: string, b: string) => `${a}→${b}`
  const edgeSet = new Set(edges.map((e) => edgeKey(e.source, e.target)))

  const nearRowOrCol = (s: { x: number; y: number }, t: { x: number; y: number }) => {
    const dx = t.x - s.x
    const dy = t.y - s.y
    const nearRow = Math.abs(dy) <= GRID_UNIT * 3
    const nearCol = Math.abs(dx) <= GRID_UNIT * 3
    return { dx, dy, nearRow, nearCol }
  }

  const buildBestRouteForHandles = (
    srcId: string,
    tgtId: string,
    sourceHandle: string,
    targetHandle: string,
  ): { polyline: RoutePoint[]; waypoints: Array<{ x: number; y: number }> } | null => {
    const sourceSide = handleToSide(sourceHandle)
    const targetSide = handleToSide(targetHandle)
    if (!sourceSide || !targetSide) return null
    const srcPoint = resolveHandlePoint(srcId, sourceSide, nodeById)
    const tgtPoint = resolveHandlePoint(tgtId, targetSide, nodeById)
    if (!srcPoint || !tgtPoint) return null

    // 快速：只尝试少量 shift/mode，避免影响整体性能
    const shifts = [0, FLOW_ROUTE_SHIFT_STEP, -FLOW_ROUTE_SHIFT_STEP]
    const modes: Array<'auto' | 'horizontal' | 'vertical'> = ['auto', 'horizontal', 'vertical']

    let best: RoutePoint[] | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const mode of modes) {
      for (const shift of shifts) {
        const polyline = buildRoutePoints(srcPoint, tgtPoint, sourceSide, targetSide, shift, mode)
        const collision = doesPolylineIntersectAnyExclusionBox(polyline, boxes, [srcId, tgtId])
        if (collision) continue
        const bends = Math.max(0, polyline.length - 2)
        let len = 0
        for (let i = 1; i < polyline.length; i += 1) {
          len += Math.abs(polyline[i].x - polyline[i - 1].x) + Math.abs(polyline[i].y - polyline[i - 1].y)
        }
        const score = bends * 80 + len
        if (score < bestScore) {
          bestScore = score
          best = polyline
        }
      }
    }
    if (!best) return null
    return { polyline: best, waypoints: best.slice(1, -1) }
  }

  const scoreHandlePair = (args: {
    srcId: string
    tgtId: string
    srcCenter: { x: number; y: number }
    tgtCenter: { x: number; y: number }
    isBidirectional: boolean
    sourceSide: Side
    targetSide: Side
    waypoints: Array<{ x: number; y: number }>
  }): number => {
    const { dx, dy, nearRow, nearCol } = nearRowOrCol(args.srcCenter, args.tgtCenter)
    const bends = args.waypoints.length
    let score = bends * 50

    // 近似同一行：避免“上下混连”造成不规则的下扎/上扎
    if (nearRow) {
      const verticalMixed =
        (args.sourceSide === 'top' || args.sourceSide === 'bottom') &&
        (args.targetSide === 'top' || args.targetSide === 'bottom') &&
        args.sourceSide !== args.targetSide
      if (verticalMixed) score += 220
      // 主方向应沿 x 推进：反向出边轻微惩罚（不是强制）
      if (dx >= 0 && args.sourceSide === 'left') score += 80
      if (dx < 0 && args.sourceSide === 'right') score += 80
    }

    // 近似同一列：避免“左右混连”
    if (nearCol) {
      const horizontalMixed =
        (args.sourceSide === 'left' || args.sourceSide === 'right') &&
        (args.targetSide === 'left' || args.targetSide === 'right') &&
        args.sourceSide !== args.targetSide
      if (horizontalMixed) score += 220
      if (dy >= 0 && args.sourceSide === 'top') score += 80
      if (dy < 0 && args.sourceSide === 'bottom') score += 80
    }

    // 双向边：更偏好同侧（top-top / bottom-bottom / left-left / right-right）减少“对穿”
    if (args.isBidirectional) {
      if (args.sourceSide === args.targetSide) score -= 40
      else score += 40
    }

    return score
  }

  const occupiedRouteSignatures = new Set<string>()

  return edges.map((e) => {
    const srcNode = nodeById.get(e.source)
    const tgtNode = nodeById.get(e.target)
    if (!srcNode || !tgtNode) return e

    const existingWaypoints = Array.isArray(((e.data ?? {}) as any)?.waypoints)
      ? ((((e.data ?? {}) as any).waypoints as any[]) ?? [])
      : []

    const centers = getCenters(e.source, e.target, nodeById)
    const sCenter = centers ? { x: centers.sCx, y: centers.sCy } : { x: srcNode.position?.x ?? 0, y: srcNode.position?.y ?? 0 }
    const tCenter = centers ? { x: centers.tCx, y: centers.tCy } : { x: tgtNode.position?.x ?? 0, y: tgtNode.position?.y ?? 0 }
    const isBidirectional = edgeSet.has(edgeKey(e.target, e.source)) || String((e as any).arrowStyle ?? '') === 'both'

    const currentSH = e.sourceHandle
    const currentTH = e.targetHandle
    const currentSS = currentSH ? handleToSide(currentSH) : null
    const currentTS = currentTH ? handleToSide(currentTH) : null

    const inferred = inferHandlesForEdge(e.source, e.target, nodeById)
    const { dx, dy, nearRow, nearCol } = nearRowOrCol(sCenter, tCenter)

    // 只在“看起来容易不规则/像斜线”的情形触发：
    // - 近似同一行，却使用上下混连（bottom->top / top->bottom）
    // - 近似同一列，却使用左右混连（left->right / right->left）
    // - 双向边近似同排/同列，却不是同侧（top-top / bottom-bottom / left-left / right-right）
    const verticalMixedNearRow =
      Boolean(nearRow && currentSS && currentTS) &&
      (currentSS === 'top' || currentSS === 'bottom') &&
      (currentTS === 'top' || currentTS === 'bottom') &&
      currentSS !== currentTS
    const horizontalMixedNearCol =
      Boolean(nearCol && currentSS && currentTS) &&
      (currentSS === 'left' || currentSS === 'right') &&
      (currentTS === 'left' || currentTS === 'right') &&
      currentSS !== currentTS
    const bidiNotSameSide =
      Boolean(isBidirectional && (nearRow || nearCol) && currentSS && currentTS) && currentSS !== currentTS

    if (!verticalMixedNearRow && !horizontalMixedNearCol && !bidiNotSameSide) {
      // 复查不介入：保留 strictHandles 已经做好的避障/去重走线
      const sig = buildPolylineSignature([
        ...(resolveHandlePoint(e.source, currentSS ?? 'right', nodeById) ? [resolveHandlePoint(e.source, currentSS ?? 'right', nodeById)!] : []),
        ...existingWaypoints.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        ...(resolveHandlePoint(e.target, currentTS ?? 'left', nodeById) ? [resolveHandlePoint(e.target, currentTS ?? 'left', nodeById)!] : []),
      ])
      if (sig) occupiedRouteSignatures.add(sig)
      return e
    }

    const candidates: Array<{ sh: string; th: string }> = []
    const push = (sh?: string | null, th?: string | null) => {
      if (!sh || !th) return
      if (!handleToSide(sh) || !handleToSide(th)) return
      const key = `${sh}/${th}`
      if (candidates.some((c) => `${c.sh}/${c.th}` === key)) return
      candidates.push({ sh, th })
    }

    push(currentSH, currentTH)
    push(inferred?.sourceHandle, inferred?.targetHandle)

    if (nearRow) {
      // 主候选：水平 or 同侧（用于避免 A 下连 B 上这种“不规则”）
      if (dx >= 0) push('s-right', 't-left')
      else push('s-left', 't-right')
      push('s-top', 't-top')
      push('s-bottom', 't-bottom')
    } else if (nearCol) {
      if (dy >= 0) push('s-bottom', 't-top')
      else push('s-top', 't-bottom')
      push('s-left', 't-left')
      push('s-right', 't-right')
    } else {
      // 非同排同列：给一个“同侧”备选，常用于规避斜向视觉（不是强制）
      push('s-top', 't-top')
      push('s-right', 't-left')
      push('s-bottom', 't-top')
      push('s-left', 't-right')
    }

    let bestEdge = e
    let bestScore = Number.POSITIVE_INFINITY

    for (const c of candidates) {
      const route = buildBestRouteForHandles(e.source, e.target, c.sh, c.th)
      if (!route) continue
      const sig = buildPolylineSignature(route.polyline)
      const fullOverlap = sig ? occupiedRouteSignatures.has(sig) : false
      if (fullOverlap) continue
      const ss = handleToSide(c.sh)
      const ts = handleToSide(c.th)
      if (!ss || !ts) continue
      const score = scoreHandlePair({
        srcId: e.source,
        tgtId: e.target,
        srcCenter: sCenter,
        tgtCenter: tCenter,
        isBidirectional,
        sourceSide: ss,
        targetSide: ts,
        waypoints: route.waypoints,
      })
      if (score < bestScore) {
        bestScore = score
        bestEdge = {
          ...e,
          sourceHandle: c.sh,
          targetHandle: c.th,
          type: route.waypoints.length >= 2 ? 'smoothstep' : (e.type ?? 'smoothstep'),
          data: { ...((e.data ?? {}) as any), waypoints: route.waypoints },
        }
      }
    }

    // 若 current handles 都缺失则保持 best；若 current 存在则仅在“明显更优”时替换（避免强制行为）
    if (currentSS && currentTS) {
      const curWaypoints = Array.isArray(((e.data ?? {}) as any)?.waypoints) ? (((e.data ?? {}) as any).waypoints as any[]) : []
      const curScore = scoreHandlePair({
        srcId: e.source,
        tgtId: e.target,
        srcCenter: sCenter,
        tgtCenter: tCenter,
        isBidirectional,
        sourceSide: currentSS,
        targetSide: currentTS,
        waypoints: curWaypoints.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
      })
      if (bestScore + 60 >= curScore) return e
    }

    const chosenSS = bestEdge.sourceHandle ? handleToSide(bestEdge.sourceHandle) : currentSS
    const chosenTS = bestEdge.targetHandle ? handleToSide(bestEdge.targetHandle) : currentTS
    const chosenSrc = chosenSS ? resolveHandlePoint(bestEdge.source, chosenSS, nodeById) : null
    const chosenTgt = chosenTS ? resolveHandlePoint(bestEdge.target, chosenTS, nodeById) : null
    const chosenWaypoints = Array.isArray(((bestEdge.data ?? {}) as any)?.waypoints) ? ((((bestEdge.data ?? {}) as any).waypoints as any[]) ?? []) : []
    const chosenPolyline: RoutePoint[] =
      chosenSrc && chosenTgt
        ? [
            chosenSrc,
            ...chosenWaypoints.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
            chosenTgt,
          ]
        : []
    const chosenSig = chosenPolyline.length > 0 ? buildPolylineSignature(chosenPolyline) : null
    if (chosenSig) occupiedRouteSignatures.add(chosenSig)
    return bestEdge
  })
}

/**
 * 将 GraphBatchPayload “物化”为一份 Flow2Go 可用的 nodes/edges 快照。
 * v1 策略：默认 replace（从空图生成）；坐标由 autoLayout op 决定。
 */
export async function materializeGraphBatchPayloadToSnapshot(
  payload: GraphBatchPayload,
  opts?: { replace?: boolean },
  base?: Flow2GoSnapshot,
): Promise<Flow2GoSnapshot> {
  const replace = opts?.replace ?? true
  const start: Flow2GoSnapshot = replace ? { nodes: [], edges: [] } : (base ?? { nodes: [], edges: [] })

  const nodes: Array<Node<any>> = [...start.nodes]
  const edges: Array<Edge<any>> = [...start.edges]
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const edgeById = new Map(edges.map((e) => [e.id, e]))
  const compactLegacyMode = false
  const mindMapMode = ((payload.meta as any)?.layoutProfile ?? '') === 'mind-map'
  /** 自然语言生成：不自动套用语义节点色、思维导图分岔色等预设 */
  const neutralGeneration = Boolean((payload.meta as any)?.neutralGeneration)
  const flowchartMode = !mindMapMode
  const preferLR = flowchartMode && shouldPreferLeftToRightByComplexity(payload)
  const preferLRDefault = flowchartMode && payload.direction !== 'LR'
  // 流程图：不强制节点方向；仅在“麻花风险”下兜底优先 LR。
  const effectiveDirection: FlowDirection = preferLRDefault || preferLR ? 'LR' : payload.direction

  const swimlaneMode = ((payload.meta as any)?.layoutProfile ?? '') === 'swimlane'
  const swimlaneDirection: 'horizontal' | 'vertical' = (payload.meta as any)?.swimlaneDirection ?? 'horizontal'
  /** 图生图泳道 Draft：物化时强制默认泳道底色，忽略泳道配色字段 */
  const swimlaneImageImport = Boolean((payload.meta as any)?.swimlaneImageImport)
  let laneIndexCounter = 0

  const frameOrder: string[] = []
  const frameExplicitPos = new Set<string>()

  // note: operations already ordered by transpiler, but we still handle out-of-order defensively.
  for (const op of payload.operations) {
    if (op.op === 'graph.createFrame') {
      if (nodeById.has(op.params.id)) continue
      const d = frameDefaults(op.params.title)
      const w = op.params.size?.width ?? d.width
      const h = op.params.size?.height ?? d.height
      if (op.params.position) frameExplicitPos.add(op.params.id)
      const isNested = Boolean(op.params.parentId)
      const pos =
        op.params.position ??
        (() => {
          if (isNested) return { x: 0, y: 0 }
          return { x: 0, y: 0 }
        })()

      const isLane = swimlaneMode && !isNested
      const rawFrameStyle = (op.params.style ?? {}) as Record<string, unknown>
      const nodeData: Record<string, any> = {
        ...d.data,
        title: op.params.title,
        ...rawFrameStyle,
      }
      if (isLane) {
        // 泳道描边不由大模型/草稿 style 覆盖（图生图路径在下面单独设定）
        if (!swimlaneImageImport) {
          delete nodeData.stroke
          delete nodeData.strokeWidth
        }
        nodeData.role = 'lane'
        // 行泳道（horizontal）使用左侧标题；列泳道（vertical）使用上方居中标题。
        nodeData.titlePosition = swimlaneDirection === 'vertical' ? 'top-center' : 'left-center'
        nodeData.laneMeta = {
          laneId: op.params.id,
          laneIndex: laneIndexCounter++,
          laneAxis: swimlaneDirection === 'vertical' ? 'column' : 'row',
          headerSize: 48,
          padding: { top: 24, right: 24, bottom: 24, left: 24 },
          minLaneWidth: 800,
          minLaneHeight: 88,
        }
        nodeData.titleColor = DEFAULT_LANE_TITLE_TEXT_COLOR
        if (swimlaneImageImport) {
          nodeData.fill = 'rgba(241, 245, 249, 0.5)'
          nodeData.stroke = 'rgba(203, 213, 225, 0.6)'
          nodeData.strokeWidth = 1
          delete nodeData.laneHeaderBackground
          delete nodeData.laneTitleLabelBackground
        } else {
          nodeData.stroke = 'rgba(203, 213, 225, 0.6)'
          nodeData.strokeWidth = 1
        }
      }

      const node: Node<any> = {
        id: op.params.id,
        type: 'group',
        position: pos,
        ...(op.params.parentId ? { parentId: op.params.parentId } : {}),
        width: w,
        height: h,
        data: nodeData,
        draggable: true,
        style: { width: w, height: h },
      }
      nodes.push(node)
      nodeById.set(node.id, node)
      frameOrder.push(node.id)
      continue
    }

    if (op.op === 'graph.createNodeQuad') {
      if (nodeById.has(op.params.id)) continue
      const d = quadDefaults(op.params.title, op.params.shape)
      const pos = op.params.position ?? { x: 0, y: 0 }
      const extraData: Record<string, any> = {}

      if (op.params.parentId) {
        const parentNode = nodeById.get(op.params.parentId)
        if (parentNode && (parentNode.data as any)?.role === 'lane') {
          extraData.laneId = op.params.parentId
        }
      }
      const rawStyleObj = (op.params.style ?? {}) as Record<string, any>
      const styleObj = withSemanticNodeStyleDefaults(rawStyleObj, {
        skipPresetSemanticColors: neutralGeneration,
      })
      if (styleObj.semanticType && !op.params.shape) {
        const st = String(styleObj.semanticType).toLowerCase()
        if (st === 'start' || st === 'end') d.data.shape = 'circle'
        else if (st === 'decision') d.data.shape = 'diamond'
        else d.data.shape = 'rect'
      }

      const node: Node<any> = {
        id: op.params.id,
        type: 'quad',
        position: pos,
        ...(op.params.parentId ? { parentId: op.params.parentId } : {}),
        width: d.width,
        height: d.height,
        data: {
          ...d.data,
          ...(op.params.subtitle ? { subtitle: op.params.subtitle } : {}),
          ...styleObj,
          ...extraData,
        },
      }
      nodes.push(node)
      nodeById.set(node.id, node)
      continue
    }

    if (op.op === 'graph.createEdge') {
      if (edgeById.has(op.params.id)) continue
      // 生成的边：默认粗细统一为 1（用户可后续在 UI 自定义）
      const defaultStyle: Record<string, unknown> = { strokeWidth: 1 }
      const mergedStyle = { ...defaultStyle, ...(op.params.style ?? {}) }

      const trimmedLabel = typeof op.params.label === 'string' ? op.params.label.trim() : ''

      // 思维导图：默认无箭头（无“边上语义”）；仅当 Mermaid 写了 -->|文案| 等显式边标签时才显示箭头
      let arrowStyle: 'none' | 'end' | 'start' | 'both'
      if (mindMapMode) {
        arrowStyle = trimmedLabel.length > 0 ? (op.params.arrowStyle ?? 'end') : 'none'
      } else {
        arrowStyle = op.params.arrowStyle ?? 'end'
      }

      const edgeData: Record<string, any> = {
        arrowStyle,
        // 所有“生成链路”产出的边默认使用纯文字标签样式。
        labelTextOnly: true,
      }
      const isDecisionNode = (n?: Node<any>) => {
        const st = (n?.data as any)?.semanticType
        const shape = (n?.data as any)?.shape
        return st === 'decision' || shape === 'diamond'
      }
      const isOrdinarySwimlaneNode = (n?: Node<any>) => {
        if (!n) return false
        const laneId = (n.data as any)?.laneId ?? n.parentId
        if (!laneId) return false
        if (isDecisionNode(n)) return false
        const st = (n.data as any)?.semanticType
        const shape = (n.data as any)?.shape
        if (st && ['start', 'task', 'end', 'data'].includes(String(st))) return true
        if (shape && ['rect', 'circle'].includes(String(shape))) return true
        return true
      }
      let sourceHandle: string | undefined
      let targetHandle: string | undefined
      if (swimlaneMode) {
        edgeData.layoutProfile = 'swimlane'
        edgeData.autoGeneratedSwimlane = true
        const srcNode = nodeById.get(op.params.source)
        const tgtNode = nodeById.get(op.params.target)
        const srcLaneId = (srcNode?.data as any)?.laneId ?? srcNode?.parentId
        const tgtLaneId = (tgtNode?.data as any)?.laneId ?? tgtNode?.parentId
        edgeData.sourceLaneId = srcLaneId
        edgeData.targetLaneId = tgtLaneId
        const explicitSemantic = (op.params.style as any)?.semanticType
        if (explicitSemantic) {
          edgeData.semanticType = explicitSemantic
        } else if (srcLaneId && tgtLaneId && srcLaneId !== tgtLaneId) {
          edgeData.semanticType = 'crossLane'
        } else {
          edgeData.semanticType = 'normal'
        }
        if (isOrdinarySwimlaneNode(srcNode)) sourceHandle = 's-right'
        if (isOrdinarySwimlaneNode(tgtNode)) targetHandle = 't-left'
        if (edgeData.semanticType === 'crossLane') {
          sourceHandle = sourceHandle ?? 's-right'
          targetHandle = targetHandle ?? 't-left'
        }
      }

      const isCrossLane = edgeData.semanticType === 'crossLane'
      const edgeType = swimlaneMode
        ? (isCrossLane ? 'smoothstep' : (op.params.type ?? 'smoothstep'))
        : (mindMapMode ? 'bezier' : (flowchartMode ? (op.params.type ?? 'smoothstep') : op.params.type ?? 'bezier'))

      const edge: Edge<any> = {
        id: op.params.id,
        source: op.params.source,
        target: op.params.target,
        type: edgeType,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        ...(trimmedLabel ? { label: op.params.label } : {}),
        data: {
          ...edgeData,
        },
        style: mergedStyle as any,
        ...(arrowStyle === 'none' ? { markerEnd: undefined, markerStart: undefined } : {}),
      }
      edges.push(edge)
      edgeById.set(edge.id, edge)
      continue
    }

    if (op.op === 'graph.autoLayout') {
      // Legacy compact frame mode: skip auto-layout ops and keep recursive stretch only.
      if (compactLegacyMode) {
        continue
      }
      // Swimlane mode: delegate entirely to autoLayoutSwimlane
      if (swimlaneMode) {
        const result = autoLayoutSwimlane({
          nodes: [...nodes],
          edges: [...edges],
          direction: op.params.direction,
          swimlaneDirection,
        })
        nodes.splice(0, nodes.length, ...result.nodes)
        edges.splice(0, edges.length, ...result.edges)
        continue
      }
      const withinFrameDir: FlowDirection = op.params.direction
      const topLevelDir: FlowDirection = op.params.direction
      if (op.params.scope === 'withinFrame' && op.params.frameId) {
        const next = await layoutWithinFrame(
          nodes,
          edges,
          op.params.frameId,
          withinFrameDir,
        )
        nodes.splice(0, nodes.length, ...next)
      } else if (op.params.scope === 'all') {
        const next = await layoutTopLevel(nodes, edges, topLevelDir)
        nodes.splice(0, nodes.length, ...next)
      }
      continue
    }
  }

  // Clamp positions to finite numbers
  let safeNodes = nodes.map((n) => ({
    ...n,
    position: {
      x: Number.isFinite(n.position?.x) ? (n.position.x as number) : 0,
      y: Number.isFinite(n.position?.y) ? (n.position.y as number) : 0,
    },
  }))

  // Swimlane mode: layout already done by autoLayoutSwimlane; skip wrap/dagre/frame postprocess.
  if (swimlaneMode) {
    safeNodes = normalizeNodesForGrid(safeNodes)
    let safeEdges = applyInferredEdgeHandles(safeNodes, edges)
    safeEdges = normalizeEdgesForGrid(safeEdges)
    return { nodes: safeNodes, edges: safeEdges }
  }

  // Make frames compact like manual grouping
  safeNodes = wrapFramesToContents(safeNodes, compactLegacyMode)

  // Mind Map：纯节点 + Mind Elixir `layoutSSR` 左右分支分配 + 左右展开几何布局
  if (mindMapMode) {
    const palette = TOP_FRAME_THEME_COLORS

    const quadNodes = safeNodes.filter((n) => n.type === 'quad') as Array<Node<any>>
    if (quadNodes.length > 0) {
      const { positions, sides } = layoutMindMapMindElixirStyle(quadNodes, edges)
      for (const n of quadNodes) {
        const p = positions.get(n.id)
        if (p) n.position = { ...n.position, x: p.x, y: p.y }
        const side = sides.get(n.id)
        if (side) {
          n.data = { ...(n.data ?? {}), mindMapSide: side }
        }
      }

      const depthByNodeId = computeMindMapForestDepth(quadNodes, edges)
      for (const n of quadNodes) {
        const d = depthByNodeId.get(n.id) ?? 0
        // mind-map：描边颜色始终按默认色板分列/分层（中性模式也保留“每一大列一个色”的可读性）
        const color = palette[d % palette.length]
        n.data = {
          ...(n.data ?? {}),
          stroke: color,
          strokeWidth: 1,
        }
      }

      const quadIdSet = new Set(quadNodes.map((n) => n.id))
      for (const e of edges) {
        if (!quadIdSet.has(e.source) || !quadIdSet.has(e.target)) continue
        const td = depthByNodeId.get(e.target) ?? 0
        const color = palette[td % palette.length]
        ;(e.style as any) = {
          ...(e.style ?? {}),
          stroke: color,
          strokeWidth: 1,
          '--xy-edge-stroke': color,
          ...(neutralGeneration ? { opacity: 0.75 } : {}),
        }
      }
    }
  }

  // Legacy compact frame mode: chapter width + vertical tiling.
  const safeById = new Map(safeNodes.map((n) => [n.id, n]))
  const framesInOrder = (frameOrder.length ? frameOrder : safeNodes.map((n) => n.id))
    .map((id) => safeById.get(id))
    .filter((n): n is Node<any> => n != null && !n.parentId && n.type === 'group' && (n.data as any)?.role === 'frame')

  // Keep a single recursive-stretch width pipeline:
  // 顶层 frame 宽度在 wrapFramesToContents(layoutBusinessFrame) 内一次性确定，
  // 这里不再做任何二次统一/放大，避免子元素在后处理后出现偏移感。

  if (compactLegacyMode) {
    let cursorX = 0
    let cursorY = 0
    for (const f of framesInOrder) {
      if (frameExplicitPos.has(f.id)) continue
      const h = f.measured?.height ?? f.height ?? (typeof (f.style as any)?.height === 'number' ? (f.style as any).height : undefined) ?? 416
      f.position = { x: cursorX, y: cursorY }
      cursorY += h + Math.max(1, Math.round(LEGACY_COMPACT_INNER_UNIT * 0.5))
    }
  } else if (!mindMapMode && framesInOrder.length > 0) {
    // 仅当有顶层画框时二次 Dagre：wrapFramesToContents 会改画框尺寸，需按 Dagre 拉开多画框/不连通子图。
    // 无画框的纯节点图保持 transpiler 内 autoLayout(scope=all) 结果，避免无谓重排破坏几何推断等。
    const explicitBackup = new Map<string, { x: number; y: number }>()
    for (const id of frameExplicitPos) {
      const n = safeNodes.find((x) => x.id === id)
      if (n?.position) explicitBackup.set(id, { x: n.position.x, y: n.position.y })
    }
    const topLevelDir: FlowDirection = payload.direction
    safeNodes = await layoutTopLevel(safeNodes, edges, topLevelDir)
    for (const [id, pos] of explicitBackup) {
      const n = safeNodes.find((x) => x.id === id)
      if (n) n.position = { ...pos }
    }
  }

  if (compactLegacyMode) {
    // Apply theme colors by top-level parent frame, and cascade to nested frames.
    const frameNodes = safeNodes.filter((n) => n.type === 'group' && (n.data as any)?.role === 'frame')
    const frameById = new Map(frameNodes.map((n) => [n.id, n]))
    const topFrames = frameNodes.filter((f) => !f.parentId).sort((a, b) => {
      const ay = a.position?.y ?? 0
      const by = b.position?.y ?? 0
      return ay - by
    })
    const topColor = new Map<string, string>()
    for (let i = 0; i < topFrames.length; i += 1) {
      topColor.set(topFrames[i].id, TOP_FRAME_THEME_COLORS[i % TOP_FRAME_THEME_COLORS.length])
    }
    const topOf = (id: string): string => {
      let cur = frameById.get(id)
      const seen = new Set<string>()
      while (cur?.parentId && frameById.has(cur.parentId)) {
        if (seen.has(cur.id)) break
        seen.add(cur.id)
        cur = frameById.get(cur.parentId)
      }
      return cur?.id ?? id
    }
    const depthOfFrame = (id: string) => {
      let d = 0
      let cur = frameById.get(id)
      const seen = new Set<string>()
      while (cur?.parentId && frameById.has(cur.parentId)) {
        if (seen.has(cur.id)) break
        seen.add(cur.id)
        d += 1
        cur = frameById.get(cur.parentId)
      }
      return d
    }

    const hasChildFrame = (id: string) => frameNodes.some((n) => n.parentId === id)

    for (const f of frameNodes) {
      const root = topOf(f.id)
      const color = topColor.get(root) ?? TOP_FRAME_THEME_COLORS[0]
      const fill6 = hexToRgba(color, 0.06) // themed fill with 6% opacity
      const data = { ...(f.data as any) }
      const depth = depthOfFrame(f.id)
      // Level semantics (outer -> inner)
      // - depth 0: Level 3 (outermost parent frame)
      // - depth 1: Level 2 (middle frames, tiled inside level 3)
      // - depth 2+: Level 1 (innermost frames that directly contain nodes)
      // Keep full, meaningful titles; do not hard truncate here.
      data.title = typeof data.title === 'string' ? data.title.trim() : data.title
      if (depth === 0) {
        // 3级（最外层父画框）：标题 18px，65%黑；底色 100% 不透明白
        data.stroke = '#ffffff'
        data.strokeWidth = 1
        data.fill = '#ffffff'
        data.titleColor = 'rgba(0, 0, 0, 0.65)'
        data.titleFontSize = 18
      } else if (hasChildFrame(f.id)) {
        // 2级（中间画框）：16px，75%黑；描边=0；主题色 6%底
        data.stroke = color
        data.strokeWidth = 0
        data.fill = fill6
        data.titleColor = 'rgba(0, 0, 0, 0.75)'
        data.titleFontSize = 16
      } else {
        // 1级（最内层画框，直接承载节点）：主题色 6%底 + 1px 主题色不透明描边；标题 16px，75%黑
        data.stroke = color
        data.strokeWidth = 1
        data.fill = fill6
        data.titleColor = 'rgba(0, 0, 0, 0.75)'
        data.titleFontSize = 16
      }
      f.data = data
      f.style = {
        ...(f.style as any),
        borderColor: data.strokeWidth === 0 ? 'transparent' : (data.stroke ?? '#ffffff'),
        borderWidth: data.strokeWidth === 0 ? 0 : undefined,
        backgroundColor: data.fill,
      }
    }
  }

  let safeEdges = applyInferredEdgeHandles(safeNodes, edges)

  if (mindMapMode) {
    // 思维导图连线规范：句柄必须与节点左右侧一致，避免脱离 handle 的视觉错位。
    safeEdges = applyMindMapHorizontalHandles(safeNodes, safeEdges)
    for (const e of safeEdges) {
      const d = (e.data ?? {}) as any
      d.layoutProfile = 'mind-map'
      e.data = d
    }
  }
  if (flowchartMode) {
    safeEdges = applyFlowchartStrictHandles(safeNodes, safeEdges, effectiveDirection)
    // 最后一步快速走线复查：当 handle/路由导致“看起来像斜线/不规则对穿”时，尝试少量替代走线并选择更自然的方案。
    safeEdges = quickReviewAndFixFlowchartRoutes(safeNodes, safeEdges, effectiveDirection)
  }

  safeNodes = normalizeNodesForGrid(safeNodes)
  safeEdges = normalizeEdgesForGrid(safeEdges)
  return { nodes: safeNodes, edges: safeEdges }
}

/**
 * 将 GraphBatchPayload 以一次 batch 语义应用到 Flow2Go。
 * - 默认 replace：用 payload 生成的新图覆盖当前 nodes/edges
 * - 一次 pushHistory，reason='ai-apply'
 */
export async function applyGraphBatchPayloadToFlow2Go(
  payload: GraphBatchPayload,
  ctx: ApplyToFlow2GoContext,
  opts?: { replace?: boolean },
): Promise<Flow2GoSnapshot> {
  const base = ctx.getSnapshot()
  const next = await materializeGraphBatchPayloadToSnapshot(payload, { replace: opts?.replace ?? true }, base)
  ctx.setSnapshot(next)
  ctx.pushHistory(next, 'ai-apply')
  return next
}
