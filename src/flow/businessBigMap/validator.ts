/**
 * Business Big Map — Validator / Repairer
 *
 * 校验布局结果、自动修复可修复问题、报告不可修复问题。
 */

import { GRID_UNIT, snapToGrid } from '../grid'
import type {
  BigMapLayoutNode,
  BigMapLayoutResult,
  BigMapValidationIssue,
  BusinessBigMapIR,
} from './types'
import {
  CONTAINER_HEADER_HEIGHT,
  CONTAINER_PADDING_TOP,
  CONTAINER_PADDING_SIDE,
  CONTAINER_PADDING_BOTTOM,
} from './sizing'

export interface ValidationResult {
  layout: BigMapLayoutResult
  issues: BigMapValidationIssue[]
}

// ─── IR 校验（进布局前） ───

export function validateIR(ir: BusinessBigMapIR): { ir: BusinessBigMapIR; issues: BigMapValidationIssue[] } {
  const issues: BigMapValidationIssue[] = []
  const fixedNodes = ir.nodes.map((n) => ({ ...n }))

  // 检查 id 唯一性
  const seen = new Set<string>()
  for (const n of fixedNodes) {
    if (seen.has(n.id)) {
      const newId = `${n.id}-dup-${Math.random().toString(16).slice(2, 6)}`
      issues.push({ severity: 'warning', nodeId: n.id, message: `重复 id "${n.id}"，已重命名为 "${newId}"`, autoFixed: true })
      n.id = newId
    }
    seen.add(n.id)
  }

  // 检查 children 引用有效性
  const newIdSet = new Set(fixedNodes.map((n) => n.id))
  for (const n of fixedNodes) {
    const validChildren = n.children.filter((c) => newIdSet.has(c))
    if (validChildren.length !== n.children.length) {
      const removed = n.children.filter((c) => !newIdSet.has(c))
      issues.push({ severity: 'warning', nodeId: n.id, message: `children 中引用了不存在的节点：${removed.join(', ')}，已移除`, autoFixed: true })
      n.children = validChildren
    }
  }

  // 检查循环引用
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const nodeById = new Map(fixedNodes.map((n) => [n.id, n]))

  function hasCycle(id: string): boolean {
    if (visited.has(id)) return false
    if (visiting.has(id)) return true
    visiting.add(id)
    const node = nodeById.get(id)
    if (node) {
      for (const child of node.children) {
        if (hasCycle(child)) {
          node.children = node.children.filter((c) => c !== child)
          issues.push({ severity: 'error', nodeId: id, message: `检测到循环引用 ${id} → ${child}，已断开`, autoFixed: true })
          return false
        }
      }
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  for (const n of fixedNodes) hasCycle(n.id)

  // 检查 type 一致性：有 children 但 type=node → 升级为 container
  for (const n of fixedNodes) {
    if (n.children.length > 0 && n.type === 'node') {
      issues.push({ severity: 'info', nodeId: n.id, message: `节点 "${n.title}" 有子节点但 type=node，已自动升级为 container`, autoFixed: true })
      n.type = 'container'
    }
  }

  return { ir: { ...ir, nodes: fixedNodes }, issues }
}

// ─── 布局后校验 ───

export function validateLayout(result: BigMapLayoutResult): ValidationResult {
  const issues: BigMapValidationIssue[] = []
  const nodes = result.nodes.map((n) => ({ ...n }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // 1. 节点重叠检测（同层兄弟节点间）
  const parentMap = buildParentMap(nodes)
  const siblingGroups = groupSiblings(nodes, parentMap)

  for (const [, siblings] of siblingGroups) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i]
        const b = siblings[j]
        if (rectsOverlap(a, b)) {
          issues.push({
            severity: 'warning',
            nodeId: b.id,
            message: `节点 "${b.title}" 与 "${a.title}" 重叠，已调整位置`,
            autoFixed: true,
          })
          b.x = snapToGrid(a.x + a.width + GRID_UNIT * 3)
        }
      }
    }
  }

  // 2. 子节点越界检测
  for (const parent of nodes) {
    if (parent.type !== 'container' || parent.children.length === 0) continue

    const children = parent.children.map((id) => byId.get(id)).filter((c): c is BigMapLayoutNode => !!c)
    for (const child of children) {
      let fixed = false
      if (child.x < 0) {
        child.x = snapToGrid(CONTAINER_PADDING_SIDE)
        fixed = true
      }
      if (child.y < CONTAINER_HEADER_HEIGHT) {
        child.y = snapToGrid(CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING_TOP)
        fixed = true
      }
      if (child.x + child.width > parent.width) {
        parent.width = snapToGrid(child.x + child.width + CONTAINER_PADDING_SIDE)
        fixed = true
      }
      if (child.y + child.height > parent.height) {
        parent.height = snapToGrid(child.y + child.height + CONTAINER_PADDING_BOTTOM)
        fixed = true
      }
      if (fixed) {
        issues.push({
          severity: 'warning',
          nodeId: child.id,
          message: `子节点 "${child.title}" 越界容器 "${parent.title}"，已修正`,
          autoFixed: true,
        })
      }
    }
  }

  // 3. 标题栏遮挡检测
  for (const parent of nodes) {
    if (parent.type !== 'container') continue
    const children = parent.children.map((id) => byId.get(id)).filter((c): c is BigMapLayoutNode => !!c)
    const minTop = CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING_TOP
    for (const child of children) {
      if (child.y < minTop) {
        issues.push({
          severity: 'warning',
          nodeId: child.id,
          message: `子节点 "${child.title}" 被标题栏遮挡，已下移`,
          autoFixed: true,
        })
        child.y = snapToGrid(minTop)
      }
    }
  }

  // 4. 顺序稳定性检查（同一容器内节点按 order 排序后位置应递增）
  for (const parent of nodes) {
    if (parent.type !== 'container' || parent.children.length <= 1) continue
    const children = parent.children
      .map((id) => byId.get(id))
      .filter((c): c is BigMapLayoutNode => !!c)
      .sort((a, b) => a.order - b.order)

    for (let i = 1; i < children.length; i++) {
      const prev = children[i - 1]
      const curr = children[i]
      if (curr.x < prev.x && curr.y < prev.y) {
        issues.push({
          severity: 'info',
          nodeId: curr.id,
          message: `节点 "${curr.title}" 顺序与位置不一致（order=${curr.order}）`,
          autoFixed: false,
        })
      }
    }
  }

  return {
    layout: { nodes, totalWidth: result.totalWidth, totalHeight: result.totalHeight },
    issues,
  }
}

function rectsOverlap(a: BigMapLayoutNode, b: BigMapLayoutNode): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function buildParentMap(nodes: BigMapLayoutNode[]): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const n of nodes) map.set(n.id, null)
  for (const n of nodes) {
    for (const c of n.children) map.set(c, n.id)
  }
  return map
}

function groupSiblings(
  nodes: BigMapLayoutNode[],
  parentMap: Map<string, string | null>,
): Map<string | null, BigMapLayoutNode[]> {
  const groups = new Map<string | null, BigMapLayoutNode[]>()
  for (const n of nodes) {
    const parentId = parentMap.get(n.id) ?? null
    const arr = groups.get(parentId) ?? []
    arr.push(n)
    groups.set(parentId, arr)
  }
  return groups
}
