import type { Node } from '@xyflow/react'
import { PPT_FRAME_ROLE, PPT_SLIDE_HEIGHT, PPT_SLIDE_WIDTH, PPT_TYPOGRAPHY_TOKENS } from '../constants'
import { getNodeAbsolutePosition, getNodeSizeLike } from '../frameUtils'
import type { ExportPayload, ExportSlide, ExportTextNode } from './types'
import { getOrderedPptFrames } from './getOrderedPptFrames'

type AnyNode = Node<any>

function isPptFrame(n: AnyNode): boolean {
  return n.type === 'group' && !n.parentId && (n.data as any)?.role === PPT_FRAME_ROLE
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function buildPptExportPayload(nodes: AnyNode[]): ExportPayload {
  const list = Array.isArray(nodes) ? nodes : []
  const byId = new Map(list.map((n) => [n.id, n]))

  const frames = getOrderedPptFrames(list)

  const slides: ExportSlide[] = []
  for (const frame of frames) {
    if (!isPptFrame(frame)) continue
    const slideIndex = asNumber((frame.data as any)?.slideIndex, NaN)
    if (!Number.isFinite(slideIndex)) continue

    const frameAbs = getNodeAbsolutePosition(frame as any, byId as any)
    const children = list.filter((n) => n.parentId === frame.id)
    const bg = children.find((n) => n.type === 'asset' && ((n.data as any)?.assetWidth ?? 0) >= PPT_SLIDE_WIDTH - 1)
    const bgUrl = String((bg?.data as any)?.assetUrl ?? '')

    // text nodes might be parented or legacy global; include both for robustness
    const textNodes = list.filter((n) => {
      if (n.type !== 'text') return false
      if (n.parentId === frame.id) return true
      // if explicitly marked as ppt role and overlaps frame roughly
      const role = (n.data as any)?.role
      if (!role) return false
      const abs = getNodeAbsolutePosition(n as any, byId as any)
      return abs.x >= frameAbs.x - 10 && abs.x <= frameAbs.x + PPT_SLIDE_WIDTH + 10
    })

    const exportTextNodes: ExportTextNode[] = []
    for (const n of textNodes) {
      const data = (n.data ?? {}) as any
      const role = String(data.role ?? 'body') as any
      const token = (PPT_TYPOGRAPHY_TOKENS as any)[role] ?? PPT_TYPOGRAPHY_TOKENS.body
      const abs = getNodeAbsolutePosition(n as any, byId as any)
      const isParented = n.parentId === frame.id
      const localX = isParented ? asNumber(n.position?.x, 0) : abs.x - frameAbs.x
      const localY = isParented ? asNumber(n.position?.y, 0) : abs.y - frameAbs.y
      const { width, height } = getNodeSizeLike(n as any)
      exportTextNodes.push({
        text: String(data.label ?? ''),
        x: asNumber(localX, 0),
        y: asNumber(localY, 0),
        width: asNumber(width, 1),
        height: asNumber(height, 1),
        fontSize: asNumber(data.labelFontSize, token.fontSize),
        fontWeight: asNumber(data.labelFontWeight, token.fontWeight),
        color: String(data.labelColor ?? token.color),
        fontFamily: String(data.fontFamily ?? token.fontFamily),
        role,
      })
    }

    slides.push({
      slideIndex: Math.round(slideIndex),
      width: PPT_SLIDE_WIDTH,
      height: PPT_SLIDE_HEIGHT,
      backgroundImage: {
        url: bgUrl,
        x: 0,
        y: 0,
        width: PPT_SLIDE_WIDTH,
        height: PPT_SLIDE_HEIGHT,
      },
      textNodes: exportTextNodes,
    })
  }

  // Ensure order already sorted by getOrderedPptFrames, but keep stable sort anyway.
  slides.sort((a, b) => a.slideIndex - b.slideIndex)
  return { slides }
}

