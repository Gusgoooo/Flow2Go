import { DEFAULT_ROUTIFY_TEXT_MODEL } from '../constants'
import { routifyChatCompletions } from '../routifyClient'
import { INFOGRAPH_ANALYSIS_SYSTEM_PROMPT, INFOGRAPH_HIDDEN_USER_PREFIX } from './infographicSystemPrompts'
import type { InfographicAnalysisJson } from './types'

function safeParseJsonObject(raw: string): InfographicAnalysisJson {
  const t = String(raw ?? '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) throw new Error('分析结果不是 JSON 对象')
  const sliced = t.slice(start, end + 1)
  const o = JSON.parse(sliced) as InfographicAnalysisJson
  if (!o || typeof o.imagePrompt !== 'string' || !o.imagePrompt.trim()) {
    throw new Error('分析结果缺少 imagePrompt')
  }
  return {
    summary: String(o.summary ?? '').trim(),
    analysis: String(o.analysis ?? '').trim(),
    imagePrompt: o.imagePrompt.trim(),
  }
}

export async function analyzeInfographicInput(args: {
  userText: string
  model?: string
  signal?: AbortSignal
}): Promise<InfographicAnalysisJson> {
  const { userText, model = DEFAULT_ROUTIFY_TEXT_MODEL, signal } = args
  const text = String(userText ?? '').trim()
  if (!text) throw new Error('请输入要生成信息图的文本素材')
  const hiddenPrefixed = `${INFOGRAPH_HIDDEN_USER_PREFIX}\n\n${text}`

  const controller = new AbortController()
  const t = window.setTimeout(() => controller.abort(), 45_000)
  const merged = new AbortController()
  const relay = () => merged.abort()
  if (signal) {
    if (signal.aborted) merged.abort()
    else signal.addEventListener('abort', relay, { once: true })
  }
  if (controller.signal.aborted) merged.abort()
  else controller.signal.addEventListener('abort', relay, { once: true })

  const res = await routifyChatCompletions({
    body: {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: INFOGRAPH_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: hiddenPrefixed },
      ],
    },
    signal: merged.signal,
  })
  window.clearTimeout(t)
  const payloadText = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`信息图分析失败：${res.status} ${payloadText}`.trim())
  const payload = JSON.parse(payloadText) as any
  const content = payload?.choices?.[0]?.message?.content
  const raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p?.text ?? '').join('') : ''
  return safeParseJsonObject(raw)
}
