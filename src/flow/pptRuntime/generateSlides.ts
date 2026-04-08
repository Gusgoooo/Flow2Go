import { routifyChatCompletions, routifyImagesGenerations, routifyVertexGenerateContent } from '../routifyClient'
import type { PptSlideInput, StyleImageInput } from './types'
import { buildPptSlidePrompt } from './buildPrompt'

export type GenerateSlideImageResult = {
  slideIndex: number
  prompt: string
  imageDataUrl: string
}

function extractFirstBase64Image(raw: string): string | null {
  const t = String(raw ?? '').trim()
  if (!t) return null
  const m1 = t.match(/data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]{128,})/i)
  if (m1) return `data:image/${m1[1].toLowerCase()};base64,${m1[2]}`
  // some models return bare base64
  const m2 = t.match(/([A-Za-z0-9+/=]{512,})/)
  if (m2) return `data:image/png;base64,${m2[1]}`
  return null
}

async function generateViaChatCompletions(args: {
  model: string
  prompt: string
  signal?: AbortSignal
}): Promise<string> {
  const { model, prompt, signal } = args
  const res = await routifyChatCompletions({
    body: {
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            '你是 PPT 单页图片生成器。',
            '只输出图片，不要解释。',
            '输出格式优先：data:image/png;base64,<...>。',
            '如果必须输出 JSON，也只能输出：{"image_b64":"..."}。',
          ].join('\n'),
        },
        { role: 'user', content: prompt },
      ],
    },
    signal,
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`生图失败(chat)：${res.status} ${msg}`.trim())
  }
  const payloadText = await res.text()
  let content = ''
  let imageB64: string | null = null
  let imageUrl: string | null = null
  try {
    const payload = JSON.parse(payloadText)
    const c = payload?.choices?.[0]?.message?.content
    if (typeof c === 'string') content = c
    else if (Array.isArray(c)) content = c.map((p: any) => p?.text ?? '').join('')

    const msg = payload?.choices?.[0]?.message
    const images = Array.isArray(msg?.images) ? msg.images : []
    for (const it of images) {
      const b64 = it?.b64_json ?? it?.b64 ?? it?.base64
      const url = it?.url
      if (!imageB64 && typeof b64 === 'string' && b64.length >= 128) imageB64 = b64
      if (!imageUrl && typeof url === 'string' && url.startsWith('http')) imageUrl = url
    }

    // Some gateways may return image data in a custom field
    const b64 = payload?.image_b64 ?? payload?.data?.[0]?.b64_json
    if (!imageB64 && typeof b64 === 'string' && b64.length >= 128) imageB64 = b64
  } catch {
    content = payloadText
  }

  if (imageB64) return `data:image/png;base64,${imageB64}`
  if (imageUrl) return imageUrl

  const direct = extractFirstBase64Image(content)
  if (direct) return direct

  // JSON fallback: {"image_b64":"..."}
  try {
    const obj = JSON.parse(content)
    const b64 = obj?.image_b64
    if (typeof b64 === 'string' && b64.length >= 128) return `data:image/png;base64,${b64}`
  } catch {
    // ignore
  }

  throw new Error('生图返回无法解析为图片（chat/completions）')
}

async function generateViaVertexGenerateContent(args: {
  model: string
  prompt: string
  signal?: AbortSignal
}): Promise<string> {
  const { model, prompt, signal } = args
  const res = await routifyVertexGenerateContent({
    model,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
    },
    signal,
  })
  const payloadText = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`生图失败(vertex)：${res.status} ${payloadText}`.trim())
  }
  let payload: any
  try {
    payload = JSON.parse(payloadText)
  } catch {
    throw new Error('生图返回无法解析为 JSON（vertex generateContent）')
  }
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('生图返回缺少 parts（vertex generateContent）')
  for (const p of parts) {
    const inline = p?.inlineData ?? p?.inline_data
    const mime = inline?.mimeType ?? inline?.mime_type
    const data = inline?.data ?? inline?.bytesBase64Encoded ?? inline?.bytes_base64_encoded
    if (typeof mime === 'string' && mime.startsWith('image/') && typeof data === 'string' && data.length >= 128) {
      return `data:${mime};base64,${data}`
    }
  }
  throw new Error('生图返回缺少 inlineData.image（vertex generateContent）')
}

/**
 * 通过 OpenAI-compatible images/generations 调用图片生成模型生成单页图片。
 * 注意：不同网关对“参考图”字段名可能不同；这里按最通用形态发送，并保留扩展字段。
 */
async function generateOne(args: {
  model: string
  prompt: string
  styleImages: StyleImageInput[]
  signal?: AbortSignal
}): Promise<string> {
  const { model, prompt, signal } = args
  // Vertex 图片模型（按文档示例）优先走 /protocol/vertex/...:generateContent
  if (model.includes('flash-image-preview')) {
    return generateViaVertexGenerateContent({ model, prompt, signal })
  }
  // Gemini image preview 在部分 OpenAI 兼容网关下对非标准字段较敏感：
  // - reference_images 可能触发 400（被路由到 chat/completions 或校验失败）
  // - size=1440x800 也可能不被支持
  // MVP：先走最小字段集合确保成功，再逐步加回参考图/尺寸。
  const res = await routifyImagesGenerations({
    body: {
      model,
      prompt,
    },
    signal,
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    // Routify 对部分 Gemini 模型会将生图路由到 chat/completions，需要 messages
    const needsMessages =
      res.status === 400 &&
      msg.includes('messages') &&
      (msg.includes('不能为空') || msg.includes('must not be empty') || msg.includes('"code":"1103"') || msg.includes('"******":"1103"'))
    if (needsMessages) {
      return generateViaChatCompletions({ model, prompt, signal })
    }
    throw new Error(`生图失败：${res.status} ${msg}`.trim())
  }
  const json = (await res.json().catch(() => null)) as any
  const item = json?.data?.[0]
  const b64 = item?.b64_json
  if (typeof b64 === 'string' && b64.length >= 32) {
    return `data:image/png;base64,${b64}`
  }
  const url = item?.url
  if (typeof url === 'string' && url.startsWith('http')) {
    // 允许网关返回临时 URL（导出时仍建议转成 dataUrl，MVP 先放行）
    return url
  }
  throw new Error('生图返回缺少 b64_json/url')
}

export async function generateSlideImages(args: {
  slides: PptSlideInput[]
  styleImages: StyleImageInput[]
  model: string
  signal?: AbortSignal
  onProgress?: (info: { index: number; total: number; phase: string }) => void
}): Promise<GenerateSlideImageResult[]> {
  const { slides, styleImages, model, signal, onProgress } = args
  const list = Array.isArray(slides) ? slides : []
  const out: GenerateSlideImageResult[] = []
  for (let i = 0; i < list.length; i += 1) {
    onProgress?.({ index: i, total: list.length, phase: 'buildPrompt' })
    const prompt = buildPptSlidePrompt(list[i])
    onProgress?.({ index: i, total: list.length, phase: 'generateImage' })
    const imageDataUrl = await generateOne({ model, prompt, styleImages, signal })
    out.push({ slideIndex: i, prompt, imageDataUrl })
  }
  return out
}

