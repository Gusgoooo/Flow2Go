import { DEFAULT_ROUTIFY_TEXT_MODEL } from '../constants'
import { routifyChatCompletions } from '../routifyClient'
import type { PptSlideInput } from './types'

type OpenRouterMessage = { role: 'system' | 'user'; content: string }

function buildSlidesStructureSystemPrompt(args: {
  userContent: string
  slideCount: number
  styleHint: string
}): string {
  const { userContent, slideCount, styleHint } = args
  return [
    '任务：生成PPT页面结构',
    '',
    '输入：',
    `- 内容：${userContent}`,
    `- 页数：${slideCount}`,
    `- 风格：${styleHint}`,
    '',
    '输出要求：',
    '',
    `1. 总页数必须等于 ${slideCount}`,
    '2. 每页结构必须一致',
    '3. 使用以下标签：',
    '   [title] / [subtitle] / [body]',
    '',
    '4. 控制每页信息密度：',
    '   - title: 1行',
    '   - subtitle: 0~1行',
    '   - body: 3~5条',
    '',
    '5. 风格要求：',
    `   ${styleHint}`,
    '',
    '6. 所有页面必须：',
    '   - 表达统一',
    '   - 语义清晰',
    '   - 可视化强',
    '',
    '输出：',
    '严格按页输出（不要 JSON，不要代码块，不要解释），格式示例：',
    '第1页：',
    '[title] ...',
    '[subtitle] ...（可选）',
    '[body] ...',
    '[body] ...',
    '[body] ...',
    '',
  ].join('\n')
}

function inferSlideCountFromText(rawInput: string): number {
  const t = String(rawInput ?? '')
  const hits = t.match(/第\s*\d+\s*页/g) ?? []
  if (hits.length > 0) return hits.length
  // fallback: count blank-line separated blocks that look like pages
  const blocks = t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  return Math.max(1, blocks.length)
}

function safeParseSlidesFromTaggedPages(raw: string, expectedCount: number): PptSlideInput[] {
  const t = String(raw ?? '').trim()
  if (!t) throw new Error('转译结果为空')
  const pages = t.split(/(?:^|\n)\s*第\s*\d+\s*页\s*：\s*/g).map((s) => s.trim()).filter(Boolean)
  if (pages.length !== expectedCount) {
    throw new Error(`转译页数不符合预期：期望 ${expectedCount} 页，实际 ${pages.length} 页`)
  }

  const slides: PptSlideInput[] = pages.map((pageText) => {
    const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean)
    let title = ''
    let subtitle = ''
    const body: string[] = []
    for (const line of lines) {
      if (line.startsWith('[title]')) title = line.replace(/^\[title\]\s*/i, '').trim()
      else if (line.startsWith('[subtitle]')) subtitle = line.replace(/^\[subtitle\]\s*/i, '').trim()
      else if (line.startsWith('[body]')) {
        const v = line.replace(/^\[body\]\s*/i, '').trim()
        if (v) body.push(v)
      }
    }
    if (!title) throw new Error('转译缺少 [title]')
    return {
      title,
      subtitle: subtitle || undefined,
      body: body.length ? body.slice(0, 5) : undefined,
    }
  })

  return slides
}

export async function translateSlidesFromNaturalLanguage(args: {
  input: string
  slideCount?: number
  styleHint?: string
  model?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<PptSlideInput[]> {
  const { input, slideCount, styleHint = '', model = DEFAULT_ROUTIFY_TEXT_MODEL, signal, timeoutMs = 45000 } = args
  const text = String(input ?? '').trim()
  if (!text) throw new Error('请输入 PPT 结构化自然语言内容')

  const count = Math.max(1, Math.round(Number.isFinite(slideCount as number) ? (slideCount as number) : inferSlideCountFromText(text)))
  const systemPrompt = buildSlidesStructureSystemPrompt({
    userContent: text,
    slideCount: count,
    styleHint: String(styleHint ?? '').trim(),
  })

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: text },
  ]

  const controller = new AbortController()
  let timedOut = false
  const t = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const merged = new AbortController()
  const relayAbort = () => merged.abort()
  if (signal) {
    if (signal.aborted) merged.abort()
    else signal.addEventListener('abort', relayAbort, { once: true })
  }
  if (controller.signal.aborted) merged.abort()
  else controller.signal.addEventListener('abort', relayAbort, { once: true })

  try {
    const res = await routifyChatCompletions({
      body: { model, temperature: 0, messages },
      signal: merged.signal,
    })

    const payloadText = await res.text().catch(() => '')
    if (!res.ok) {
      const hint =
        payloadText.includes('ENOTFOUND') || payloadText.includes('getaddrinfo')
          ? '（本机网络无法解析 Routify 域名；请检查 DNS/代理/内网环境）'
          : ''
      throw new Error(`slides 转译失败：${res.status} ${payloadText} ${hint}`.trim())
    }
    const payload = JSON.parse(payloadText)
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('slides 转译未返回内容')
    return safeParseSlidesFromTaggedPages(content, count)
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (signal?.aborted && !timedOut) throw new Error('用户已取消本次转译')
      if (timedOut) throw new Error(`转译超时（>${Math.round(timeoutMs / 1000)}s），已中止`)
      throw new Error('转译请求被中断，请重试')
    }
    throw e
  } finally {
    window.clearTimeout(t)
    if (signal) signal.removeEventListener('abort', relayAbort)
    controller.signal.removeEventListener('abort', relayAbort)
  }
}

