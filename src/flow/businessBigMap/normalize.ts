/**
 * Business Big Map — Normalize
 *
 * 布局结果经过规范化：
 *  - snap 到 grid
 *  - 容器包围盒修正
 *  - 同行容器等高
 *  - 不再强制叶子拉满宽度（布局引擎已处理多列网格）
 */

import { GRID_UNIT, snapToGrid } from '../grid'
import type { BigMapLayoutNode, BigMapLayoutResult } from './types'
import {
  CONTAINER_PADDING_SIDE,
  CONTAINER_PADDING_BOTTOM,
} from './sizing'

export function normalizeBigMapLayout(result: BigMapLayoutResult): BigMapLayoutResult {
  const nodes = result.nodes.map((n) => ({ ...n }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // Pass 1: grid snap
  for (const n of nodes) {
    n.x = snapToGrid(n.x)
    n.y = snapToGrid(n.y)
    n.width = snapToGrid(n.width)
    n.height = snapToGrid(n.height)
  }

  // Pass 2: 容器包围盒修正
  for (const parent of nodes) {
    if (parent.type !== 'container' || parent.children.length === 0) continue
    const childNodes = getChildNodes(parent, byId)
    if (childNodes.length === 0) continue

    const maxRight = Math.max(...childNodes.map((c) => c.x + c.width))
    const maxBottom = Math.max(...childNodes.map((c) => c.y + c.height))
    parent.width = Math.max(parent.width, snapToGrid(maxRight + CONTAINER_PADDING_SIDE))
    parent.height = Math.max(parent.height, snapToGrid(maxBottom + CONTAINER_PADDING_BOTTOM))
  }

  // Pass 3: 同一行根容器等高
  const rootIds = findRootIds(nodes)
  const rootNodes = rootIds.map((id) => byId.get(id)!).filter(Boolean)
  const yGroups = groupByApproxY(rootNodes)
  for (const group of yGroups) {
    if (group.length <= 1) continue
    const maxH = Math.max(...group.map((n) => n.height))
    for (const n of group) n.height = snapToGrid(maxH)
  }

  // Pass 4: 内部同级子容器等高
  for (const parent of nodes) {
    if (parent.type !== 'container') continue
    const childContainers = parent.children
      .map((id) => byId.get(id))
      .filter((n): n is BigMapLayoutNode => !!n && n.type === 'container')
    if (childContainers.length > 1) {
      const maxH = Math.max(...childContainers.map((n) => n.height))
      for (const c of childContainers) c.height = snapToGrid(maxH)
    }
  }

  // Pass 5: 总尺寸
  let totalW = 0
  let totalH = 0
  for (const n of rootNodes) {
    totalW = Math.max(totalW, n.x + n.width)
    totalH = Math.max(totalH, n.y + n.height)
  }

  return {
    nodes,
    totalWidth: snapToGrid(Math.max(totalW, result.totalWidth)),
    totalHeight: snapToGrid(Math.max(totalH, result.totalHeight)),
  }
}

function getChildNodes(parent: BigMapLayoutNode, byId: Map<string, BigMapLayoutNode>): BigMapLayoutNode[] {
  return parent.children.map((id) => byId.get(id)).filter((c): c is BigMapLayoutNode => !!c)
}

function groupByApproxY(nodes: BigMapLayoutNode[]): BigMapLayoutNode[][] {
  if (nodes.length === 0) return []
  const sorted = [...nodes].sort((a, b) => a.y - b.y)
  const groups: BigMapLayoutNode[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = groups[groups.length - 1][0]
    if (Math.abs(sorted[i].y - prev.y) <= GRID_UNIT * 4) {
      groups[groups.length - 1].push(sorted[i])
    } else {
      groups.push([sorted[i]])
    }
  }
  return groups
}

function findRootIds(nodes: BigMapLayoutNode[]): string[] {
  const childSet = new Set<string>()
  for (const n of nodes) for (const c of n.children) childSet.add(c)
  return nodes.filter((n) => !childSet.has(n.id)).map((n) => n.id)
}
