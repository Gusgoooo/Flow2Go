export type AiDiagramSchema = 'flow2go.ai.diagram.v1'

export type AiDiagramDraft = {
  schema: AiDiagramSchema
  title?: string
  nodes: unknown[]
  edges: unknown[]
  viewport?: { x: number; y: number; zoom: number }
  /** 原始响应文本（用于调试/展示） */
  rawText: string
}

/** 由 UI 胶囊显式指定的生图场景；不传则完全由 Scene Router / 关键词自动判断 */
export type AiDiagramSceneHint =
  | 'mind-map'
  | 'flowchart'
  | 'swimlane'
  | 'free-layout'

/** 生成进度：用于 UI 与控制台排查「慢 / 卡住 / 失败」 */
export type AiGenerateProgressInfo = {
  phase: string
  detail?: string
  /** 自 openRouterGenerateDiagram 开始以来的毫秒数 */
  elapsedMs: number
}

export type OpenRouterChatOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
  /** 选中场景胶囊时传入，强制走对应管线 */
  diagramScene?: AiDiagramSceneHint
  /** 每进入一个新阶段调用一次（含耗时），便于界面展示与 DevTools 排查 */
  onProgress?: (info: AiGenerateProgressInfo) => void
}

export type OpenRouterImageToDiagramOptions = {
  apiKey: string
  model?: string
  recognitionModel?: string
  generationModel?: string
  imageDataUrl: string
  /** 可选：用户额外补充要求（如“改成泳道图”） */
  prompt?: string
  signal?: AbortSignal
  timeoutMs?: number
  diagramScene?: AiDiagramSceneHint
  onProgress?: (info: AiGenerateProgressInfo) => void
}

import { parseMermaidFlowchart, transpileMermaidFlowIR } from './mermaid'
import { materializeGraphBatchPayloadToSnapshot } from './mermaid/apply'
import { GRID_UNIT, snapToGrid } from './grid'
import { swimlaneDraftToGraphBatchPayload, type SwimlaneDraft } from './swimlaneDraft'
import { routifyChatCompletions } from './routifyClient'

const DEFAULT_TIMEOUT_MS = 90_000

import MERMAID_GENERATOR_SYSTEM_PROMPT from './aiPromptPresets/mermaid-generator-system-prompt.md?raw'
import {
  type LayoutDecision,
  type LayoutProfileKey,
  LAYOUT_PROFILE_KEYS,
  type SceneRouteV2,
  isLayoutProfileKey,
  resolveLayoutDecision,
  sceneRouteFromLegacyTemplateKey,
  toPlannerComplexity,
} from './aiLayoutTypes'

/** 兼容旧代码：模板名称（思维导图 + 流程图 profile） */
export type UserTemplateKey =
  | LayoutProfileKey
  | 'Mind Map Template'

/** @deprecated 旧版模板选择器文案；请使用 LAYOUT_SELECTOR_SYSTEM_PROMPT + openRouterSelectLayoutProfile */
export const TEMPLATE_SELECTOR_SYSTEM_PROMPT = [
  '（已弃用）请改用 Layout Selector JSON。',
  '仅保留导出以避免外部引用报错。',
].join('\n')

/**
 * Layout Selector：只输出轻量布局决策（不返回长模板正文）
 */
export const LAYOUT_SELECTOR_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Layout Selector（布局选择器）。',
  '',
  '你的任务不是生成图内容，而是根据用户需求判断：',
  '- 应使用的流程类 layoutProfileKey（6 选 1，见下）',
  '- complexityMode：compact（更克制）或 normal（更章节化）',
  '- sceneKind：与后续 Scene Router 同义的粗分类',
  '- pipeline：只能是 flowchart（本选择器仅负责流程图布局 profile）',
  '',
  '可选 layoutProfileKey（必须完全一致）：',
  ...LAYOUT_PROFILE_KEYS.map((k, i) => `${i + 1}. ${k}`),
  '',
  '选择规则（与旧模板语义对应，但不输出模板正文）：',
  '- 前后端/接口/服务/数据库链路 → Frontend-Backend Flow Template',
  '- 数据管道/数仓/指标 → Data Pipeline Flow Template',
  '- Agent/RAG/工具链 → Agent Workflow Template',
  '- 审批/会签/通知 → Approval Workflow Template',
  '- 平台分层/基础设施 → System Architecture Template',
  '- 用户旅程/触点 → User Journey Template',
  '',
  '输出要求（强制）：',
  '- 只能输出一段严格 JSON，不要代码块，不要多余文字。',
  '- JSON 格式：',
  '{',
  '  "layoutProfileKey": "<上述 6 个名称之一>",',
  '  "complexityMode": "compact" | "normal",',
  '  "sceneKind": "agent-flow|approval-flow|data-pipeline|business-flow|hierarchy|other"',
  '}',
].join('\n')

/** 各 layout profile 的 subgraph 提示（软约束：不再强制分区数量/固定英文名，交给 Planner 与用户意图） */
const FLOWCHART_PROFILE_SUBGRAPH_SOFT_HINT = [
  '【流程图 layout profile（强可读性）】',
  '- profile 名称仅作语义参考；核心目标是“简单、清晰、易读”，不要追求复杂关系完整还原。',
  '- subgraph（group）可用但必须克制：仅按阶段分组（如 提交/审核/执行），禁止过度拆分。',
  '- 跨 group 连线严格限制：仅允许“阶段结束 -> 下一阶段开始”这类必要交接；禁止来回横跳与大规模跨组连接。',
  '- 默认结构应接近单链路：大多数节点 1 -> 1 推进；判断节点才允许分支（最多 yes/no 两条）。',
  '- 主流程方向固定为 LR（从左到右）；避免主路径回头与网状连接。',
  '- 布局由 Flow2Go 内置 Dagre 自动处理；请优先减少连接复杂度来提升可读性。',
].join('\n')

const LAYOUT_PROFILE_SUBGRAPH_RULES: Record<LayoutProfileKey, string> = {
  'Frontend-Backend Flow Template': FLOWCHART_PROFILE_SUBGRAPH_SOFT_HINT,
  'Data Pipeline Flow Template': FLOWCHART_PROFILE_SUBGRAPH_SOFT_HINT,
  'Agent Workflow Template': FLOWCHART_PROFILE_SUBGRAPH_SOFT_HINT,
  'Approval Workflow Template': FLOWCHART_PROFILE_SUBGRAPH_SOFT_HINT,
  'System Architecture Template': FLOWCHART_PROFILE_SUBGRAPH_SOFT_HINT,
  'User Journey Template': FLOWCHART_PROFILE_SUBGRAPH_SOFT_HINT,
}

const MIND_MAP_MERMAID_SUBGRAPH_RULES = [
  '【思维导图 Mermaid 约束（轻量）】',
  '- Mermaid 第一行必须严格为：flowchart LR。',
  '- 建议保持树状层级（根 -> 分支 -> 子要点），避免明显回环。',
  '- 节点 id 必须唯一且为小写英文字母/数字/下划线；节点 label 必须为中文且尽量短。',
  '- 父子关系默认用无标签连线：`父id --> 子id`；仅在确有语义时再使用 `-->|...|`。',
  '- 布局由系统 mind-elixir-core 管线决定（除配色外不额外施加版式限制）。',
].join('\n')

function layoutDecisionSystemSnippet(ld: LayoutDecision): string {
  const lines = [
    '【布局决策（轻量，仅版式/引擎偏好；具体节点与章节由 Planner JSON 与用户输入决定）】',
    `- diagramType: ${ld.diagramType}`,
    `- layoutEngine: ${ld.layoutEngine}`,
    `- layoutMode: ${ld.layoutMode}`,
    `- complexityMode: ${ld.complexityMode}`,
    `- profileId: ${ld.profileId}`,
  ]
  if (ld.diagramType === 'flowchart') {
    lines.push(
      '- 流程图物化：每个子图内部与顶层元素各跑一次 Dagre 默认布局；不要求人为压缩节点或边数量。',
    )
  }
  return lines.join('\n')
}

type OpenRouterMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenRouterMessage = {
  role: 'system' | 'user'
  content: string | OpenRouterMessageContentPart[]
}

async function openRouterChatCompleteByMessages(args: {
  apiKey: string
  model: string
  messages: OpenRouterMessage[]
  signal?: AbortSignal
  timeoutMs: number
  temperature: number
  maxTokens?: number
}): Promise<string> {
  const controller = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, args.timeoutMs)
  const mergedController = new AbortController()
  const relayAbort = () => mergedController.abort()
  if (args.signal) {
    if (args.signal.aborted) {
      mergedController.abort()
    } else {
      args.signal.addEventListener('abort', relayAbort, { once: true })
    }
  }
  if (controller.signal.aborted) {
    mergedController.abort()
  } else {
    controller.signal.addEventListener('abort', relayAbort, { once: true })
  }

  try {
    const requestPayload: Record<string, unknown> = {
      model: args.model,
      temperature: args.temperature,
      messages: args.messages,
    }
    const maxTokens = Number(args.maxTokens)
    if (Number.isFinite(maxTokens) && maxTokens > 0) {
      requestPayload.max_tokens = Math.floor(maxTokens)
    }
    const res = await routifyChatCompletions({
      body: requestPayload,
      signal: mergedController.signal,
      bearerFallback: args.apiKey,
    })

    const text = await res.text()
    if (!res.ok) throw new Error(`Routify 错误 ${res.status}: ${text}`)
    const payload = JSON.parse(text)
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回内容')
    return content.trim()
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (args.signal?.aborted && !timedOut) {
        throw new Error('用户已取消本次生成')
      }
      if (timedOut) {
        throw new Error(`请求超时（>${Math.round(args.timeoutMs / 1000)}s），已中止`)
      }
      throw new Error('请求被中断，请重试')
    }
    throw e
  } finally {
    if (args.signal) args.signal.removeEventListener('abort', relayAbort)
    controller.signal.removeEventListener('abort', relayAbort)
    window.clearTimeout(timeout)
  }
}

async function openRouterChatComplete(args: {
  apiKey: string
  model: string
  system: string
  user: string
  signal?: AbortSignal
  timeoutMs: number
  temperature: number
}): Promise<string> {
  return openRouterChatCompleteByMessages({
    apiKey: args.apiKey,
    model: args.model,
    signal: args.signal,
    timeoutMs: args.timeoutMs,
    temperature: args.temperature,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
  })
}

function stripCodeFences(s: string): string {
  const t = s.trim()
  // ``` ... ```
  const fence = t.match(/^```(?:mermaid|json)?\s*([\s\S]*?)\s*```$/i)
  if (fence?.[1]) return fence[1].trim()
  return t
}

export type LayoutProfileSelectResult = {
  layoutProfileKey: LayoutProfileKey
  sceneKind: SceneRouteV2['sceneKind']
  complexityMode: SceneRouteV2['complexityMode']
}

/**
 * Layout Selector：返回轻量 profile（mind-map 由 Scene Router 分流）
 */
export async function openRouterSelectLayoutProfile(args: OpenRouterChatOptions): Promise<LayoutProfileSelectResult> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  // Key 可选：生产环境可通过服务端代理环境变量提供
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: LAYOUT_SELECTOR_SYSTEM_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })

  try {
    const cleaned = stripCodeFences(raw).trim()
    const obj = JSON.parse(cleaned)
    const lpk = obj?.layoutProfileKey as string | undefined
    const sk = obj?.sceneKind as SceneRouteV2['sceneKind'] | undefined
    const cm = obj?.complexityMode as string | undefined
    if (lpk && isLayoutProfileKey(lpk) && sk && (cm === 'compact' || cm === 'normal')) {
      const sceneKinds: SceneRouteV2['sceneKind'][] = [
        'agent-flow',
        'approval-flow',
        'data-pipeline',
        'business-flow',
        'hierarchy',
        'other',
      ]
      if (sceneKinds.includes(sk)) {
        return { layoutProfileKey: lpk, sceneKind: sk, complexityMode: cm }
      }
    }
  } catch {
    /* fallback */
  }

  return {
    layoutProfileKey: 'Frontend-Backend Flow Template',
    sceneKind: 'other',
    complexityMode: 'compact',
  }
}

function layoutProfileResultToFallbackRoute(sel: LayoutProfileSelectResult): SceneRouteV2 {
  return {
    sceneKind: sel.sceneKind,
    complexityMode: sel.complexityMode,
    layoutProfileKey: sel.layoutProfileKey,
    pipeline: 'flowchart',
  }
}

/**
 * @deprecated 旧「8 模板名」选择；Router 失败时回退为 flowchart layoutProfileKey
 */
export async function openRouterSelectUserTemplate(args: OpenRouterChatOptions): Promise<UserTemplateKey> {
  const sel = await openRouterSelectLayoutProfile(args)
  return sel.layoutProfileKey
}

function isFiniteNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function validateAiDiagramDraft(obj: any, rawText: string): AiDiagramDraft {
  if (!obj || typeof obj !== 'object') throw new Error('AI 返回内容不是对象')
  if (obj.schema !== 'flow2go.ai.diagram.v1') throw new Error('AI schema 不匹配（需要 flow2go.ai.diagram.v1）')
  if (!Array.isArray(obj.nodes)) throw new Error('AI nodes 必须是数组')
  if (!Array.isArray(obj.edges)) throw new Error('AI edges 必须是数组')

  if (obj.viewport != null) {
    const v = obj.viewport
    if (!v || typeof v !== 'object') throw new Error('AI viewport 格式错误')
    if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.zoom)) throw new Error('AI viewport 坐标/缩放必须为数字')
  }

  return {
    schema: 'flow2go.ai.diagram.v1',
    title: typeof obj.title === 'string' ? obj.title : undefined,
    nodes: obj.nodes,
    edges: obj.edges,
    viewport: obj.viewport,
    rawText,
  }
}

export function normalizeAiDiagramToSnapshot(draft: AiDiagramDraft): { nodes: any[]; edges: any[]; viewport?: { x: number; y: number; zoom: number } } {
  // 第一阶段：最小归一化，保证结构可用；坐标/parentId 的强语义在应用阶段继续校验/修复。
  const nodes = Array.isArray(draft.nodes) ? draft.nodes : []
  const edges = Array.isArray(draft.edges) ? draft.edges : []
  const viewport = draft.viewport
  return { nodes, edges, viewport }
}

export async function convertMermaidToAiDraft(
  rawText: string,
  opts?: { layoutProfile?: string },
): Promise<AiDiagramDraft> {
  const cleaned = stripCodeFences(rawText)
  const parsed = parseMermaidFlowchart(cleaned)
  if (!parsed.success || !parsed.ir) {
    const msg = parsed.errors?.[0]?.message || 'Mermaid 解析失败'
    throw new Error(msg)
  }
  const transpiled = transpileMermaidFlowIR(parsed.ir, cleaned, parsed.warnings)
  if (!transpiled.success || !transpiled.data) {
    const msg = transpiled.errors?.[0]?.message || 'Mermaid 转译失败'
    throw new Error(msg)
  }
  transpiled.data.meta = {
    ...(transpiled.data.meta ?? {}),
    ...(opts?.layoutProfile ? { layoutProfile: opts.layoutProfile } : {}),
    /** 自然语言 Mermaid 转图：不自动注入语义色、思维导图分岔色等预设 */
    neutralGeneration: true,
  }
  const snap = await materializeGraphBatchPayloadToSnapshot(transpiled.data, { replace: true })
  return {
    schema: 'flow2go.ai.diagram.v1',
    title: undefined,
    nodes: snap.nodes,
    edges: snap.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    rawText: cleaned,
  }
}

export const DEFAULT_MERMAID_SYSTEM_PROMPT = MERMAID_GENERATOR_SYSTEM_PROMPT.trimEnd()

export const DEFAULT_MERMAID_USER_TEMPLATE = ['{{prompt}}'].join('\n')

/** Planner 与历史 JSON 字段兼容 */
type ComplexityMode = 'compact' | 'chapters'

const SCENE_ROUTER_SCENE_KINDS: SceneRouteV2['sceneKind'][] = [
  'agent-flow',
  'approval-flow',
  'data-pipeline',
  'business-flow',
  'hierarchy',
  'mind-map',
  'other',
]

const SCENE_ROUTER_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Scene Router（场景路由器）。',
  '',
  '你的任务：识别用户意图属于哪条生成管道，并给出轻量路由信息。',
  '你不再负责输出「长内容模板」；通用流程图的内容结构由 Diagram Planner 压缩，布局由 Layout Selector 辅助。',
  '',
  '你的输出必须是“纯 JSON”，不能有任何多余文本或代码块。',
  'JSON 格式（新格式，优先使用）：',
  '{',
  '  "pipeline": "mind-map" | "flowchart",',
  '  "sceneKind": "agent-flow|approval-flow|data-pipeline|business-flow|hierarchy|mind-map|other",',
  '  "complexityMode": "compact" | "normal" | "chapters",',
  '  "layoutProfileKey": "<仅当 pipeline=flowchart 时必填，6 个布局 profile 名称之一>" | null',
  '}',
  '',
  `当 pipeline=mind-map：layoutProfileKey 必须为 null；sceneKind 建议 mind-map。`,
  `当 pipeline=flowchart：layoutProfileKey 必须从下列 6 个名称中精确选一个：`,
  ...LAYOUT_PROFILE_KEYS.map((k) => `  - ${k}`),
  '',
  '路由规则：',
  '- 思维导图/脑图/树状发散 → pipeline=mind-map',
  '- 其它流程/架构/旅程等 → pipeline=flowchart，并选对 layoutProfileKey',
  '',
  '兼容说明：若你更熟悉旧格式，也可输出 {"templateKey":"...","sceneKind":"...","complexityMode":"compact|chapters"}（7 个旧模板名之一），系统会自动转换。',
  '',
  '默认：不确定时用 flowchart + Frontend-Backend Flow Template + compact。',
].join('\n')

const LONG_INPUT_SUMMARY_THRESHOLD = 2200
const LONG_INPUT_TIMEOUT_MS = 150_000
const FLOWCHART_GUARD_NODE_MAX = 16
const FLOWCHART_GUARD_EDGE_MAX = 20
const FLOWCHART_GUARD_EDGE_OVER_NODE_ALLOWANCE = 4
const STABLE_GENERATION_TEMPERATURE = 0

function isFlowchartOverComplex(nodesCount: number, edgesCount: number): boolean {
  if (nodesCount > FLOWCHART_GUARD_NODE_MAX) return true
  if (edgesCount > FLOWCHART_GUARD_EDGE_MAX) return true
  if (nodesCount <= 0) return edgesCount > 0
  const denseByGap = edgesCount > nodesCount + FLOWCHART_GUARD_EDGE_OVER_NODE_ALLOWANCE
  const denseByRatio = edgesCount / nodesCount > 1.35
  return denseByGap || denseByRatio
}

function flowchartComplexityScore(nodesCount: number, edgesCount: number): number {
  return nodesCount + edgesCount * 1.15
}

const DIAGRAM_PLANNER_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Diagram Planner / Graph Normalizer（规划器）。',
  '你同时是“自然语言 -> 简洁流程图结构”的转译器：目标不是完整保留用户描述，而是压缩成简单、清晰、稳定、易读的流程图语义。',
  '',
  '你的任务：把用户原始高噪声输入，压缩成结构规划 JSON（供 Mermaid 生成器使用）。',
  '',
  '硬约束：',
  '- 只能输出严格 JSON（不能有任何多余文本、代码块标记、换行外的内容）。',
  '- 不要输出 Mermaid DSL，不要输出任何 subgraph/end/flowchart/classDef/style/linkStyle/click/::: 等。',
  '- 不要输出任何节点 id（例如 id[xxx] 这种）与边（例如 A --> B 这种）表达式。',
  '- 只输出规划骨架：主题、分层结构、主链/支撑/回流的文字意图、以及要点颗粒度。',
  '',
  '输出 JSON 结构（固定字段，强制类型）：',
  '{',
  '  "templateKey": string,',
  '  "complexityMode": "compact" | "chapters",',
  '（templateKey：Mind Map Template | 或 6 个 flowchart layoutProfile 名称之一）',
  '  "theme": string,',
  '  "structure": {',
  '    "framesOrRoot": [',
  '      {',
  '        "title": string,',
  '        "case": "case1" | "case2" | "case3",',
  '        "directPoints": string[],',
  '        "children": [',
  '          {',
  '            "title": string,',
  '            "points": string[]',
  '          }',
  '        ]',
  '      }',
  '    ]',
  '  },',
  '  "mainChain": string,',
  '  "supportStrategy": string,',
  '  "feedbackStrategy": string,',
  '  "constraints": {',
  '    "modulePointRange": [number, number],',
  '    "targetNodeCountHintRange": [number, number],',
  '    "noCrossBranchConnections": boolean',
  '  }',
  '}',
  '',
  '当 templateKey 为 Mind Map Template：',
  '- framesOrRoot 的第一个元素作为中心主题（root）；其 children/points 仅作为基础线索，不限制最终层数固定为 3 层。',
  '- 层级深度必须根据用户文案语义自动拆解：可 2~6 层，禁止机械固定“根->一级->二级”映射。',
  '- 若用户文案存在更深子主题（如分域->模块->子模块->要点），应继续递归展开，不要截断到二级要点。',
  '- 要求：保持树状发散与可读性，避免无意义重复节点或空壳层级。',
  '- 列间距、线型由系统 mind-map 布局器与模板负责；你只负责结构信息。',
  '',
  '当 templateKey 为以下任一（6 个 flowchart layout profile：Frontend-Backend / Data Pipeline / Agent / Approval / System Architecture / User Journey）：',
  '- 【核心原则：强制简化】优先保留主流程，删除次要步骤，合并重复/相似动作；宁可少，不要乱；不要生成复杂依赖网。',
  '- 【连接规则：默认 1 by 1】普通步骤默认单入单出，不要多下游/多汇入；仅判断节点允许分支。',
  '- 【判断规则】decision 仅在必要时出现；每个 decision 最多 yes/no 两条分支；分支应尽快收敛；禁止连续多个判断节点。',
  '- 【Group 规则】可以分阶段 group（提交/审核/执行等）但必须克制；默认禁止跨 group 连线，仅允许阶段交接时跨一次；禁止来回跨 group。',
  '- 【方向与可读性】主流程必须从左到右（LR）推进，避免折返；结构应一眼可读，分支很少，节点不拥挤。',
  '- 【边语义约束】默认 next；yes/no 仅用于 decision 分支；避免无意义复杂连接。',
  '- mainChain：必须写成单链路主路径（一句话）；supportStrategy / feedbackStrategy 若无必要写「无」或极短补充。',
  '- constraints 建议保守：targetNodeCountHintRange 默认偏小（建议 7~16），并显式强调 noCrossBranchConnections=true。',
  '- 仍禁止输出 Mermaid、禁止输出具体节点 id 与边表达式。',
  '- 输出前必须自检：1) 大多数是否 1->1；2) 是否几乎无跨 group；3) 是否无网状结构；4) 是否简单清晰；不满足则继续简化。',
].join('\n')

function detectMindMapIntent(prompt: string): boolean {
  return /(思维导图|脑图|mind\s*map|树状联想|主题分支|知识梳理|层级展开)/i.test(prompt)
}

function parseSceneRouteJson(raw: string): SceneRouteV2 | null {
  try {
    const cleaned = stripCodeFences(raw).trim()
    const obj = JSON.parse(cleaned)

    const pipelineRaw = obj?.pipeline as string | undefined
    if (pipelineRaw === 'mind-map' || pipelineRaw === 'flowchart') {
      const sceneKind = obj?.sceneKind as SceneRouteV2['sceneKind'] | undefined
      if (!sceneKind || !SCENE_ROUTER_SCENE_KINDS.includes(sceneKind)) return null
      const cm = obj?.complexityMode as string | undefined
      if (cm !== 'compact' && cm !== 'normal' && cm !== 'chapters') return null

      if (pipelineRaw === 'mind-map') {
        return { sceneKind: 'mind-map', complexityMode: cm, layoutProfileKey: null, pipeline: 'mind-map' }
      }
      const lpk = obj?.layoutProfileKey as string | null | undefined
      if (!lpk || !isLayoutProfileKey(lpk)) return null
      return { sceneKind, complexityMode: cm, layoutProfileKey: lpk, pipeline: 'flowchart' }
    }

    const templateKey = obj?.templateKey as string | undefined
    if (templateKey) {
      const legacyEight = new Set<string>([
        ...LAYOUT_PROFILE_KEYS,
        'Mind Map Template',
      ])
      if (!legacyEight.has(templateKey)) return null
      const sceneKind = obj?.sceneKind as SceneRouteV2['sceneKind'] | undefined
      const complexityMode = obj?.complexityMode as ComplexityMode | undefined
      if (!sceneKind || !SCENE_ROUTER_SCENE_KINDS.includes(sceneKind)) return null
      if (complexityMode !== 'compact' && complexityMode !== 'chapters') return null
      return sceneRouteFromLegacyTemplateKey(templateKey, complexityMode)
    }
    return null
  } catch {
    return null
  }
}

const IMAGE_STRUCTURE_SCHEMA_V1 = 'flow2go.image.structure.v1' as const
const IMAGE_STRUCTURE_SCHEMA_V2 = 'flow2go.image.structure.v2' as const
const IMAGE_STRUCTURE_SCHEMA = IMAGE_STRUCTURE_SCHEMA_V2
type ImageSceneHint = AiDiagramSceneHint | 'auto'
type ImageStructuredNodeType = 'start_end' | 'process' | 'decision' | 'io' | 'subprocess'
type ImageStructuredGroupKind = 'group' | 'lane' | 'container'

type AiImageStructuredStyle = {
  fill?: string
  stroke?: string
  textColor?: string
  strokeWidth?: number
  opacity?: number
}

type AiImageStructuredConfidence = {
  geometry: number
  hierarchy: number
  color: number
  scene: number
  overall: number
}

type AiImageStructuredNode = {
  id: string
  label: string
  type: ImageStructuredNodeType
  lane?: string
  parentId?: string
  /** 归一化到 [0,1] 的相对坐标与尺寸（左上角坐标） */
  x?: number
  y?: number
  w?: number
  h?: number
  style?: AiImageStructuredStyle
  confidence?: number
}

type AiImageStructuredGroup = {
  id: string
  label: string
  kind: ImageStructuredGroupKind
  parentId?: string
  x?: number
  y?: number
  w?: number
  h?: number
  style?: AiImageStructuredStyle
  confidence?: number
}

export type AiImageStructuredDraft = {
  schema: typeof IMAGE_STRUCTURE_SCHEMA
  title?: string
  sceneHint: ImageSceneHint
  lanes: string[]
  groups: AiImageStructuredGroup[]
  nodes: AiImageStructuredNode[]
  edges: Array<{ from: string; to: string; relation: string; label?: string }>
  confidence?: AiImageStructuredConfidence
  rawText: string
}

const IMAGE_STRUCTURE_ALLOWED_SCHEMAS = new Set<string>([
  IMAGE_STRUCTURE_SCHEMA_V1,
  IMAGE_STRUCTURE_SCHEMA_V2,
])

const IMAGE_EDGE_RELATIONS = new Set([
  'next',
  'yes',
  'no',
  'notify',
  'request',
  'return_to',
  'submit_to',
  'cancel_to',
])

const IMAGE_TO_STRUCTURED_STAGE1_SYSTEM_PROMPT = [
  '你是 Flow2Go 的识图模型（阶段1：结构骨架提取）。',
  '仅提取：场景判断、泳道、容器/分组、节点、连线拓扑、粗几何框。',
  '不要生成解释，不要 markdown，只输出严格 JSON。',
  '',
  '强制输出 schema：',
  `- "schema": "${IMAGE_STRUCTURE_SCHEMA}"`,
  '',
  'sceneHint 只能是：mind-map | flowchart | swimlane | free-layout | auto。',
  'groups/nodes/edges 必须是数组，id 必须唯一且可引用。',
  'groups 用于表达画框/泳道/容器嵌套：kind 只能是 group|lane|container。',
  '节点与容器均可给 x/y/w/h（0~1 归一化）。',
  '',
  '输出 JSON 结构（必须严格匹配字段名）：',
  '{',
  `  "schema": "${IMAGE_STRUCTURE_SCHEMA}",`,
  '  "title": "可选标题",',
  '  "sceneHint": "mind-map|flowchart|swimlane|free-layout|auto",',
  '  "lanes": ["可选泳道1", "可选泳道2"],',
  '  "groups": [',
  '    { "id": "g1", "label": "阶段一", "kind": "group", "parentId": "可选", "x": 0.08, "y": 0.12, "w": 0.36, "h": 0.30 }',
  '  ],',
  '  "nodes": [',
  '    { "id": "n1", "label": "开始", "type": "start_end", "lane": "可选泳道", "parentId": "可选", "x": 0.12, "y": 0.20, "w": 0.14, "h": 0.07 }',
  '  ],',
  '  "edges": [',
  '    { "from": "n1", "to": "n2", "relation": "next", "label": "可选" }',
  '  ]',
  '}',
].join('\n')

const IMAGE_TO_STRUCTURED_STAGE2_SYSTEM_PROMPT = [
  '你是 Flow2Go 的识图模型（阶段2：细节增强与校准）。',
  '你会收到一份阶段1的结构骨架 JSON，以及同一张图片。',
  '目标：在不破坏骨架拓扑的前提下，补全层级归属与颜色样式，并输出严格 JSON。',
  '',
  '强制约束：',
  `- 输出 schema 固定为 "${IMAGE_STRUCTURE_SCHEMA}"。`,
  '- 优先复用阶段1中的 id，不要随意改名；确需新增也要保持引用正确。',
  '- 允许补全字段：groups[].parentId、nodes[].parentId、style(fill/stroke/textColor/strokeWidth/opacity)。',
  '- 泳道分组 groups（kind=lane）：不要输出 style.fill、labelFill、color、stroke、strokeWidth 等泳道配色/描边字段（由应用统一默认）。',
  '- 禁止臆造复杂关系；若不确定，保持 next 关系并保守输出。',
  '- 仅输出 JSON，不要 markdown，不要解释。',
].join('\n')

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function clampRange(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

function toShortString(input: unknown, fallback = '', maxLen = 48): string {
  if (typeof input !== 'string') return fallback
  const v = input.trim()
  if (!v) return fallback
  return v.length > maxLen ? v.slice(0, maxLen) : v
}

function toRatio(input: unknown): number | undefined {
  const n = Number(input)
  if (!Number.isFinite(n)) return undefined
  return clamp01(n)
}

function toOptionalNumber(input: unknown): number | undefined {
  const n = Number(input)
  return Number.isFinite(n) ? n : undefined
}

function normalizeImageSceneHint(input: unknown): ImageSceneHint {
  if (
    input === 'mind-map' ||
    input === 'flowchart' ||
    input === 'swimlane' ||
    input === 'free-layout' ||
    input === 'auto'
  ) return input
  return 'auto'
}

function normalizeImageNodeType(input: unknown): ImageStructuredNodeType {
  if (input === 'start_end' || input === 'process' || input === 'decision' || input === 'io' || input === 'subprocess') return input
  return 'process'
}

function normalizeImageGroupKind(input: unknown): ImageStructuredGroupKind {
  if (input === 'group' || input === 'lane' || input === 'container') return input
  return 'group'
}

function hexByte(n: number): string {
  return clampRange(Math.round(n), 0, 255).toString(16).padStart(2, '0').toUpperCase()
}

function normalizeHexColor(input: string): string | undefined {
  const raw = input.trim()
  if (!raw) return undefined
  const m = raw.match(/^#([0-9a-fA-F]{3,8})$/)
  if (!m) return undefined
  const hex = m[1]
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase()
  }
  if (hex.length === 4) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase()
  }
  if (hex.length === 6 || hex.length === 8) {
    return `#${hex.slice(0, 6)}`.toUpperCase()
  }
  return undefined
}

function normalizeRgbColor(input: string): string | undefined {
  const m = input.trim().match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return undefined
  const parts = m[1].split(',').map((x) => x.trim())
  if (parts.length < 3) return undefined
  const toChannel = (raw: string): number => {
    if (raw.endsWith('%')) {
      const p = Number(raw.slice(0, -1))
      if (!Number.isFinite(p)) return 0
      return clampRange(Math.round((p / 100) * 255), 0, 255)
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return 0
    return clampRange(Math.round(n), 0, 255)
  }
  const r = toChannel(parts[0])
  const g = toChannel(parts[1])
  const b = toChannel(parts[2])
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`
}

function normalizeImageColor(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const raw = input.trim()
  if (!raw) return undefined
  if (raw.toLowerCase() === 'none' || raw.toLowerCase() === 'transparent') return undefined
  return normalizeHexColor(raw) ?? normalizeRgbColor(raw) ?? raw
}

function normalizeImageStyle(input: unknown): AiImageStructuredStyle | undefined {
  if (!input || typeof input !== 'object') return undefined
  const obj = input as Record<string, unknown>
  const fill = normalizeImageColor(obj.fill ?? obj.color ?? obj.backgroundColor)
  const stroke = normalizeImageColor(obj.stroke ?? obj.borderColor ?? obj.outlineColor)
  const textColor = normalizeImageColor(obj.textColor ?? obj.fontColor ?? obj.labelColor)
  const strokeWidthRaw = toOptionalNumber(obj.strokeWidth ?? obj.borderWidth)
  const opacityRaw = toOptionalNumber(obj.opacity ?? obj.alpha)
  const style: AiImageStructuredStyle = {}
  if (fill) style.fill = fill
  if (stroke) style.stroke = stroke
  if (textColor) style.textColor = textColor
  if (strokeWidthRaw != null) style.strokeWidth = clampRange(strokeWidthRaw, 0, 24)
  if (opacityRaw != null) style.opacity = clampRange(opacityRaw, 0, 1)
  return Object.keys(style).length > 0 ? style : undefined
}

function parseColorToRgb(color: string | undefined): { r: number; g: number; b: number } | null {
  if (!color) return null
  const hex = normalizeHexColor(color)
  if (hex) {
    const h = hex.replace('#', '')
    if (h.length === 6) {
      return {
        r: Number.parseInt(h.slice(0, 2), 16),
        g: Number.parseInt(h.slice(2, 4), 16),
        b: Number.parseInt(h.slice(4, 6), 16),
      }
    }
  }
  const rgb = normalizeRgbColor(color)
  if (rgb) {
    const h = rgb.replace('#', '')
    return {
      r: Number.parseInt(h.slice(0, 2), 16),
      g: Number.parseInt(h.slice(2, 4), 16),
      b: Number.parseInt(h.slice(4, 6), 16),
    }
  }
  return null
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const normalize = (c: number) => {
    const s = clampRange(c, 0, 255) / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const r = normalize(rgb.r)
  const g = normalize(rgb.g)
  const b = normalize(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function isNearGray(rgb: { r: number; g: number; b: number }, threshold = 18): boolean {
  const max = Math.max(rgb.r, rgb.g, rgb.b)
  const min = Math.min(rgb.r, rgb.g, rgb.b)
  return max - min <= threshold
}

function shouldUseMonochromeImageTheme(structured: AiImageStructuredDraft): boolean {
  const colors: Array<{ r: number; g: number; b: number }> = []
  let hasDarkFillWithLightText = false
  for (const node of structured.nodes) {
    const style = node.style
    if (!style) continue
    const fill = parseColorToRgb(style.fill)
    const stroke = parseColorToRgb(style.stroke)
    const text = parseColorToRgb(style.textColor)
    if (fill) colors.push(fill)
    if (stroke) colors.push(stroke)
    if (text) colors.push(text)
    if (fill && text) {
      const fillLum = relativeLuminance(fill)
      const textLum = relativeLuminance(text)
      if (fillLum <= 0.34 && textLum >= 0.78) {
        hasDarkFillWithLightText = true
      }
    }
  }
  for (const group of structured.groups) {
    const style = group.style
    if (!style) continue
    const fill = parseColorToRgb(style.fill)
    const stroke = parseColorToRgb(style.stroke)
    if (fill) colors.push(fill)
    if (stroke) colors.push(stroke)
  }

  if (colors.length === 0) {
    return (structured.confidence?.color ?? 0.5) < 0.3
  }
  // 若识图已明确出现“深底浅字”的强对比节点，优先保留原有语义色与字色，不做黑白强制收敛。
  if (hasDarkFillWithLightText) return false
  if (colors.length <= 3) return colors.every((c) => isNearGray(c, 16))

  const colorful = colors.filter((c) => !isNearGray(c, 20)).length
  return colorful / colors.length <= 0.08
}

function normalizeEdgeRelation(input: unknown): string {
  const relation = toShortString(input, 'next', 24).toLowerCase()
  if (IMAGE_EDGE_RELATIONS.has(relation)) return relation
  return 'next'
}

function hasLayoutBox<T extends { x?: number; y?: number; w?: number; h?: number }>(
  v: T,
): v is T & { x: number; y: number; w: number; h: number } {
  return (
    v.x != null &&
    v.y != null &&
    v.w != null &&
    v.h != null &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.w) &&
    Number.isFinite(v.h) &&
    v.w > 0 &&
    v.h > 0
  )
}

function containsPoint(
  box: { x: number; y: number; w: number; h: number },
  p: { x: number; y: number },
): boolean {
  return p.x >= box.x && p.y >= box.y && p.x <= box.x + box.w && p.y <= box.y + box.h
}

function buildStructuredConfidence(draft: {
  sceneHint: ImageSceneHint
  lanes: string[]
  groups: AiImageStructuredGroup[]
  nodes: AiImageStructuredNode[]
}): AiImageStructuredConfidence {
  const nodeCount = Math.max(1, draft.nodes.length)
  const groupCount = draft.groups.length
  const hasGroups = groupCount > 0
  const nodesWithGeometry = draft.nodes.filter((n) => n.x != null && n.y != null).length
  const nodesWithSize = draft.nodes.filter((n) => n.w != null && n.h != null).length
  const nodesWithParent = draft.nodes.filter((n) => !!n.parentId || !!n.lane).length
  const nodesWithStyle = draft.nodes.filter((n) => n.style != null).length
  const groupsWithStyle = draft.groups.filter((g) => g.style != null).length

  const geometry = clamp01((nodesWithGeometry / nodeCount) * 0.7 + (nodesWithSize / nodeCount) * 0.3)
  const hierarchyBase = hasGroups || draft.lanes.length > 1 ? nodesWithParent / nodeCount : 1
  const hierarchy = clamp01(hierarchyBase)
  const colorDenominator = Math.max(1, draft.nodes.length + draft.groups.length)
  const color = clamp01((nodesWithStyle + groupsWithStyle) / colorDenominator)

  let scene = 0.55
  if (draft.sceneHint === 'swimlane') {
    const laneSignals = (draft.lanes.length >= 2 ? 1 : 0) + (draft.groups.filter((g) => g.kind === 'lane').length >= 2 ? 1 : 0)
    scene = laneSignals >= 2 ? 0.92 : laneSignals === 1 ? 0.75 : 0.45
  } else if (draft.sceneHint === 'mind-map') {
    scene = clamp01(0.55 + (hasGroups ? 0.1 : 0))
  } else if (draft.sceneHint === 'flowchart' || draft.sceneHint === 'free-layout') {
    scene = clamp01(0.7 + (hasGroups ? 0.1 : 0))
  }

  const overall = clamp01(geometry * 0.4 + hierarchy * 0.3 + color * 0.2 + scene * 0.1)
  return {
    geometry,
    hierarchy,
    color,
    scene,
    overall,
  }
}

export function refineImageStructuredDraft(input: AiImageStructuredDraft): AiImageStructuredDraft {
  const groupsById = new Map(input.groups.map((g) => [g.id, g]))
  const laneGroups = input.groups.filter((g) => g.kind === 'lane')
  const laneGroupByLabel = new Map(
    laneGroups
      .map((g) => [g.label.trim().toLowerCase(), g.id] as const)
      .filter(([label]) => label.length > 0),
  )

  // 清理 group parent 循环/悬空引用
  const cleanedGroups = input.groups.map((g) => {
    const parentId = g.parentId && groupsById.has(g.parentId) ? g.parentId : undefined
    if (!parentId || parentId === g.id) return { ...g, parentId: undefined }
    const seen = new Set<string>([g.id])
    let cur: string | undefined = parentId
    while (cur) {
      if (seen.has(cur)) return { ...g, parentId: undefined }
      seen.add(cur)
      const parent = groupsById.get(cur)
      cur = parent?.parentId
    }
    return { ...g, parentId }
  })
  const cleanedGroupById = new Map(cleanedGroups.map((g) => [g.id, g]))
  const containerGroups = cleanedGroups.filter(hasLayoutBox)

  const nextNodes = input.nodes.map((n) => {
    let parentId = n.parentId && cleanedGroupById.has(n.parentId) ? n.parentId : undefined
    const center = {
      x: n.x != null ? n.x + ((n.w ?? 0) * 0.5) : undefined,
      y: n.y != null ? n.y + ((n.h ?? 0) * 0.5) : undefined,
    }
    if (!parentId && center.x != null && center.y != null) {
      let best: AiImageStructuredGroup | undefined
      for (const g of containerGroups) {
        if (!hasLayoutBox(g)) continue
        if (!containsPoint({ x: g.x, y: g.y, w: g.w, h: g.h }, { x: center.x, y: center.y })) continue
        if (!best) {
          best = g
          continue
        }
        const bestArea = (best.w ?? 1) * (best.h ?? 1)
        const curArea = (g.w ?? 1) * (g.h ?? 1)
        if (curArea < bestArea) best = g
      }
      parentId = best?.id
    }

    let lane = n.lane
    if ((!lane || !lane.trim()) && parentId) {
      const parent = cleanedGroupById.get(parentId)
      if (parent?.kind === 'lane' && parent.label.trim()) {
        lane = parent.label.trim()
      }
    }
    if ((!lane || !lane.trim()) && n.x != null && n.y != null) {
      const centerPoint = { x: n.x + ((n.w ?? 0) * 0.5), y: n.y + ((n.h ?? 0) * 0.5) }
      for (const laneGroup of laneGroups) {
        if (!hasLayoutBox(laneGroup)) continue
        if (containsPoint({ x: laneGroup.x, y: laneGroup.y, w: laneGroup.w, h: laneGroup.h }, centerPoint)) {
          lane = laneGroup.label.trim() || lane
          parentId = parentId ?? laneGroup.id
          break
        }
      }
    }
    if ((parentId == null || parentId === '') && lane) {
      const laneGroupId = laneGroupByLabel.get(lane.trim().toLowerCase())
      if (laneGroupId) parentId = laneGroupId
    }

    return {
      ...n,
      lane: lane?.trim() || undefined,
      parentId: parentId || undefined,
    }
  })

  const lanes = Array.from(
    new Set([
      ...input.lanes.map((x) => x.trim()).filter(Boolean),
      ...laneGroups.map((g) => g.label.trim()).filter(Boolean),
      ...nextNodes.map((n) => (n.lane ?? '').trim()).filter(Boolean),
    ]),
  )

  let sceneHint = input.sceneHint
  if (sceneHint === 'auto') {
    const laneSignal = lanes.length >= 2 || laneGroups.length >= 2
    if (laneSignal) sceneHint = 'swimlane'
    else if (cleanedGroups.length > 0) sceneHint = 'flowchart'
    else sceneHint = 'auto'
  }

  const confidence = buildStructuredConfidence({
    sceneHint,
    lanes,
    groups: cleanedGroups,
    nodes: nextNodes,
  })

  return {
    ...input,
    schema: IMAGE_STRUCTURE_SCHEMA,
    sceneHint,
    lanes,
    groups: cleanedGroups,
    nodes: nextNodes,
    confidence,
  }
}

export function validateImageStructuredDraft(obj: any, rawText: string): AiImageStructuredDraft {
  if (!obj || typeof obj !== 'object') throw new Error('识图返回不是对象')
  if (obj.schema && !IMAGE_STRUCTURE_ALLOWED_SCHEMAS.has(String(obj.schema))) {
    throw new Error(`识图 schema 不匹配（仅支持 ${IMAGE_STRUCTURE_SCHEMA_V1}/${IMAGE_STRUCTURE_SCHEMA_V2}）`)
  }
  if (!Array.isArray(obj.nodes)) throw new Error('识图 nodes 必须是数组')
  if (!Array.isArray(obj.edges)) throw new Error('识图 edges 必须是数组')

  const lanes: string[] = Array.isArray(obj.lanes)
    ? Array.from(
        new Set(
          obj.lanes
            .map((x: unknown) => toShortString(x))
            .filter((v: string) => v.length > 0),
        ),
      )
    : []

  type GroupInterim = {
    idRaw: string
    id?: string
    parentRaw: string
    label: string
    kind: ImageStructuredGroupKind
    x?: number
    y?: number
    w?: number
    h?: number
    style?: AiImageStructuredStyle
    confidence?: number
  }
  const groupsRaw = Array.isArray(obj.groups) ? obj.groups as any[] : []
  const groupInterim: GroupInterim[] = groupsRaw.map((g, idx) => {
    const idRaw = toShortString(g?.id, `g${idx + 1}`, 40)
    const parentRaw = toShortString(g?.parentId ?? g?.groupId, '', 40)
    const label = toShortString(g?.label, `分组${idx + 1}`, 40)
    const kind = normalizeImageGroupKind(g?.kind)
    const x = toRatio(g?.x)
    const y = toRatio(g?.y)
    const w = toRatio(g?.w)
    const h = toRatio(g?.h)
    const style = normalizeImageStyle({
      ...(g?.style ?? {}),
      fill: g?.style?.fill ?? g?.fill ?? g?.color,
      labelFill: g?.style?.labelFill ?? g?.labelFill ?? g?.titleLabelFill,
      stroke: g?.style?.stroke ?? g?.stroke,
      textColor: g?.style?.textColor ?? g?.textColor ?? g?.fontColor,
      strokeWidth: g?.style?.strokeWidth ?? g?.strokeWidth,
      opacity: g?.style?.opacity ?? g?.opacity,
    })
    const confidence = toOptionalNumber(g?.confidence)
    return {
      idRaw,
      parentRaw,
      label,
      kind,
      x,
      y,
      w,
      h,
      style,
      confidence: confidence != null ? clampRange(confidence, 0, 1) : undefined,
    }
  })

  const usedIds = new Set<string>()
  const groupIdAlias = new Map<string, string>()
  for (let i = 0; i < groupInterim.length; i += 1) {
    const item = groupInterim[i]
    let id = item.idRaw || `g${i + 1}`
    while (usedIds.has(id)) id = `${item.idRaw || 'g'}_${i + 1}`
    usedIds.add(id)
    if (!groupIdAlias.has(item.idRaw)) groupIdAlias.set(item.idRaw, id)
    item.id = id
  }

  const groups: AiImageStructuredGroup[] = groupInterim.map((item, idx) => {
    const id = item.id ?? `g${idx + 1}`
    const mappedParent = item.parentRaw ? groupIdAlias.get(item.parentRaw) ?? item.parentRaw : undefined
    return {
      id,
      label: item.label || `分组${idx + 1}`,
      kind: item.kind,
      parentId: mappedParent && usedIds.has(mappedParent) ? mappedParent : undefined,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      style: item.style,
      confidence: item.confidence,
    }
  })

  const nodesRaw = obj.nodes as any[]
  const nodeInterim = nodesRaw.map((n, idx) => {
    const idRaw = toShortString(n?.id, `n${idx + 1}`, 40)
    const parentRaw = toShortString(n?.parentId ?? n?.groupId, '', 40)
    const label = toShortString(n?.label, `步骤${idx + 1}`, 32)
    const type = normalizeImageNodeType(n?.type)
    const lane = toShortString(n?.lane, '', 24) || undefined
    const x = toRatio(n?.x)
    const y = toRatio(n?.y)
    const w = toRatio(n?.w)
    const h = toRatio(n?.h)
    const style = normalizeImageStyle({
      ...(n?.style ?? {}),
      fill: n?.style?.fill ?? n?.fill ?? n?.color,
      stroke: n?.style?.stroke ?? n?.stroke,
      textColor: n?.style?.textColor ?? n?.textColor ?? n?.fontColor,
      strokeWidth: n?.style?.strokeWidth ?? n?.strokeWidth,
      opacity: n?.style?.opacity ?? n?.opacity,
    })
    const confidence = toOptionalNumber(n?.confidence)
    return {
      idRaw,
      parentRaw,
      label,
      type,
      lane,
      x,
      y,
      w,
      h,
      style,
      confidence: confidence != null ? clampRange(confidence, 0, 1) : undefined,
    }
  })

  const nodeIdAlias = new Map<string, string>()
  const nodes: AiImageStructuredNode[] = nodeInterim.map((item, idx) => {
    let id = item.idRaw || `n${idx + 1}`
    while (usedIds.has(id)) id = `${item.idRaw || 'n'}_${idx + 1}`
    usedIds.add(id)
    if (!nodeIdAlias.has(item.idRaw)) nodeIdAlias.set(item.idRaw, id)
    const parentIdRaw = item.parentRaw ? groupIdAlias.get(item.parentRaw) ?? item.parentRaw : undefined
    return {
      id,
      label: item.label || `步骤${idx + 1}`,
      type: item.type,
      lane: item.lane,
      parentId: parentIdRaw && groups.some((g) => g.id === parentIdRaw) ? parentIdRaw : undefined,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      style: item.style,
      confidence: item.confidence,
    }
  })

  if (!nodes.length) throw new Error('识图未提取到有效节点')
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const edges = (obj.edges as any[])
    .map((e: any) => {
      const fromRaw = toShortString(e?.from, '', 40)
      const toRaw = toShortString(e?.to, '', 40)
      const from = nodeIdAlias.get(fromRaw) ?? fromRaw
      const to = nodeIdAlias.get(toRaw) ?? toRaw
      const relation = normalizeEdgeRelation(e?.relation)
      const label = toShortString(e?.label, '', 24) || undefined
      return { from, to, relation, label }
    })
    .filter((e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to) && e.from !== e.to)

  return refineImageStructuredDraft({
    schema: IMAGE_STRUCTURE_SCHEMA,
    title: toShortString(obj.title, '', 60) || undefined,
    sceneHint: normalizeImageSceneHint(obj.sceneHint),
    lanes,
    groups,
    nodes,
    edges,
    rawText,
  })
}

function inferHandlesByGeometry(
  s: { x: number; y: number; w: number; h: number },
  t: { x: number; y: number; w: number; h: number },
): { sourceHandle: string; targetHandle: string } {
  const sCx = s.x + s.w / 2
  const sCy = s.y + s.h / 2
  const tCx = t.x + t.w / 2
  const tCy = t.y + t.h / 2
  const dx = tCx - sCx
  const dy = tCy - sCy
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 's-right', targetHandle: 't-left' }
      : { sourceHandle: 's-left', targetHandle: 't-right' }
  }
  return dy >= 0
    ? { sourceHandle: 's-bottom', targetHandle: 't-top' }
    : { sourceHandle: 's-top', targetHandle: 't-bottom' }
}

function slugForId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function laneLabelKey(input: string): string {
  return input.trim().toLowerCase()
}

function uniqueLaneId(baseLabel: string, fallbackIndex: number, used: Set<string>): string {
  const base = slugForId(baseLabel) || `lane-${fallbackIndex + 1}`
  let id = `lane-${base}`
  let k = 2
  while (used.has(id)) {
    id = `lane-${base}-${k}`
    k += 1
  }
  used.add(id)
  return id
}

function toNodeCenter(node: {
  x?: number
  y?: number
  w?: number
  h?: number
}): { x?: number; y?: number } {
  const x = node.x != null ? node.x + ((node.w ?? 0.12) * 0.5) : undefined
  const y = node.y != null ? node.y + ((node.h ?? 0.08) * 0.5) : undefined
  return { x, y }
}

function quantizeStep(values: number[], fallback: number): number {
  if (values.length < 2) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  const diffs: number[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    const d = sorted[i] - sorted[i - 1]
    if (d > 0.0001) diffs.push(d)
  }
  if (diffs.length === 0) return fallback

  const strong = diffs.filter((d) => d >= 0.05)
  const relaxed = strong.length > 0 ? strong : diffs.filter((d) => d >= 0.02)
  const candidates = relaxed.length > 0 ? relaxed : diffs
  candidates.sort((a, b) => a - b)
  const idx = Math.floor((candidates.length - 1) * 0.35)
  const picked = candidates[idx] ?? fallback
  return Math.max(0.02, Math.min(0.45, picked))
}

/**
 * 将连续中心坐标转为“可跳格”的离散索引，尽量保留相对间距：
 * - 相邻差值很小：认为近似对齐 → 同一格（inc=0）
 * - 相邻差值很大：允许跳格 → inc>1
 */
function inferGridIndexByCenters(values: Array<{ id: string; v: number | null | undefined }>, fallbackStep: number): Map<string, number> {
  const valid = values
    .filter((x): x is { id: string; v: number } => Number.isFinite(x.v))
    .map((x) => ({ id: x.id, v: x.v as number }))
    .sort((a, b) => a.v - b.v)
  const out = new Map<string, number>()
  if (valid.length === 0) return out
  if (valid.length === 1) {
    out.set(valid[0].id, 0)
    return out
  }
  // baseStep 用偏小的“常见相邻间距”（低分位），这样大间距能自然表现为跳列/跳行。
  const baseStep = quantizeStep(valid.map((x) => x.v), fallbackStep)
  const nearThreshold = Math.max(0.012, baseStep * 0.4)

  let idx = 0
  out.set(valid[0].id, idx)
  for (let i = 1; i < valid.length; i += 1) {
    const d = valid[i].v - valid[i - 1].v
    if (d <= nearThreshold) {
      // 近似同列/同行：保持 idx 不变
    } else {
      const raw = Math.max(1, Math.round(d / Math.max(0.0001, baseStep)))
      const inc = Math.min(12, raw) // 防止极端跳格导致列数爆炸
      idx += inc
    }
    out.set(valid[i].id, idx)
  }
  return out
}

function inferSwimlaneDirectionFromStructured(structured: AiImageStructuredDraft): 'horizontal' | 'vertical' {
  const laneBoxes = structured.groups.filter(
    (g): g is AiImageStructuredGroup & { x: number; y: number; w: number; h: number } =>
      g.kind === 'lane' && hasLayoutBox(g),
  )
  const axisLaneSeparationScore = (values: number[]): number => {
    if (values.length < 3) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const diffs: number[] = []
    for (let i = 1; i < sorted.length; i += 1) {
      const d = sorted[i] - sorted[i - 1]
      if (d > 0.0001) diffs.push(d)
    }
    if (diffs.length === 0) return 0
    const step = quantizeStep(sorted, 0.06)
    const threshold = Math.max(0.04, step * 1.35)
    const large = diffs.filter((d) => d >= threshold)
    if (large.length === 0) return 0
    const sumAll = diffs.reduce((sum, d) => sum + d, 0)
    const sumLarge = large.reduce((sum, d) => sum + d, 0)
    const largeCountRatio = large.length / diffs.length
    const largeMagnitudeRatio = sumLarge / Math.max(0.0001, sumAll)
    return largeCountRatio * 0.45 + largeMagnitudeRatio * 0.55
  }

  const centers = laneBoxes.length >= 2
    ? laneBoxes.map((g) => ({ x: g.x + g.w * 0.5, y: g.y + g.h * 0.5 }))
    : structured.nodes
        .map((node) => toNodeCenter(node))
        .filter((c): c is { x: number; y: number } => Number.isFinite(c.x) && Number.isFinite(c.y))

  if (centers.length < 2) return 'horizontal'
  const minX = Math.min(...centers.map((c) => c.x))
  const maxX = Math.max(...centers.map((c) => c.x))
  const minY = Math.min(...centers.map((c) => c.y))
  const maxY = Math.max(...centers.map((c) => c.y))
  const spreadX = maxX - minX
  const spreadY = maxY - minY

  if (laneBoxes.length < 2) {
    const scoreX = axisLaneSeparationScore(centers.map((c) => c.x))
    const scoreY = axisLaneSeparationScore(centers.map((c) => c.y))
    if (Math.abs(scoreX - scoreY) >= 0.08) {
      return scoreX > scoreY ? 'vertical' : 'horizontal'
    }
  }
  return spreadX > spreadY ? 'vertical' : 'horizontal'
}

type InferredNodeBox = {
  id: string
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  sourceIndex: number
}

function clampUnit(v: number): number {
  return clampRange(v, 0, 1)
}

function toNodeBoxForInference(node: AiImageStructuredNode, index: number): InferredNodeBox {
  const fallbackX = 0.08 + (index % 6) * 0.12
  const fallbackY = 0.12 + Math.floor(index / 6) * 0.11
  const w = clampRange(node.w ?? 0.12, 0.04, 0.42)
  const h = clampRange(node.h ?? 0.08, 0.04, 0.36)
  const x = clampRange(node.x ?? fallbackX, 0, Math.max(0, 1 - w))
  const y = clampRange(node.y ?? fallbackY, 0, Math.max(0, 1 - h))
  return {
    id: node.id,
    x,
    y,
    w,
    h,
    cx: x + w * 0.5,
    cy: y + h * 0.5,
    sourceIndex: index,
  }
}

function inferLaneCountFromNodeSpread(
  boxes: InferredNodeBox[],
  direction: 'horizontal' | 'vertical',
  desiredLaneCount: number,
): number {
  if (boxes.length <= 1) return 1
  if (desiredLaneCount >= 2) return Math.min(Math.max(2, desiredLaneCount), Math.min(8, boxes.length))

  const primaryValues = boxes
    .map((b) => (direction === 'horizontal' ? b.cy : b.cx))
    .sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < primaryValues.length; i += 1) {
    const d = primaryValues[i] - primaryValues[i - 1]
    if (d > 0.0001) gaps.push(d)
  }
  if (gaps.length === 0) return boxes.length >= 6 ? 2 : 1
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 0.02
  const threshold = Math.max(0.05, medianGap * 1.9)
  const largeGapCount = gaps.filter((g) => g >= threshold).length
  const guessed = largeGapCount + 1
  if (boxes.length >= 6) return Math.min(Math.max(2, guessed), 6)
  return Math.min(Math.max(1, guessed), 4)
}

function assignLaneClusters(
  boxes: InferredNodeBox[],
  direction: 'horizontal' | 'vertical',
  laneCountRaw: number,
): Map<string, number> {
  const laneCount = Math.min(Math.max(1, laneCountRaw), Math.max(1, boxes.length))
  const sorted = [...boxes].sort((a, b) => {
    const ap = direction === 'horizontal' ? a.cy : a.cx
    const bp = direction === 'horizontal' ? b.cy : b.cx
    if (ap !== bp) return ap - bp
    return a.sourceIndex - b.sourceIndex
  })
  if (laneCount <= 1) return new Map(sorted.map((b) => [b.id, 0]))

  const boundaries = new Set<number>()
  const gaps = sorted
    .slice(0, -1)
    .map((cur, i) => {
      const next = sorted[i + 1]
      const g = (direction === 'horizontal' ? next.cy - cur.cy : next.cx - cur.cx)
      return { i, gap: g }
    })
    .sort((a, b) => b.gap - a.gap)

  for (const item of gaps) {
    if (boundaries.size >= laneCount - 1) break
    if (item.gap >= 0.04) boundaries.add(item.i)
  }
  for (let k = 1; boundaries.size < laneCount - 1 && k < laneCount; k += 1) {
    const idx = Math.min(sorted.length - 2, Math.max(0, Math.round((sorted.length * k) / laneCount) - 1))
    boundaries.add(idx)
  }
  const boundaryList = [...boundaries].sort((a, b) => a - b).slice(0, laneCount - 1)
  const boundarySet = new Set(boundaryList)

  const clusterByNodeId = new Map<string, number>()
  let cluster = 0
  for (let i = 0; i < sorted.length; i += 1) {
    clusterByNodeId.set(sorted[i].id, cluster)
    if (boundarySet.has(i) && cluster < laneCount - 1) cluster += 1
  }
  return clusterByNodeId
}

function ensureStructuredSwimlaneGeometry(structured: AiImageStructuredDraft): AiImageStructuredDraft {
  const direction = inferSwimlaneDirectionFromStructured(structured)
  const existingLaneGroups = structured.groups.filter((g) => g.kind === 'lane')
  const nonLaneGroups = structured.groups.filter((g) => g.kind !== 'lane')
  const boxes = structured.nodes.map((n, i) => toNodeBoxForInference(n, i))

  if (boxes.length === 0) {
    return {
      ...structured,
      sceneHint: 'swimlane',
      lanes: structured.lanes.length > 0 ? structured.lanes : ['泳道1'],
    }
  }

  let laneGroups: AiImageStructuredGroup[] = existingLaneGroups
  let laneNames = structured.lanes.map((name) => name.trim()).filter(Boolean)
  if (laneNames.length < laneGroups.length) {
    laneNames = laneGroups.map((g) => g.label.trim()).filter(Boolean)
  }

  if (laneGroups.length === 0) {
    const inferredLaneCount = inferLaneCountFromNodeSpread(boxes, direction, laneNames.length)
    const clusterByNodeId = assignLaneClusters(boxes, direction, inferredLaneCount)
    const clusterCount = Math.max(...Array.from(clusterByNodeId.values()), 0) + 1
    if (laneNames.length < clusterCount) {
      laneNames = [
        ...laneNames,
        ...Array.from({ length: clusterCount - laneNames.length }, (_, i) => `泳道${laneNames.length + i + 1}`),
      ]
    } else if (laneNames.length > clusterCount) {
      laneNames = laneNames.slice(0, clusterCount)
    }

    const globalMinX = Math.min(...boxes.map((b) => b.x))
    const globalMaxX = Math.max(...boxes.map((b) => b.x + b.w))
    const globalMinY = Math.min(...boxes.map((b) => b.y))
    const globalMaxY = Math.max(...boxes.map((b) => b.y + b.h))
    const usedIds = new Set(structured.groups.map((g) => g.id))
    const nextId = (idx: number): string => {
      let id = `lane-auto-${idx + 1}`
      let k = 2
      while (usedIds.has(id)) {
        id = `lane-auto-${idx + 1}-${k}`
        k += 1
      }
      usedIds.add(id)
      return id
    }

    const padX = 0.03
    const padY = 0.03
    laneGroups = []
    for (let laneIdx = 0; laneIdx < clusterCount; laneIdx += 1) {
      const clusterNodes = boxes.filter((b) => (clusterByNodeId.get(b.id) ?? 0) === laneIdx)
      if (clusterNodes.length === 0) continue
      const minX = Math.min(...clusterNodes.map((b) => b.x))
      const maxX = Math.max(...clusterNodes.map((b) => b.x + b.w))
      const minY = Math.min(...clusterNodes.map((b) => b.y))
      const maxY = Math.max(...clusterNodes.map((b) => b.y + b.h))
      if (direction === 'horizontal') {
        const x = clampUnit(globalMinX - padX)
        const right = clampUnit(globalMaxX + padX)
        const y = clampUnit(minY - padY)
        const bottom = clampUnit(maxY + padY)
        laneGroups.push({
          id: nextId(laneIdx),
          label: laneNames[laneIdx] ?? `泳道${laneIdx + 1}`,
          kind: 'lane',
          x,
          y,
          w: clampRange(right - x, 0.1, 1),
          h: clampRange(bottom - y, 0.08, 1),
        })
      } else {
        const y = clampUnit(globalMinY - padY)
        const bottom = clampUnit(globalMaxY + padY)
        const x = clampUnit(minX - padX)
        const right = clampUnit(maxX + padX)
        laneGroups.push({
          id: nextId(laneIdx),
          label: laneNames[laneIdx] ?? `泳道${laneIdx + 1}`,
          kind: 'lane',
          x,
          y,
          w: clampRange(right - x, 0.1, 1),
          h: clampRange(bottom - y, 0.08, 1),
        })
      }
    }
  } else if (laneNames.length === 0) {
    laneNames = laneGroups.map((g) => g.label.trim()).filter(Boolean)
  }

  const sortedLaneGroups = [...laneGroups].sort((a, b) => {
    const ac = direction === 'horizontal'
      ? (a.y ?? 0) + ((a.h ?? 0.2) * 0.5)
      : (a.x ?? 0) + ((a.w ?? 0.2) * 0.5)
    const bc = direction === 'horizontal'
      ? (b.y ?? 0) + ((b.h ?? 0.2) * 0.5)
      : (b.x ?? 0) + ((b.w ?? 0.2) * 0.5)
    return ac - bc
  })
  const laneByIndex = sortedLaneGroups.map((lane, idx) => ({
    lane,
    name: laneNames[idx] || lane.label.trim() || `泳道${idx + 1}`,
  }))

  const findLaneForBox = (box: InferredNodeBox): { laneId: string; laneName: string } => {
    if (laneByIndex.length === 0) return { laneId: '', laneName: '' }
    let best: { idx: number; score: number } | null = null
    for (let i = 0; i < laneByIndex.length; i += 1) {
      const lane = laneByIndex[i].lane
      const lx = lane.x ?? 0
      const ly = lane.y ?? 0
      const lw = lane.w ?? 1
      const lh = lane.h ?? 1
      const inside = box.cx >= lx && box.cx <= lx + lw && box.cy >= ly && box.cy <= ly + lh
      const laneCenter = direction === 'horizontal' ? ly + lh * 0.5 : lx + lw * 0.5
      const nodeCenter = direction === 'horizontal' ? box.cy : box.cx
      const dist = Math.abs(nodeCenter - laneCenter)
      const score = (inside ? 0 : 10) + dist
      if (!best || score < best.score) best = { idx: i, score }
    }
    const picked = laneByIndex[best?.idx ?? 0]
    return { laneId: picked.lane.id, laneName: picked.name }
  }

  const boxByNodeId = new Map(boxes.map((b) => [b.id, b]))
  const nextNodes = structured.nodes.map((node) => {
    const box = boxByNodeId.get(node.id)
    if (!box) return node
    const picked = findLaneForBox(box)
    if (!picked.laneId) return node
    return {
      ...node,
      lane: picked.laneName,
      parentId: node.parentId || picked.laneId,
    }
  })

  const nextGroups = [
    ...nonLaneGroups,
    ...sortedLaneGroups.map((g, i) => ({
      ...g,
      label: laneByIndex[i]?.name || g.label,
      kind: 'lane' as const,
    })),
  ]

  return refineImageStructuredDraft({
    ...structured,
    sceneHint: 'swimlane',
    lanes: laneByIndex.map((item) => item.name),
    groups: nextGroups,
    nodes: nextNodes,
  })
}

function hasSwimlaneSignalsFromStructured(structured: AiImageStructuredDraft): boolean {
  if (structured.sceneHint === 'swimlane') return true
  const laneGroupCount = structured.groups.filter((g) => g.kind === 'lane').length
  if (laneGroupCount >= 1) return true

  const lanesFromTop = new Set(
    structured.lanes
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  )
  if (lanesFromTop.size >= 2) return true

  const lanesFromNodes = new Set(
    structured.nodes
      .map((n) => (n.lane ?? '').trim().toLowerCase())
      .filter(Boolean),
  )
  if (lanesFromNodes.size >= 2) return true

  const groupById = new Map(structured.groups.map((g) => [g.id, g]))
  const nodesInLaneGroup = structured.nodes.filter((n) => {
    const pid = n.parentId
    if (!pid) return false
    return groupById.get(pid)?.kind === 'lane'
  }).length
  return nodesInLaneGroup >= 2
}

export function buildSwimlaneDraftFromImageStructured(structured: AiImageStructuredDraft): SwimlaneDraft {
  type LaneResolved = {
    id: string
    title: string
    order: number
    groupId?: string
    box?: { x: number; y: number; w: number; h: number }
  }
  type NodeResolved = {
    id: string
    title: string
    sourceType: ImageStructuredNodeType
    laneId: string
    laneOrder: number
    laneRow: number
    laneCol: number
    sourceIndex: number
    centerX?: number
    centerY?: number
  }

  const direction = inferSwimlaneDirectionFromStructured(structured)
  const groupsById = new Map(structured.groups.map((g) => [g.id, g]))
  const laneGroups = structured.groups.filter((g) => g.kind === 'lane')
  const laneGroupsSorted = [...laneGroups].sort((a, b) => {
    if (hasLayoutBox(a) && hasLayoutBox(b)) {
      const aPrimary = direction === 'horizontal' ? a.y + a.h * 0.5 : a.x + a.w * 0.5
      const bPrimary = direction === 'horizontal' ? b.y + b.h * 0.5 : b.x + b.w * 0.5
      if (Math.abs(aPrimary - bPrimary) > 0.0001) return aPrimary - bPrimary
      const aSecondary = direction === 'horizontal' ? a.x + a.w * 0.5 : a.y + a.h * 0.5
      const bSecondary = direction === 'horizontal' ? b.x + b.w * 0.5 : b.y + b.h * 0.5
      return aSecondary - bSecondary
    }
    if (hasLayoutBox(a)) return -1
    if (hasLayoutBox(b)) return 1
    return 0
  })

  const lanes: LaneResolved[] = []
  const usedLaneIds = new Set<string>()
  const laneByKey = new Map<string, LaneResolved>()
  const laneByGroupId = new Map<string, LaneResolved>()
  const pushLane = (
    titleRaw: string,
    groupId?: string,
    box?: { x: number; y: number; w: number; h: number },
  ) => {
    const title = titleRaw.trim()
    if (!title) return
    const key = laneLabelKey(title)
    const existed = laneByKey.get(key)
    if (existed) {
      if (groupId) laneByGroupId.set(groupId, existed)
      return
    }
    const lane: LaneResolved = {
      id: uniqueLaneId(title, lanes.length, usedLaneIds),
      title,
      order: lanes.length,
      ...(groupId ? { groupId } : {}),
      ...(box ? { box } : {}),
    }
    lanes.push(lane)
    laneByKey.set(key, lane)
    if (groupId) laneByGroupId.set(groupId, lane)
  }

  for (const laneGroup of laneGroupsSorted) {
    pushLane(
      laneGroup.label,
      laneGroup.id,
      hasLayoutBox(laneGroup) ? { x: laneGroup.x, y: laneGroup.y, w: laneGroup.w, h: laneGroup.h } : undefined,
    )
  }
  for (const lane of structured.lanes) pushLane(lane)
  for (const node of structured.nodes) {
    if (node.lane) pushLane(node.lane)
  }
  if (lanes.length === 0) pushLane('默认泳道')

  const findLaneGroupAncestor = (groupId?: string): string | undefined => {
    let cur = groupId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const grp = groupsById.get(cur)
      if (!grp) return undefined
      if (grp.kind === 'lane') return grp.id
      cur = grp.parentId
    }
    return undefined
  }

  const laneBoxes = lanes
    .filter((lane) => lane.box != null)
    .map((lane) => ({ lane, box: lane.box! }))

  const fallbackLane = lanes[0]
  const resolveLaneForNode = (node: AiImageStructuredNode): LaneResolved => {
    if (node.lane) {
      const byTitle = laneByKey.get(laneLabelKey(node.lane))
      if (byTitle) return byTitle
    }
    const laneGroupId = findLaneGroupAncestor(node.parentId)
    if (laneGroupId) {
      const byGroup = laneByGroupId.get(laneGroupId)
      if (byGroup) return byGroup
    }
    const center = toNodeCenter(node)
    if (center.x != null && center.y != null && laneBoxes.length > 0) {
      let best: { lane: LaneResolved; area: number } | null = null
      for (const item of laneBoxes) {
        const { box } = item
        if (
          center.x >= box.x &&
          center.x <= box.x + box.w &&
          center.y >= box.y &&
          center.y <= box.y + box.h
        ) {
          const area = box.w * box.h
          if (!best || area < best.area) best = { lane: item.lane, area }
        }
      }
      if (best) return best.lane
    }
    return fallbackLane
  }

  const provisional: NodeResolved[] = []
  const nodeIdSet = new Set<string>()
  for (let i = 0; i < structured.nodes.length; i += 1) {
    const node = structured.nodes[i]
    const lane = resolveLaneForNode(node)
    const center = toNodeCenter(node)
    const baseId = String(node.id || `n-${i + 1}`).trim() || `n-${i + 1}`
    let id = baseId
    let k = 2
    while (nodeIdSet.has(id)) {
      id = `${baseId}-${k}`
      k += 1
    }
    nodeIdSet.add(id)
    provisional.push({
      id,
      title: node.label.trim().slice(0, 16) || `步骤${i + 1}`,
      sourceType: node.type,
      laneId: lane.id,
      laneOrder: lane.order,
      laneRow: 0,
      laneCol: i,
      sourceIndex: i,
      centerX: center.x,
      centerY: center.y,
    })
  }

  const byLane = new Map<string, NodeResolved[]>()
  for (const node of provisional) {
    const list = byLane.get(node.laneId)
    if (list) list.push(node)
    else byLane.set(node.laneId, [node])
  }

  for (const lane of lanes) {
    const list = byLane.get(lane.id)
    if (!list || list.length === 0) continue
    // 图生图：尽量保留原图相对间距与排序（允许跳列/跳行），再交给后续泳道布局做近似对齐收敛。
    const colById = inferGridIndexByCenters(
      list.map((n) => ({ id: n.id, v: n.centerX })),
      0.16,
    )
    const rowById = inferGridIndexByCenters(
      list.map((n) => ({ id: n.id, v: n.centerY })),
      0.12,
    )

    for (let i = 0; i < list.length; i += 1) {
      const node = list[i]
      node.laneCol = colById.has(node.id) ? (colById.get(node.id) as number) : i
      node.laneRow = rowById.has(node.id) ? (rowById.get(node.id) as number) : 0
    }

    list.sort((a, b) => {
      // 以原图几何为主（col/row 已包含跳格信息），稳定回退 sourceIndex
      if (a.laneCol !== b.laneCol) return a.laneCol - b.laneCol
      if (a.laneRow !== b.laneRow) return a.laneRow - b.laneRow
      return a.sourceIndex - b.sourceIndex
    })
    for (let i = 0; i < list.length; i += 1) {
      list[i].laneOrder = i
    }
  }

  const normalizedNodes: SwimlaneDraft['nodes'] = provisional.map((node) => ({
    id: node.id,
    title: node.title,
    shape: node.sourceType === 'decision' ? 'diamond' : node.sourceType === 'start_end' ? 'circle' : 'rect',
    laneId: node.laneId,
    semanticType:
      node.sourceType === 'decision'
        ? 'decision'
        : node.sourceType === 'io'
          ? 'data'
          : node.sourceType === 'start_end'
            ? 'start'
            : 'task',
    order: node.laneOrder,
    laneRow: node.laneRow,
    laneCol: node.laneCol,
  }))
  const nodeById = new Map(normalizedNodes.map((n) => [n.id, n]))

  const indeg = new Map<string, number>()
  const outdeg = new Map<string, number>()
  for (const edge of structured.edges) {
    const from = String(edge.from ?? '').trim()
    const to = String(edge.to ?? '').trim()
    if (!nodeById.has(from) || !nodeById.has(to)) continue
    outdeg.set(from, (outdeg.get(from) ?? 0) + 1)
    indeg.set(to, (indeg.get(to) ?? 0) + 1)
  }
  for (const node of normalizedNodes) {
    if (node.semanticType !== 'start') continue
    const incoming = indeg.get(node.id) ?? 0
    const outgoing = outdeg.get(node.id) ?? 0
    if (incoming > 0 && outgoing === 0) node.semanticType = 'end'
  }

  const normalizedEdges: SwimlaneDraft['edges'] = []
  let edgeIndex = 1
  for (const edge of structured.edges) {
    const source = String(edge.from ?? '').trim()
    const target = String(edge.to ?? '').trim()
    const sourceNode = nodeById.get(source)
    const targetNode = nodeById.get(target)
    if (!sourceNode || !targetNode || source === target) continue
    const relation = normalizeEdgeRelation(edge.relation)
    const labelTrimmed = typeof edge.label === 'string' ? edge.label.trim() : ''
    let semanticType: SwimlaneDraft['edges'][number]['semanticType'] = 'normal'
    if (relation === 'yes' || relation === 'no') semanticType = 'conditional'
    else if (relation === 'return_to' || relation === 'cancel_to') semanticType = 'returnFlow'
    else if (sourceNode.laneId !== targetNode.laneId) semanticType = 'crossLane'
    else if ((sourceNode.order ?? 0) > (targetNode.order ?? 0)) semanticType = 'returnFlow'
    else if (sourceNode.semanticType === 'decision') semanticType = 'conditional'

    normalizedEdges.push({
      id: `e-${edgeIndex++}`,
      source,
      target,
      label: labelTrimmed || (relation === 'yes' || relation === 'no' ? relation : undefined),
      semanticType,
    })
  }

  return {
    title: structured.title || '泳道图（图生图）',
    direction,
    lanes: lanes.map((lane) => ({
      id: lane.id,
      title: lane.title,
      order: lane.order,
    })),
    nodes: normalizedNodes,
    edges: normalizedEdges,
  }
}

export async function buildSwimlaneAiDraftFromImageStructured(
  structured: AiImageStructuredDraft,
): Promise<AiDiagramDraft> {
  const swimlaneDraft = buildSwimlaneDraftFromImageStructured(structured)
  const payload = swimlaneDraftToGraphBatchPayload(swimlaneDraft)
  payload.meta = { ...(payload.meta ?? {}), swimlaneImageImport: true }
  const snap = await materializeGraphBatchPayloadToSnapshot(payload, { replace: true })
  return {
    schema: 'flow2go.ai.diagram.v1',
    title: structured.title || '泳道图（图生图）',
    nodes: snap.nodes,
    edges: snap.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    rawText: structured.rawText,
  }
}

const HIDDEN_RELATION_LABELS = new Set([
  'next',
  'yes',
  'no',
  'notify',
  'request',
  'return_to',
  'submit_to',
  'cancel_to',
])

function toRelationToken(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function sanitizeEdgeLabelForImageSwimlane(label: unknown, relation: unknown): string | undefined {
  if (typeof label !== 'string') return undefined
  const t = label.trim()
  if (!t) return undefined
  const token = toRelationToken(t)
  const rel = toRelationToken(relation)
  if (HIDDEN_RELATION_LABELS.has(token) || HIDDEN_RELATION_LABELS.has(rel)) {
    if (token === 'yes') return '是'
    if (token === 'no') return '否'
    return undefined
  }
  if (token === 'yes') return '是'
  if (token === 'no') return '否'
  return t.slice(0, 12)
}

function quickReviewAndFixImageSwimlaneEdges(args: {
  nodes: any[]
  edges: any[]
  direction: 'horizontal' | 'vertical'
}): any[] {
  const { nodes, edges, direction } = args
  if (!Array.isArray(edges) || edges.length === 0) return edges

  const nodeById = new Map<string, any>(nodes.map((n) => [String(n?.id ?? ''), n]))
  const laneById = new Map<string, any>(
    nodes
      .filter((n) => n?.type === 'group' && n?.data?.role === 'lane')
      .map((n) => [String(n.id), n]),
  )

  const absMemo = new Map<string, { x: number; y: number }>()
  const absPosById = (id: string, seen?: Set<string>): { x: number; y: number } => {
    const cached = absMemo.get(id)
    if (cached) return cached
    const node = nodeById.get(id)
    if (!node) return { x: 0, y: 0 }
    const x = Number(node?.position?.x) || 0
    const y = Number(node?.position?.y) || 0
    const pid = typeof node?.parentId === 'string' ? node.parentId : undefined
    if (!pid || !nodeById.has(pid)) {
      const abs = { x, y }
      absMemo.set(id, abs)
      return abs
    }
    const nextSeen = seen ?? new Set<string>()
    if (nextSeen.has(id)) {
      const abs = { x, y }
      absMemo.set(id, abs)
      return abs
    }
    nextSeen.add(id)
    const p = absPosById(pid, nextSeen)
    const abs = { x: p.x + x, y: p.y + y }
    absMemo.set(id, abs)
    return abs
  }

  const nodeCenter = (node: any): { x: number; y: number } => {
    const id = String(node?.id ?? '')
    const abs = absPosById(id)
    const w = Number(node?.width ?? node?.style?.width ?? 0) || GRID_UNIT * 10
    const h = Number(node?.height ?? node?.style?.height ?? 0) || GRID_UNIT * 6
    return { x: abs.x + w * 0.5, y: abs.y + h * 0.5 }
  }

  const laneIdOf = (node: any): string | undefined => {
    const fromData = String((node?.data as any)?.laneId ?? '').trim()
    if (fromData && laneById.has(fromData)) return fromData
    const pid = String(node?.parentId ?? '').trim()
    if (pid && laneById.has(pid)) return pid
    return undefined
  }

  const semanticOf = (node: any): string => String((node?.data as any)?.semanticType ?? (node?.data as any)?.semantic ?? '').trim().toLowerCase()

  // 0) 基础清洗：去掉明显非法/重复
  const seenPair = new Set<string>()
  const cleaned: any[] = []
  for (const e of edges) {
    const source = String(e?.source ?? '').trim()
    const target = String(e?.target ?? '').trim()
    if (!source || !target) continue
    if (source === target) continue
    if (!nodeById.has(source) || !nodeById.has(target)) continue
    const key = `${source}→${target}`
    if (seenPair.has(key)) continue
    seenPair.add(key)
    cleaned.push(e)
  }

  // 1) 语义修正（不重布线，只修 relation/semanticType 并做极少量删除）
  const outBySrc = new Map<string, any[]>()
  const inByTgt = new Map<string, any[]>()
  for (const e of cleaned) {
    const s = String(e.source)
    const t = String(e.target)
    if (!outBySrc.has(s)) outBySrc.set(s, [])
    if (!inByTgt.has(t)) inByTgt.set(t, [])
    outBySrc.get(s)!.push(e)
    inByTgt.get(t)!.push(e)
  }

  const isYesNo = (r: string) => r === 'yes' || r === 'no'
  const isReturn = (r: string) => r === 'return_to' || r === 'cancel_to'

  // 1.1 end 节点不应再有 next/yes/no 出边（保留 return_to/cancel_to）
  const pruned: any[] = []
  for (const e of cleaned) {
    const src = nodeById.get(String(e.source))
    const rel = toRelationToken((e?.data as any)?.relation)
    const srcSem = semanticOf(src)
    if (srcSem === 'end' && !isReturn(rel)) continue
    pruned.push(e)
  }

  // 1.2 decision：最多保留 2 条 yes/no（按几何“更像分支”优先）
  const final: any[] = []
  const dropped = new Set<any>()
  for (const [srcId, list] of outBySrc.entries()) {
    const srcNode = nodeById.get(srcId)
    if (!srcNode) continue
    const srcSem = semanticOf(srcNode)
    const yesNo = list.filter((e) => isYesNo(toRelationToken((e?.data as any)?.relation)))
    if (srcSem !== 'decision' || yesNo.length <= 2) continue

    const sC = nodeCenter(srcNode)
    const scored = yesNo
      .map((e) => {
        const tgt = nodeById.get(String(e.target))
        const tC = tgt ? nodeCenter(tgt) : { x: 0, y: 0 }
        const dx = tC.x - sC.x
        const dy = tC.y - sC.y
        // 行泳道更看重左右推进；列泳道更看重上下推进
        const primary = direction === 'horizontal' ? dx : dy
        const secondary = direction === 'horizontal' ? Math.abs(dy) : Math.abs(dx)
        // 更“向前”的 + 适度分叉（secondary）优先
        const score = primary * 1.0 + secondary * 0.35
        return { e, score }
      })
      .sort((a, b) => b.score - a.score)

    for (let i = 2; i < scored.length; i += 1) dropped.add(scored[i].e)
  }

  for (const e of pruned) {
    if (dropped.has(e)) continue
    const src = nodeById.get(String(e.source))
    const tgt = nodeById.get(String(e.target))
    const srcLane = src ? laneIdOf(src) : undefined
    const tgtLane = tgt ? laneIdOf(tgt) : undefined
    const isCross = !!srcLane && !!tgtLane && srcLane !== tgtLane

    const rel = toRelationToken((e?.data as any)?.relation) || 'next'
    const srcSem = semanticOf(src)

    // 非 decision 上的 yes/no：快速纠正为 next（避免“乱连线”语义污染）
    const nextRel = srcSem === 'decision' ? rel : (isYesNo(rel) ? 'next' : rel)
    const nextSemantic =
      isReturn(nextRel)
        ? 'returnFlow'
        : isYesNo(nextRel)
          ? 'conditional'
          : isCross
            ? 'crossLane'
            : 'normal'

    final.push({
      ...e,
      label: sanitizeEdgeLabelForImageSwimlane(e.label, nextRel),
      data: {
        ...((e?.data ?? {}) as Record<string, unknown>),
        relation: nextRel,
        semanticType: nextSemantic,
        layoutProfile: 'swimlane',
        autoGeneratedSwimlane: true,
        labelTextOnly: true,
      },
    })
  }

  return final
}

/** 图生图泳道：与 GroupNode `.laneNode` 一致的默认区底色，禁止沿用识图模型配色 */
const SWIMLANE_IMAGE_LANE_BODY_FILL = 'rgba(241, 245, 249, 0.5)'
const SWIMLANE_IMAGE_LANE_STROKE = 'rgba(203, 213, 225, 0.6)'

function applySwimlaneImageDefaultLaneGroupPaint(node: any): any {
  if (node?.type !== 'group' || node?.data?.role !== 'lane') return node
  const d = { ...(node.data ?? {}) }
  d.fill = SWIMLANE_IMAGE_LANE_BODY_FILL
  d.stroke = SWIMLANE_IMAGE_LANE_STROKE
  d.strokeWidth = 1
  d.titleColor = '#334155'
  delete d.laneHeaderBackground
  delete d.laneTitleLabelBackground
  delete d.opacity
  return { ...node, data: d }
}

const SWIMLANE_IMAGE_HEADER_DEFAULT_SIZE = 48
const SWIMLANE_IMAGE_CONTENT_PAD = GRID_UNIT * 2
const SWIMLANE_IMAGE_TOP_HEADER_NODE_GAP = GRID_UNIT
const SWIMLANE_IMAGE_FIXED_GAP = GRID_UNIT
const SWIMLANE_COLUMN_CENTER_ALIGN_THRESHOLD_RATIO = 0.6

function isLaneNodeByData(node: any): boolean {
  if (node?.type !== 'group') return false
  if (node?.data?.role === 'lane') return true
  const tp = String(node?.data?.titlePosition ?? '')
  return tp === 'left-center' || tp === 'top-center'
}

function cloneLayoutNode(node: any): any {
  return {
    ...node,
    position: {
      x: Number(node?.position?.x) || 0,
      y: Number(node?.position?.y) || 0,
    },
    style: node?.style ? { ...(node.style as Record<string, unknown>) } : node?.style,
    data: node?.data ? { ...(node.data as Record<string, unknown>) } : node?.data,
  }
}

function readNodeSize(node: any): { w: number; h: number } {
  const wRaw = Number(node?.width ?? node?.style?.width)
  const hRaw = Number(node?.height ?? node?.style?.height)
  const w = Number.isFinite(wRaw) ? Math.max(GRID_UNIT, wRaw) : GRID_UNIT * 10
  const h = Number.isFinite(hRaw) ? Math.max(GRID_UNIT, hRaw) : GRID_UNIT * 6
  return { w, h }
}

function setNodeSize(node: any, width: number, height: number) {
  const w = snapToGrid(Math.max(GRID_UNIT, width))
  const h = snapToGrid(Math.max(GRID_UNIT, height))
  node.width = w
  node.height = h
  node.style = { ...(node.style ?? {}), width: w, height: h }
}

function autoFixSwimlaneImageLayoutNodes(
  inputNodes: any[],
  direction: 'horizontal' | 'vertical',
): any[] {
  if (!Array.isArray(inputNodes) || inputNodes.length === 0) return inputNodes

  let nodes = inputNodes.map((node) => cloneLayoutNode(node))
  let byId = new Map<string, any>()
  let childrenByParent = new Map<string, any[]>()
  const rebuildRelations = () => {
    byId = new Map<string, any>(nodes.map((node) => [String(node.id), node]))
    childrenByParent = new Map<string, any[]>()
    for (const node of nodes) {
      const pid = typeof node?.parentId === 'string' ? node.parentId : undefined
      if (!pid) continue
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, [])
      childrenByParent.get(pid)!.push(node)
    }
  }
  rebuildRelations()

  const absMemo = new Map<string, { x: number; y: number }>()
  const clearAbsMemo = () => absMemo.clear()
  const getAbsPosById = (id: string, seen?: Set<string>): { x: number; y: number } => {
    const cached = absMemo.get(id)
    if (cached) return cached
    const node = byId.get(id)
    if (!node) return { x: 0, y: 0 }
    const localX = Number(node?.position?.x) || 0
    const localY = Number(node?.position?.y) || 0
    const pid = typeof node?.parentId === 'string' ? node.parentId : undefined
    if (!pid || !byId.has(pid)) {
      const abs = { x: localX, y: localY }
      absMemo.set(id, abs)
      return abs
    }
    const nextSeen = seen ?? new Set<string>()
    if (nextSeen.has(id)) {
      const abs = { x: localX, y: localY }
      absMemo.set(id, abs)
      return abs
    }
    nextSeen.add(id)
    const parentAbs = getAbsPosById(pid, nextSeen)
    const abs = { x: parentAbs.x + localX, y: parentAbs.y + localY }
    absMemo.set(id, abs)
    return abs
  }
  const getAbsPos = (node: any): { x: number; y: number } => getAbsPosById(String(node.id))
  const setAbsPos = (node: any, absX: number, absY: number) => {
    const sx = snapToGrid(absX)
    const sy = snapToGrid(absY)
    const pid = typeof node?.parentId === 'string' ? node.parentId : undefined
    if (!pid || !byId.has(pid)) {
      node.position = { x: sx, y: sy }
      clearAbsMemo()
      return
    }
    const parentAbs = getAbsPosById(pid)
    node.position = {
      x: snapToGrid(sx - parentAbs.x),
      y: snapToGrid(sy - parentAbs.y),
    }
    clearAbsMemo()
  }

  const overlapRatio = (
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number },
  ): number => {
    const ix1 = Math.max(a.minX, b.minX)
    const iy1 = Math.max(a.minY, b.minY)
    const ix2 = Math.min(a.maxX, b.maxX)
    const iy2 = Math.min(a.maxY, b.maxY)
    const iw = Math.max(0, ix2 - ix1)
    const ih = Math.max(0, iy2 - iy1)
    if (iw <= 0 || ih <= 0) return 0
    const inter = iw * ih
    const areaA = Math.max(1, (a.maxX - a.minX) * (a.maxY - a.minY))
    const areaB = Math.max(1, (b.maxX - b.minX) * (b.maxY - b.minY))
    return inter / Math.min(areaA, areaB)
  }

  const isRedundantLaneNameFrame = (frameNode: any, laneNode: any): boolean => {
    const framePos = getAbsPos(frameNode)
    const lanePos = getAbsPos(laneNode)
    const frameSize = readNodeSize(frameNode)
    const laneSize = readNodeSize(laneNode)
    const frameBox = {
      minX: framePos.x,
      minY: framePos.y,
      maxX: framePos.x + frameSize.w,
      maxY: framePos.y + frameSize.h,
    }
    const laneBox = {
      minX: lanePos.x,
      minY: lanePos.y,
      maxX: lanePos.x + laneSize.w,
      maxY: lanePos.y + laneSize.h,
    }
    return overlapRatio(frameBox, laneBox) >= 0.72
  }

  // 0) 清理冗余 frame：与 lane 同名且大面积重叠的“重复画框”直接移除。
  // 只处理明显重复容器，且保持子元素绝对坐标不变。
  {
    const laneNodesForPrune = nodes.filter((node) => isLaneNodeByData(node))
    const laneByLabel = new Map<string, any[]>()
    for (const lane of laneNodesForPrune) {
      const key = laneLabelKey(String(lane?.data?.title ?? '').trim())
      if (!key) continue
      const list = laneByLabel.get(key)
      if (list) list.push(lane)
      else laneByLabel.set(key, [lane])
    }
    const removableFrameIds = new Set<string>()
    const frameNodes = nodes.filter((node) => node?.type === 'group' && node?.data?.role === 'frame')
    for (const frame of frameNodes) {
      const key = laneLabelKey(String(frame?.data?.title ?? '').trim())
      if (!key) continue
      const sameLabelLanes = laneByLabel.get(key)
      if (!sameLabelLanes || sameLabelLanes.length === 0) continue
      if (sameLabelLanes.some((lane) => isRedundantLaneNameFrame(frame, lane))) {
        removableFrameIds.add(String(frame.id))
      }
    }
    if (removableFrameIds.size > 0) {
      for (const frameId of removableFrameIds) {
        const frameNode = byId.get(frameId)
        if (!frameNode) continue
        const nextParentId =
          typeof frameNode?.parentId === 'string' && byId.has(frameNode.parentId)
            ? frameNode.parentId
            : undefined
        const children = childrenByParent.get(frameId) ?? []
        for (const child of children) {
          const abs = getAbsPos(child)
          if (nextParentId) child.parentId = nextParentId
          else delete child.parentId
          setAbsPos(child, abs.x, abs.y)
        }
      }
      nodes = nodes.filter((node) => !removableFrameIds.has(String(node.id)))
      rebuildRelations()
      clearAbsMemo()
    }
  }

  const laneNodes = nodes.filter((node) => isLaneNodeByData(node))

  // 1) 标题安全区：自动把 lane 内内容推离左侧标题栏，避免“标题与节点重叠”。
  for (const lane of laneNodes) {
    const children = childrenByParent.get(String(lane.id)) ?? []
    const laneData = (lane?.data ?? {}) as Record<string, unknown>
    const laneTitlePosition = String(laneData.titlePosition ?? '')
    const laneAxisMeta = String((laneData.laneMeta as any)?.laneAxis ?? '')
    const laneHeaderOnLeft =
      laneTitlePosition === 'left-center'
        ? true
        : laneTitlePosition === 'top-center'
          ? false
          : laneAxisMeta !== 'column'
    const laneHeaderRaw = Number((laneData.laneMeta as any)?.headerSize)
    const laneHeaderSize = Number.isFinite(laneHeaderRaw) && laneHeaderRaw > 0
      ? laneHeaderRaw
      : SWIMLANE_IMAGE_HEADER_DEFAULT_SIZE
    const minLocalX = snapToGrid((laneHeaderOnLeft ? laneHeaderSize : 0) + SWIMLANE_IMAGE_CONTENT_PAD)
    const minLocalY = laneHeaderOnLeft
      ? snapToGrid(SWIMLANE_IMAGE_CONTENT_PAD)
      : snapToGrid(laneHeaderSize + SWIMLANE_IMAGE_TOP_HEADER_NODE_GAP)

    if (children.length > 0) {
      const childMinX = Math.min(...children.map((child) => Number(child?.position?.x) || 0))
      const childMinY = Math.min(...children.map((child) => Number(child?.position?.y) || 0))
      const shiftX = childMinX < minLocalX ? minLocalX - childMinX : 0
      const shiftY = childMinY < minLocalY ? minLocalY - childMinY : 0
      if (shiftX !== 0 || shiftY !== 0) {
        for (const child of children) {
          child.position = {
            x: snapToGrid((Number(child?.position?.x) || 0) + shiftX),
            y: snapToGrid((Number(child?.position?.y) || 0) + shiftY),
          }
        }
      }
    }

    const laneSize = readNodeSize(lane)
    const minLaneWidth = snapToGrid(minLocalX + SWIMLANE_IMAGE_CONTENT_PAD + GRID_UNIT * 2)
    const minLaneHeight = snapToGrid(minLocalY + SWIMLANE_IMAGE_CONTENT_PAD + GRID_UNIT * 2)
    let requiredWidth = Math.max(laneSize.w, minLaneWidth)
    let requiredHeight = Math.max(laneSize.h, minLaneHeight)
    if (children.length > 0) {
      const maxRight = Math.max(
        ...children.map((child) => (Number(child?.position?.x) || 0) + readNodeSize(child).w),
      )
      const maxBottom = Math.max(
        ...children.map((child) => (Number(child?.position?.y) || 0) + readNodeSize(child).h),
      )
      requiredWidth = Math.max(requiredWidth, snapToGrid(maxRight + SWIMLANE_IMAGE_CONTENT_PAD))
      requiredHeight = Math.max(requiredHeight, snapToGrid(maxBottom + SWIMLANE_IMAGE_CONTENT_PAD))
    }
    setNodeSize(lane, requiredWidth, requiredHeight)
  }

  // 2) 泳道固定间距：统一按固定 gap 堆叠，避免泳道间距忽大忽小。
  if (laneNodes.length > 0) {
    const sortedLanes = [...laneNodes].sort((a, b) => {
      const ap = getAbsPos(a)
      const bp = getAbsPos(b)
      return direction === 'horizontal' ? ap.y - bp.y : ap.x - bp.x
    })
    const unifiedSecondarySize = Math.max(
      ...sortedLanes.map((lane) => {
        const size = readNodeSize(lane)
        return direction === 'horizontal' ? size.w : size.h
      }),
    )
    const anchorSecondary = Math.min(
      ...sortedLanes.map((lane) => {
        const abs = getAbsPos(lane)
        return direction === 'horizontal' ? abs.x : abs.y
      }),
    )

    let cursor = direction === 'horizontal'
      ? getAbsPos(sortedLanes[0]).y
      : getAbsPos(sortedLanes[0]).x
    for (let i = 0; i < sortedLanes.length; i += 1) {
      const lane = sortedLanes[i]
      if (i > 0) {
        const prev = sortedLanes[i - 1]
        const prevSize = readNodeSize(prev)
        cursor += (direction === 'horizontal' ? prevSize.h : prevSize.w) + SWIMLANE_IMAGE_FIXED_GAP
      }
      if (direction === 'horizontal') {
        setAbsPos(lane, anchorSecondary, cursor)
        const laneSize = readNodeSize(lane)
        setNodeSize(lane, unifiedSecondarySize, laneSize.h)
      } else {
        setAbsPos(lane, cursor, anchorSecondary)
        const laneSize = readNodeSize(lane)
        setNodeSize(lane, laneSize.w, unifiedSecondarySize)
      }
    }
  }

  // 3) 列泳道（从左到右）优先让节点沿泳道中心线从上到下对齐；
  // 仅当偏移不超过 3/5 节点宽度时强制吸附，保留明显的“刻意偏移”。
  if (direction === 'vertical' && laneNodes.length > 0) {
    rebuildRelations()
    clearAbsMemo()
    for (const lane of laneNodes) {
      const children = (childrenByParent.get(String(lane.id)) ?? []).filter((node) => node?.type === 'quad')
      if (children.length === 0) continue
      const laneAbs = getAbsPos(lane)
      const laneSize = readNodeSize(lane)
      const laneData = (lane?.data ?? {}) as Record<string, unknown>
      const laneTitlePosition = String(laneData.titlePosition ?? '')
      const laneAxisMeta = String((laneData.laneMeta as any)?.laneAxis ?? '')
      const laneHeaderOnLeft =
        laneTitlePosition === 'left-center'
          ? true
          : laneTitlePosition === 'top-center'
            ? false
            : laneAxisMeta !== 'column'
      const laneHeaderRaw = Number((laneData.laneMeta as any)?.headerSize)
      const laneHeaderSize = Number.isFinite(laneHeaderRaw) && laneHeaderRaw > 0
        ? laneHeaderRaw
        : SWIMLANE_IMAGE_HEADER_DEFAULT_SIZE

      const contentLeft = laneAbs.x + (laneHeaderOnLeft ? laneHeaderSize : 0) + SWIMLANE_IMAGE_CONTENT_PAD
      const contentRight = laneAbs.x + laneSize.w - SWIMLANE_IMAGE_CONTENT_PAD
      const contentCenterX = snapToGrid((contentLeft + contentRight) * 0.5)

      for (const child of children) {
        const abs = getAbsPos(child)
        const size = readNodeSize(child)
        const childCenterX = abs.x + size.w * 0.5
        const alignThreshold = Math.max(GRID_UNIT * 2, size.w * SWIMLANE_COLUMN_CENTER_ALIGN_THRESHOLD_RATIO)
        if (Math.abs(childCenterX - contentCenterX) > alignThreshold) continue
        setAbsPos(child, contentCenterX - size.w * 0.5, abs.y)
      }
    }
  }

  // 4) 跨泳道近似对齐（图生图保真 + 工整的折中）：
  // - 行泳道（horizontal）：把不同泳道中“近似同一列”的节点对齐到同一条 X 中心线
  // - 列泳道（vertical）：把不同泳道中“近似同一行”的节点对齐到同一条 Y 中心线
  // 只在偏差 <= 3 * GRID_UNIT 时触发，且确保节点仍落在泳道内容区内。
  if (laneNodes.length > 1) {
    rebuildRelations()
    clearAbsMemo()

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
    const median = (values: number[]): number => {
      if (!Array.isArray(values) || values.length === 0) return 0
      const a = [...values].sort((x, y) => x - y)
      const mid = Math.floor(a.length / 2)
      if (a.length % 2 === 1) return a[mid]
      return (a[mid - 1] + a[mid]) / 2
    }

    const getLaneHeaderAndBounds = (lane: any) => {
      const laneAbs = getAbsPos(lane)
      const laneSize = readNodeSize(lane)
      const laneData = (lane?.data ?? {}) as Record<string, unknown>
      const laneTitlePosition = String(laneData.titlePosition ?? '')
      const laneAxisMeta = String((laneData.laneMeta as any)?.laneAxis ?? '')
      const laneHeaderOnLeft =
        laneTitlePosition === 'left-center'
          ? true
          : laneTitlePosition === 'top-center'
            ? false
            : laneAxisMeta !== 'column'
      const laneHeaderRaw = Number((laneData.laneMeta as any)?.headerSize)
      const laneHeaderSize = Number.isFinite(laneHeaderRaw) && laneHeaderRaw > 0
        ? laneHeaderRaw
        : SWIMLANE_IMAGE_HEADER_DEFAULT_SIZE
      const contentMinX = laneAbs.x + (laneHeaderOnLeft ? laneHeaderSize : 0) + SWIMLANE_IMAGE_CONTENT_PAD
      const contentMinY = laneAbs.y + (laneHeaderOnLeft ? SWIMLANE_IMAGE_CONTENT_PAD : laneHeaderSize + SWIMLANE_IMAGE_TOP_HEADER_NODE_GAP)
      const contentMaxX = laneAbs.x + laneSize.w - SWIMLANE_IMAGE_CONTENT_PAD
      const contentMaxY = laneAbs.y + laneSize.h - SWIMLANE_IMAGE_CONTENT_PAD
      return { laneAbs, laneSize, laneHeaderOnLeft, laneHeaderSize, contentMinX, contentMinY, contentMaxX, contentMaxY }
    }

    type AlignCandidate = {
      laneId: string
      node: any
      center: number
      absX: number
      absY: number
      w: number
      h: number
      bounds: ReturnType<typeof getLaneHeaderAndBounds>
    }

    const candidates: AlignCandidate[] = []
    for (const lane of laneNodes) {
      const bounds = getLaneHeaderAndBounds(lane)
      const children = (childrenByParent.get(String(lane.id)) ?? []).filter((n) => n?.type === 'quad')
      for (const child of children) {
        const abs = getAbsPos(child)
        const size = readNodeSize(child)
        const center = direction === 'horizontal'
          ? abs.x + size.w * 0.5
          : abs.y + size.h * 0.5
        candidates.push({
          laneId: String(lane.id),
          node: child,
          center,
          absX: abs.x,
          absY: abs.y,
          w: size.w,
          h: size.h,
          bounds,
        })
      }
    }

    const TH = GRID_UNIT * 3
    // 以“网格线桶”为第一归并维度，让结果更像肉眼看到的“一列/一行”。
    // 然后对桶中心做一次“中位数 -> 网格吸附”作为最终目标中心线。
    const bucketByKey = new Map<number, AlignCandidate[]>()
    for (const c of candidates) {
      const key = snapToGrid(c.center, GRID_UNIT)
      const list = bucketByKey.get(key)
      if (list) list.push(c)
      else bucketByKey.set(key, [c])
    }

    const bucketKeys = Array.from(bucketByKey.keys()).sort((a, b) => a - b)
    const clusters: AlignCandidate[][] = []
    let curKeys: number[] = []
    for (const k of bucketKeys) {
      if (curKeys.length === 0) {
        curKeys = [k]
        continue
      }
      const prevK = curKeys[curKeys.length - 1]
      // 若两个桶中心足够近，合并为同一 cluster（处理“同一列略偏到相邻网格线”的情况）
      if (Math.abs(k - prevK) <= TH) {
        curKeys.push(k)
      } else {
        const merged: AlignCandidate[] = []
        for (const kk of curKeys) merged.push(...(bucketByKey.get(kk) ?? []))
        clusters.push(merged)
        curKeys = [k]
      }
    }
    if (curKeys.length) {
      const merged: AlignCandidate[] = []
      for (const kk of curKeys) merged.push(...(bucketByKey.get(kk) ?? []))
      clusters.push(merged)
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue
      const laneSet = new Set(cluster.map((c) => c.laneId))
      if (laneSet.size < 2) continue

      const targetCenter = snapToGrid(median(cluster.map((c) => c.center)), GRID_UNIT)

      for (const c of cluster) {
        if (direction === 'horizontal') {
          if (Math.abs(c.center - targetCenter) > TH) continue
          const minX = c.bounds.contentMinX
          const maxX = c.bounds.contentMaxX - c.w
          const nextAbsX = clamp(snapToGrid(targetCenter - c.w * 0.5), minX, maxX)
          setAbsPos(c.node, nextAbsX, c.absY)
        } else {
          if (Math.abs(c.center - targetCenter) > TH) continue
          const minY = c.bounds.contentMinY
          const maxY = c.bounds.contentMaxY - c.h
          const nextAbsY = clamp(snapToGrid(targetCenter - c.h * 0.5), minY, maxY)
          setAbsPos(c.node, c.absX, nextAbsY)
        }
      }
    }
  }

  return nodes
}

export function buildSwimlanePreserveLayoutDraftFromImageStructured(
  structured: AiImageStructuredDraft,
  opts?: {
    canvasWidth?: number
    canvasHeight?: number
  },
): AiDiagramDraft {
  const normalizedStructured = ensureStructuredSwimlaneGeometry(structured)
  const base = buildFreeLayoutDraftFromImageStructured(normalizedStructured, {
    canvasWidth: opts?.canvasWidth,
    canvasHeight: opts?.canvasHeight,
    preserveLayoutStrict: true,
  })
  const structuredNodeById = new Map(normalizedStructured.nodes.map((n) => [n.id, n]))
  const laneGroups = (base.nodes as any[])
    .filter((n) => isLaneNodeByData(n))
    .map((n) => n as any)

  const direction = inferSwimlaneDirectionFromStructured(normalizedStructured)
  const laneAxis = direction === 'horizontal' ? 'row' : 'column'
  const laneTitlePosition: 'left-center' | 'top-center' = laneAxis === 'column' ? 'top-center' : 'left-center'
  const structuredLaneBoxes = normalizedStructured.groups
    .filter((g): g is AiImageStructuredGroup & { x: number; y: number; w: number; h: number } => g.kind === 'lane' && hasLayoutBox(g))
    .map((g) => ({
      laneId: g.id,
      labelKey: laneLabelKey(g.label),
      minX: g.x,
      minY: g.y,
      maxX: g.x + g.w,
      maxY: g.y + g.h,
      area: g.w * g.h,
    }))

  laneGroups.sort((a, b) => {
    const pa = a?.position ?? { x: 0, y: 0 }
    const pb = b?.position ?? { x: 0, y: 0 }
    return direction === 'horizontal'
      ? (pa.y ?? 0) - (pb.y ?? 0)
      : (pa.x ?? 0) - (pb.x ?? 0)
  })

  const laneIdByLabel = new Map<string, string>()
  for (const laneNode of laneGroups) {
    const title = String(laneNode?.data?.title ?? '').trim()
    if (title) laneIdByLabel.set(title.toLowerCase(), laneNode.id)
  }

  const laneMetaById = new Map<string, { laneIndex: number }>()
  for (let i = 0; i < laneGroups.length; i += 1) {
    laneMetaById.set(laneGroups[i].id, { laneIndex: i })
  }

  const nextNodes = (base.nodes as any[]).map((node) => {
    if (node?.type === 'group' && (node?.data?.role === 'lane' || laneMetaById.has(node.id))) {
      const laneIndex = laneMetaById.get(node.id)?.laneIndex ?? 0
      return {
        ...node,
        data: {
          ...(node.data ?? {}),
          role: 'lane',
          titlePosition: laneTitlePosition,
          laneMeta: {
            laneId: node.id,
            laneIndex,
            laneAxis,
          },
        },
      }
    }

    if (node?.type !== 'quad') return node
    const src = structuredNodeById.get(node.id)
    const laneName = (src?.lane ?? '').trim().toLowerCase()
    const laneId = laneName ? laneIdByLabel.get(laneName) : undefined
    if (!laneId) return node

    return {
      ...node,
      ...(node.parentId ? {} : { parentId: laneId }),
      data: {
        ...(node.data ?? {}),
        laneId,
      },
    }
  })

  const layoutFixedNodes = autoFixSwimlaneImageLayoutNodes(nextNodes, direction)

  // 泳道图图生图：不保留非泳道画框，避免“识图噪声 group/frame”干扰 lane 关系。
  // 同时基于几何关系重算节点所属泳道，保证节点真正落在对应 lane 内。
  const absorbSwimlaneNodes = (): any[] => {
    let nodes = layoutFixedNodes.map((node: any) => cloneLayoutNode(node))
    let byId = new Map<string, any>(nodes.map((node: any) => [String(node.id), node]))

    const rebuildById = () => {
      byId = new Map<string, any>(nodes.map((node: any) => [String(node.id), node]))
    }

    const getAbsPosById = (
      id: string,
      memo: Map<string, { x: number; y: number }>,
      seen?: Set<string>,
    ): { x: number; y: number } => {
      const cached = memo.get(id)
      if (cached) return cached
      const node = byId.get(id)
      if (!node) return { x: 0, y: 0 }
      const x = Number(node?.position?.x) || 0
      const y = Number(node?.position?.y) || 0
      const pid = typeof node?.parentId === 'string' ? node.parentId : undefined
      if (!pid || !byId.has(pid)) {
        const abs = { x, y }
        memo.set(id, abs)
        return abs
      }
      const nextSeen = seen ?? new Set<string>()
      if (nextSeen.has(id)) {
        const abs = { x, y }
        memo.set(id, abs)
        return abs
      }
      nextSeen.add(id)
      const parentAbs: { x: number; y: number } = getAbsPosById(pid, memo, nextSeen)
      const abs: { x: number; y: number } = { x: parentAbs.x + x, y: parentAbs.y + y }
      memo.set(id, abs)
      return abs
    }

    const toAbsMap = () => {
      const memo = new Map<string, { x: number; y: number }>()
      for (const node of nodes) getAbsPosById(String(node.id), memo)
      return memo
    }

    const frameIds = new Set(
      nodes
        .filter((node) => node?.type === 'group' && node?.data?.role === 'frame')
        .map((node) => String(node.id)),
    )

    if (frameIds.size > 0) {
      const absMap = toAbsMap()
      for (const node of nodes) {
        if (frameIds.has(String(node.id))) continue
        const abs = absMap.get(String(node.id)) ?? { x: Number(node?.position?.x) || 0, y: Number(node?.position?.y) || 0 }
        let parentId = typeof node?.parentId === 'string' ? node.parentId : undefined
        while (parentId && frameIds.has(parentId)) {
          const parent = byId.get(parentId)
          parentId = typeof parent?.parentId === 'string' ? parent.parentId : undefined
        }
        if (parentId && byId.has(parentId) && !frameIds.has(parentId)) {
          const parentAbs = absMap.get(parentId) ?? { x: 0, y: 0 }
          node.parentId = parentId
          node.position = {
            x: snapToGrid(abs.x - parentAbs.x),
            y: snapToGrid(abs.y - parentAbs.y),
          }
        } else {
          delete node.parentId
          node.position = { x: snapToGrid(abs.x), y: snapToGrid(abs.y) }
        }
      }
      nodes = nodes.filter((node) => !frameIds.has(String(node.id)))
      rebuildById()
    }

    const laneNodes = nodes.filter(
      (node) => isLaneNodeByData(node),
    )
    const laneAbsMap = toAbsMap()
    laneNodes.sort((a, b) => {
      const pa = laneAbsMap.get(String(a.id)) ?? { x: 0, y: 0 }
      const pb = laneAbsMap.get(String(b.id)) ?? { x: 0, y: 0 }
      return direction === 'horizontal' ? pa.y - pb.y : pa.x - pb.x
    })

    const laneIdByLabel = new Map<string, string>()
    for (const lane of laneNodes) {
      const k = laneLabelKey(String(lane?.data?.title ?? '').trim())
      if (k) laneIdByLabel.set(k, String(lane.id))
    }
    const laneIndexById = new Map<string, number>(laneNodes.map((lane, idx) => [String(lane.id), idx]))

    for (const lane of laneNodes) {
      const abs = laneAbsMap.get(String(lane.id)) ?? { x: Number(lane?.position?.x) || 0, y: Number(lane?.position?.y) || 0 }
      delete lane.parentId
      lane.position = { x: snapToGrid(abs.x), y: snapToGrid(abs.y) }
      const laneIndex = laneIndexById.get(String(lane.id)) ?? 0
      lane.data = {
        ...(lane.data ?? {}),
        role: 'lane',
        titlePosition: laneTitlePosition,
        laneMeta: {
          laneId: String(lane.id),
          laneIndex,
          laneAxis,
        },
      }
    }
    rebuildById()

    const refreshedAbs = toAbsMap()
    const laneBoxes = laneNodes.map((lane) => {
      const abs = refreshedAbs.get(String(lane.id)) ?? { x: 0, y: 0 }
      const size = readNodeSize(lane)
      return {
        laneId: String(lane.id),
        labelKey: laneLabelKey(String(lane?.data?.title ?? '').trim()),
        minX: abs.x,
        minY: abs.y,
        maxX: abs.x + size.w,
        maxY: abs.y + size.h,
        cx: abs.x + size.w / 2,
        cy: abs.y + size.h / 2,
        area: size.w * size.h,
      }
    })

    const pickLaneByNodeAbs = (node: any): string | undefined => {
      if (laneBoxes.length === 0) return undefined
      const nodeAbs = refreshedAbs.get(String(node.id)) ?? { x: Number(node?.position?.x) || 0, y: Number(node?.position?.y) || 0 }
      const size = readNodeSize(node)
      const center = { x: nodeAbs.x + size.w / 2, y: nodeAbs.y + size.h / 2 }
      const src = structuredNodeById.get(String(node.id))

      // 优先使用识图原始几何判定泳道，避免“错误 parentId 导致 lane 扩张后把节点吸回错误泳道”。
      if (src?.x != null && src?.y != null) {
        const cx = src.x + ((src.w ?? 0.12) * 0.5)
        const cy = src.y + ((src.h ?? 0.08) * 0.5)
        const srcContains = structuredLaneBoxes.filter(
          (lane) => cx >= lane.minX && cx <= lane.maxX && cy >= lane.minY && cy <= lane.maxY,
        )
        if (srcContains.length > 0) {
          const picked = [...srcContains].sort((a, b) => a.area - b.area)[0]
          if (laneIndexById.has(picked.laneId)) return picked.laneId
          const byLabel = picked.labelKey ? laneIdByLabel.get(picked.labelKey) : undefined
          if (byLabel) return byLabel
        }
      }

      const contains = laneBoxes.filter(
        (lane) => center.x >= lane.minX && center.x <= lane.maxX && center.y >= lane.minY && center.y <= lane.maxY,
      )
      if (contains.length === 1) return contains[0].laneId
      if (contains.length > 1) {
        return contains.sort((a, b) => a.area - b.area)[0].laneId
      }

      const srcLaneKey = laneLabelKey(String(src?.lane ?? '').trim())
      if (srcLaneKey) {
        const byLabel = laneIdByLabel.get(srcLaneKey)
        if (byLabel) return byLabel
      }

      const currentLaneId = (() => {
        const dataLane = String((node?.data as any)?.laneId ?? '').trim()
        if (dataLane && laneIndexById.has(dataLane)) return dataLane
        const pid = String(node?.parentId ?? '').trim()
        if (pid && laneIndexById.has(pid)) return pid
        return undefined
      })()
      if (currentLaneId) return currentLaneId

      const nearest = [...laneBoxes].sort((a, b) => {
        const da = direction === 'horizontal'
          ? Math.abs(center.y - a.cy)
          : Math.abs(center.x - a.cx)
        const db = direction === 'horizontal'
          ? Math.abs(center.y - b.cy)
          : Math.abs(center.x - b.cx)
        return da - db
      })[0]
      return nearest?.laneId
    }

    for (const node of nodes) {
      if (node?.type !== 'quad') continue
      const abs = refreshedAbs.get(String(node.id)) ?? { x: Number(node?.position?.x) || 0, y: Number(node?.position?.y) || 0 }
      const laneId = pickLaneByNodeAbs(node)
      if (!laneId) continue
      const laneAbs = refreshedAbs.get(laneId) ?? { x: 0, y: 0 }
      const laneNode = byId.get(laneId)
      const laneData = (laneNode?.data ?? {}) as Record<string, unknown>
      const laneTitlePositionRaw = String(laneData.titlePosition ?? '')
      const laneAxisMeta = String((laneData.laneMeta as any)?.laneAxis ?? '')
      const laneHeaderOnLeft =
        laneTitlePositionRaw === 'left-center'
          ? true
          : laneTitlePositionRaw === 'top-center'
            ? false
            : laneAxisMeta !== 'column'
      const laneHeaderRaw = Number((laneData.laneMeta as any)?.headerSize)
      const laneHeaderSize = Number.isFinite(laneHeaderRaw) && laneHeaderRaw > 0
        ? laneHeaderRaw
        : SWIMLANE_IMAGE_HEADER_DEFAULT_SIZE
      const minLocalX = snapToGrid((laneHeaderOnLeft ? laneHeaderSize : 0) + SWIMLANE_IMAGE_CONTENT_PAD)
      const minLocalY = laneHeaderOnLeft
        ? snapToGrid(SWIMLANE_IMAGE_CONTENT_PAD)
        : snapToGrid(laneHeaderSize + SWIMLANE_IMAGE_TOP_HEADER_NODE_GAP)
      const localX = snapToGrid(abs.x - laneAbs.x)
      const localY = snapToGrid(abs.y - laneAbs.y)
      node.parentId = laneId
      node.position = {
        x: Math.max(minLocalX, localX),
        y: Math.max(minLocalY, localY),
      }
      node.data = {
        ...(node.data ?? {}),
        laneId,
      }
    }

    return autoFixSwimlaneImageLayoutNodes(nodes, direction)
  }

  // 关键：absorbSwimlaneNodes 会“重算 parentId/laneId”，此前的对齐可能因早期 parent 关系不稳定而未触发。
  // 因此在 absorb 之后再跑一遍 autoFix，让跨泳道近似对齐真正对最终归属生效。
  const absorbedNodes = absorbSwimlaneNodes()
  const finalNodes = autoFixSwimlaneImageLayoutNodes(absorbedNodes, direction).map((n: any) =>
    applySwimlaneImageDefaultLaneGroupPaint(n),
  )
  const nodeById = new Map(finalNodes.map((n: any) => [n.id, n]))
  const nextEdgesRaw = (base.edges as any[]).map((edge) => {
    const srcNode = nodeById.get(edge.source)
    const tgtNode = nodeById.get(edge.target)
    const srcLaneId = (srcNode?.data as any)?.laneId ?? srcNode?.parentId
    const tgtLaneId = (tgtNode?.data as any)?.laneId ?? tgtNode?.parentId
    const relation = toRelationToken((edge?.data as any)?.relation)
    const isCrossLane = !!srcLaneId && !!tgtLaneId && srcLaneId !== tgtLaneId

    const semanticType =
      relation === 'return_to' || relation === 'cancel_to'
        ? 'returnFlow'
        : relation === 'yes' || relation === 'no'
          ? 'conditional'
          : isCrossLane
            ? 'crossLane'
            : 'normal'

    return {
      ...edge,
      type: 'smoothstep',
      label: sanitizeEdgeLabelForImageSwimlane(edge.label, relation),
      data: {
        ...((edge?.data ?? {}) as Record<string, unknown>),
        relation: relation || 'next',
        semanticType,
        layoutProfile: 'swimlane',
        autoGeneratedSwimlane: true,
        labelTextOnly: true,
      },
    }
  })
  const nextEdges = quickReviewAndFixImageSwimlaneEdges({ nodes: finalNodes, edges: nextEdgesRaw, direction })

  return {
    schema: 'flow2go.ai.diagram.v1',
    title: normalizedStructured.title || '泳道图（图生图）',
    nodes: finalNodes,
    edges: nextEdges,
    viewport: { x: 0, y: 0, zoom: 1 },
    rawText: normalizedStructured.rawText,
  }
}

export function buildFreeLayoutDraftFromImageStructured(
  structured: AiImageStructuredDraft,
  opts?: {
    canvasWidth?: number
    canvasHeight?: number
    preserveLayoutStrict?: boolean
  },
): AiDiagramDraft {
  const CANVAS_W = Math.max(720, Math.round(Number(opts?.canvasWidth) || 1800))
  const CANVAS_H = Math.max(480, Math.round(Number(opts?.canvasHeight) || 1000))
  const MIN_W = 120
  const MAX_W = 320
  const MIN_H = 48
  const MAX_H = 180
  const GAP_X = 220
  const GAP_Y = 120
  const START_X = 120
  const START_Y = 120
  const MONO_FILL = '#FFFFFF'
  const MONO_NODE_STROKE = '#E2E8F0'
  const MONO_GROUP_STROKE = '#CBD5E1'
  const MONO_GROUP_FILL = 'rgba(226, 232, 240, 0.14)'
  const MONO_LANE_FILL = 'rgba(226, 232, 240, 0.24)'
  const MONO_TEXT = '#0F172A'

  const snapToGrid = (value: number) => Math.round(value / GRID_UNIT) * GRID_UNIT
  const snapSizeToGrid = (value: number) => Math.max(GRID_UNIT, snapToGrid(value))
  const avoidGap = GRID_UNIT
  const microShift = GRID_UNIT * 2
  const maxShiftPass = 8

  const intersects = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
    gap: number,
  ) => {
    const ax1 = a.x - gap
    const ay1 = a.y - gap
    const ax2 = a.x + a.w + gap
    const ay2 = a.y + a.h + gap
    const bx1 = b.x - gap
    const by1 = b.y - gap
    const bx2 = b.x + b.w + gap
    const by2 = b.y + b.h + gap
    return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1
  }

  const pickMedian = (values: number[], fallback: number): number => {
    if (values.length === 0) return fallback
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted[mid] ?? fallback
  }

  const normalizeApproxNodeSize = (args: {
    raw: number
    avg: number
    min: number
    max: number
    similarTolerance: number
  }): number => {
    const clamped = clampRange(args.raw, args.min, args.max)
    if (Math.abs(clamped - args.avg) <= args.similarTolerance) {
      return snapSizeToGrid(args.avg)
    }
    return snapSizeToGrid(clamped)
  }

  const rawWidthCandidates = structured.nodes.map((n) => {
    const raw = n.w != null ? Math.round(n.w * CANVAS_W) : 180
    return Math.max(MIN_W, Math.min(MAX_W, raw))
  })
  const rawHeightCandidates = structured.nodes.map((n) => {
    const raw = n.h != null ? Math.round(n.h * CANVAS_H) : 56
    return Math.max(MIN_H, Math.min(MAX_H, raw))
  })
  // 识图节点几何：改为“近似统一”，相近尺寸收敛到全局均值，差异较大的保留原尺度。
  const approximateNodeWidth = snapSizeToGrid(
    clampRange(pickMedian(rawWidthCandidates, 176), MIN_W, MAX_W),
  )
  const approximateNodeHeight = snapSizeToGrid(
    clampRange(pickMedian(rawHeightCandidates, 56), MIN_H, MAX_H),
  )
  const nearSizeToleranceW = Math.max(GRID_UNIT * 4, Math.round(approximateNodeWidth / 3))
  const nearSizeToleranceH = Math.max(GRID_UNIT * 3, Math.round(approximateNodeHeight / 3))
  // 纵向：在 1/3 节点宽度内强制对齐；横向：仅弱约束，不做强制吸附。
  const verticalAlignTolerance = Math.max(GRID_UNIT * 2, Math.round(approximateNodeWidth / 3))
  const horizontalAlignTolerance = Math.max(GRID_UNIT, Math.round(approximateNodeWidth * 0.18))
  const clampShiftDelta = (delta: number, maxShift: number): number => {
    if (!Number.isFinite(delta)) return 0
    if (delta > maxShift) return maxShift
    if (delta < -maxShift) return -maxShift
    return delta
  }
  const useMonochromeTheme = shouldUseMonochromeImageTheme(structured)
  const inferredSwimlaneDirection = inferSwimlaneDirectionFromStructured(structured)
  const laneTitlePosition: 'left-center' | 'top-center' =
    inferredSwimlaneDirection === 'vertical' ? 'top-center' : 'left-center'
  const degreeById = new Map<string, { in: number; out: number }>()
  for (const node of structured.nodes) degreeById.set(node.id, { in: 0, out: 0 })
  for (const edge of structured.edges) {
    const from = degreeById.get(edge.from)
    const to = degreeById.get(edge.to)
    if (from) from.out += 1
    if (to) to.in += 1
  }

  const groupAbsBoxById = new Map<string, { x: number; y: number; w: number; h: number }>()
  const groupParentById = new Map<string, string | undefined>()

  const groups = structured.groups.map((g, idx) => {
    const hasLayout = g.x != null && g.y != null
    const defaultGroupW = g.kind === 'lane' ? 1080 : 520
    const defaultGroupH = g.kind === 'lane' ? 240 : 320
    const widthRaw = g.w != null ? Math.max(240, Math.round(g.w * CANVAS_W)) : defaultGroupW
    const heightRaw = g.h != null ? Math.max(140, Math.round(g.h * CANVAS_H)) : defaultGroupH
    const fallbackCol = idx % 2
    const fallbackRow = Math.floor(idx / 2)
    const xRaw = hasLayout ? Math.round((g.x as number) * CANVAS_W) : START_X + fallbackCol * (defaultGroupW + 120)
    const yRaw = hasLayout ? Math.round((g.y as number) * CANVAS_H) : START_Y + fallbackRow * (defaultGroupH + 80)
    const width = snapSizeToGrid(widthRaw)
    const height = snapSizeToGrid(heightRaw)
    const x = snapToGrid(xRaw)
    const y = snapToGrid(yRaw)
    groupAbsBoxById.set(g.id, { x, y, w: width, h: height })
    groupParentById.set(g.id, g.parentId)
    return {
      id: g.id,
      type: 'group',
      position: { x, y },
      width,
      height,
      style: { width, height },
      data: {
        title: g.label,
        role: g.kind === 'lane' ? 'lane' : 'frame',
        titlePosition: g.kind === 'lane' ? laneTitlePosition : undefined,
        stroke:
          g.kind === 'lane'
            ? '#cbd5e1'
            : useMonochromeTheme
              ? MONO_GROUP_STROKE
              : (g.style?.stroke ?? '#CBD5E1'),
        strokeWidth: g.kind === 'lane' ? 1.5 : useMonochromeTheme ? 1 : (g.style?.strokeWidth ?? 1),
        fill: useMonochromeTheme
          ? (g.kind === 'lane' ? MONO_LANE_FILL : MONO_GROUP_FILL)
          : (g.style?.fill ?? (g.kind === 'lane' ? 'rgba(226, 232, 240, 0.24)' : 'rgba(226, 232, 240, 0.14)')),
        titleColor: useMonochromeTheme ? '#475569' : (g.style?.textColor ?? '#475569'),
        opacity: g.style?.opacity,
      },
    } as any
  })

  const nodeAbsBoxById = new Map<string, { x: number; y: number; w: number; h: number }>()
  const nodes = structured.nodes.map((n, idx) => {
    const hasLayout = n.x != null && n.y != null
    const fallbackCol = idx % 6
    const fallbackRow = Math.floor(idx / 6)
    const parentAbs = n.parentId ? groupAbsBoxById.get(n.parentId) : undefined
    const xRaw = hasLayout
      ? Math.round((n.x as number) * CANVAS_W)
      : (parentAbs ? parentAbs.x + 24 + fallbackCol * 180 : START_X + fallbackCol * GAP_X)
    const yRaw = hasLayout
      ? Math.round((n.y as number) * CANVAS_H)
      : (parentAbs ? parentAbs.y + 24 + fallbackRow * 96 : START_Y + fallbackRow * GAP_Y)
    const rawWidth = n.w != null ? Math.round((n.w as number) * CANVAS_W) : approximateNodeWidth
    const rawHeight = n.h != null ? Math.round((n.h as number) * CANVAS_H) : approximateNodeHeight
    const width = normalizeApproxNodeSize({
      raw: rawWidth,
      avg: approximateNodeWidth,
      min: MIN_W,
      max: MAX_W,
      similarTolerance: nearSizeToleranceW,
    })
    const height = normalizeApproxNodeSize({
      raw: rawHeight,
      avg: approximateNodeHeight,
      min: MIN_H,
      max: MAX_H,
      similarTolerance: nearSizeToleranceH,
    })
    const x = snapToGrid(xRaw)
    const y = snapToGrid(yRaw)
    nodeAbsBoxById.set(n.id, { x, y, w: width, h: height })
    const shape = n.type === 'decision' ? 'diamond' : n.type === 'start_end' ? 'circle' : 'rect'
    const degree = degreeById.get(n.id) ?? { in: 0, out: 0 }
    const semanticType =
      n.type === 'decision'
        ? 'decision'
        : n.type === 'start_end'
          ? (degree.in > 0 && degree.out === 0 ? 'end' : 'start')
          : n.type === 'io'
            ? 'data'
            : 'task'

    const fillRgb = parseColorToRgb(n.style?.fill)
    const textRgb = parseColorToRgb(n.style?.textColor)
    const fillLum = fillRgb ? relativeLuminance(fillRgb) : undefined
    const hasModelTextColor = typeof n.style?.textColor === 'string' && n.style.textColor.trim().length > 0
    let resolvedTextColor = n.style?.textColor
    if (!hasModelTextColor && !useMonochromeTheme && fillLum != null) {
      if (fillLum <= 0.42) {
        if (!textRgb || relativeLuminance(textRgb) < 0.45) resolvedTextColor = '#FFFFFF'
      } else if (textRgb && relativeLuminance(textRgb) > 0.82) {
        resolvedTextColor = '#0F172A'
      }
    }
    if (!resolvedTextColor) {
      // 文本色缺失时，按背景亮度给可读默认值，避免“识别不到文本色→黑字压深底”。
      if (fillLum != null) resolvedTextColor = fillLum <= 0.42 ? '#FFFFFF' : '#0F172A'
      else resolvedTextColor = '#0F172A'
    }

    const strokeColor = useMonochromeTheme ? MONO_NODE_STROKE : n.style?.stroke
    const fillColor = useMonochromeTheme ? MONO_FILL : n.style?.fill
    const strokeWidth = useMonochromeTheme ? 1 : n.style?.strokeWidth
    return {
      id: n.id,
      type: 'quad',
      position: { x, y },
      width,
      height,
      style: { width, height },
      ...(n.parentId && groupAbsBoxById.has(n.parentId) ? { parentId: n.parentId } : {}),
      data: {
        title: n.label,
        label: n.label,
        shape,
        semanticType,
        color: fillColor,
        stroke: strokeColor,
        strokeWidth,
        // 识图生图：显式回填到 labelColor，避免 QuadNode 的 decision 白字默认值覆盖模型识别结果。
        labelColor: useMonochromeTheme ? MONO_TEXT : resolvedTextColor,
        fontColor: useMonochromeTheme ? MONO_TEXT : resolvedTextColor,
        opacity: n.style?.opacity,
      },
    } as any
  })

  const outlierNodeIds = (() => {
    const outlierIds = new Set<string>()
    const byParent = new Map<string, any[]>()
    for (const node of nodes) {
      const key = node.parentId ? `p:${node.parentId}` : 'root'
      const arr = byParent.get(key)
      if (arr) arr.push(node)
      else byParent.set(key, [node])
    }
    for (const list of byParent.values()) {
      if (list.length < 4) continue
      const nearestDistance = (idx: number): number => {
        const a = list[idx]
        let best = Number.POSITIVE_INFINITY
        for (let j = 0; j < list.length; j += 1) {
          if (j === idx) continue
          const b = list[j]
          const dx = Math.abs((Number(a?.position?.x) || 0) - (Number(b?.position?.x) || 0))
          const dy = Math.abs((Number(a?.position?.y) || 0) - (Number(b?.position?.y) || 0))
          const d = dx + dy
          if (d < best) best = d
        }
        return best
      }
      const distances = list.map((_, i) => nearestDistance(i)).filter((v) => Number.isFinite(v) && v > 0)
      const baseline = Math.max(GRID_UNIT * 12, pickMedian(distances, approximateNodeWidth * 1.6))
      for (let i = 0; i < list.length; i += 1) {
        const d = nearestDistance(i)
        if (!Number.isFinite(d)) continue
        if (d >= baseline * 1.9) {
          outlierIds.add(String(list[i].id))
        }
      }
    }
    return outlierIds
  })()

  const hasLaneGroupsInDraft = groups.some((g) => (g?.data as any)?.role === 'lane')
  // 包含结构（业务分层/画框嵌套）按“半单位”硬规则排版：
  // 节点间距与容器 padding 都固定为 1/2 单位（GRID_UNIT）。
  const HALF_UNIT_GAP = GRID_UNIT
  const CONTAINER_PAD_X = HALF_UNIT_GAP
  const CONTAINER_PAD_Y = HALF_UNIT_GAP

  const setNodeSizeLike = (node: any, width: number, height: number) => {
    const w = snapSizeToGrid(clampRange(width, MIN_W, MAX_W))
    const h = snapSizeToGrid(clampRange(height, MIN_H, MAX_H))
    node.width = w
    node.height = h
    node.style = { ...(node.style ?? {}), width: w, height: h }
  }

  const hasAnyOverlap = (list: any[], gap: number): boolean => {
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]
      const aBox = {
        x: Number(a?.position?.x) || 0,
        y: Number(a?.position?.y) || 0,
        w: Math.max(GRID_UNIT, Number(a?.width ?? a?.style?.width ?? GRID_UNIT)),
        h: Math.max(GRID_UNIT, Number(a?.height ?? a?.style?.height ?? GRID_UNIT)),
      }
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]
        const bBox = {
          x: Number(b?.position?.x) || 0,
          y: Number(b?.position?.y) || 0,
          w: Math.max(GRID_UNIT, Number(b?.width ?? b?.style?.width ?? GRID_UNIT)),
          h: Math.max(GRID_UNIT, Number(b?.height ?? b?.style?.height ?? GRID_UNIT)),
        }
        if (intersects(aBox, bBox, gap)) return true
      }
    }
    return false
  }

  const regularizeMixedGridInGroup = (groupId: string, eligibleNodes: any[]) => {
    const groupAbs = groupAbsBoxById.get(groupId)
    if (!groupAbs || eligibleNodes.length < 3) return
    const contentX = groupAbs.x + CONTAINER_PAD_X
    const contentY = groupAbs.y + CONTAINER_PAD_Y
    const contentW = Math.max(GRID_UNIT * 6, groupAbs.w - CONTAINER_PAD_X * 2)
    const contentH = Math.max(GRID_UNIT * 6, groupAbs.h - CONTAINER_PAD_Y * 2)
    const baseCellW = snapSizeToGrid(pickMedian(
      eligibleNodes.map((n) => Math.max(GRID_UNIT, Number(n?.width ?? n?.style?.width ?? approximateNodeWidth))),
      approximateNodeWidth,
    ))
    const baseCellH = snapSizeToGrid(pickMedian(
      eligibleNodes.map((n) => Math.max(GRID_UNIT, Number(n?.height ?? n?.style?.height ?? approximateNodeHeight))),
      approximateNodeHeight,
    ))
    const stepX = Math.max(GRID_UNIT, baseCellW + HALF_UNIT_GAP)
    const stepY = Math.max(GRID_UNIT, baseCellH + HALF_UNIT_GAP)
    const maxCols = Math.max(1, Math.floor((contentW + HALF_UNIT_GAP) / stepX))
    const visibleRows = Math.max(1, Math.floor((contentH + HALF_UNIT_GAP) / stepY))
    const maxRows = Math.max(visibleRows, eligibleNodes.length * 3)
    const used = new Set<string>()
    const canPlace = (row: number, col: number, rowSpan: number, colSpan: number): boolean => {
      if (row < 0 || col < 0 || row + rowSpan > maxRows || col + colSpan > maxCols) return false
      for (let r = row; r < row + rowSpan; r += 1) {
        for (let c = col; c < col + colSpan; c += 1) {
          if (used.has(`${r}:${c}`)) return false
        }
      }
      return true
    }
    const mark = (row: number, col: number, rowSpan: number, colSpan: number) => {
      for (let r = row; r < row + rowSpan; r += 1) {
        for (let c = col; c < col + colSpan; c += 1) {
          used.add(`${r}:${c}`)
        }
      }
    }
    const sortedNodes = [...eligibleNodes].sort((a, b) => {
      const aw = Math.max(GRID_UNIT, Number(a?.width ?? a?.style?.width ?? baseCellW))
      const ah = Math.max(GRID_UNIT, Number(a?.height ?? a?.style?.height ?? baseCellH))
      const bw = Math.max(GRID_UNIT, Number(b?.width ?? b?.style?.width ?? baseCellW))
      const bh = Math.max(GRID_UNIT, Number(b?.height ?? b?.style?.height ?? baseCellH))
      return bw * bh - aw * ah
    })
    for (const node of sortedNodes) {
      const w = Math.max(GRID_UNIT, Number(node?.width ?? node?.style?.width ?? baseCellW))
      const h = Math.max(GRID_UNIT, Number(node?.height ?? node?.style?.height ?? baseCellH))
      const spanC = Math.max(1, Math.min(maxCols, Math.ceil(w / baseCellW)))
      const spanR = Math.max(1, Math.min(maxRows, Math.ceil(h / baseCellH)))
      const nodeX = Number(node?.position?.x) || contentX
      const nodeY = Number(node?.position?.y) || contentY
      const desiredCol = Math.max(0, Math.min(maxCols - spanC, Math.round((nodeX - contentX) / stepX)))
      const desiredRow = Math.max(0, Math.min(maxRows - spanR, Math.round((nodeY - contentY) / stepY)))
      let placed: { row: number; col: number } | null = null
      const maxRadius = Math.max(maxCols, Math.min(maxRows, 32))
      for (let radius = 0; radius <= maxRadius && !placed; radius += 1) {
        for (let dr = -radius; dr <= radius && !placed; dr += 1) {
          for (let dc = -radius; dc <= radius && !placed; dc += 1) {
            const row = desiredRow + dr
            const col = desiredCol + dc
            if (canPlace(row, col, spanR, spanC)) {
              placed = { row, col }
            }
          }
        }
      }
      if (!placed) {
        for (let row = 0; row <= maxRows - spanR && !placed; row += 1) {
          for (let col = 0; col <= maxCols - spanC && !placed; col += 1) {
            if (canPlace(row, col, spanR, spanC)) placed = { row, col }
          }
        }
      }
      if (!placed) continue
      mark(placed.row, placed.col, spanR, spanC)
      node.position.x = snapToGrid(contentX + placed.col * stepX)
      node.position.y = snapToGrid(contentY + placed.row * stepY)
    }
  }

  const recursivelyRegularizedGroupIds = new Set<string>()
  const regularizeGroupChildrenRecursive = (parentGroupId?: string) => {
    const childGroups = groups.filter((g) => (groupParentById.get(g.id) ?? undefined) === parentGroupId)
    for (const group of childGroups) {
      if ((group?.data as any)?.role === 'lane') {
        regularizeGroupChildrenRecursive(String(group.id))
        continue
      }
      const groupAbs = groupAbsBoxById.get(group.id)
      if (groupAbs) {
        const children = nodes.filter((n) => n.parentId === group.id)
        const eligible = children.filter((n) => !outlierNodeIds.has(String(n.id)))
        if (eligible.length >= 2) {
          const contentX = groupAbs.x + CONTAINER_PAD_X
          const contentY = groupAbs.y + CONTAINER_PAD_Y
          const contentW = Math.max(GRID_UNIT * 8, groupAbs.w - CONTAINER_PAD_X * 2)
          const contentH = Math.max(GRID_UNIT * 8, groupAbs.h - CONTAINER_PAD_Y * 2)
          const rowBandTolerance = Math.max(HALF_UNIT_GAP, verticalAlignTolerance)
          const rowBands: Array<{ centerY: number; members: any[] }> = []
          const sortedByCenterY = [...eligible].sort((a, b) => {
            const ay = (Number(a?.position?.y) || 0) + Math.max(GRID_UNIT, Number(a?.height ?? a?.style?.height ?? approximateNodeHeight)) / 2
            const by = (Number(b?.position?.y) || 0) + Math.max(GRID_UNIT, Number(b?.height ?? b?.style?.height ?? approximateNodeHeight)) / 2
            return ay - by
          })
          for (const node of sortedByCenterY) {
            const cy = (Number(node?.position?.y) || 0) + Math.max(GRID_UNIT, Number(node?.height ?? node?.style?.height ?? approximateNodeHeight)) / 2
            const last = rowBands[rowBands.length - 1]
            if (!last || Math.abs(cy - last.centerY) > rowBandTolerance) {
              rowBands.push({ centerY: cy, members: [node] })
            } else {
              last.members.push(node)
              last.centerY = last.members.reduce((sum, item) => {
                const itemCy = (Number(item?.position?.y) || 0) + Math.max(GRID_UNIT, Number(item?.height ?? item?.style?.height ?? approximateNodeHeight)) / 2
                return sum + itemCy
              }, 0) / last.members.length
            }
          }

          const sortedRows = rowBands.sort((a, b) => a.centerY - b.centerY)
          const rowGap = HALF_UNIT_GAP
          const rowHeights = sortedRows.map((row) => {
            const heights = row.members.map((n) => Math.max(GRID_UNIT, Number(n?.height ?? n?.style?.height ?? approximateNodeHeight)))
            return snapSizeToGrid(Math.max(...heights, approximateNodeHeight))
          })
          const totalRowsHeight = rowHeights.reduce((sum, h) => sum + h, 0) + rowGap * Math.max(0, sortedRows.length - 1)
          let cursorY = snapToGrid(contentY)
          if (totalRowsHeight > contentH) {
            cursorY = snapToGrid(contentY)
          }

          for (let rowIdx = 0; rowIdx < sortedRows.length; rowIdx += 1) {
            const row = sortedRows[rowIdx]
            row.members.sort((a, b) => (Number(a?.position?.x) || 0) - (Number(b?.position?.x) || 0))
            const count = row.members.length
            if (count === 0) continue
            const targetWidth = snapSizeToGrid(clampRange(
              (contentW - rowGap * Math.max(0, count - 1)) / Math.max(1, count),
              MIN_W,
              MAX_W,
            ))

            for (const node of row.members) {
              const curW = Math.max(GRID_UNIT, Number(node?.width ?? node?.style?.width ?? targetWidth))
              const curH = Math.max(GRID_UNIT, Number(node?.height ?? node?.style?.height ?? approximateNodeHeight))
              const nextW = Math.abs(curW - targetWidth) <= nearSizeToleranceW * 1.2 ? targetWidth : curW
              setNodeSizeLike(node, nextW, curH)
            }

            const totalRowWidth = row.members.reduce(
              (sum, node) => sum + Math.max(GRID_UNIT, Number(node?.width ?? node?.style?.width ?? targetWidth)),
              0,
            ) + rowGap * Math.max(0, count - 1)
            const startX = totalRowWidth <= contentW
              ? snapToGrid(contentX)
              : snapToGrid(contentX + Math.max(0, (contentW - totalRowWidth) / 2))
            const rowHeight = rowHeights[rowIdx] ?? approximateNodeHeight
            let cursorX = startX
            for (const node of row.members) {
              const w = Math.max(GRID_UNIT, Number(node?.width ?? node?.style?.width ?? targetWidth))
              const h = Math.max(GRID_UNIT, Number(node?.height ?? node?.style?.height ?? approximateNodeHeight))
              node.position.x = snapToGrid(cursorX)
              node.position.y = snapToGrid(cursorY + Math.max(0, (rowHeight - h) / 2))
              cursorX += w + rowGap
            }
            cursorY += rowHeight + rowGap
          }

          const rowCounts = sortedRows.map((row) => row.members.length)
          const rowVariance = rowCounts.length >= 2 ? Math.max(...rowCounts) - Math.min(...rowCounts) : 0
          const overlapAfterRowLayout = hasAnyOverlap(eligible, HALF_UNIT_GAP * 0.25)
          const mixedLike = rowCounts.length >= 2 && (rowVariance >= 1 || overlapAfterRowLayout)
          if (mixedLike) {
            regularizeMixedGridInGroup(String(group.id), eligible)
          }
          recursivelyRegularizedGroupIds.add(String(group.id))
        }
      }
      regularizeGroupChildrenRecursive(String(group.id))
    }
  }

  const didRecursiveGroupRegularize = !hasLaneGroupsInDraft && groups.length > 0
  if (!hasLaneGroupsInDraft && groups.length > 0) {
    regularizeGroupChildrenRecursive(undefined)
  }

  // 识图对齐：纵向强约束、横向弱约束；明显跳脱节点保持绝对位置。
  // 注意：包含结构做了递归硬规则排版后，避免再次平滑打乱已规整结果。
  const alignAxis = (axis: 'x' | 'y') => {
    const tolerance = axis === 'y' ? verticalAlignTolerance : horizontalAlignTolerance
    const byParent = new Map<string, Array<{ id: string; value: number }>>()
    for (const node of nodes) {
      if (outlierNodeIds.has(String(node.id))) continue
      if (node.parentId && recursivelyRegularizedGroupIds.has(String(node.parentId))) continue
      const key = node.parentId ? `p:${node.parentId}` : 'root'
      const arr = byParent.get(key)
      const value = axis === 'x' ? node.position.x : node.position.y
      if (arr) arr.push({ id: node.id, value })
      else byParent.set(key, [{ id: node.id, value }])
    }
    for (const list of byParent.values()) {
      if (list.length < 2) continue
      const sorted = [...list].sort((a, b) => a.value - b.value)
      let cluster: Array<{ id: string; value: number }> = [sorted[0]]
      const flush = () => {
        if (cluster.length < 2) return
        if (axis === 'x' && cluster.length < 3) return
        const avg = cluster.reduce((sum, item) => sum + item.value, 0) / cluster.length
        const aligned = snapToGrid(avg)
        for (const item of cluster) {
          const node = nodes.find((n) => n.id === item.id)
          if (!node) continue
          if (axis === 'x') {
            const old = Number(node.position?.x) || 0
            const maxShift = GRID_UNIT * 3
            const shifted = old + clampShiftDelta(aligned - old, maxShift)
            node.position.x = snapToGrid(shifted)
          } else {
            node.position.y = aligned
          }
        }
      }
      for (let i = 1; i < sorted.length; i += 1) {
        const cur = sorted[i]
        const prev = sorted[i - 1]
        if (Math.abs(cur.value - prev.value) <= tolerance) {
          cluster.push(cur)
        } else {
          flush()
          cluster = [cur]
        }
      }
      flush()
    }
  }
  if (!didRecursiveGroupRegularize) {
    alignAxis('x')
    alignAxis('y')
  }

  // 识图递归规整：保持“大布局”相对关系不变的前提下，
  // 在每个父容器内做网格化细排版（间距平滑 + 行列更整齐）。
  const recursiveParentMap = new Map<string, any[]>()
  for (const node of nodes) {
    const key = node.parentId ? `p:${node.parentId}` : 'root'
    const arr = recursiveParentMap.get(key)
    if (arr) arr.push(node)
    else recursiveParentMap.set(key, [node])
  }
  const groupChildrenByParent = new Map<string, any[]>()
  for (const group of groups) {
    const pid = groupParentById.get(group.id)
    const key = pid ? `p:${pid}` : 'root'
    const arr = groupChildrenByParent.get(key)
    if (arr) arr.push(group)
    else groupChildrenByParent.set(key, [group])
  }

  const smoothAxisSpacing = (
    list: any[],
    axis: 'x' | 'y',
    maxShift: number,
  ) => {
    if (list.length < 2) return
    const eligible = list.filter((node) => !outlierNodeIds.has(String(node.id)))
    if (eligible.length < 2) return
    const axisKey = axis === 'x' ? 'w' : 'h'
    const entries = eligible
      .map((node) => {
        const rawSize =
          axis === 'x'
            ? Number(node?.[axisKey] ?? node?.width ?? node?.style?.width)
            : Number(node?.[axisKey] ?? node?.height ?? node?.style?.height)
        const size = Math.max(GRID_UNIT, Number.isFinite(rawSize) ? rawSize : GRID_UNIT)
        const pos = Number(axis === 'x' ? node?.position?.x : node?.position?.y) || 0
        return {
          node,
          size,
          center: pos + size / 2,
        }
      })
      .sort((a, b) => a.center - b.center)
    if (entries.length < 2) return

    const axisAlignTolerance = axis === 'y' ? verticalAlignTolerance : horizontalAlignTolerance
    const bandTolerance = Math.max(GRID_UNIT, Math.round(axisAlignTolerance * 0.9))
    const bands: Array<{ members: typeof entries; center: number }> = []
    for (const entry of entries) {
      const last = bands[bands.length - 1]
      if (!last) {
        bands.push({ members: [entry], center: entry.center })
        continue
      }
      if (Math.abs(entry.center - last.center) <= bandTolerance) {
        last.members.push(entry)
        last.center = last.members.reduce((sum, item) => sum + item.center, 0) / last.members.length
      } else {
        bands.push({ members: [entry], center: entry.center })
      }
    }
    if (bands.length < 2) return

    const sortedBands = bands.sort((a, b) => a.center - b.center)
    const observedGaps: number[] = []
    for (let i = 1; i < sortedBands.length; i += 1) {
      const gap = sortedBands[i].center - sortedBands[i - 1].center
      if (gap > 0.001) observedGaps.push(gap)
    }
    // 间距不再硬限制，改为按该组观察到的“全局平均间距”做近似统一。
    const observedMedianGap = pickMedian(observedGaps, GRID_UNIT * 6)
    const desiredCenterGap = Math.max(
      GRID_UNIT * 2,
      snapToGrid(observedMedianGap),
    )

    const targets: number[] = []
    const startCenter = snapToGrid(sortedBands[0].center)
    for (let i = 0; i < sortedBands.length; i += 1) {
      targets.push(startCenter + i * desiredCenterGap)
    }
    const sourceMid = (sortedBands[0].center + sortedBands[sortedBands.length - 1].center) / 2
    const targetMid = (targets[0] + targets[targets.length - 1]) / 2
    const centerOffset = snapToGrid(sourceMid - targetMid)
    for (let i = 0; i < targets.length; i += 1) {
      targets[i] = snapToGrid(targets[i] + centerOffset)
    }

    for (let i = 0; i < sortedBands.length; i += 1) {
      const targetCenter = targets[i]
      const band = sortedBands[i]
      for (const item of band.members) {
        const oldPos = Number(axis === 'x' ? item.node?.position?.x : item.node?.position?.y) || 0
        const oldCenter = oldPos + item.size / 2
        const shiftedCenter = oldCenter + clampShiftDelta(targetCenter - oldCenter, maxShift)
        const nextPos = snapToGrid(shiftedCenter - item.size / 2)
        if (axis === 'x') item.node.position.x = nextPos
        else item.node.position.y = nextPos
      }
    }
  }

  const strictMode = Boolean(opts?.preserveLayoutStrict)
  const strongShift = strictMode ? GRID_UNIT * 8 : GRID_UNIT * 10
  const mediumShift = strictMode ? GRID_UNIT * 6 : GRID_UNIT * 8

  const regularizeByParent = (parentId?: string) => {
    const key = parentId ? `p:${parentId}` : 'root'
    if (parentId && recursivelyRegularizedGroupIds.has(String(parentId))) {
      const subGroups = groupChildrenByParent.get(key) ?? []
      for (const subgroup of subGroups) {
        regularizeByParent(String(subgroup.id))
      }
      return
    }
    const directNodes = recursiveParentMap.get(key) ?? []
    if (directNodes.length >= 2) {
      const xs = directNodes.map((node) => Number(node?.position?.x) || 0)
      const ys = directNodes.map((node) => Number(node?.position?.y) || 0)
      const spreadX = Math.max(...xs) - Math.min(...xs)
      const spreadY = Math.max(...ys) - Math.min(...ys)
      // 纵向优先规整；横向仅在模型明显表达横向主链时做轻微平滑。
      smoothAxisSpacing(directNodes, 'y', strongShift)
      if (spreadX > spreadY * 1.25) {
        smoothAxisSpacing(directNodes, 'x', mediumShift)
      }
    }

    const subGroups = groupChildrenByParent.get(key) ?? []
    for (const subgroup of subGroups) {
      regularizeByParent(String(subgroup.id))
    }
  }
  if (!didRecursiveGroupRegularize) {
    regularizeByParent(undefined)
    // 规整后再做一次“近似对齐”收口，确保阈值生效。
    alignAxis('x')
    alignAxis('y')
  }

  // 全场景防重叠：优先移动非 outlier，跳脱节点尽量保持绝对位置。
  const resolveOverlaps = () => {
    const byParent = new Map<string, any[]>()
    for (const node of nodes) {
      const key = node.parentId ? `p:${node.parentId}` : 'root'
      const arr = byParent.get(key)
      if (arr) arr.push(node)
      else byParent.set(key, [node])
    }
    for (let pass = 0; pass < maxShiftPass; pass += 1) {
      let changed = false
      for (const scoped of byParent.values()) {
        if (scoped.length < 2) continue
        for (let i = 0; i < scoped.length; i += 1) {
          for (let j = i + 1; j < scoped.length; j += 1) {
            const a = scoped[i]
            const b = scoped[j]
            const aBox = {
              x: Number(a.position?.x) || 0,
              y: Number(a.position?.y) || 0,
              w: Math.max(GRID_UNIT, Number(a.width ?? 160)),
              h: Math.max(GRID_UNIT, Number(a.height ?? 56)),
            }
            const bBox = {
              x: Number(b.position?.x) || 0,
              y: Number(b.position?.y) || 0,
              w: Math.max(GRID_UNIT, Number(b.width ?? 160)),
              h: Math.max(GRID_UNIT, Number(b.height ?? 56)),
            }
            if (!intersects(aBox, bBox, avoidGap)) continue
            const aOut = outlierNodeIds.has(String(a.id))
            const bOut = outlierNodeIds.has(String(b.id))
            if (aOut && bOut) continue
            const movable = aOut ? b : a
            const mBox = aOut ? bBox : aBox
            const fBox = aOut ? aBox : bBox
            const overlapX = Math.min(mBox.x + mBox.w, fBox.x + fBox.w) - Math.max(mBox.x, fBox.x)
            const overlapY = Math.min(mBox.y + mBox.h, fBox.y + fBox.h) - Math.max(mBox.y, fBox.y)
            if (overlapX <= 0 || overlapY <= 0) continue
            const dx = (mBox.x + mBox.w / 2) >= (fBox.x + fBox.w / 2) ? 1 : -1
            const dy = (mBox.y + mBox.h / 2) >= (fBox.y + fBox.h / 2) ? 1 : -1
            if (overlapX < overlapY) {
              const shift = snapToGrid(overlapX + GRID_UNIT) * dx
              movable.position.x = snapToGrid((Number(movable.position?.x) || 0) + shift)
            } else {
              const shift = snapToGrid(overlapY + GRID_UNIT) * dy
              movable.position.y = snapToGrid((Number(movable.position?.y) || 0) + shift)
            }
            changed = true
          }
        }
      }
      if (!changed) break
    }
  }
  resolveOverlaps()

  for (const node of nodes) {
    nodeAbsBoxById.set(node.id, {
      x: node.position.x,
      y: node.position.y,
      w: Math.max(GRID_UNIT, Number(node.width ?? approximateNodeWidth)),
      h: Math.max(GRID_UNIT, Number(node.height ?? approximateNodeHeight)),
    })
  }

  if (structured.groups.length === 0 && !opts?.preserveLayoutStrict) {
    // 实验能力：在“尽量复刻”前提下做轻微去重叠，且每次位移都严格走网格。
    // 只做小步平移，不重排整体拓扑，不触发任何 Dagre/ELK 自动布局。
    for (let pass = 0; pass < maxShiftPass; pass += 1) {
      let changed = false
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]
          const b = nodes[j]
          const aBox = {
            x: a.position.x,
            y: a.position.y,
            w: Math.max(GRID_UNIT, Number(a.width ?? 160)),
            h: Math.max(GRID_UNIT, Number(a.height ?? 56)),
          }
          const bBox = {
            x: b.position.x,
            y: b.position.y,
            w: Math.max(GRID_UNIT, Number(b.width ?? 160)),
            h: Math.max(GRID_UNIT, Number(b.height ?? 56)),
          }
          if (!intersects(aBox, bBox, avoidGap)) continue

          const dx = (bBox.x + bBox.w / 2) - (aBox.x + aBox.w / 2)
          const dy = (bBox.y + bBox.h / 2) - (aBox.y + aBox.h / 2)
          if (Math.abs(dx) >= Math.abs(dy)) {
            b.position.x = snapToGrid(b.position.x + (dx >= 0 ? microShift : -microShift))
          } else {
            b.position.y = snapToGrid(b.position.y + (dy >= 0 ? microShift : -microShift))
          }
          changed = true
        }
      }
      if (!changed) break
    }
  }

  const groupsAdjusted = groups.map((g) => {
    const parentId = groupParentById.get(g.id)
    if (!parentId) return g
    const parentAbs = groupAbsBoxById.get(parentId)
    const selfAbs = groupAbsBoxById.get(g.id)
    if (!parentAbs || !selfAbs) return g
    return {
      ...g,
      parentId,
      position: {
        x: snapToGrid(selfAbs.x - parentAbs.x),
        y: snapToGrid(selfAbs.y - parentAbs.y),
      },
    }
  })

  const nodesAdjusted = nodes.map((n) => {
    if (!n.parentId) return n
    const parentAbs = groupAbsBoxById.get(n.parentId)
    const selfAbs = nodeAbsBoxById.get(n.id)
    if (!parentAbs || !selfAbs) return n
    return {
      ...n,
      position: {
        x: snapToGrid(selfAbs.x - parentAbs.x),
        y: snapToGrid(selfAbs.y - parentAbs.y),
      },
    }
  })

  const boxById = new Map(nodeAbsBoxById)
  const edges = structured.edges.map((e, idx) => {
    const s = boxById.get(e.from)
    const t = boxById.get(e.to)
    const handles = s && t ? inferHandlesByGeometry(s, t) : { sourceHandle: 's-right', targetHandle: 't-left' }
    return {
      id: `e-${idx + 1}`,
      source: e.from,
      target: e.to,
      type: 'smoothstep',
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      ...(e.label ? { label: e.label } : {}),
      data: {
        relation: e.relation,
        labelTextOnly: true,
        layoutProfile: 'free-layout',
      },
      style: { strokeWidth: 1 },
    }
  })

  const outputNodes = [...groupsAdjusted, ...nodesAdjusted]
  return {
    schema: 'flow2go.ai.diagram.v1',
    title: structured.title || '自由布局（图生图）',
    nodes: outputNodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    rawText: structured.rawText,
  }
}

function parseImageStructuredResponse(raw: string): AiImageStructuredDraft {
  const cleaned = stripCodeFences(raw).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('识图阶段返回的不是合法 JSON')
  }
  return validateImageStructuredDraft(parsed, raw)
}

function scoreImageStructuredDraftQuality(draft: AiImageStructuredDraft): number {
  const conf = draft.confidence ?? {
    geometry: 0.5,
    hierarchy: 0.5,
    color: 0.5,
    scene: 0.5,
    overall: 0.5,
  }
  const nodeCount = draft.nodes.length
  const edgeCount = draft.edges.length
  const groupsCount = draft.groups.length
  const hierarchyRatio = nodeCount > 0 ? draft.nodes.filter((n) => n.parentId != null || n.lane != null).length / nodeCount : 0
  const colorRatio =
    nodeCount + groupsCount > 0
      ? (draft.nodes.filter((n) => n.style != null).length + draft.groups.filter((g) => g.style != null).length) /
        (nodeCount + groupsCount)
      : 0
  const topologyScore = Math.min(1, (nodeCount / 16) * 0.7 + Math.min(edgeCount, nodeCount * 2) / Math.max(1, nodeCount * 2) * 0.3)
  return (
    conf.overall * 0.55 +
    conf.geometry * 0.15 +
    conf.hierarchy * 0.12 +
    conf.color * 0.08 +
    hierarchyRatio * 0.06 +
    colorRatio * 0.02 +
    topologyScore * 0.02
  )
}

function pickBetterImageStructuredDraft(a: AiImageStructuredDraft, b: AiImageStructuredDraft): AiImageStructuredDraft {
  const sa = scoreImageStructuredDraftQuality(a)
  const sb = scoreImageStructuredDraftQuality(b)
  if (sb > sa + 0.03) return b
  if (sa > sb + 0.03) return a

  // 分数接近时，优先保留层级与颜色更完整的一份。
  const aHierarchy = a.confidence?.hierarchy ?? 0
  const bHierarchy = b.confidence?.hierarchy ?? 0
  if (bHierarchy > aHierarchy + 0.05) return b
  if (aHierarchy > bHierarchy + 0.05) return a
  const aColor = a.confidence?.color ?? 0
  const bColor = b.confidence?.color ?? 0
  if (bColor > aColor + 0.05) return b
  if (aColor > bColor + 0.05) return a
  return b.nodes.length >= a.nodes.length ? b : a
}

async function openRouterSceneRoute(args: OpenRouterChatOptions): Promise<SceneRouteV2> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  // Key 可选：生产环境可通过服务端代理环境变量提供
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: SCENE_ROUTER_SYSTEM_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })

  const parsed = parseSceneRouteJson(raw)
  if (!parsed) throw new Error('Scene Router 输出不是合法 JSON')
  return parsed
}

async function openRouterDiagramPlanner(
  args: OpenRouterChatOptions & { templateKey: UserTemplateKey; complexityMode: ComplexityMode; extraUserHint?: string },
): Promise<string> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS, templateKey, complexityMode, extraUserHint } = args
  const key = (apiKey ?? '').trim()
  // Key 可选：生产环境可通过服务端代理环境变量提供
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: DIAGRAM_PLANNER_SYSTEM_PROMPT,
    user: [
      `【templateKey】${templateKey}`,
      `【complexityMode】${complexityMode}`,
      '',
      '【用户原文】',
      prompt.trim(),
      ...(extraUserHint ? ['', '【Planner 失败原因/额外强制】', extraUserHint] : []),
    ].join('\n'),
    signal,
    timeoutMs,
    temperature: STABLE_GENERATION_TEMPERATURE,
  })

  const s = raw.trim()
  if (!s) throw new Error('Diagram Planner 返回空文本')

  // planner 必须是严格 JSON；否则回退旧逻辑，保持现有链路稳定性。
  const cleaned = stripCodeFences(s).trim()
  let obj: unknown
  try {
    obj = JSON.parse(cleaned)
  } catch {
    throw new Error('Diagram Planner 输出不是合法 JSON')
  }
  // 压缩输出，减少 Mermaid 生成器的 token 消耗。
  return JSON.stringify(obj)
}

export async function openRouterGenerateDiagram(opts: OpenRouterChatOptions): Promise<AiDiagramDraft> {
  const {
    apiKey,
    model,
    prompt,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    diagramScene: sceneHint,
    onProgress,
  } = opts
  const key = (apiKey ?? '').trim()
  // Key 可选：生产环境可通过服务端代理环境变量提供
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const elapsed = () => Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
  const report = (phase: string, detail?: string) => {
    const elapsedMs = elapsed()
    try {
      onProgress?.({ phase, detail, elapsedMs })
    } catch {
      /* 进度回调不应影响生成 */
    }
    console.info(`[Flow2Go AI] +${elapsedMs}ms`, phase, detail ?? '')
  }

  const originalPrompt = prompt.trim()
  const longInput = originalPrompt.length >= LONG_INPUT_SUMMARY_THRESHOLD
  const forceMindMapScene = sceneHint === 'mind-map'
  const timeoutMsForPipeline = longInput ? Math.max(timeoutMs, LONG_INPUT_TIMEOUT_MS) : timeoutMs
  let planningPrompt = originalPrompt
  // 全场景统一：不做“先摘要再生图”。
  // 改为先通过 Diagram Planner 做逻辑简化与顺序梳理，再生成 Mermaid。
  const commonPlannerLogicalHint = [
    '【逻辑简化优先（全场景强制）】',
    '- 不要先做输入摘要；直接基于原文做结构化规划。',
    '- 先整理逻辑顺序，保证语义通顺，再输出结构。',
    '- 合并重复/近义表达，删除无关噪音，避免跳步与断层。',
    '- 若信息过多，优先保留主链与关键约束，次要细节下沉。',
  ].join('\n')
  report('已开始', sceneHint ? `场景胶囊: ${sceneHint}` : '自动路由')
  let chosen: UserTemplateKey = 'Frontend-Backend Flow Template'
  let plannerText: string | null = null
  let route: SceneRouteV2 | null = null
  let layoutDecision: LayoutDecision | null = null

  const mindMapFromHint = forceMindMapScene
  const mindMapFromText = sceneHint == null && detectMindMapIntent(originalPrompt)
  const forceMindMap = mindMapFromHint || mindMapFromText

  const runMindMapPlanner = async () => {
    route = {
      sceneKind: 'mind-map',
      complexityMode: 'chapters',
      layoutProfileKey: null,
      pipeline: 'mind-map',
    }
    chosen = 'Mind Map Template'
    layoutDecision = resolveLayoutDecision(route)
    plannerText = await openRouterDiagramPlanner({
      apiKey: key,
      model,
      prompt: planningPrompt,
      signal,
      timeoutMs: timeoutMsForPipeline,
      templateKey: chosen,
      complexityMode: toPlannerComplexity(route.complexityMode),
      extraUserHint: commonPlannerLogicalHint,
    })
  }

  const runFlowchartByLayoutSelector = async () => {
    const sel = await openRouterSelectLayoutProfile({
      apiKey: key,
      model,
      prompt: planningPrompt,
      signal,
      timeoutMs: timeoutMsForPipeline,
    })
    route = layoutProfileResultToFallbackRoute(sel)
    // 流程图默认走紧凑复杂度，优先可读性与简洁度。
    route = { ...route, complexityMode: 'compact' }
    // 长输入自动降复杂度：优先可读性与稳定性。
    if (longInput && route.complexityMode !== 'compact') {
      route = { ...route, complexityMode: 'compact' }
    }
    layoutDecision = resolveLayoutDecision(route)
    chosen = sel.layoutProfileKey
    const simpleFlowHint = [
      '【流程图转译约束（强制）】',
      '- 强制简化：优先主链，删除次要步骤，合并重复动作，宁可少不要乱。',
      '- 默认 1 by 1：普通节点仅一个下游；仅 decision 允许 yes/no 两分支且尽快收敛。',
      '- group 克制：仅按阶段分组；跨 group 连线仅允许阶段交接，禁止来回横跳。',
      '- 方向固定 LR，主路径不得回头；整体保持稀疏、清晰、易读。',
      '- 若信息过多，优先保留主流程并压缩细节。',
    ].join('\n')
    plannerText = await openRouterDiagramPlanner({
      apiKey: key,
      model,
      prompt: planningPrompt,
      signal,
      timeoutMs: timeoutMsForPipeline,
      templateKey: chosen,
      complexityMode: toPlannerComplexity(route.complexityMode),
      extraUserHint: `${commonPlannerLogicalHint}\n${simpleFlowHint}`,
    })
  }

  // Scene Router → LayoutDecision；Diagram Planner；失败则 Layout Selector + 可选 Planner 回退
  try {
    if (forceMindMap) {
      report('Diagram Planner（思维导图）', '请求中…')
      await runMindMapPlanner()
    } else if (sceneHint === 'flowchart') {
      report('布局选择器', '请求中…')
      await runFlowchartByLayoutSelector()
    } else {
      report('场景路由（Scene Router）', '请求中…')
      route = await openRouterSceneRoute({
        apiKey: key,
        model,
        prompt: planningPrompt,
        signal,
        timeoutMs: timeoutMsForPipeline,
      })
      report('场景路由完成', `pipeline=${route.pipeline}`)
      layoutDecision = resolveLayoutDecision(route)
      chosen = route.pipeline === 'mind-map' ? 'Mind Map Template' : (route.layoutProfileKey as LayoutProfileKey)
      report('Diagram Planner', `${chosen}`)
      plannerText = await openRouterDiagramPlanner({
        apiKey: key,
        model,
        prompt: planningPrompt,
        signal,
        timeoutMs: timeoutMsForPipeline,
        templateKey: chosen,
        complexityMode: toPlannerComplexity(route.complexityMode),
        extraUserHint: commonPlannerLogicalHint,
      })
    }
  } catch {
    plannerText = null
    route = null
    layoutDecision = null
    if (mindMapFromHint || mindMapFromText) {
      try {
        await runMindMapPlanner()
      } catch {
        plannerText = null
      }
    } else if (sceneHint === 'flowchart') {
      try {
        await runFlowchartByLayoutSelector()
      } catch {
        plannerText = null
      }
    } else if (detectMindMapIntent(planningPrompt)) {
      try {
        await runMindMapPlanner()
      } catch {
        plannerText = null
      }
    } else {
      try {
        await runFlowchartByLayoutSelector()
      } catch {
        plannerText = null
      }
    }
  }
  report(
    '路由与结构规划阶段结束',
    plannerText ? `Planner 已就绪（约 ${plannerText.length} 字）` : '无 Planner，将用用户原文',
  )

  const effectivePrompt = plannerText ?? planningPrompt

  if (!route || !layoutDecision) {
    throw new Error('内部错误：Scene route 或布局决策缺失')
  }

  const baseMermaidSystem = DEFAULT_MERMAID_SYSTEM_PROMPT

  let system: string
  if (chosen === 'Mind Map Template') {
    system = [
      baseMermaidSystem,
      '',
      layoutDecisionSystemSnippet(layoutDecision),
      '',
      '模板名称（兼容，等同管道标识）：Mind Map Template',
      '',
      MIND_MAP_MERMAID_SUBGRAPH_RULES,
      '',
      '【边数量控制（强制）】',
      '- 如果关系很多：优先用“汇总节点/分组”替代全连接，避免每对节点都连边',
      '- 一般情况下，边数量尽量控制在：edges <= nodes + 3',
      '- 避免同一对节点重复多条边；避免交叉边过多',
    ].join('\n')
  } else {
    const profileKey = chosen as LayoutProfileKey
    system = [
      baseMermaidSystem,
      '',
      layoutDecisionSystemSnippet(layoutDecision),
      '',
      `模板名称（兼容，等同 layout profile）：${profileKey}`,
      '',
      LAYOUT_PROFILE_SUBGRAPH_RULES[profileKey],
    ].join('\n')
  }

  const user = DEFAULT_MERMAID_USER_TEMPLATE.replaceAll('{{prompt}}', effectivePrompt)

  const mindMapJsonMermaidHint = [
    '【必须依据 Planner JSON 生成思维导图 Mermaid】',
    '你在 user 里收到的是严格 JSON（来自 Diagram Planner）与用户原始语义。不要固定成 3 层；必须按语义拆解真实层级深度。',
    '1) 根节点：以核心主题作为 root。',
    '2) 递归展开：根据主题 -> 分域 -> 模块 -> 子模块 -> 要点等语义递归生成层级，深度由内容决定（通常 2~6 层）。',
    '3) 连线关系只表示父子归属；默认无边标签，确有必要时才用短中文边标签。',
    '4) 禁止：任何 subgraph / end / frame / 画框 / 编组。',
    '5) 禁止：生成步骤式“流程图语序/章节链条”；只能做树状发散。',
    '6) Mermaid 第一行必须是 flowchart LR。',
    '7) 所有节点文本必须短词化：2~8个汉字，严禁整句；超过10个字必须先压缩。',
    '8) 禁止主副标题写法（包括 ｜ 或 \\n）；思维导图节点只能单行短标题。',
  ].join('\n')

  const generateOnce = async (extraUserHint?: string, mermaidStepLabel?: string) => {
    report('大模型生成 Mermaid', mermaidStepLabel ?? '等待模型返回…')
    const userPrompt = extraUserHint ? `${user}\n\n${extraUserHint}` : user
    let content = ''
    let lastError: unknown = null
    const retryTimeout = Math.max(timeoutMsForPipeline + 30_000, 120_000)
    for (let i = 0; i < 2; i += 1) {
      const attemptTimeout = i === 0 ? timeoutMsForPipeline : retryTimeout
      try {
        if (i === 1) {
          report('大模型生成 Mermaid', `超时兜底重试（${Math.round(attemptTimeout / 1000)}s）…`)
        }
        content = await openRouterChatComplete({
          apiKey: key,
          model,
          system,
          user: userPrompt,
          signal,
          timeoutMs: attemptTimeout,
          temperature: STABLE_GENERATION_TEMPERATURE,
        })
        break
      } catch (e) {
        lastError = e
        const msg = e instanceof Error ? e.message : String(e)
        const isRetryable =
          !signal?.aborted &&
          (msg.includes('请求超时') || msg.includes('aborted') || msg.includes('中断') || msg.includes('timed out'))
        if (!isRetryable || i === 1) throw e
      }
    }
    if (!content) throw (lastError instanceof Error ? lastError : new Error('大模型生成 Mermaid 失败'))
    report('Mermaid 文本已返回', `约 ${content.length} 字，解析与物化中…`)

    const mermaidLayoutProfile: string | undefined = chosen === 'Mind Map Template' ? 'mind-map' : 'flowchart'

    const draft = await convertMermaidToAiDraft(content, {
      layoutProfile: mermaidLayoutProfile,
    })
    const nodeN = Array.isArray(draft.nodes) ? draft.nodes.length : 0
    report('解析与物化完成', `约 ${nodeN} 个节点`)
    return draft
  }

  if (chosen === 'Mind Map Template') {
    const dm = await generateOnce(mindMapJsonMermaidHint, '思维导图')
    report('生成完成', '思维导图')
    return dm
  }
  const d1 = await generateOnce(undefined, '主生成')
  const nodesCount = Array.isArray(d1.nodes) ? d1.nodes.length : 0
  const edgesCount = Array.isArray(d1.edges) ? d1.edges.length : 0
  const tooComplex = isFlowchartOverComplex(nodesCount, edgesCount)
  if (tooComplex) {
    report('复杂度守门触发', `首次结果过密：nodes=${nodesCount}, edges=${edgesCount}，执行强压缩重生…`)
    const d2 = await generateOnce(
      [
        '【复杂度守门（强制重生）】首次结果过于复杂，必须显著简化：',
        `- 节点上限：${FLOWCHART_GUARD_NODE_MAX}`,
        `- 连线上限：${FLOWCHART_GUARD_EDGE_MAX}`,
        `- 连线密度上限：edges <= nodes + ${FLOWCHART_GUARD_EDGE_OVER_NODE_ALLOWANCE}`,
        '- 主链仅保留 4~8 步；分支最多 2 个；回流最多 1 条。',
        '- 合并重复/近义节点；禁止碎节点、禁止跨分支大量连线、禁止全连接。',
        '- 若信息过多，宁可省略次要细节，不要牺牲可读性。',
      ].join('\n'),
      '复杂度守门重生',
    )
    const nodes2 = Array.isArray(d2.nodes) ? d2.nodes.length : 0
    const edges2 = Array.isArray(d2.edges) ? d2.edges.length : 0
    const stillTooComplex = isFlowchartOverComplex(nodes2, edges2)
    if (stillTooComplex) {
      report('复杂度守门结果', `重生后仍偏复杂（nodes=${nodes2}, edges=${edges2}），返回更优候选`)
      const score1 = flowchartComplexityScore(nodesCount, edgesCount)
      const score2 = flowchartComplexityScore(nodes2, edges2)
      return score2 <= score1 ? d2 : d1
    }
    report('复杂度守门通过', `重生后收敛：nodes=${nodes2}, edges=${edges2}`)
    return d2
  }
  report('生成完成', '流程图/通用')
  return d1
}

async function getImageNaturalSizeFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const width = Number((img as any).naturalWidth ?? img.width)
      const height = Number((img as any).naturalHeight ?? img.height)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        reject(new Error('无法读取图片尺寸'))
        return
      }
      resolve({ width, height })
    }
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
}

function deriveCanvasSizeFromNaturalImageSize(natural: { width: number; height: number }): { width: number; height: number } {
  const FALLBACK = { width: 1800, height: 1000 }
  const w = Number(natural.width)
  const h = Number(natural.height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return FALLBACK

  const MAX_W = 2400
  const MAX_H = 1500
  const MIN_W = 1200
  const MIN_H = 720

  let scale = Math.min(MAX_W / w, MAX_H / h)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  if (scale > 1) scale = Math.min(scale, 1.25)

  let width = Math.round(w * scale)
  let height = Math.round(h * scale)

  if (width < MIN_W) {
    const ratio = MIN_W / Math.max(1, width)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  if (height < MIN_H) {
    const ratio = MIN_H / Math.max(1, height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  if (width > MAX_W) {
    const ratio = MAX_W / width
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  if (height > MAX_H) {
    const ratio = MAX_H / height
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  const snap = (n: number, min: number) => Math.max(min, Math.round(n / GRID_UNIT) * GRID_UNIT)
  return {
    width: snap(width, 960),
    height: snap(height, 640),
  }
}

export async function openRouterGenerateDiagramFromImage(
  opts: OpenRouterImageToDiagramOptions,
): Promise<{ draft: AiDiagramDraft; structured: AiImageStructuredDraft }> {
  const {
    apiKey,
    model,
    recognitionModel,
    generationModel,
    imageDataUrl,
    prompt,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    diagramScene,
    onProgress,
  } = opts
  const key = (apiKey ?? '').trim()
  if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    throw new Error('请先选择有效的图片文件（png/jpg/svg/webp）')
  }

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const elapsed = () => Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
  const report = (phase: string, detail?: string) => {
    const elapsedMs = elapsed()
    try {
      onProgress?.({ phase, detail, elapsedMs })
    } catch {
      /* no-op */
    }
    console.info(`[Flow2Go AI] +${elapsedMs}ms`, phase, detail ?? '')
  }

  const recogModel = (recognitionModel ?? model ?? generationModel ?? '').trim() || 'qwen/qwen2.5-vl-72b-instruct'

  const imageRecognitionMaxTokens = 4096
  report('识图阶段1', '提取结构骨架（场景/分组/节点/连线）…')
  const recognitionStage1Raw = await openRouterChatCompleteByMessages({
    apiKey: key,
    model: recogModel,
    signal,
    timeoutMs,
    temperature: STABLE_GENERATION_TEMPERATURE,
    maxTokens: imageRecognitionMaxTokens,
    messages: [
      { role: 'system', content: IMAGE_TO_STRUCTURED_STAGE1_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              '请识别这张图并输出结构化 JSON（阶段1：结构骨架）。',
              prompt?.trim() ? `额外要求：${prompt.trim()}` : '额外要求：无',
              '如果无法确定细节，请保持结构简洁并使用 next 关系。',
            ].join('\n'),
          },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  })
  const stage1Structured = parseImageStructuredResponse(recognitionStage1Raw)
  report(
    '识图阶段1完成',
    `nodes=${stage1Structured.nodes.length}, edges=${stage1Structured.edges.length}, groups=${stage1Structured.groups.length}`,
  )

  let structured = stage1Structured
  try {
    report('识图阶段2', '补全层级归属与颜色样式…')
    const stage1Payload = JSON.stringify({
      schema: stage1Structured.schema,
      title: stage1Structured.title,
      sceneHint: stage1Structured.sceneHint,
      lanes: stage1Structured.lanes,
      groups: stage1Structured.groups,
      nodes: stage1Structured.nodes,
      edges: stage1Structured.edges,
      confidence: stage1Structured.confidence,
    })
    const recognitionStage2Raw = await openRouterChatCompleteByMessages({
      apiKey: key,
      model: recogModel,
      signal,
      timeoutMs,
      temperature: STABLE_GENERATION_TEMPERATURE,
      maxTokens: imageRecognitionMaxTokens,
      messages: [
        { role: 'system', content: IMAGE_TO_STRUCTURED_STAGE2_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '请在阶段1骨架上做细节增强，尤其是 parentId 层级关系与颜色样式。',
                '禁止大幅改动阶段1拓扑；尽量保留节点 id 与边关系。',
                prompt?.trim() ? `额外要求：${prompt.trim()}` : '额外要求：无',
                '【阶段1骨架 JSON】',
                stage1Payload,
              ].join('\n'),
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    })
    const stage2Structured = parseImageStructuredResponse(recognitionStage2Raw)
    structured = pickBetterImageStructuredDraft(stage1Structured, stage2Structured)
    report(
      '识图阶段2完成',
      `chosen=stage${structured === stage2Structured ? 2 : 1}, conf=${(structured.confidence?.overall ?? 0).toFixed(2)}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    report('识图阶段2回退', `采用阶段1结果：${msg}`)
    structured = stage1Structured
  }
  report(
    '识图结构化完成',
    `nodes=${structured.nodes.length}, edges=${structured.edges.length}, groups=${structured.groups.length}, conf=${(structured.confidence?.overall ?? 0).toFixed(2)}`,
  )

  let canvasSize = { width: 1800, height: 1000 }
  try {
    const natural = await getImageNaturalSizeFromDataUrl(imageDataUrl)
    canvasSize = deriveCanvasSizeFromNaturalImageSize(natural)
    report('识图尺寸映射', `${natural.width}×${natural.height} -> ${canvasSize.width}×${canvasSize.height}`)
  } catch {
    report('识图尺寸映射', `fallback -> ${canvasSize.width}×${canvasSize.height}`)
  }

  // 图生图统一走“识图结构直出”链路，不再走文本二次生成，
  // 避免把图片中的真实布局压缩成模板化排布。
  const sceneConfidence = structured.confidence?.scene ?? 1
  const sceneFromImage =
    structured.sceneHint === 'auto' || sceneConfidence < 0.45 ? undefined : structured.sceneHint
  const shouldRenderSwimlane =
    diagramScene === 'swimlane' ||
    sceneFromImage === 'swimlane' ||
    hasSwimlaneSignalsFromStructured(structured)

  if (shouldRenderSwimlane) {
    const hasLaneGroups = structured.groups.some((g) => g.kind === 'lane')
    const swimlaneStructured =
      hasLaneGroups
        ? structured
        : ensureStructuredSwimlaneGeometry(structured)
    report(
      '泳道图识图直出',
      hasLaneGroups
        ? '保留识图泳道坐标与层级关系'
        : '检测到泳道语义，自动补齐泳道分区并保留坐标',
    )
    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(swimlaneStructured, {
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
    })
    report('识图落图完成', '泳道图（结构直出）已生成')
    return { draft, structured: swimlaneStructured }
  }

  report('自由布局复刻', '按识图坐标直接还原节点与连线（不走二次文本生成）')
  const draft = buildFreeLayoutDraftFromImageStructured(structured, {
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
  })
  report('识图落图完成', '自由布局已生成')
  return { draft, structured }
}
