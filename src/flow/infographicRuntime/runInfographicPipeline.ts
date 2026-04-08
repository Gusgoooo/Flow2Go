import { INFOGRAPH_IMAGE_GEN_MODEL } from '../constants'
import { analyzeInfographicInput } from './analyzeInfographic'
import { generateInfographicImageDataUrl } from './generateInfographicImage'
import { ocrInfographicImage } from './ocrInfographic'
import { removeInfographicTextBySecondGen } from './removeTextInfographic'
import { getImageNaturalSizeFromDataUrl } from './normalizeImage'
import type { OcrBlock } from './types'

export type InfographicPipelineProgress = {
  phase:
    | 'analyze'
    | 'generateImage'
    | 'ocr'
    | 'removeText'
    | 'done'
  detail?: string
}

export async function runInfographicPipeline(args: {
  userText: string
  textModel: string
  visionModel: string
  imageModel?: string
  signal?: AbortSignal
  onProgress?: (p: InfographicPipelineProgress) => void
}): Promise<{
  analysis: { summary: string; analysis: string; imagePrompt: string }
  rawImageDataUrl: string
  ocrBlocks: OcrBlock[]
  cleanedImageDataUrl: string
}> {
  const {
    userText,
    textModel,
    visionModel,
    imageModel = INFOGRAPH_IMAGE_GEN_MODEL,
    signal,
    onProgress,
  } = args

  onProgress?.({ phase: 'analyze', detail: '总结与结构化分析…' })
  const analysis = await analyzeInfographicInput({ userText, model: textModel, signal })

  onProgress?.({ phase: 'generateImage', detail: '生成信息图画面…' })
  const rawImageDataUrl = await generateInfographicImageDataUrl({
    imagePrompt: analysis.imagePrompt,
    model: imageModel,
    signal,
  })
  const rawSize = await getImageNaturalSizeFromDataUrl(rawImageDataUrl).catch(() => ({ width: 1600, height: 900 }))
  console.info('[Infographic] raw image size', rawSize)

  onProgress?.({ phase: 'ocr', detail: '识别文字位置与内容…' })
  const ocrBlocks = await ocrInfographicImage({
    imageDataUrl: rawImageDataUrl,
    coordSize: rawSize,
    model: visionModel,
    signal,
  })

  onProgress?.({ phase: 'removeText', detail: '二次生图去除画面内文字…' })
  let cleanedImageDataUrl = rawImageDataUrl
  let blocksForRemoval = ocrBlocks
  // 去字可能失败（残留文字）；为了速度默认最多 2 次（1 次主尝试 + 1 次重试）
  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onProgress?.({ phase: 'removeText', detail: `二次生图去字（第${attempt}/${maxAttempts}次）…` })
    cleanedImageDataUrl = await removeInfographicTextBySecondGen({
      imageDataUrl: rawImageDataUrl,
      blocks: blocksForRemoval,
      model: imageModel,
      signal,
    })
    const cleanedSize = await getImageNaturalSizeFromDataUrl(cleanedImageDataUrl).catch(() => rawSize)
    console.info('[Infographic] cleaned image size', cleanedSize)
    onProgress?.({ phase: 'ocr', detail: `校验去字结果（第${attempt}/${maxAttempts}次）…` })
    const remain = await ocrInfographicImage({
      imageDataUrl: cleanedImageDataUrl,
      coordSize: cleanedSize,
      model: visionModel,
      signal,
    }).catch(() => [])
    // 允许极少量噪声：如果仍有明显文字块，继续用“残留块”作为新 bbox 重试
    const strongRemain = remain.filter((b) => (b.text || '').trim().length >= 1 && (b.bbox?.[2] ?? 0) * (b.bbox?.[3] ?? 0) >= 140)
    if (strongRemain.length === 0) break
    blocksForRemoval = strongRemain
    if (attempt === maxAttempts) {
      // 不阻断主流程：保留最后一次去字结果继续落盘，让用户先拿到可编辑文本层再迭代。
      console.warn('[Infographic] removeText still has remaining blocks, continue anyway', {
        remaining: strongRemain.length,
        attempts: maxAttempts,
      })
      onProgress?.({ phase: 'removeText', detail: `去字后仍检测到残留文字块：${strongRemain.length} 个（已重试 ${maxAttempts} 次），继续生成可编辑层…` })
      break
    }
  }

  onProgress?.({ phase: 'done' })
  return { analysis, rawImageDataUrl, ocrBlocks, cleanedImageDataUrl }
}
