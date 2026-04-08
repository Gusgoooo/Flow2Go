import { routifyVertexGenerateContent } from '../routifyClient'
import type { OcrBlock } from './types'

function dataUrlToInlineData(dataUrl: string): { mimeType: string; data: string } {
  const m = String(dataUrl ?? '').match(/^data:([^;]+);base64,(.+)$/)
  if (!m) throw new Error('需要 data:image/*;base64,... 作为输入图片')
  return { mimeType: m[1], data: m[2] }
}

function normalizeBBoxes(blocks: OcrBlock[]): Array<[number, number, number, number]> {
  return (Array.isArray(blocks) ? blocks : [])
    .map((b) => b?.bbox)
    .filter((bb): bb is [number, number, number, number] => Array.isArray(bb) && bb.length === 4)
    .map((bb) => bb.map((n) => Math.max(0, Math.round(Number(n)))) as [number, number, number, number])
    // 去掉过小/异常框，避免干扰重绘
    .filter(([, , w, h]) => w >= 8 && h >= 8)
}

export async function removeTextBySecondGen(args: {
  /** 原始带字的页面图（dataUrl） */
  imageDataUrl: string
  /** OCR blocks（1440x800 坐标） */
  blocks: OcrBlock[]
  /** Vertex 图片模型，如 gemini-3.1-flash-image-preview */
  model: string
  signal?: AbortSignal
}): Promise<string> {
  const { imageDataUrl, blocks, model, signal } = args
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('二次生图去字需要 dataUrl 图片')

  const bboxes = normalizeBBoxes(blocks)
  // 即使 OCR 空，也让模型“去除所有可见文字”，作为纯净化尝试
  const bboxText = bboxes.length
    ? bboxes.map((b) => `[${b[0]},${b[1]},${b[2]},${b[3]}]`).join(', ')
    : '(none)'

  const prompt = [
    '你是图像修复/重绘模型。',
    '输入是一张 1440x800 的 PPT 单页图片，图片中包含文字。',
    '任务：在保持整体布局、背景、图形、颜色、光照尽量不变的前提下，去除所有文字内容。',
    '优先针对这些文字区域（坐标系 1440x800，格式 [x,y,w,h]）：',
    bboxText,
    '要求：不要添加新文字；不要改变非文字区域的元素形状；让去字区域看起来像原本就没有字。',
    '输出：只返回编辑后的图片。',
  ].join('\n')

  const inline = dataUrlToInlineData(imageDataUrl)
  const res = await routifyVertexGenerateContent({
    model,
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: inline.mimeType, data: inline.data } },
          ],
        },
      ],
    },
    signal,
  })

  const payloadText = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`二次生图去字失败：${res.status} ${payloadText}`.trim())

  let payload: any
  try {
    payload = JSON.parse(payloadText)
  } catch {
    throw new Error('二次生图去字返回无法解析为 JSON')
  }

  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) throw new Error('二次生图去字返回缺少 parts')

  for (const p of parts) {
    const inlineData = p?.inlineData ?? p?.inline_data
    const mime = inlineData?.mimeType ?? inlineData?.mime_type
    const data = inlineData?.data ?? inlineData?.bytesBase64Encoded ?? inlineData?.bytes_base64_encoded
    if (typeof mime === 'string' && mime.startsWith('image/') && typeof data === 'string' && data.length >= 128) {
      return `data:${mime};base64,${data}`
    }
  }

  throw new Error('二次生图去字返回缺少 inlineData 图片')
}

