/**
 * Business Big Map — 节点尺寸计算
 *
 * 紧凑填充式布局：叶子节点宽度由父容器决定（后续拉伸），
 * 这里只计算最小宽度和固定高度。
 */

import { GRID_UNIT, snapToGrid } from '../grid'
import type { BigMapIRNode, BigMapLayoutNode, BusinessBigMapIR } from './types'

const CHAR_WIDTH_CJK = 14
const CHAR_WIDTH_LATIN = 8

/** 叶子节点（蓝色条形）固定高度 */
const LEAF_HEIGHT = 48
const LEAF_MIN_WIDTH = 140

/** 容器标题栏高度 */
const HEADER_HEIGHT = 40
/** 容器内边距 */
const PAD_TOP = 12
const PAD_SIDE = 12
const PAD_BOTTOM = 12
/** 子节点之间纵向间距 */
const CHILD_GAP = 8
/** 同级容器之间横向间距 */
const SIBLING_GAP = 16

function measureTextWidth(text: string): number {
  let w = 0
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x7f ? CHAR_WIDTH_CJK : CHAR_WIDTH_LATIN
  }
  return w
}

function measureLeafMinWidth(node: BigMapIRNode): number {
  // 给叶子更宽的默认内边距，避免文本显得拥挤
  return snapToGrid(Math.max(LEAF_MIN_WIDTH, measureTextWidth(node.title) + 40), GRID_UNIT)
}

/**
 * 为 IR 中所有节点计算初始最小尺寸。
 * 最终宽度由布局层拉伸到父容器宽度。
 */
export function computeNodeSizes(ir: BusinessBigMapIR): BigMapLayoutNode[] {
  return ir.nodes.map((n) => {
    if (n.type === 'node') {
      return {
        ...n,
        width: measureLeafMinWidth(n),
        height: snapToGrid(LEAF_HEIGHT),
        x: 0,
        y: 0,
      }
    }
    const titleW = measureTextWidth(n.title) + PAD_SIDE * 2
    return {
      ...n,
      width: snapToGrid(Math.max(titleW, LEAF_MIN_WIDTH)),
      height: snapToGrid(HEADER_HEIGHT + PAD_TOP + PAD_BOTTOM),
      x: 0,
      y: 0,
    }
  })
}

export {
  HEADER_HEIGHT as CONTAINER_HEADER_HEIGHT,
  PAD_TOP as CONTAINER_PADDING_TOP,
  PAD_SIDE as CONTAINER_PADDING_SIDE,
  PAD_BOTTOM as CONTAINER_PADDING_BOTTOM,
  CHILD_GAP,
  SIBLING_GAP,
  LEAF_HEIGHT,
}
