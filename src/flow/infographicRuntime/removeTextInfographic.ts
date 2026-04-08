import { routifyVertexGenerateContent } from '../routifyClient'
import { INFOGRAPH_CANVAS_HEIGHT, INFOGRAPH_CANVAS_WIDTH } from '../constants'
import type { OcrBlock } from './types'
import { INFOGRAPH_HIDDEN_USER_PREFIX } from './infographicSystemPrompts'
import { normalizeInfographicImageDataUrl } from './normalizeImage'

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
    .filter(([, , w, h]) => w >= 8 && h >= 8)
}

export async function removeInfographicTextBySecondGen(args: {
  imageDataUrl: string
  blocks: OcrBlock[]
  model: string
  signal?: AbortSignal
}): Promise<string> {
  const { imageDataUrl, blocks, model, signal } = args
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('二次生图去字需要 dataUrl 图片')

  const bboxes = normalizeBBoxes(blocks)
  const bboxText = bboxes.length
    ? bboxes.map((b) => `[${b[0]},${b[1]},${b[2]},${b[3]}]`).join(', ')
    : '(none)'

  const prompt = [
    '你是图像修复/重绘模型。',
    `输入是一张 ${INFOGRAPH_CANVAS_WIDTH}x${INFOGRAPH_CANVAS_HEIGHT} 的信息图，图中包含文字与图形。`,
    '',
    INFOGRAPH_HIDDEN_USER_PREFIX,
    '',
    '去除文字指令（强约束）：',
    '帮我不影响图片构图及内容的情况下，去除图中的所有文字并保留原本文字的展示空间。',
    '',
    '你可以优先处理这些文字区域（坐标系与画幅一致，格式 [x,y,w,h]）：',
    bboxText,
    '',
    '补充要求：',
    '- 不要新增任何文字或符号；',
    '- 不要改变非文字元素的形状、位置与颜色；',
    '- 去字区域要自然，像原本就没有字；',
    '- 保留文字“占位”的空白/留白关系（不要把背景细节填满导致后续文字难读）。',
    '- 必须去除干净：不保留任何文字、标题、数字、日期、编号（ZERO readable text / numbers）。',
    '',
    '输出：只返回编辑后的图片（不要解释）。',
  ].join('\n')

  const inline = dataUrlToInlineData(imageDataUrl)
  const doRequest = async () => {
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
    return { res, payloadText }
  }

  // Tengine ingress 502/503/504 可能是瞬时网关故障：重试 1 次，不阻断主流程
  let { res, payloadText } = await doRequest()
  if (!res.ok && [502, 503, 504].includes(res.status)) {
    console.warn('[Infographic removeText] upstream gateway error, retry once', { status: res.status })
    await new Promise((r) => setTimeout(r, 800))
    ;({ res, payloadText } = await doRequest())
  }
  if (!res.ok) {
    const isHtml = (payloadText || '').trim().startsWith('<!DOCTYPE') || (payloadText || '').includes('<html')
    // 5xx/网关 HTML：兜底返回原图，不阻断流程
    if (res.status >= 500 || isHtml) {
      console.warn('[Infographic removeText] upstream error, fallback to original image', {
        status: res.status,
        preview: String(payloadText).slice(0, 300),
      })
      return imageDataUrl
    }
    // 4xx 参数错误：保留错误，方便定位 prompt/payload
    throw new Error(`信息图二次生图去字失败：${res.status} ${payloadText}`.trim())
  }

  let payload: any
  try {
    payload = JSON.parse(payloadText)
  } catch {
    throw new Error('信息图去字返回无法解析为 JSON')
  }

  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) throw new Error('信息图去字返回缺少 parts')

  for (const p of parts) {
    const inlineData = p?.inlineData ?? p?.inline_data
    const mime = inlineData?.mimeType ?? inlineData?.mime_type
    const data = inlineData?.data ?? inlineData?.bytesBase64Encoded ?? inlineData?.bytes_base64_encoded
    if (typeof mime === 'string' && mime.startsWith('image/') && typeof data === 'string' && data.length >= 128) {
      return normalizeInfographicImageDataUrl(`data:${mime};base64,${data}`)
    }
  }

  // 某些情况下模型会返回纯文本（例如安全策略/能力退化/网关变体），不应阻断主流程。
  // 返回原图作为兜底，并将错误展示为可复制文本（由上层决定是否提示用户）。
  const textParts = parts.map((p: any) => String(p?.text ?? '')).filter(Boolean)
  console.warn('[Infographic removeText] missing inlineData image; fallback to original image', {
    model,
    textPreview: textParts.join('\n').slice(0, 600),
  })
  return normalizeInfographicImageDataUrl(imageDataUrl)
}
