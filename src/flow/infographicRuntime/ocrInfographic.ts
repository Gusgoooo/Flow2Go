import { DEFAULT_ROUTIFY_VISION_MODEL } from '../constants'
import { routifyChatCompletions } from '../routifyClient'
import type { OcrBlock } from './types'

type Msg = {
  role: 'system' | 'user'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}

function buildOcrSystemPrompt(args: { width: number; height: number }): string {
  const w = Math.max(1, Math.round(args.width))
  const h = Math.max(1, Math.round(args.height))
  return [
    '你是 OCR 引擎，只输出严格 JSON，不要代码块，不要解释。',
    '输入是一张信息图（Infographic），画幅约 16:9。',
    '输出数组，每个元素：{"text":"...", "bbox":[x,y,width,height], "fontSize": number, "fontWeight": number, "color":"#RRGGBB"}',
    `坐标系：宽 ${w}，高 ${h}，左上角为 (0,0)；bbox 为整数，x/y 为左上角。`,
    '识别图中所有清晰可读的正文与标题文字块（忽略装饰性过小的水印）。',
    '必须识别“反白/反色”文字：例如深色色块上的白字、浅色字、描边字、半透明底上的字。',
    '如果标题是白字黑底，也必须输出对应 bbox 与 color（常见为 #FFFFFF）。',
    `fontSize：以像素表示，尽量贴近渲染效果（基于 ${w}x${h} 坐标系）。`,
    'fontWeight：用 400/500/600/700 这种数字，尽量根据粗细判断（标题更粗）。',
    'color：输出文字主色的近似十六进制（#RRGGBB）。',
  ].join('\n')
}

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

export async function ocrInfographicImage(args: {
  imageDataUrl: string
  coordSize?: { width: number; height: number }
  model?: string
  signal?: AbortSignal
}): Promise<OcrBlock[]> {
  const { imageDataUrl, coordSize, model = DEFAULT_ROUTIFY_VISION_MODEL, signal } = args
  if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) return []
  const w = coordSize?.width ?? 1600
  const h = coordSize?.height ?? 900

  const messages: Msg[] = [
    { role: 'system', content: buildOcrSystemPrompt({ width: w, height: h }) },
    {
      role: 'user',
      content: [
        { type: 'text', text: '请对这张信息图做 OCR，输出 JSON 数组。' },
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
    throw new Error(`信息图 OCR 失败：${res.status} ${msg}`.trim())
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
    const fontSize = Number(item?.fontSize)
    const fontWeight = Number(item?.fontWeight)
    const color = String(item?.color ?? '').trim()
    blocks.push({
      text,
      bbox: [x, y, w, h],
      fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : undefined,
      fontWeight: Number.isFinite(fontWeight) && fontWeight > 0 ? fontWeight : undefined,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined,
    })
  }
  return blocks
}
