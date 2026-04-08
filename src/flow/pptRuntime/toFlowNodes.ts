import type { Node } from '@xyflow/react'
import { snapPointToGrid } from '../grid'
import { PPT_FRAME_ROLE, PPT_FRAME_STEP_X, PPT_SLIDE_HEIGHT, PPT_SLIDE_WIDTH, PPT_TYPOGRAPHY_TOKENS } from '../constants'
import type { RoleBlock } from './types'

export type FlowNode = Node<any>

function newId(prefix: string, n: number) {
  return `${prefix}-${n}-${Math.random().toString(16).slice(2, 8)}`
}

export function nextPptSlideIndex(nodes: FlowNode[]): number {
  let max = 0
  for (const n of nodes) {
    if (n?.type !== 'group') continue
    const role = (n.data as any)?.role
    if (role !== PPT_FRAME_ROLE) continue
    const idx = Number((n.data as any)?.slideIndex)
    if (Number.isFinite(idx)) max = Math.max(max, idx)
  }
  return max + 1
}

export function buildPptSlideFrameNodes(args: {
  baseNodes: FlowNode[]
  slideIndex: number
  cleanedSlideImageDataUrl: string
  roleBlocks: RoleBlock[]
  frameX: number
}): FlowNode[] {
  const { baseNodes, slideIndex, cleanedSlideImageDataUrl, roleBlocks, frameX } = args

  const frameId = newId('ppt-frame', slideIndex)
  const frameNode: FlowNode = {
    id: frameId,
    type: 'group',
    position: { x: frameX, y: 0 },
    data: {
      role: PPT_FRAME_ROLE,
      slideIndex,
      slideName: String(slideIndex),
      title: String(slideIndex),
      roleHint: 'ppt',
    },
    width: PPT_SLIDE_WIDTH,
    height: PPT_SLIDE_HEIGHT,
    style: { width: PPT_SLIDE_WIDTH, height: PPT_SLIDE_HEIGHT },
  }

  const bgNode: FlowNode = {
    id: newId('ppt-bg', slideIndex),
    type: 'asset',
    parentId: frameId,
    position: { x: 0, y: 0 },
    data: {
      assetUrl: cleanedSlideImageDataUrl,
      assetName: `ppt-slide-${slideIndex}`,
      assetType: 'png',
      assetWidth: PPT_SLIDE_WIDTH,
      assetHeight: PPT_SLIDE_HEIGHT,
    },
    width: PPT_SLIDE_WIDTH,
    height: PPT_SLIDE_HEIGHT,
    style: { width: PPT_SLIDE_WIDTH, height: PPT_SLIDE_HEIGHT },
  }

  const textNodes: FlowNode[] = roleBlocks.map((b, i) => {
    const token = PPT_TYPOGRAPHY_TOKENS[b.role]
    const [x, y, w, h] = b.bbox
    const snapped = snapPointToGrid({ x, y })
    return {
      id: newId(`ppt-text-${b.role}`, i + 1),
      type: 'text',
      parentId: frameId,
      position: { x: snapped.x, y: snapped.y },
      data: {
        label: b.text,
        labelFontSize: token.fontSize,
        labelFontWeight: String(token.fontWeight),
        labelColor: token.color,
        role: b.role,
        fontFamily: token.fontFamily,
      },
      width: Math.max(1, w),
      height: Math.max(1, h),
      style: { width: Math.max(1, w), height: Math.max(1, h) },
    }
  })

  return [...baseNodes, frameNode, bgNode, ...textNodes]
}

export function computePptFrameXForNewSlide(args: { existingPptFrames: number; slideOrder: number }): number {
  const { existingPptFrames, slideOrder } = args
  const i = existingPptFrames + slideOrder
  return i * PPT_FRAME_STEP_X
}

