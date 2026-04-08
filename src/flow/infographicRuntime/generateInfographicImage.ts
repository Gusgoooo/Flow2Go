import { routifyChatCompletions, routifyImagesGenerations, routifyVertexGenerateContent } from '../routifyClient'
import { INFOGRAPH_HIDDEN_USER_PREFIX, INFOGRAPH_ZH_TEXT_IMAGE_CONSTRAINTS_SYSTEM_PROMPT } from './infographicSystemPrompts'
import { normalizeInfographicImageDataUrl } from './normalizeImage'

function extractFirstBase64Image(raw: string): string | null {
  const t = String(raw ?? '').trim()
  if (!t) return null
  const m1 = t.match(/data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]{128,})/i)
  if (m1) return `data:image/${m1[1].toLowerCase()};base64,${m1[2]}`
  const m2 = t.match(/([A-Za-z0-9+/=]{512,})/)
  if (m2) return `data:image/png;base64,${m2[1]}`
  return null
}

async function generateViaChatCompletions(args: { model: string; prompt: string; signal?: AbortSignal }): Promise<string> {
  const { model, prompt, signal } = args
  const res = await routifyChatCompletions({
    body: {
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            '你是信息图单帧渲染器。',
            '只输出图片，不要解释。',
            '优先输出 data:image/png;base64,...；否则输出 {"image_b64":"..."}。',
          ].join('\n'),
        },
        { role: 'user', content: prompt },
      ],
    },
    signal,
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`信息图生图失败(chat)：${res.status} ${msg}`.trim())
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
    const b64 = payload?.image_b64 ?? payload?.data?.[0]?.b64_json
    if (!imageB64 && typeof b64 === 'string' && b64.length >= 128) imageB64 = b64
  } catch {
    content = payloadText
  }
  if (imageB64) return `data:image/png;base64,${imageB64}`
  if (imageUrl) return imageUrl
  const direct = extractFirstBase64Image(content)
  if (direct) return direct
  try {
    const obj = JSON.parse(content)
    const b64 = obj?.image_b64
    if (typeof b64 === 'string' && b64.length >= 128) return `data:image/png;base64,${b64}`
  } catch {
    // ignore
  }
  throw new Error('信息图生图返回无法解析为图片')
}

async function generateViaVertexGenerateContent(args: { model: string; prompt: string; signal?: AbortSignal }): Promise<string> {
  const { model, prompt, signal } = args
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 180_000)
  const merged = new AbortController()
  const relay = () => merged.abort()
  if (signal) {
    if (signal.aborted) merged.abort()
    else signal.addEventListener('abort', relay, { once: true })
  }
  if (controller.signal.aborted) merged.abort()
  else controller.signal.addEventListener('abort', relay, { once: true })
  const res = await routifyVertexGenerateContent({
    model,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
    },
    signal: merged.signal,
  })
  clearTimeout(t)
  const payloadText = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`信息图生图失败(vertex)：${res.status} ${payloadText}`.trim())
  let payload: any
  try {
    payload = JSON.parse(payloadText)
  } catch {
    throw new Error('信息图生图返回无法解析为 JSON')
  }
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('信息图生图返回缺少 parts')
  for (const p of parts) {
    const inline = p?.inlineData ?? p?.inline_data
    const mime = inline?.mimeType ?? inline?.mime_type
    const data = inline?.data ?? inline?.bytesBase64Encoded ?? inline?.bytes_base64_encoded
    if (typeof mime === 'string' && mime.startsWith('image/') && typeof data === 'string' && data.length >= 128) {
      return `data:${mime};base64,${data}`
    }
  }
  throw new Error('信息图生图返回缺少 inlineData 图片')
}

export async function generateInfographicImageDataUrl(args: {
  imagePrompt: string
  model: string
  signal?: AbortSignal
}): Promise<string> {
  const { imagePrompt, model, signal } = args
  const prompt = [
    '生成一张 16:9 的信息图（版式清晰、风格统一），分辨率必须严格为 1600x900。',
    '要求：',
    // 说明：最终商业稳定方案是“背景生图 + 后贴文字”。但当前流程仍会先生成带字图用于 OCR。
    // 为了减少中文错字风险，这里要求：文字必须清晰可读（便于识别），并在后续通过去字+贴字校正。
    '- 所有文字必须清晰、对比度高，便于后续识别与替换；',
    '- 信息层次分明，使用标题、要点、图示/图标组织；',
    '- 不要出现多余水印或无关装饰。',
    '',
    INFOGRAPH_HIDDEN_USER_PREFIX,
    '',
    INFOGRAPH_ZH_TEXT_IMAGE_CONSTRAINTS_SYSTEM_PROMPT,
    '',
    '【视觉与内容指令】',
    imagePrompt,
  ].join('\n')

  if (model.includes('flash-image-preview')) {
    const raw = await generateViaVertexGenerateContent({ model, prompt, signal })
    return normalizeInfographicImageDataUrl(raw)
  }
  const res = await routifyImagesGenerations({ body: { model, prompt }, signal })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    const needsMessages =
      res.status === 400 &&
      msg.includes('messages') &&
      (msg.includes('不能为空') || msg.includes('must not be empty') || msg.includes('"code":"1103"') || msg.includes('"******":"1103"'))
    if (needsMessages) return generateViaChatCompletions({ model, prompt, signal })
    throw new Error(`信息图生图失败：${res.status} ${msg}`.trim())
  }
  const json = (await res.json().catch(() => null)) as any
  const item = json?.data?.[0]
  const b64 = item?.b64_json
  if (typeof b64 === 'string' && b64.length >= 32) {
    return normalizeInfographicImageDataUrl(`data:image/png;base64,${b64}`)
  }
  const url = item?.url
  if (typeof url === 'string' && url.startsWith('http')) return url
  throw new Error('信息图生图返回缺少 b64_json/url')
}
