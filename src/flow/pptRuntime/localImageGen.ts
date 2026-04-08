import { PPT_SLIDE_HEIGHT, PPT_SLIDE_WIDTH, PPT_TYPOGRAPHY_TOKENS } from '../constants'
import type { PptSlideInput, RoleBlock } from './types'

function cleanLine(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

export function buildLocalRoleBlocks(slide: PptSlideInput): RoleBlock[] {
  const title = cleanLine(slide.title)
  const subtitle = cleanLine(slide.subtitle)
  const body = Array.isArray(slide.body) ? slide.body.map(cleanLine).filter(Boolean).slice(0, 5) : []

  const blocks: RoleBlock[] = []

  const marginX = 120
  const maxW = PPT_SLIDE_WIDTH - marginX * 2

  let y = 110
  if (title) {
    const h = Math.round(PPT_TYPOGRAPHY_TOKENS.title.fontSize * 1.25)
    blocks.push({ role: 'title', text: title, bbox: [marginX, y, maxW, h] })
    y += h + 26
  }

  if (subtitle) {
    const h = Math.round(PPT_TYPOGRAPHY_TOKENS.subtitle.fontSize * 1.25)
    blocks.push({ role: 'subtitle', text: subtitle, bbox: [marginX, y, maxW, h] })
    y += h + 34
  } else {
    y += 18
  }

  const lineH = Math.round(PPT_TYPOGRAPHY_TOKENS.body.fontSize * 1.6)
  for (const item of body) {
    if (y + lineH > PPT_SLIDE_HEIGHT - 80) break
    blocks.push({ role: 'body', text: item, bbox: [marginX, y, maxW, lineH] })
    y += lineH + 10
  }

  return blocks
}

export async function generateLocalSlideImage(args: {
  slide: PptSlideInput
  seed?: number
}): Promise<string> {
  const { seed = 0 } = args

  const canvas = document.createElement('canvas')
  canvas.width = PPT_SLIDE_WIDTH
  canvas.height = PPT_SLIDE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用，无法本地生图')

  // background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // subtle accent (deterministic)
  const hue = (seed * 47) % 360
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  grad.addColorStop(0, `hsla(${hue}, 70%, 60%, 0.16)`)
  grad.addColorStop(1, `hsla(${(hue + 40) % 360}, 70%, 55%, 0.06)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // a couple of shapes for "template" feel
  ctx.fillStyle = `hsla(${hue}, 70%, 45%, 0.10)`
  ctx.beginPath()
  ctx.roundRect(72, 64, 260, 22, 11)
  ctx.fill()

  ctx.fillStyle = `hsla(${(hue + 80) % 360}, 70%, 50%, 0.10)`
  ctx.beginPath()
  ctx.arc(canvas.width - 180, canvas.height - 140, 220, 0, Math.PI * 2)
  ctx.fill()

  return canvas.toDataURL('image/png')
}

