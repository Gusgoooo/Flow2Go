import type { OcrBlock } from './types'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function median(values: number[]): number {
  if (values.length === 0) return 255
  const arr = [...values].sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 === 0 ? Math.round((arr[mid - 1] + arr[mid]) / 2) : arr[mid]
}

function sampleBackgroundColor(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }) {
  const { x, y, w, h } = rect
  const pad = 6
  const sx = clamp(Math.floor(x - pad), 0, Math.max(0, ctx.canvas.width - 1))
  const sy = clamp(Math.floor(y - pad), 0, Math.max(0, ctx.canvas.height - 1))
  const ex = clamp(Math.floor(x + w + pad), 0, Math.max(0, ctx.canvas.width - 1))
  const ey = clamp(Math.floor(y + h + pad), 0, Math.max(0, ctx.canvas.height - 1))
  const sw = Math.max(1, ex - sx + 1)
  const sh = Math.max(1, ey - sy + 1)

  const img = ctx.getImageData(sx, sy, sw, sh).data
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  // sample border pixels only (cheap)
  for (let j = 0; j < sh; j += 1) {
    for (let i = 0; i < sw; i += 1) {
      const isBorder = j === 0 || i === 0 || j === sh - 1 || i === sw - 1
      if (!isBorder) continue
      const idx = (j * sw + i) * 4
      rs.push(img[idx])
      gs.push(img[idx + 1])
      bs.push(img[idx + 2])
    }
  }
  const r = median(rs)
  const g = median(gs)
  const b = median(bs)
  return `rgb(${r},${g},${b})`
}

export async function maskTextByBBoxes(args: {
  imageDataUrl: string
  blocks: OcrBlock[]
  outputType?: 'image/png' | 'image/jpeg'
}): Promise<string> {
  const { imageDataUrl, blocks, outputType = 'image/png' } = args
  if (!imageDataUrl.startsWith('data:image/')) return imageDataUrl

  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = imageDataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, img.naturalWidth || 1)
  canvas.height = Math.max(1, img.naturalHeight || 1)
  const ctx = canvas.getContext('2d')
  if (!ctx) return imageDataUrl
  ctx.drawImage(img, 0, 0)

  // blocks bboxes are in 1440x800; scale to actual image size
  const scaleX = canvas.width / 1440
  const scaleY = canvas.height / 800

  for (const b of blocks) {
    const [x, y, w, h] = b.bbox
    if (![x, y, w, h].every((n) => Number.isFinite(n))) continue
    const rx = clamp(Math.round(x * scaleX), 0, canvas.width)
    const ry = clamp(Math.round(y * scaleY), 0, canvas.height)
    const rw = clamp(Math.round(w * scaleX), 1, canvas.width - rx)
    const rh = clamp(Math.round(h * scaleY), 1, canvas.height - ry)

    const fill = sampleBackgroundColor(ctx, { x: rx, y: ry, w: rw, h: rh })
    ctx.fillStyle = fill
    ctx.fillRect(rx, ry, rw, rh)
  }

  return canvas.toDataURL(outputType, outputType === 'image/jpeg' ? 0.92 : undefined)
}

