/**
 * Business Big Map — 物化层
 *
 * 将 BigMapLayoutResult 转换为 Flow2Go 原生 nodes/edges 结构。
 * 容器 → type: 'group'（GroupNode，虚线/实线边框）
 * 叶子 → type: 'quad'（QuadNode，蓝色实心填充条形）
 */

import type { Node, Edge } from '@xyflow/react'
import type { BigMapLayoutNode, BigMapLayoutResult } from './types'

/**
 * 统一配色（不按 semanticRole 分色）：蓝色边框 + 透明蓝底。
 * - 容器：更浅的底色
 * - 叶子：略深的底色（但仍是透明底，而不是实心块）
 */
const BLUE_STROKE = 'rgba(37, 99, 235, 0.55)'
const CONTAINER_FILL = 'rgba(37, 99, 235, 0.05)'
const LEAF_FILL = 'rgba(37, 99, 235, 0.12)'
const TEXT_COLOR = '#0f172a'

export function materializeBigMapToFlow2Go(
  result: BigMapLayoutResult,
  _title?: string,
): { nodes: Node[]; edges: Edge[] } {
  const parentMap = buildParentMap(result.nodes)
  const nodes: Node[] = []
  const sorted = topologicalSort(result.nodes)

  for (const n of sorted) {
    const parentId = parentMap.get(n.id) ?? undefined
    const position = { x: n.x, y: n.y }

    if (n.type === 'container') {
      nodes.push({
        id: n.id,
        type: 'group',
        position,
        width: n.width,
        height: n.height,
        ...(parentId ? { parentId } : {}),
        data: {
          title: n.title,
          role: 'frame',
          fill: CONTAINER_FILL,
          stroke: BLUE_STROKE,
          strokeWidth: 1,
          titleFontSize: 13,
          titleFontWeight: '600',
          titleColor: TEXT_COLOR,
          bigMapRole: n.semanticRole,
        },
        style: { width: n.width, height: n.height },
      } as any)
    } else {
      nodes.push({
        id: n.id,
        type: 'quad',
        position,
        width: n.width,
        height: n.height,
        ...(parentId ? { parentId } : {}),
        data: {
          label: n.title,
          fill: LEAF_FILL,
          stroke: BLUE_STROKE,
          strokeWidth: 0,
          fontSize: 13,
          fontWeight: '500',
          textColor: TEXT_COLOR,
          textAlign: 'center',
          bigMapRole: n.semanticRole,
          ...(n.description ? { description: n.description } : {}),
        },
        style: { width: n.width, height: n.height },
      } as any)
    }
  }

  return { nodes, edges: [] }
}

function buildParentMap(nodes: BigMapLayoutNode[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const n of nodes) {
    for (const c of n.children) map.set(c, n.id)
  }
  return map
}

function topologicalSort(nodes: BigMapLayoutNode[]): BigMapLayoutNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const childSet = new Set<string>()
  for (const n of nodes) for (const c of n.children) childSet.add(c)

  const roots = nodes.filter((n) => !childSet.has(n.id))
  const result: BigMapLayoutNode[] = []
  const visited = new Set<string>()

  function visit(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const node = byId.get(id)
    if (!node) return
    result.push(node)
    for (const childId of node.children) visit(childId)
  }

  for (const root of roots) visit(root.id)
  for (const n of nodes) {
    if (!visited.has(n.id)) result.push(n)
  }
  return result
}
