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

import { parseMermaidFlowchart, transpileMermaidFlowIR } from './mermaid'
import { materializeGraphBatchPayloadToSnapshot } from './mermaid/apply'

const DEFAULT_TIMEOUT_MS = 45_000

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
  '【流程图 layout profile（软提示）】',
  '- profile 名称仅作语义参考（前后端链路 / 数据管道 / Agent / 审批 / 架构 / 用户旅程等），按 Planner JSON 与用户诉求组织 subgraph 与节点即可。',
  '- 不强制固定分区标题、不强制最少 subgraph 数量；需要分组时用 subgraph，不需要时可少画框或扁平节点。',
  '- 画布上：子图内部与顶层画框/节点的相对位置由 Flow2Go 内置 Dagre 自动布局；间距遵循 Dagre 默认值，无需为留白而删减内容。',
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

async function openRouterChatComplete(args: {
  apiKey: string
  model: string
  system: string
  user: string
  signal?: AbortSignal
  timeoutMs: number
  temperature: number
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
    const requestBody = JSON.stringify({
      model: args.model,
      temperature: args.temperature,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
    })
    let res = await fetch('/api/openrouter/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.apiKey ? { 'x-openrouter-key': args.apiKey } : {}),
      },
      signal: mergedController.signal,
      body: requestBody,
    })
    if ((res.status === 404 || res.status === 405) && args.apiKey?.trim()) {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${args.apiKey.trim()}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Flow2Go',
        },
        signal: mergedController.signal,
        body: requestBody,
      })
    }

    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter 错误 ${res.status}: ${text}`)
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
  if (opts?.layoutProfile) {
    transpiled.data.meta = {
      ...(transpiled.data.meta ?? {}),
      layoutProfile: opts.layoutProfile,
    }
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
const LONG_INPUT_TIMEOUT_MS = 90_000
const FLOWCHART_GUARD_NODE_MAX = 20
const FLOWCHART_GUARD_EDGE_MAX = 26

const DIAGRAM_PLANNER_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Diagram Planner / Graph Normalizer（规划器）。',
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
  '- 【需求简洁化（规划阶段）】在仍忠实用户目标的前提下，把输入压缩成最少必要主干：合并重复步骤、去掉与制图无关的说明、不要为“显得完整”而虚构子系统或空阶段。',
  '- 【可读性优先（强）】默认生成“简单易懂”的流程：节点总量优先控制在 8~18；主链 4~8 步；分支最多 2 个；回流最多 1 条；禁止跨分支大量连接。',
  '- mainChain：用一句白话写清端到端主路径；supportStrategy / feedbackStrategy 若无独立价值可写「无」或极短一句。',
  '- structure.framesOrRoot：层次够用即可，不要为了填满模板而堆空壳阶段；constraints.targetNodeCountHintRange 宜略保守（宁可少节点，细节可留给用户画布上补充）。',
  '- 仍禁止输出 Mermaid、禁止输出具体节点 id 与边表达式。',
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
    temperature: 0.2,
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
    const simpleFlowHint =
      '【流程简化（强制）】请优先可读性：主链 4~7 步，节点总量尽量 7~15，分支 <=2，回流 <=1；跨组连线尽量为 0。若信息过多，请合并同类步骤并省略次要支线。'
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
          temperature: 0.2,
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
  const tooComplex = nodesCount > FLOWCHART_GUARD_NODE_MAX || edgesCount > FLOWCHART_GUARD_EDGE_MAX
  if (tooComplex) {
    report('复杂度守门触发', `首次结果过密：nodes=${nodesCount}, edges=${edgesCount}，执行强压缩重生…`)
    const d2 = await generateOnce(
      [
        '【复杂度守门（强制重生）】首次结果过于复杂，必须显著简化：',
        `- 节点上限：${FLOWCHART_GUARD_NODE_MAX}`,
        `- 连线上限：${FLOWCHART_GUARD_EDGE_MAX}`,
        '- 主链仅保留 4~8 步；分支最多 2 个；回流最多 1 条。',
        '- 合并重复/近义节点；禁止碎节点、禁止跨分支大量连线、禁止全连接。',
        '- 若信息过多，宁可省略次要细节，不要牺牲可读性。',
      ].join('\n'),
      '复杂度守门重生',
    )
    const nodes2 = Array.isArray(d2.nodes) ? d2.nodes.length : 0
    const edges2 = Array.isArray(d2.edges) ? d2.edges.length : 0
    const stillTooComplex = nodes2 > FLOWCHART_GUARD_NODE_MAX || edges2 > FLOWCHART_GUARD_EDGE_MAX
    if (stillTooComplex) {
      report('复杂度守门结果', `重生后仍偏复杂（nodes=${nodes2}, edges=${edges2}），返回更优候选`)
      const score1 = nodesCount + edgesCount * 0.8
      const score2 = nodes2 + edges2 * 0.8
      return score2 <= score1 ? d2 : d1
    }
    report('复杂度守门通过', `重生后收敛：nodes=${nodes2}, edges=${edges2}`)
    return d2
  }
  report('生成完成', '流程图/通用')
  return d1
}
