import { DEFAULT_ROUTIFY_VISION_MODEL } from '../constants'
import { routifyChatCompletions } from '../routifyClient'
import type { OcrBlock } from './types'

type OpenRouterMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenRouterMessage = {
  role: 'system' | 'user'
  content: string | OpenRouterMessageContentPart[]
}

const OCR_SYSTEM_PROMPT = [
  '你是一个 OCR 引擎，只输出严格 JSON，不要代码块，不要解释。',
  '输入是一张 PPT 单页截图（16:9）。',
  '你的任务：识别所有普通文本块，并输出数组：',
  '[',
  '  {"text":"...", "bbox":[x,y,width,height]}',
  ']',
  '坐标系强制为：宽 1440，高 800（左上为 0,0）。',
  'bbox 必须是整数；x/y 为左上角；width/height 为正数。',
  '只识别普通文本区域；不需要表格/图表结构化。',
  '如果不确定，宁可少输出也不要胡乱输出。',
].join('\n')

function safeParseJsonArray(raw: string): any[] {
  const t = String(raw ?? '').trim()
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start < 0 || end < 0 || end <= start) throw new Error('OCR 返回不是 JSON 数组')
  const sliced = t.slice(start, end + 1)
  const parsed = JSON.parse(sliced)
  if (!Array.isArray(parsed)) throw new Error('OCR 返回不是数组')
  return parsed
}

export async function ocrSlideImageByVisionModel(args: {
  imageDataUrl: string
  model?: string
  signal?: AbortSignal
}): Promise<OcrBlock[]> {
  const { imageDataUrl, model = DEFAULT_ROUTIFY_VISION_MODEL, signal } = args
  if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) return []

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: OCR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '请对这张 PPT 单页图片做 OCR，按要求输出 JSON 数组。' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ]

  const res = await routifyChatCompletions({
    body: {
      model,
      temperature: 0,
      messages,
    },
    signal,
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`OCR 请求失败：${res.status} ${msg}`.trim())
  }
  const json = (await res.json().catch(() => null)) as any
  const content = json?.choices?.[0]?.message?.content
  const raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p?.text ?? '').join('') : ''
  const arr = safeParseJsonArray(raw)

  const blocks: OcrBlock[] = []
  for (const item of arr) {
    const text = String(item?.text ?? '').trim()
    const bbox = item?.bbox
    if (!text) continue
    if (!Array.isArray(bbox) || bbox.length !== 4) continue
    const nums = bbox.map((n: any) => Number(n))
    if (!nums.every((n: number) => Number.isFinite(n))) continue
    const [x, y, w, h] = nums.map((n: number) => Math.round(n))
    if (w <= 0 || h <= 0) continue
    blocks.push({ text, bbox: [x, y, w, h] })
  }
  return blocks
}

