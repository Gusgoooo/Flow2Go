import type { Node } from '@xyflow/react'
import {
  INFOGRAPH_CANVAS_HEIGHT,
  INFOGRAPH_CANVAS_WIDTH,
  INFOGRAPH_FONT_FAMILY,
  INFOGRAPH_FRAME_ROLE,
  INFOGRAPH_FRAME_STEP_X,
  INFOGRAPH_FRAME_PADDING_PX,
  INFOGRAPH_FRAME_TITLE_BAR_PX,
  INFOGRAPH_FRAME_TITLE_GAP_PX,
  INFOGRAPH_TEXT_COLOR,
} from '../constants'
import type { OcrBlock, RoleBlock } from './types'
import type { InfographicTextRole } from '../constants'

export type FlowNode = Node<any>

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`
}

function fallbackFontSizeFromBBoxHeight(h: number): number {
  const x = Number(h)
  if (!Number.isFinite(x) || x <= 0) return 22
  // 不做上限 token 限制：尽量贴近识别结果，仅做最小值保护
  return Math.max(1, Math.round(x * 0.72))
}

export function nextInfographicFrameIndex(nodes: FlowNode[]): number {
  let max = 0
  for (const n of nodes) {
    if (n?.type !== 'group') continue
    const role = (n.data as any)?.role
    if (role !== INFOGRAPH_FRAME_ROLE) continue
    const idx = Number((n.data as any)?.slideIndex)
    if (Number.isFinite(idx)) max = Math.max(max, idx)
  }
  return max + 1
}

/** 将 OCR 块转为可编辑文本节点：字号随框高变化，尽量贴近原图 */
export function ocrBlocksToRoleBlocks(blocks: OcrBlock[]): RoleBlock[] {
  const cleaned = (Array.isArray(blocks) ? blocks : [])
    .map((b) => ({
      text: String(b.text ?? '').trim(),
      bbox: b.bbox,
      fontSize: b.fontSize,
      fontWeight: b.fontWeight,
      color: b.color,
    }))
    .filter((b) => b.text.length > 0 && Array.isArray(b.bbox) && b.bbox.length === 4)

  const sorted = [...cleaned].sort((a, b) => {
    const ay = a.bbox[1] ?? 0
    const by = b.bbox[1] ?? 0
    if (ay !== by) return ay - by
    return (a.bbox[0] ?? 0) - (b.bbox[0] ?? 0)
  })

  const heights = sorted.map((s) => s.bbox[3] ?? 0).filter((h) => h > 0)
  const sortedH = [...heights].sort((a, b) => b - a)
  const titleTh = sortedH[2] ?? sortedH[0] ?? 40

  return sorted.map((b) => {
    const h = b.bbox[3] ?? 24
    let role: InfographicTextRole = 'body'
    if (h >= titleTh - 2) role = 'title'
    else if (h >= Math.max(28, titleTh * 0.55)) role = 'subtitle'
    return { ...b, role }
  })
}

export function buildInfographicFrameNodes(args: {
  baseNodes: FlowNode[]
  slideIndex: number
  cleanedImageDataUrl: string
  roleBlocks: RoleBlock[]
  /** cleanedImage 的真实像素宽高（用于 contain 映射与精准落位） */
  cleanedImageSize?: { width: number; height: number }
  frameX: number
}): { nodes: FlowNode[]; frameId: string } {
  const { baseNodes, slideIndex, cleanedImageDataUrl, roleBlocks, cleanedImageSize, frameX } = args

  const frameId = newId('infographic-frame')
  const pad = INFOGRAPH_FRAME_PADDING_PX
  const titleOffset = INFOGRAPH_FRAME_TITLE_BAR_PX + INFOGRAPH_FRAME_TITLE_GAP_PX
  const contentW = Math.max(1, INFOGRAPH_CANVAS_WIDTH - pad * 2)
  const contentH = Math.max(1, INFOGRAPH_CANVAS_HEIGHT - pad * 2 - titleOffset)
  const srcW = Math.max(1, Math.round(Number(cleanedImageSize?.width ?? INFOGRAPH_CANVAS_WIDTH)))
  const srcH = Math.max(1, Math.round(Number(cleanedImageSize?.height ?? INFOGRAPH_CANVAS_HEIGHT)))
  // AssetNode 使用 objectFit: contain，因此需要按 contain 规则把“图片像素坐标”映射到节点坐标
  const containScale = Math.min(contentW / srcW, contentH / srcH)
  const bgW = Math.max(1, Math.round(srcW * containScale))
  const bgH = Math.max(1, Math.round(srcH * containScale))
  const bgOffsetX = pad + Math.round((contentW - bgW) / 2)
  const bgOffsetY = pad + titleOffset + Math.round((contentH - bgH) / 2)
  const frameNode: FlowNode = {
    id: frameId,
    type: 'group',
    position: { x: frameX, y: 0 },
    data: {
      role: INFOGRAPH_FRAME_ROLE,
      slideIndex,
      slideName: `信息图 ${slideIndex}`,
      title: `信息图 ${slideIndex}`,
      roleHint: 'infographic',
    },
    width: INFOGRAPH_CANVAS_WIDTH,
    height: INFOGRAPH_CANVAS_HEIGHT,
    style: { width: INFOGRAPH_CANVAS_WIDTH, height: INFOGRAPH_CANVAS_HEIGHT },
  }

  const bgNode: FlowNode = {
    id: newId('infographic-bg'),
    type: 'asset',
    parentId: frameId,
    position: { x: bgOffsetX, y: bgOffsetY },
    data: {
      assetUrl: cleanedImageDataUrl,
      assetName: `infographic-${slideIndex}`,
      assetType: 'png',
      assetWidth: bgW,
      assetHeight: bgH,
    },
    width: bgW,
    height: bgH,
    style: { width: bgW, height: bgH },
  }

  const textNodes: FlowNode[] = roleBlocks.map((b, i) => {
    const [x, y, w, h] = b.bbox
    const fontSizeRaw = Number((b as any).fontSize)
    const fontSize = Number.isFinite(fontSizeRaw) && fontSizeRaw > 0
      ? Math.max(1, Math.round(fontSizeRaw * containScale))
      : fallbackFontSizeFromBBoxHeight(h * containScale)
    const fontWeightNum = Number((b as any).fontWeight)
    const fontWeight = Number.isFinite(fontWeightNum) && fontWeightNum > 0 ? String(Math.round(fontWeightNum)) : (h >= 52 ? '600' : '400')
    const color = typeof (b as any).color === 'string' && /^#[0-9a-fA-F]{6}$/.test((b as any).color) ? (b as any).color : INFOGRAPH_TEXT_COLOR
    return {
      id: newId(`infographic-text-${i}`),
      type: 'text',
      parentId: frameId,
      // 原位替换：不吸附网格，不做偏移
      position: { x: bgOffsetX + x * containScale, y: bgOffsetY + y * containScale },
      data: {
        label: b.text,
        labelFontSize: fontSize,
        labelFontWeight: fontWeight,
        labelColor: color,
        role: b.role,
        fontFamily: INFOGRAPH_FONT_FAMILY,
      },
      width: Math.max(1, w * containScale),
      height: Math.max(1, h * containScale),
      style: { width: Math.max(1, w * containScale), height: Math.max(1, h * containScale) },
    }
  })

  return { nodes: [...baseNodes, frameNode, bgNode, ...textNodes], frameId }
}

export function computeInfographicFrameX(args: { existingFrames: number; order: number }): number {
  return (args.existingFrames + args.order) * INFOGRAPH_FRAME_STEP_X
}
