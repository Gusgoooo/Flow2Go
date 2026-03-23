import type { Edge, Node } from '@xyflow/react'
import { autoLayoutDagre } from '../dagreLayout'
import { layoutMindMapMindElixirStyle } from '../mindMap/mindElixirLayout'
import { autoLayoutSwimlane } from '../swimlaneLayout'
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
  const MIN_W_DEFAULT = 220
  const MIN_H = 140
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

function shouldPreferLeftToRightByComplexity(payload: GraphBatchPayload): boolean {
  const nodeCount = payload.operations.filter((op) => op.op === 'graph.createNodeQuad').length
  const edgeCount = payload.operations.filter((op) => op.op === 'graph.createEdge').length
  if (nodeCount <= 0) return false
  // 麻花风险兜底：边显著多于节点时，优先改为 LR，通常可减少交叉感。
  return edgeCount > Math.max(8, Math.floor(nodeCount * 1.2))
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
    let foundStrictPair = false
    const sourceIncomingRec = incomingByTargetSide.get(e.source) ?? { top: 0, right: 0, bottom: 0, left: 0 }
    const targetOutgoingRec = anySourceSide.get(e.target) ?? { top: 0, right: 0, bottom: 0, left: 0 }

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
      return sourceScore(sSide) + targetScore(tSide) + preferOpposite + lanePenalty + undirectedLanePenalty + crossFramePenalty
    }

    // Pass 1 (strict):
    // - source outgoing side must not already have incoming on same side
    // - target incoming side must not already have outgoing on same side
    for (const sSide of sides) {
      for (const tSide of sides) {
        if ((sourceIncomingRec[sSide] ?? 0) > 0) continue
        if ((targetOutgoingRec[tSide] ?? 0) > 0) continue
        const score = scorePair(sSide, tSide)
        if (score < bestPairScore) {
          foundStrictPair = true
          bestPairScore = score
          srcSide = sSide
          tgtSide = tSide
        }
      }
    }

    // Pass 2 (fallback): if strict impossible, allow mixed in/out side
    // but still choose nearest geometric pair.
    if (!foundStrictPair) {
      bestPairScore = Number.POSITIVE_INFINITY
      for (const sSide of sides) {
        for (const tSide of sides) {
          const score = scorePair(sSide, tSide)
          if (score < bestPairScore) {
            bestPairScore = score
            srcSide = sSide
            tgtSide = tSide
          }
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
  const incomingByNode = new Map<string, Set<Side>>()
  const outgoingByNode = new Map<string, Set<Side>>()
  const toSide = (h: string): Side => (h.endsWith('-top') ? 'top' : h.endsWith('-right') ? 'right' : h.endsWith('-bottom') ? 'bottom' : 'left')
  const addSide = (m: Map<string, Set<Side>>, id: string, side: Side) => {
    const s = m.get(id) ?? new Set<Side>()
    s.add(side)
    m.set(id, s)
  }
  const sideCandidates = (preferred: Side): Side[] => {
    if (preferred === 'top') return ['top', 'left', 'right', 'bottom']
    if (preferred === 'bottom') return ['bottom', 'left', 'right', 'top']
    if (preferred === 'left') return ['left', 'top', 'bottom', 'right']
    return ['right', 'top', 'bottom', 'left']
  }
  const pickSourceSide = (nodeId: string, preferred: Side): Side => {
    const incoming = incomingByNode.get(nodeId) ?? new Set<Side>()
    const cands = sideCandidates(preferred)
    for (const c of cands) {
      if (!incoming.has(c)) return c
    }
    return preferred
  }
  const pickTargetSide = (nodeId: string, preferred: Side): Side => {
    const outgoing = outgoingByNode.get(nodeId) ?? new Set<Side>()
    const cands = sideCandidates(preferred)
    for (const c of cands) {
      if (!outgoing.has(c)) return c
    }
    return preferred
  }

  return edges.map((e) => {
    const centers = getCenters(e.source, e.target, nodeById)
    if (!centers) return e
    const dx = centers.tCx - centers.sCx
    const dy = centers.tCy - centers.sCy

    let sourceHandle: string
    let targetHandle: string
    if (direction === 'LR' || direction === 'RL') {
      const srcPref: Side = dx >= 0 ? 'right' : 'left'
      const tgtPref: Side = dx >= 0 ? 'left' : 'right'
      const srcSide = pickSourceSide(e.source, srcPref)
      const tgtSide = pickTargetSide(e.target, tgtPref)
      sourceHandle = `s-${srcSide}`
      targetHandle = `t-${tgtSide}`
    } else if (direction === 'TB' || direction === 'BT') {
      const srcPref: Side = dy >= 0 ? 'bottom' : 'top'
      const tgtPref: Side = dy >= 0 ? 'top' : 'bottom'
      const srcSide = pickSourceSide(e.source, srcPref)
      const tgtSide = pickTargetSide(e.target, tgtPref)
      sourceHandle = `s-${srcSide}`
      targetHandle = `t-${tgtSide}`
    } else {
      const inferred = inferHandlesForEdge(e.source, e.target, nodeById)
      if (!inferred) return e
      const srcPref = toSide(inferred.sourceHandle)
      const tgtPref = toSide(inferred.targetHandle)
      const srcSide = pickSourceSide(e.source, srcPref)
      const tgtSide = pickTargetSide(e.target, tgtPref)
      sourceHandle = `s-${srcSide}`
      targetHandle = `t-${tgtSide}`
    }

    addSide(outgoingByNode, e.source, toSide(sourceHandle))
    addSide(incomingByNode, e.target, toSide(targetHandle))
    const d = { ...((e.data ?? {}) as any), autoOffset: 0 }
    return { ...e, sourceHandle, targetHandle, data: d }
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
  const flowchartMode = !mindMapMode
  const preferLR = flowchartMode && shouldPreferLeftToRightByComplexity(payload)
  const preferLRDefault = flowchartMode && payload.direction !== 'LR'
  // 流程图：不强制节点方向；仅在“麻花风险”下兜底优先 LR。
  const effectiveDirection: FlowDirection = preferLRDefault || preferLR ? 'LR' : payload.direction

  const swimlaneMode = ((payload.meta as any)?.layoutProfile ?? '') === 'swimlane'
  const swimlaneDirection: 'horizontal' | 'vertical' = (payload.meta as any)?.swimlaneDirection ?? 'horizontal'
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
      const nodeData: Record<string, any> = {
        ...d.data,
        title: op.params.title,
        ...(op.params.style ?? {}),
      }
      if (isLane) {
        nodeData.role = 'lane'
        nodeData.laneMeta = {
          laneId: op.params.id,
          laneIndex: laneIndexCounter++,
          laneAxis: swimlaneDirection === 'vertical' ? 'column' : 'row',
          headerSize: 44,
          padding: { top: 20, right: 24, bottom: 20, left: 24 },
          minLaneWidth: 800,
          minLaneHeight: 160,
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
      const styleObj = (op.params.style ?? {}) as Record<string, any>
      if (styleObj.semanticType && !op.params.shape) {
        const st = styleObj.semanticType
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

      const edgeData: Record<string, any> = { arrowStyle }
      if (swimlaneMode) {
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
      }

      const isCrossLane = edgeData.semanticType === 'crossLane'
      const edgeType = swimlaneMode
        ? (isCrossLane ? 'smoothstep' : (op.params.type ?? 'bezier'))
        : (mindMapMode || flowchartMode ? 'bezier' : op.params.type ?? 'bezier')

      const edge: Edge<any> = {
        id: op.params.id,
        source: op.params.source,
        target: op.params.target,
        type: edgeType,
        ...(trimmedLabel ? { label: op.params.label } : {}),
        data: {
          ...edgeData,
          ...(flowchartMode ? { labelTextOnly: true } : {}),
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
      const topLevelDir: FlowDirection = 'LR'
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
    let safeEdges = applyInferredEdgeHandles(safeNodes, edges)
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
          strokeWidth: 1.5,
          '--xy-edge-stroke': color,
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
      const h = f.measured?.height ?? f.height ?? (typeof (f.style as any)?.height === 'number' ? (f.style as any).height : undefined) ?? 420
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
    const topLevelDir: FlowDirection = 'LR'
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
      d.autoOffset = 0
      e.data = d
    }
  }
  if (flowchartMode) {
    safeEdges = applyFlowchartStrictHandles(safeNodes, safeEdges, effectiveDirection)
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