import type { Edge, Node } from '@xyflow/react'
import { autoLayout } from '../layout'
import { layoutMindMapMindElixirStyle } from '../mindMap/mindElixirLayout'
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
  // ELK layered + elk.direction 映射 LR/TB/RL/BT（见 layout.ts）
  return dir as any
}

function frameDefaults(title: string) {
  return {
    width: 640,
    height: 420,
    data: {
      title,
      stroke: '#e2e8f0',
      fill: 'rgba(226, 232, 240, 0.20)',
      titleFontSize: 14,
      titleColor: '#64748b',
      role: 'frame',
    },
  }
}

const LAYOUT_UNIT = 24
const BUSINESS_INNER_UNIT = 12
const NODE_MIN_WIDTH_UNITS = 3
const BUSINESS_CHAPTER_W_30 = LAYOUT_UNIT * 30 // 30 grid units = 720px
const BUSINESS_CHAPTER_W_50 = LAYOUT_UNIT * 50 // 50 grid units = 1200px
const BUSINESS_CHAPTER_W_70 = LAYOUT_UNIT * 70 // 70 grid units
const BUSINESS_CHAPTER_W_90 = LAYOUT_UNIT * 90 // 90 grid units
const BUSINESS_CHAPTER_W_120 = LAYOUT_UNIT * 120 // 120 grid units
// Keep the old name for readability at call sites that still assume the "30 units" baseline.
const BUSINESS_CHAPTER_W = BUSINESS_CHAPTER_W_30
// Business Big Map: restrict theme palette (rotating)
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
    height: 44,
    data: {
      title,
      label: title,
      shape: shape ?? 'rect',
    },
  }
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
  const incidentEdges = allEdges.filter((e) => childIds.has(e.source) || childIds.has(e.target))
  // Spacing strategy:
  // - No edges inside: compact "group-like" alignment (1 unit gap)
  // - Has edges: slightly larger spacing for stable connections
  const UNIT = LAYOUT_UNIT
  // IMPORTANT: if there are cross-frame edges touching children, treat as "has edges"
  // to avoid over-compact layouts that make the overall flow unreadable.
  if (incidentEdges.length === 0) {
    const ordered = [...children].sort((a, b) => a.id.localeCompare(b.id))
    const cols = Math.max(1, Math.min(6, ordered.length))
    for (let i = 0; i < ordered.length; i += 1) {
      const n = ordered[i]
      const { w, h } = getNodeSize(n)
      const col = i % cols
      const row = Math.floor(i / cols)
      n.position = { x: col * (w + UNIT), y: row * (h + UNIT) }
    }
    return allNodes
  }

  // Edge-heavy flowcharts need more whitespace. Scale spacing by edge density.
  const n = Math.max(1, children.length)
  const e = incidentEdges.length
  const density = e / Math.max(1, n - 1) // tree≈1, dense>1
  const crossFrameEdges = incidentEdges.filter((edge) => childIds.has(edge.source) !== childIds.has(edge.target)).length
  const crossRatio = e > 0 ? crossFrameEdges / e : 0
  const highDensityMode = density >= 1.6 || crossRatio >= 0.34 || e >= Math.max(10, n * 1.7)
  const complexityBase = Math.max(0, Math.min(2.5, density))
  const complexityBoost = highDensityMode ? 0.75 + crossRatio * 0.8 : 0
  const complexity = Math.max(0, Math.min(3.2, complexityBase + complexityBoost))
  const nodesep = 40 + complexity * 20 // 40..104
  const ranksep = 84 + complexity * 34 // 84..193
  const margin = 28 + complexity * 14 // 28..72

  const laid = await autoLayout(children, internalEdges as any, dirToLayoutDirection(direction), {
    nodesep,
    ranksep,
    marginx: margin,
    marginy: margin,
  })
  const byId = new Map(laid.map((n) => [n.id, n.position]))
  return allNodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n))
}

async function layoutTopLevel(allNodes: Array<Node<any>>, allEdges: Array<Edge<any>>, direction: FlowDirection) {
  const top = allNodes.filter((n) => !n.parentId)
  if (top.length === 0) return allNodes
  const topIds = new Set(top.map((n) => n.id))
  const subEdges = allEdges.filter((e) => topIds.has(e.source) && topIds.has(e.target))
  const n = Math.max(1, top.length)
  const e = subEdges.length
  const density = e / Math.max(1, n - 1)
  const complexity = Math.max(0, Math.min(2.6, density))
  const laid = await autoLayout(top, subEdges as any, dirToLayoutDirection(direction), {
    nodesep: 72 + complexity * 16,
    ranksep: 116 + complexity * 22,
    marginx: 56 + complexity * 10,
    marginy: 56 + complexity * 10,
  })
  const byId = new Map(laid.map((n) => [n.id, n.position]))
  return allNodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n))
}

function wrapFramesToContents(allNodes: Array<Node<any>>, businessMode: boolean) {
  const TITLE_H = 32
  const MIN_W_DEFAULT = 220
  const MIN_H = 140
  const UNIT = businessMode ? BUSINESS_INNER_UNIT : LAYOUT_UNIT
  const MIN_NODE_W = Math.round(UNIT * NODE_MIN_WIDTH_UNITS)
  const NODE_GAP = Math.round(UNIT * 0.5)
  const MAX_COLS = businessMode ? 6 : 6

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

  // Business Big Map: chapter width is unified by the largest bucket.
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
    const BASE_LEAF_FRAME_W = leafAvailableWRequired + 2 * UNIT

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
      const padX = UNIT
      const parentW = 2 * padX + (cols - 1) * UNIT + cols * requiredChildW

      memo.set(frameId, parentW)
      visiting.delete(frameId)
      return parentW
    }

    let globalNeed = 0
    for (const chapter of topFrames) {
      globalNeed = Math.max(globalNeed, requiredWidthForFrame(chapter.id))
    }

    const tiers = [
      { w: BUSINESS_CHAPTER_W_30, label: 30 },
      { w: BUSINESS_CHAPTER_W_50, label: 50 },
      { w: BUSINESS_CHAPTER_W_70, label: 70 },
      { w: BUSINESS_CHAPTER_W_90, label: 90 },
      { w: BUSINESS_CHAPTER_W_120, label: 120 },
    ]

    // 递进一档：
    // - 当“运算结果对应的最大档位”为 50，则统一宽度取 70
    // - 运算结果对应为 70，则统一宽度取 90
    // - 以此类推（但仅当基础档位 >= 50 时才上调），避免小图被无谓放大。
    // 实现方式：先取 floor 档位（<= globalNeed 的最大 tier），再在基础档位为 50/70/90 时上调一档。
    let baseIdx = 0
    for (let i = 0; i < tiers.length; i += 1) {
      if (tiers[i].w <= globalNeed) baseIdx = i
    }
    const bumpedIdx = baseIdx >= 1 && baseIdx < tiers.length - 1 ? baseIdx + 1 : baseIdx
    return tiers[bumpedIdx].w
  }
  const businessUnifiedTopChapterWidth = calcBusinessUnifiedTopChapterWidth()
  const getBusinessChapterWidth = (isTop: boolean): number => (isTop ? businessUnifiedTopChapterWidth : BUSINESS_CHAPTER_W_30)

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
    const cellW = Math.max(MIN_NODE_W, Math.floor((availableW - (cols - 1) * UNIT) / cols))
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
      it.position = { x: col * (cellW + UNIT), y: originY + row * (h + UNIT) }
      maxBottom = Math.max(maxBottom, originY + row * (h + UNIT) + h)
    }
    return { maxBottom }
  }

  if (businessMode) {

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
      // Ensure this subtree obeys "max 3 direct child frames per parent" before layout.
      enforceMaxNestedFrames(frame.id, 3)

      const kids = childrenByParent.get(frame.id) ?? []
      const childFrames = kids.filter(isFrame).sort((a, b) => a.id.localeCompare(b.id))
      const childNodes = kids.filter((k) => !isFrame(k)).sort((a, b) => a.id.localeCompare(b.id))

      const padX = UNIT
      const padBottom = UNIT
      const padTop = TITLE_H + Math.round(UNIT * 1.35)
      const isTop = !frame.parentId
      // Top chapter width is selected by the generated structure.
      // Nested frames follow the width allocated by their parent.
      // Non-top frames must strictly follow recursive parent allocation.
      // Avoid forcing MIN_W_DEFAULT here, otherwise shallow mixed nesting will break the "recursive unit width" contract.
      const frameW = isTop ? getBusinessChapterWidth(true) : forcedWidth ?? MIN_W_DEFAULT
      const availableW = Math.max(1, frameW - padX * 2)

      // 1) 先递归并布局子画框（优先横向平铺）
      let yCursor = 0
      if (childFrames.length > 0) {
        // 横向优先，超出后换行；每行最多3个子画框
        const cols = Math.max(1, Math.min(3, childFrames.length))
        const cellW = Math.max(MIN_NODE_W, Math.floor((availableW - (cols - 1) * UNIT) / cols))

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
          const x = col * (cellW + UNIT)
          const y = row * (h + UNIT)
          cf.position = { x, y }
          maxBottom = Math.max(maxBottom, y + h)
        }
        yCursor = maxBottom
      }

      // 2) 再布局当前画框内的直接子节点（最多2列）
      if (childNodes.length > 0) {
        if (childFrames.length > 0) yCursor += UNIT
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
        frame.width = frameW
        frame.height = Math.max(MIN_H, TITLE_H + UNIT * 3)
        frame.style = { ...(frame.style as any), width: frame.width, height: frame.height }
        return
      }
      const contentW = maxX - minX
      const contentH = maxY - minY
      // Keep the width that parent allocated (strict recursive stretching contract).
      const nextW = frameW
      const nextH = Math.max(MIN_H, contentH + padTop + padBottom)
      const extraX = Math.max(0, nextW - (contentW + padX * 2))
      const dx = -minX + padX + extraX / 2
      const dy = -minY + padTop
      for (const k of kids) {
        k.position = { x: (k.position?.x ?? 0) + dx, y: (k.position?.y ?? 0) + dy }
      }
      frame.width = nextW
      frame.height = nextH
      frame.style = { ...(frame.style as any), width: nextW, height: nextH }
    }

    const topFrames = frames.filter((f) => !f.parentId).sort((a, b) => a.id.localeCompare(b.id))
    for (const tf of topFrames) {
      layoutBusinessFrame(tf, getBusinessChapterWidth(true))
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
    // Business mode: padding uses half grid unit (12px).
    // Default mode keeps previous rhythm.
    const padX = businessMode ? UNIT : isTop ? UNIT * 4 : UNIT
    const padBottom = businessMode ? UNIT : isTop ? UNIT * 4 : UNIT
    // business mode: reduce title-to-content gap a bit more
    const padTop = businessMode ? TITLE_H + Math.round(UNIT * 1.35) : TITLE_H + (isTop ? UNIT * 3 : UNIT)
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
    const minW = businessMode ? (isTop ? getBusinessChapterWidth(true) : 0) : MIN_W_DEFAULT
    let nextW = Math.max(minW, initialBounds.contentW + padX * 2)
    let nextH = Math.max(MIN_H, initialBounds.contentH + padTop + padBottom)

    // Business mode: stable auto-stretch, no special-case math.
    // - Keep paddings/gaps uniform (1 unit)
    // - Stretch children to fill width under the same parent
    if (businessMode) {
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
        const targetW = Math.min(businessUnifiedTopChapterWidth, curW)
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
        const res = stretchChildrenToWidth(nextW, padX, childNodes, childFrames.length > 0 ? maxBottom + UNIT : 0, true)
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
  const h = n.measured?.height ?? n.height ?? (typeof (n.style as any)?.height === 'number' ? (n.style as any).height : undefined) ?? 44
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

type Side = 'top' | 'right' | 'bottom' | 'left'

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

function chooseSideForVector(
  dx: number,
  dy: number,
  penalties: Partial<Record<Side, number>>,
): Side {
  const score = scoreSideForVector(dx, dy, penalties)
  const candidates: Side[] = ['right', 'left', 'bottom', 'top']
  let best: Side = candidates[0]
  let bestScore = score(best)
  for (let i = 1; i < candidates.length; i += 1) {
    const s = candidates[i]
    const sc = score(s)
    if (sc < bestScore) {
      best = s
      bestScore = sc
    }
  }
  return best
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

function applyInferredEdgeHandles(nodes: Array<Node<any>>, edges: Array<Edge<any>>) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
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
  // Per-node per-side lane counters (for autoOffset)
  const laneOutBySide = new Map<string, Record<Side, number>>()
  const laneInBySide = new Map<string, Record<Side, number>>()
  // Corridor lanes: separate edges from different columns so they don't overlap.
  // Keyed by (rootFrame, srcSide, dxSign) and bucketed by sourceX.
  const corridorBucketIndex = new Map<string, Map<number, number>>()

  const getLaneRec = (m: Map<string, Record<Side, number>>, id: string) =>
    m.get(id) ?? { top: 0, right: 0, bottom: 0, left: 0 }

  const bumpLane = (m: Map<string, Record<Side, number>>, id: string, side: Side) => {
    const rec = getLaneRec(m, id)
    rec[side] += 1
    m.set(id, rec)
  }

  // Convert 0,1,2,3... to signed lane: 0, +1, -1, +2, -2 ...
  const laneToSigned = (lane: number) => {
    if (lane <= 0) return 0
    const k = Math.ceil(lane / 2)
    return lane % 2 === 1 ? k : -k
  }

  const bump = (m: Map<string, Record<Side, number>>, id: string, side: Side) => {
    const rec = m.get(id) ?? { top: 0, right: 0, bottom: 0, left: 0 }
    rec[side] += 1
    m.set(id, rec)
  }

  // Seed occupancy from edges that already have handles (manual edits / imported snapshots)
  for (const e of edges) {
    const sh = handleToSide((e as any).sourceHandle)
    const th = handleToSide((e as any).targetHandle)
    if (sh) bump(anySourceSide, e.source, sh)
    if (th) bump(incomingByTargetSide, e.target, th)
  }

  return edges.map((e) => {
    // If already set, don't override (manual edits win)
    if ((e as any).sourceHandle || (e as any).targetHandle) return e

    const centers = getCenters(e.source, e.target, nodeById)
    if (!centers) {
      const fallback = inferHandlesForEdge(e.source, e.target, nodeById)
      return fallback ? { ...e, sourceHandle: fallback.sourceHandle, targetHandle: fallback.targetHandle } : e
    }

    const dx = centers.tCx - centers.sCx
    const dy = centers.tCy - centers.sCy

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
    const sides: Side[] = ['right', 'left', 'bottom', 'top']
    let srcSide: Side = chooseSideForVector(dx, dy, sourcePenalties)
    let tgtSide: Side = oppositeSide(srcSide)
    let bestPairScore = Number.POSITIVE_INFINITY
    for (const sSide of sides) {
      for (const tSide of sides) {
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
        const score =
          sourceScore(sSide) +
          targetScore(tSide) +
          preferOpposite +
          lanePenalty +
          undirectedLanePenalty +
          crossFramePenalty
        if (score < bestPairScore) {
          bestPairScore = score
          srcSide = sSide
          tgtSide = tSide
        }
      }
    }

    const next = { ...e, sourceHandle: sideToSourceHandle(srcSide), targetHandle: sideToTargetHandle(tgtSide) }

    // Auto-offset lanes to reduce overlapping edges even when sharing the same handle.
    // Spacing requirement: handle-to-handle distance >= 2 units.
    const laneSpacing = LAYOUT_UNIT * 2
    const outLaneRec = getLaneRec(laneOutBySide, e.source)
    const inLaneRec = getLaneRec(laneInBySide, e.target)
    const outLane = outLaneRec[srcSide] ?? 0
    const inLane = inLaneRec[tgtSide] ?? 0
    const lane = Math.max(outLane, inLane)
    const signedLane = laneToSigned(lane)

    // Corridor separation: distribute edges from different source "columns"
    // to different midlines, so right-column edges don't mask left-column edges.
    const rootKey = getRootFrameId(e.source) ?? 'root'
    const dxSign = dx >= 0 ? 'pos' : 'neg'
    const corridorKey = `${rootKey}:${srcSide}:${dxSign}`
    const bucketStep = LAYOUT_UNIT * 10 // coarse column bucketing
    const xBucket = Math.round(centers.sCx / bucketStep)
    const bucketMap = corridorBucketIndex.get(corridorKey) ?? new Map<number, number>()
    if (!corridorBucketIndex.has(corridorKey)) corridorBucketIndex.set(corridorKey, bucketMap)
    if (!bucketMap.has(xBucket)) bucketMap.set(xBucket, bucketMap.size)
    const corridorSigned = laneToSigned(bucketMap.get(xBucket) ?? 0)

    // Combine offsets (cap to avoid extreme detours)
    const autoOffset = Math.max(-laneSpacing * 6, Math.min(laneSpacing * 6, (signedLane + corridorSigned) * laneSpacing))
    ;(next as any).data = { ...((next as any).data ?? {}), autoOffset }

    // Update occupancy for subsequent edges in the same batch
    bump(anySourceSide, e.source, srcSide)
    bump(incomingByTargetSide, e.target, tgtSide)
    bumpLane(laneOutBySide, e.source, srcSide)
    bumpLane(laneInBySide, e.target, tgtSide)
    const laneKey = `${e.source}->${e.target}:${srcSide}:${tgtSide}`
    laneByPair.set(laneKey, (laneByPair.get(laneKey) ?? 0) + 1)
    const undirectedLaneKey =
      e.source <= e.target
        ? `${e.source}<->${e.target}:${srcSide}:${tgtSide}`
        : `${e.target}<->${e.source}:${tgtSide}:${srcSide}`
    laneByUndirectedPair.set(undirectedLaneKey, (laneByUndirectedPair.get(undirectedLaneKey) ?? 0) + 1)

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
 * 思维导图：连线只能从左右句柄进出（标准思维导图观感），不走上/下。
 */
function applyMindMapHorizontalHandles(nodes: Array<Node<any>>, edges: Array<Edge<any>>): Array<Edge<any>> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  return edges.map((e) => {
    const tgt = nodeById.get(e.target)
    const side = (tgt?.data as any)?.mindMapSide as 'L' | 'R' | undefined
    if (side === 'R') return { ...e, sourceHandle: 's-right', targetHandle: 't-left' }
    if (side === 'L') return { ...e, sourceHandle: 's-left', targetHandle: 't-right' }
    return e
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
  // business-big-map-elk：不走 BBM 专有的章节/画框主题等后处理，依赖 transpiler 的 ELK autoLayout
  const businessMode = ((payload.meta as any)?.layoutProfile ?? '') === 'business-big-map'
  const mindMapMode = ((payload.meta as any)?.layoutProfile ?? '') === 'mind-map'

  // When Mermaid creates multiple frames, place them with a safe gap by default
  // so they never overlap（顶层 frame 往往互不连通，分层布局不会把它们拉开，需后续 tile）。
  const FRAME_GAP = 160
  let frameAutoIndex = 0
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
          // Nested frames live inside parent; place them at origin and let withinFrame layout handle children.
          if (isNested) return { x: 0, y: 0 }
          const idx = frameAutoIndex++
          // Arrange frames along the main flow direction
          if (payload.direction === 'TB' || payload.direction === 'BT') {
            return { x: 0, y: idx * (h + FRAME_GAP) }
          }
          return { x: idx * (w + FRAME_GAP), y: 0 }
        })()
      const node: Node<any> = {
        id: op.params.id,
        type: 'group',
        position: pos,
        ...(op.params.parentId ? { parentId: op.params.parentId } : {}),
        width: w,
        height: h,
        data: { ...d.data, title: op.params.title, ...(op.params.style ?? {}) },
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
          ...(op.params.style ?? {}),
        },
      }
      nodes.push(node)
      nodeById.set(node.id, node)
      continue
    }

    if (op.op === 'graph.createEdge') {
      if (edgeById.has(op.params.id)) continue
      const defaultStyle: Record<string, unknown> = { strokeWidth: 1.5 }
      const mergedStyle = { ...defaultStyle, ...(op.params.style ?? {}) }

      const trimmedLabel = typeof op.params.label === 'string' ? op.params.label.trim() : ''

      // 思维导图：默认无箭头（无“边上语义”）；仅当 Mermaid 写了 -->|文案| 等显式边标签时才显示箭头
      let arrowStyle: 'none' | 'end' | 'start' | 'both'
      if (mindMapMode) {
        arrowStyle = trimmedLabel.length > 0 ? (op.params.arrowStyle ?? 'end') : 'none'
      } else {
        arrowStyle = op.params.arrowStyle ?? 'end'
      }

      const edge: Edge<any> = {
        id: op.params.id,
        source: op.params.source,
        target: op.params.target,
        type: mindMapMode ? 'bezier' : op.params.type ?? 'bezier',
        ...(trimmedLabel ? { label: op.params.label } : {}),
        data: { arrowStyle },
        style: mergedStyle as any,
        ...(arrowStyle === 'none' ? { markerEnd: undefined, markerStart: undefined } : {}),
      }
      edges.push(edge)
      edgeById.set(edge.id, edge)
      continue
    }

    if (op.op === 'graph.autoLayout') {
      const dir = op.params.direction
      if (op.params.scope === 'withinFrame' && op.params.frameId) {
        const next = await layoutWithinFrame(nodes, edges, op.params.frameId, dir)
        nodes.splice(0, nodes.length, ...next)
      } else if (op.params.scope === 'all') {
        const next = await layoutTopLevel(nodes, edges, dir)
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

  // Make frames compact like manual grouping
  safeNodes = wrapFramesToContents(safeNodes, businessMode)

  // Mind Map：纯节点 + Mind Elixir `layoutSSR` 左右分支分配 + 左右展开几何布局
  if (mindMapMode) {
    const palette = TOP_FRAME_THEME_COLORS

    // 思维导图：不允许任何画框/编组容器（group role=frame）。
    const frameRoleNodes = safeNodes.filter((n) => n.type === 'group' && (n.data as any)?.role === 'frame')
    if (frameRoleNodes.length > 0) {
      const frameIdSet = new Set(frameRoleNodes.map((f) => f.id))
      for (const n of safeNodes) {
        if (n.type === 'quad' && n.parentId && frameIdSet.has(n.parentId)) {
          n.parentId = undefined
        }
      }
      safeNodes = safeNodes.filter((n) => !(n.type === 'group' && (n.data as any)?.role === 'frame'))
    }

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
        const color = palette[d % palette.length]
        n.data = {
          ...(n.data ?? {}),
          stroke: color,
          strokeWidth: 2,
          handleMode: 'leftRight',
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
          '--xy-edge-stroke': color,
        }
      }
    }
  }

  // Final pass: tile frames so they never overlap and are aligned.
  // Only affects frames without explicit position.
  const safeById = new Map(safeNodes.map((n) => [n.id, n]))
  const framesInOrder = (frameOrder.length ? frameOrder : safeNodes.map((n) => n.id))
    .map((id) => safeById.get(id))
    // only tile TOP-LEVEL frames; nested frames should stay within their parent
    .filter((n): n is Node<any> => n != null && !n.parentId && n.type === 'group' && (n.data as any)?.role === 'frame')

  let cursorX = 0
  let cursorY = 0
  const parentGap = businessMode ? BUSINESS_INNER_UNIT : LAYOUT_UNIT * 2
  const count = framesInOrder.filter((f) => !frameExplicitPos.has(f.id)).length
  const gridSpan = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))))
  let row = 0
  let col = 0
  let rowMaxH = 0
  let colMaxW = 0
  // Business Big Map: enforce equal chapter widths around 600px.
  const businessChapterW = BUSINESS_CHAPTER_W
  if (businessMode) {
    const byParent = new Map<string, Array<Node<any>>>()
    for (const n of safeNodes) {
      if (!n.parentId) continue
      const arr = byParent.get(n.parentId) ?? []
      arr.push(n)
      byParent.set(n.parentId, arr)
    }
    for (const f of framesInOrder) {
      const curW =
        f.measured?.width ??
        f.width ??
        (typeof (f.style as any)?.width === 'number' ? (f.style as any).width : undefined) ??
        640
      const desiredW = Math.max(curW, businessChapterW)
      if (desiredW > curW) {
        const extra = desiredW - curW
        const kids = byParent.get(f.id) ?? []
        for (const k of kids) {
          k.position = { x: (k.position?.x ?? 0) + extra / 2, y: k.position?.y ?? 0 }
        }
        f.width = desiredW
        f.style = { ...(f.style as any), width: desiredW }
      } else {
        f.width = desiredW
        f.style = { ...(f.style as any), width: desiredW }
      }
    }
  }

  for (const f of framesInOrder) {
    if (frameExplicitPos.has(f.id)) continue
    const w = f.measured?.width ?? f.width ?? (typeof (f.style as any)?.width === 'number' ? (f.style as any).width : undefined) ?? 640
    const h = f.measured?.height ?? f.height ?? (typeof (f.style as any)?.height === 'number' ? (f.style as any).height : undefined) ?? 420

    if (businessMode) {
      // Business Big Map requires top->down parent frame ordering.
      f.position = { x: cursorX, y: cursorY }
      cursorY += h + parentGap
    } else {
      const verticalFirst = payload.direction === 'TB' || payload.direction === 'BT'
      if (!verticalFirst) {
        f.position = { x: cursorX, y: cursorY }
        cursorX += w + FRAME_GAP
        rowMaxH = Math.max(rowMaxH, h)
        col += 1
        if (col >= gridSpan) {
          col = 0
          row += 1
          cursorX = 0
          cursorY += rowMaxH + FRAME_GAP
          rowMaxH = 0
        }
      } else {
        f.position = { x: cursorX, y: cursorY }
        cursorY += h + FRAME_GAP
        colMaxW = Math.max(colMaxW, w)
        row += 1
        if (row >= gridSpan) {
          row = 0
          col += 1
          cursorY = 0
          cursorX += colMaxW + FRAME_GAP
          colMaxW = 0
        }
      }
    }
  }

  if (businessMode) {
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
      // IMPORTANT: Business Big Map level semantics (outer -> inner)
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

  // Mind-map：强制左右句柄（标准思维导图），覆盖几何推断可能选出的上/下句柄。
  if (mindMapMode) {
    safeEdges = applyMindMapHorizontalHandles(safeNodes, safeEdges)
  }

  // Mind-map: avoid perpendicular autoOffset that makes bezier start/end not align with handle.
  if (mindMapMode) {
    for (const e of safeEdges) {
      const data = (e.data ?? {}) as any
      data.autoOffset = 0
      e.data = data
    }
  }

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