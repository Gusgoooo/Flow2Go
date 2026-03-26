import type { Node } from '@xyflow/react'

export type AnyNode = Node<any>

export type Rect = { x: number; y: number; width: number; height: number }

// ---- 基础语义 ----

export function isFrameNode(node: AnyNode | undefined | null): boolean {
  return !!node && node.type === 'group'
}

export function getNodeSizeLike(node: AnyNode & { measured?: any; style?: any }): {
  width: number
  height: number
} {
  const w = (node.measured as any)?.width ?? (node as any).width ?? (node.style as any)?.width ?? 160
  const h = (node.measured as any)?.height ?? (node as any).height ?? (node.style as any)?.height ?? 48
  return { width: Number(w) || 160, height: Number(h) || 48 }
}

/** 由 parentId 链向上累加得到节点全局坐标（仅依赖 position/parentId，不依赖 ReactFlow 内部测量） */
export function getNodeAbsolutePosition(
  node: AnyNode & { position: { x: number; y: number }; parentId?: string },
  byId: Map<string, AnyNode & { position: { x: number; y: number }; parentId?: string }>,
): { x: number; y: number } {
  let x = node.position.x
  let y = node.position.y
  let pid = node.parentId
  const seen = new Set<string>()
  while (pid && !seen.has(pid)) {
    seen.add(pid)
    const p = byId.get(pid)
    if (!p) break
    x += p.position.x
    y += p.position.y
    pid = p.parentId
  }
  return { x, y }
}

export function getNodeAbsoluteRect(
  node: AnyNode & { position: { x: number; y: number }; parentId?: string; measured?: any; style?: any },
  byId: Map<string, AnyNode & { position: { x: number; y: number }; parentId?: string; measured?: any; style?: any }>,
): Rect {
  const pos = getNodeAbsolutePosition(node, byId)
  const { width, height } = getNodeSizeLike(node)
  return { x: pos.x, y: pos.y, width, height }
}

export function getRectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function isPointInsideRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height
}

// ---- Frame 嵌套规则 ----

/** 找到最合适的父 Frame：更深层优先，面积更小者优先 */
export function findBestParentFrame(
  targetRect: Rect,
  allNodes: AnyNode[],
  byId: Map<string, AnyNode & { position: { x: number; y: number }; parentId?: string; measured?: any; style?: any }>,
  excludeFrameIds?: Set<string>,
): AnyNode | null {
  const center = getRectCenter(targetRect)
  const frames = allNodes.filter((n) => isFrameNode(n) && !(excludeFrameIds?.has(n.id)))

  let best: AnyNode | null = null
  let bestDepth = -1
  let bestArea = Infinity

  const depthOf = (g: AnyNode): number => {
    let depth = 0
    let cur: AnyNode | undefined | null = g
    const seen = new Set<string>()
    while (cur?.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId)
      const p = byId.get(cur.parentId)
      if (!p || !isFrameNode(p)) break
      depth += 1
      cur = p
    }
    return depth
  }

  for (const frame of frames) {
    const frect = getNodeAbsoluteRect(frame as any, byId)
    if (!isPointInsideRect(center.x, center.y, frect)) continue
    const depth = depthOf(frame)
    const area = frect.width * frect.height
    if (depth > bestDepth || (depth === bestDepth && area < bestArea)) {
      bestDepth = depth
      bestArea = area
      best = frame
    }
  }

  return best
}

/** 是否应当从父 Frame 中脱离：中心点不再处于父 Frame 内部即视为脱离 */
export function shouldDetachFromParent(
  childRect: Rect,
  parentRect: Rect | null | undefined,
): boolean {
  if (!parentRect) return true
  const center = getRectCenter(childRect)
  return !isPointInsideRect(center.x, center.y, parentRect)
}
