import { INFOGRAPH_CANVAS_HEIGHT, INFOGRAPH_CANVAS_WIDTH } from '../constants'

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = dataUrl
  })
  return img
}

/**
 * 将输入图片强制归一为 INFOGRAPH_CANVAS_WIDTH x INFOGRAPH_CANVAS_HEIGHT（当前 1600x900）。
 * 用于保证 OCR 坐标与节点定位一致，避免上游返回非预期尺寸导致位置漂移。
 */
export async function normalizeInfographicImageDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  const img = await loadImage(dataUrl)
  const srcW = Math.max(1, img.naturalWidth || 1)
  const srcH = Math.max(1, img.naturalHeight || 1)
  if (srcW === INFOGRAPH_CANVAS_WIDTH && srcH === INFOGRAPH_CANVAS_HEIGHT) return dataUrl

  const canvas = document.createElement('canvas')
  canvas.width = INFOGRAPH_CANVAS_WIDTH
  canvas.height = INFOGRAPH_CANVAS_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export async function getImageNaturalSizeFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl)
  return {
    width: Math.max(1, img.naturalWidth || 1),
    height: Math.max(1, img.naturalHeight || 1),
  }
}

