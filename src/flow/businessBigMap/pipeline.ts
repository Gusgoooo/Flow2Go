/**
 * Business Big Map — 生成管线
 *
 * 统一链路：输入 → IR → sizing → ELK layout → normalize → validate → materialize
 *
 * 文生图和图生图都收敛到此管线。
 */

import type { AiDiagramDraft, AiGenerateProgressInfo } from '../aiDiagram'
import { routifyChatCompletions } from '../routifyClient'
import type {
  BusinessBigMapIR,
  BigMapPipelineLog,
  BigMapValidationIssue,
} from './types'
import { BIGMAP_TEXT_SYSTEM_PROMPT, BIGMAP_IMAGE_SYSTEM_PROMPT } from './prompt'
import { computeNodeSizes } from './sizing'
import { layoutWithELK } from './layout'
import { normalizeBigMapLayout } from './normalize'
import { validateIR, validateLayout } from './validator'
import { materializeBigMapToFlow2Go } from './materialize'

const LOG_PREFIX = '[Flow2Go BigMap]'

// ─── 可观察性 ───

function log(stage: string, data: unknown) {
  if (import.meta.env.DEV) {
    console.log(`${LOG_PREFIX} [${stage}]`, data)
  }
}

// ─── IR 解析 ───

function parseIRFromLLMOutput(raw: string): BusinessBigMapIR {
  let cleaned = raw.trim()
  // 移除可能的 markdown 代码块标记
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  const parsed = JSON.parse(cleaned)
  if (parsed.schema !== 'flow2go.business-big-map.v1') {
    throw new Error(`无效的 IR schema: ${parsed.schema}`)
  }
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    throw new Error('IR 节点列表为空')
  }
  return parsed as BusinessBigMapIR
}

/**
 * 自动修复/降级 LLM 输出中的常见问题。
 */
function repairIRDefaults(ir: BusinessBigMapIR): BusinessBigMapIR {
  const nodes = ir.nodes.map((n, i) => ({
    id: n.id || `node-${i}`,
    title: n.title || '[未命名]',
    type: n.type === 'container' ? 'container' as const : 'node' as const,
    semanticRole: n.semanticRole || 'unknown' as const,
    order: typeof n.order === 'number' ? n.order : i,
    children: Array.isArray(n.children) ? n.children : [],
    ...(n.description ? { description: n.description } : {}),
    ...(n.tags ? { tags: n.tags } : {}),
  }))
  return { ...ir, nodes }
}

// ─── 响应解析（增强兼容性与可观测性） ───

function truncateText(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + `…(truncated, len=${s.length})`
}

function safeJsonStringify(v: unknown, maxLen: number): string {
  try {
    return truncateText(JSON.stringify(v), maxLen)
  } catch {
    return '[unserializable json]'
  }
}

function extractAssistantTextFromChatCompletionsPayload(payload: any): { text: string; debug: Record<string, unknown> } {
  const choice = payload?.choices?.[0]
  const msg = choice?.message

  const debug = {
    hasChoices: Array.isArray(payload?.choices),
    choiceCount: Array.isArray(payload?.choices) ? payload.choices.length : undefined,
    finishReason: choice?.finish_reason,
    messageKeys: msg && typeof msg === 'object' ? Object.keys(msg) : undefined,
    contentType: typeof msg?.content,
    hasToolCalls: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : 0,
  } as Record<string, unknown>

  // OpenAI 兼容：content 可能是 string
  if (typeof msg?.content === 'string') {
    return { text: msg.content, debug }
  }

  // 某些网关/模型：content 可能是数组（[{type:'text', text:'...'}]）
  if (Array.isArray(msg?.content)) {
    const texts = msg.content
      .map((c: any) => (typeof c?.text === 'string' ? c.text : (typeof c === 'string' ? c : '')))
      .filter((t: string) => t.trim().length > 0)
    const combined = texts.join('\n')
    return { text: combined, debug: { ...debug, contentArrayLen: msg.content.length } }
  }

  // tool_calls：有时内容放在 function.arguments（JSON 字符串）
  const tc0 = Array.isArray(msg?.tool_calls) ? msg.tool_calls[0] : undefined
  const args = tc0?.function?.arguments
  if (typeof args === 'string' && args.trim().length > 0) {
    return { text: args, debug: { ...debug, toolCallName: tc0?.function?.name } }
  }

  return { text: '', debug }
}

// ─── 文生图入口 ───

export type BigMapTextGenerateOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (info: AiGenerateProgressInfo) => void
}

export async function generateBigMapFromText(
  opts: BigMapTextGenerateOptions,
): Promise<{ draft: AiDiagramDraft; logs: BigMapPipelineLog[]; issues: BigMapValidationIssue[] }> {
  const { apiKey, model, prompt, signal, timeoutMs = 90_000, onProgress } = opts
  const startMs = Date.now()
  const logs: BigMapPipelineLog[] = []
  const allIssues: BigMapValidationIssue[] = []

  const report = (phase: string, detail?: string) => {
    const info: AiGenerateProgressInfo = { phase, detail, elapsedMs: Date.now() - startMs }
    log(phase, detail)
    onProgress?.(info)
  }

  // Stage 1: LLM → raw text
  report('生成业务大图', 'LLM 结构化中…')
  logs.push({ stage: 'input', timestamp: Date.now(), data: { prompt } })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })

  let rawText: string
  try {
    // 等待 LLM 返回时，DEV 下每 5s 打点一次，避免“看起来卡死”
    const waitTicker = import.meta.env.DEV
      ? window.setInterval(() => {
          log('LLM 等待中', { elapsedMs: Date.now() - startMs, model })
        }, 5000)
      : undefined
    const res = await routifyChatCompletions({
      body: { model, temperature: 0, stream: false, messages: [
        { role: 'system', content: BIGMAP_TEXT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ]},
      signal: controller.signal,
      bearerFallback: apiKey,
    })
    const rawBodyText = await res.text()
    if (!res.ok) throw new Error(`Routify 错误 ${res.status}: ${truncateText(rawBodyText, 2000)}`)
    const payload = JSON.parse(rawBodyText)
    const extracted = extractAssistantTextFromChatCompletionsPayload(payload)
    rawText = extracted.text ?? ''
    if (!rawText.trim()) {
      const hint = safeJsonStringify({ debug: extracted.debug, payload }, 2500)
      throw new Error(`AI 未返回可解析内容（chat.completions）: ${hint}`)
    }
    if (waitTicker != null) window.clearInterval(waitTicker)
  } catch (e) {
    if (signal?.aborted) throw new Error('已取消本次生成')
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  // Stage 2: Parse IR
  report('解析 IR', '解析 LLM 输出为中间结构…')
  let ir = parseIRFromLLMOutput(rawText)
  ir = repairIRDefaults(ir)
  ir.meta = { source: 'text', rawInputSummary: prompt.slice(0, 200) }
  logs.push({ stage: 'ir', timestamp: Date.now(), data: ir })

  // Run through common pipeline
  return runBigMapPipeline(ir, rawText, logs, allIssues, report)
}

// ─── 图生图入口 ───

export type BigMapImageGenerateOptions = {
  apiKey: string
  model: string
  imageDataUrl: string
  prompt?: string
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (info: AiGenerateProgressInfo) => void
}

export async function generateBigMapFromImage(
  opts: BigMapImageGenerateOptions,
): Promise<{ draft: AiDiagramDraft; logs: BigMapPipelineLog[]; issues: BigMapValidationIssue[] }> {
  const { apiKey, model, imageDataUrl, prompt, signal, timeoutMs = 120_000, onProgress } = opts
  const startMs = Date.now()
  const logs: BigMapPipelineLog[] = []
  const allIssues: BigMapValidationIssue[] = []

  const report = (phase: string, detail?: string) => {
    const info: AiGenerateProgressInfo = { phase, detail, elapsedMs: Date.now() - startMs }
    log(phase, detail)
    onProgress?.(info)
  }

  report('识图结构化', '读取图中结构…')
  logs.push({ stage: 'input', timestamp: Date.now(), data: { imageDataUrl: '[image]', prompt } })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })

  let rawText: string
  try {
    const messages: any[] = [
      { role: 'system', content: BIGMAP_IMAGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          ...(prompt ? [{ type: 'text', text: prompt }] : [{ type: 'text', text: '请识别这张图片中的业务大图结构。' }]),
        ],
      },
    ]
    const waitTicker = import.meta.env.DEV
      ? window.setInterval(() => {
          log('LLM 等待中', { elapsedMs: Date.now() - startMs, model })
        }, 5000)
      : undefined
    const res = await routifyChatCompletions({
      body: { model, temperature: 0, stream: false, messages },
      signal: controller.signal,
      bearerFallback: apiKey,
    })
    const rawBodyText = await res.text()
    if (!res.ok) throw new Error(`Routify 错误 ${res.status}: ${truncateText(rawBodyText, 2000)}`)
    const payload = JSON.parse(rawBodyText)
    const extracted = extractAssistantTextFromChatCompletionsPayload(payload)
    rawText = extracted.text ?? ''
    if (!rawText.trim()) {
      const hint = safeJsonStringify({ debug: extracted.debug, payload }, 2500)
      throw new Error(`AI 未返回可解析内容（chat.completions）: ${hint}`)
    }
    if (waitTicker != null) window.clearInterval(waitTicker)
  } catch (e) {
    if (signal?.aborted) throw new Error('已取消本次生成')
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  report('解析 IR', '解析 LLM 输出为中间结构…')
  let ir = parseIRFromLLMOutput(rawText)
  ir = repairIRDefaults(ir)
  ir.meta = { source: 'image', rawInputSummary: prompt?.slice(0, 200) ?? '[图片识别]' }
  logs.push({ stage: 'ir', timestamp: Date.now(), data: ir })

  return runBigMapPipeline(ir, rawText, logs, allIssues, report)
}

// ─── 公共管线 ───

async function runBigMapPipeline(
  rawIR: BusinessBigMapIR,
  rawText: string,
  logs: BigMapPipelineLog[],
  allIssues: BigMapValidationIssue[],
  report: (phase: string, detail?: string) => void,
): Promise<{ draft: AiDiagramDraft; logs: BigMapPipelineLog[]; issues: BigMapValidationIssue[] }> {

  // Stage 3: Validate IR
  report('校验 IR', '检查结构合法性…')
  const { ir, issues: irIssues } = validateIR(rawIR)
  allIssues.push(...irIssues)
  if (irIssues.length > 0) {
    log('IR 校验', irIssues)
  }

  // Stage 4: Compute sizes
  report('计算尺寸', '测量文本与容器大小…')
  const sizedNodes = computeNodeSizes(ir)
  logs.push({ stage: 'sized', timestamp: Date.now(), data: sizedNodes })

  // Stage 5: ELK layout
  report('布局计算', 'ELK 自动布局中…')
  const layoutResult = await layoutWithELK(sizedNodes)
  logs.push({ stage: 'layout', timestamp: Date.now(), data: layoutResult })

  // Stage 6: Normalize
  report('规范化', '对齐网格、统一间距…')
  const normalized = normalizeBigMapLayout(layoutResult)
  logs.push({ stage: 'normalized', timestamp: Date.now(), data: normalized })

  // Stage 7: Validate layout
  report('校验布局', '检测重叠/越界/遮挡…')
  const { layout: validated, issues: layoutIssues } = validateLayout(normalized)
  allIssues.push(...layoutIssues)
  logs.push({ stage: 'validated', timestamp: Date.now(), data: validated, issues: layoutIssues })

  // Stage 8: Materialize
  report('物化渲染', '转换为 Flow2Go 结构…')
  const { nodes, edges } = materializeBigMapToFlow2Go(validated, ir.title)
  logs.push({ stage: 'materialized', timestamp: Date.now(), data: { nodeCount: nodes.length, edgeCount: edges.length } })

  const draft: AiDiagramDraft = {
    schema: 'flow2go.ai.diagram.v1',
    title: ir.title,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    rawText,
  }

  report('生成完成', `${nodes.length} 个节点`)

  if (import.meta.env.DEV) {
    console.groupCollapsed(`${LOG_PREFIX} Pipeline Logs (${logs.length} stages)`)
    for (const l of logs) console.log(`[${l.stage}]`, l.data)
    if (allIssues.length > 0) {
      console.log('[Issues]', allIssues)
    }
    console.groupEnd()
  }

  return { draft, logs, issues: allIssues }
}
