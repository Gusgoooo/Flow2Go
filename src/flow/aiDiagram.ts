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

export type OpenRouterChatOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
}

import { parseMermaidFlowchart, transpileMermaidFlowIR } from './mermaid'
import { materializeGraphBatchPayloadToSnapshot } from './mermaid/apply'

const DEFAULT_TIMEOUT_MS = 45_000

import FRONTEND_BACKEND_TMPL from '../../usertemplate/01_frontend_backend_flow_template.md?raw'
import DATA_PIPELINE_TMPL from '../../usertemplate/02_data_pipeline_flow_template.md?raw'
import AGENT_WORKFLOW_TMPL from '../../usertemplate/03_agent_workflow_template.md?raw'
import APPROVAL_WORKFLOW_TMPL from '../../usertemplate/04_approval_workflow_template.md?raw'
import SYSTEM_ARCH_TMPL from '../../usertemplate/05_system_architecture_template.md?raw'
import USER_JOURNEY_TMPL from '../../usertemplate/06_user_journey_template.md?raw'
import BUSINESS_BIG_MAP_TMPL from '../../usertemplate/07_business_big_map_template.md?raw'
import MIND_MAP_TMPL from '../../usertemplate/08_mind_map_template.md?raw'
import MERMAID_GENERATOR_SYSTEM_PROMPT from './aiPromptPresets/mermaid-generator-system-prompt.md?raw'

export type UserTemplateKey =
  | 'Frontend-Backend Flow Template'
  | 'Data Pipeline Flow Template'
  | 'Agent Workflow Template'
  | 'Approval Workflow Template'
  | 'System Architecture Template'
  | 'User Journey Template'
  | 'Business Big Map Template'
  | 'Mind Map Template'

const USER_TEMPLATES: Record<UserTemplateKey, string> = {
  'Frontend-Backend Flow Template': FRONTEND_BACKEND_TMPL,
  'Data Pipeline Flow Template': DATA_PIPELINE_TMPL,
  'Agent Workflow Template': AGENT_WORKFLOW_TMPL,
  'Approval Workflow Template': APPROVAL_WORKFLOW_TMPL,
  'System Architecture Template': SYSTEM_ARCH_TMPL,
  'User Journey Template': USER_JOURNEY_TMPL,
  'Business Big Map Template': BUSINESS_BIG_MAP_TMPL,
  'Mind Map Template': MIND_MAP_TMPL,
}

export const TEMPLATE_SELECTOR_SYSTEM_PROMPT = [
  '你是 Flow2Go 的模板选择器。',
  '',
  '你的任务不是直接生成图，而是先判断当前用户需求最适合使用哪一种模板，再按对应模板的结构要求去生成。',
  '',
  '可选模板只有以下 8 种：',
  '1. Frontend-Backend Flow Template',
  '2. Data Pipeline Flow Template',
  '3. Agent Workflow Template',
  '4. Approval Workflow Template',
  '5. System Architecture Template',
  '6. User Journey Template',
  '7. Business Big Map Template',
  '8. Mind Map Template',
  '',
  '选择规则：',
  '- 涉及页面、接口、服务、数据库请求链路，优先 Frontend-Backend Flow',
  '- 涉及采集、清洗、加工、仓库、指标、消费，优先 Data Pipeline',
  '- 涉及 Planner、Executor、Reviewer、Tools、RAG、Memory，优先 Agent Workflow',
  '- 涉及申请、审核、驳回、会签、通知、归档，优先 Approval Workflow',
  '- 涉及平台模块、服务分层、基础设施、第三方依赖，优先 System Architecture',
  '- 涉及用户阶段、触点、行为、痛点、机会点，优先 User Journey',
  '- 涉及战略全景图、能力地图、知识结构图、系统分层大图、方案拆解图、业务总览图，优先 Business Big Map',
  '- 涉及思维导图、脑图、层级展开、树状联想、主题分支展开，优先 Mind Map',
  '',
  '如果需求同时满足多个模板：',
  '- 优先选择最接近用户核心意图的模板',
  '- 其次选择最能体现结构分层的模板',
  '- 避免混用多个模板导致结构失焦',
  '',
  '输出要求（强制）：',
  '- 只能输出“模板名称”这一行（必须与上述 8 个模板名称完全一致）',
].join('\n')

export type FrameTypeKey = 'Type A' | 'Type B' | 'Type C' | 'Type D' | 'Type E' | 'Type F'
export type BusinessStyleKey = '样式1' | '样式2' | '样式3' | '样式4'

export const FRAME_SELECTOR_SYSTEM_PROMPT = [
  '你是 Flow2Go 的画框选择器。',
  '',
  '你的任务不是直接生成内容，而是先根据用户输入内容的结构复杂度与层级关系，判断应使用哪一种 frame 类型。',
  '',
  '可选 frame 类型：',
  '- Type A：横向概览条',
  '- Type B：双栏模块板',
  '- Type C：多列卡片组',
  '- Type D：左标题章节块',
  '- Type E：极简横向承载',
  '- Type F：双层嵌套复杂区',
  '',
  '判断标准：',
  '1. 平级概览 → A / E',
  '2. 左右两域 → B',
  '3. 多模块并列、每个模块下 2~3 个要点 → C',
  '4. 章节式信息块 → D',
  '5. 多层嵌套结构 → F',
  '',
  '输出要求（强制）：',
  '- 只能输出 “Type A / Type B / Type C / Type D / Type E / Type F” 其中之一，不要输出任何其他文字。',
].join('\n')

export async function openRouterSelectFrameType(args: OpenRouterChatOptions): Promise<FrameTypeKey> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: FRAME_SELECTOR_SYSTEM_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })
  const normalized = raw.replace(/\s+/g, ' ').trim()
  const candidates: FrameTypeKey[] = ['Type A', 'Type B', 'Type C', 'Type D', 'Type E', 'Type F']
  const exact = candidates.find((c) => c === normalized)
  if (exact) return exact
  const fuzzy = candidates.find((c) => normalized.toLowerCase().includes(c.toLowerCase()))
  return fuzzy ?? 'Type F'
}

export const BUSINESS_STYLE_SELECTOR_PROMPT = [
  '你是 Flow2Go 的业务大图样式选择器。',
  '',
  '你的任务不是直接生成内容，而是先在以下 4 种参考样式中选择一个最合适的：',
  '- 样式1：单层横向摘要条（frame 内直接并列 quad）',
  '- 样式2：双栏模块板（frame 内 2 个大 group，每个 group 内 2xN 网格）',
  '- 样式3：多列小组（frame 内多个并列 group，每个 group 内 2 个纵向 quad）',
  '- 样式4：左标题章节块 + 多个子 group（中高密度、板块感强、适合业务总览）',
  '',
  '判断规则：',
  '1. 低密度概览：样式1',
  '2. 左右两域：样式2',
  '3. 多模块并列且每模块少量要点：样式3',
  '4. 章节式业务大图/能力地图/战略全景：样式4',
  '5. 若输入存在明显“左右对照”词（对比/双域/AB/左右），优先样式2；若存在“并列模块+少量要点”，优先样式3。',
  '',
  '输出要求（强制）：',
  '- 只能输出：样式1 或 样式2 或 样式3 或 样式4（仅一项）',
].join('\n')

export async function openRouterSelectBusinessStyle(args: OpenRouterChatOptions): Promise<BusinessStyleKey> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')
  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: BUSINESS_STYLE_SELECTOR_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })
  const normalized = raw.replace(/\s+/g, '').trim()
  const candidates: BusinessStyleKey[] = ['样式1', '样式2', '样式3', '样式4']
  const exact = candidates.find((c) => c === normalized)
  if (exact) return exact
  const mapped = normalized
    .replace('样式一', '样式1')
    .replace('样式二', '样式2')
    .replace('样式三', '样式3')
    .replace('样式四', '样式4')
    .replace('style1', '样式1')
    .replace('style2', '样式2')
    .replace('style3', '样式3')
    .replace('style4', '样式4')
  const exactMapped = candidates.find((c) => c === mapped)
  if (exactMapped) return exactMapped
  const fuzzy = candidates.find((c) => normalized.includes(c))
  if (fuzzy) return fuzzy
  const p = prompt
  if (/(对照|对比|双域|左右|A\/B|AB)/i.test(p)) return '样式2'
  if (/(模块|板块|能力|主题).*(要点|子项|条目)/i.test(p)) return '样式3'
  if (/(摘要|总览|概览|结论|索引)/i.test(p)) return '样式1'
  return '样式4'
}

function normalizeBusinessBigMapDraft(draft: AiDiagramDraft): AiDiagramDraft {
  const rawNodes = Array.isArray(draft.nodes) ? draft.nodes : []
  const frameById = new Map<string, any>()
  for (const n of rawNodes as any[]) {
    if (n && typeof n === 'object' && n.type === 'group' && n.data?.role === 'frame') frameById.set(n.id, n)
  }

  const parentOf = (id: string): string | null => {
    const n = frameById.get(id)
    if (!n?.parentId) return null
    return frameById.has(n.parentId) ? n.parentId : null
  }

  const childrenOf = (id: string) => {
    const out: string[] = []
    for (const [fid, n] of frameById.entries()) {
      if (n.parentId === id) out.push(fid)
    }
    return out
  }

  const topFrames: string[] = []
  for (const [fid, n] of frameById.entries()) {
    if (!n.parentId || !frameById.has(n.parentId)) topFrames.push(fid)
  }

  const depthFromRoot = (rootId: string, id: string) => {
    let d = 0
    let cur = id
    const seen = new Set<string>()
    while (cur !== rootId) {
      if (seen.has(cur)) break
      seen.add(cur)
      const p = parentOf(cur)
      if (!p) break
      d += 1
      cur = p
    }
    return cur === rootId ? d : -1
  }

  const ancestorAtDepth = (rootId: string, id: string, targetDepth: number): string | null => {
    let cur = id
    let d = depthFromRoot(rootId, id)
    if (d < 0) return null
    const seen = new Set<string>()
    while (d > targetDepth) {
      if (seen.has(cur)) break
      seen.add(cur)
      const p = parentOf(cur)
      if (!p) break
      cur = p
      d -= 1
    }
    return d === targetDepth ? cur : null
  }

  const collectLeafDepths = (rootId: string) => {
    const depths: number[] = []
    const stack = [rootId]
    const seen = new Set<string>()
    while (stack.length) {
      const cur = stack.pop() as string
      if (seen.has(cur)) continue
      seen.add(cur)
      const kids = childrenOf(cur)
      if (kids.length === 0) {
        const d = depthFromRoot(rootId, cur)
        if (d >= 1) depths.push(d)
        continue
      }
      for (const k of kids) stack.push(k)
    }
    return depths
  }

  // 同一父画框（顶层 frame）下只允许一种嵌套深度样式：
  // 选该子树最浅叶子深度作为目标层级，把更深层扁平到该层级。
  for (const rootId of topFrames) {
    const leafDepths = collectLeafDepths(rootId)
    if (!leafDepths.length) continue
    const targetLeafDepth = Math.max(1, Math.min(...leafDepths))
    for (const [fid, n] of frameById.entries()) {
      if (fid === rootId) continue
      const d = depthFromRoot(rootId, fid)
      if (d <= targetLeafDepth || d < 0) continue
      const anchor = ancestorAtDepth(rootId, fid, targetLeafDepth - 1)
      if (!anchor) continue
      n.parentId = anchor
    }
  }

  const nodes = rawNodes.map((n: any) => {
    if (!n || typeof n !== 'object') return n
    const data = { ...(n.data ?? {}) }
    if (typeof data.title === 'string') {
      data.title = data.title
        .replace(/\s*[｜|]\s*Type\s*[A-F]\s*$/i, '')
        .replace(/\s*[｜|]\s*T(?:ype)?\s*[A-F]?\s*$/i, '')
    }
    if (typeof data.label === 'string') {
      data.label = data.label
        .replace(/\s*[｜|]\s*Type\s*[A-F]\s*$/i, '')
        .replace(/\s*[｜|]\s*T(?:ype)?\s*[A-F]?\s*$/i, '')
    }
    return { ...n, data }
  })
  return {
    ...draft,
    nodes,
    edges: [],
  }
}

type NestingDepthKind = 'nest-1' | 'nest-2' | 'nest-3'

function analyzeBusinessNestingCoverage(draft: AiDiagramDraft) {
  const nodes = Array.isArray(draft.nodes) ? (draft.nodes as any[]) : []
  const frameById = new Map<string, any>()
  for (const n of nodes) {
    if (n && typeof n === 'object' && n.type === 'group' && n.data?.role === 'frame') frameById.set(n.id, n)
  }
  const childCount = new Map<string, number>()
  for (const n of frameById.values()) {
    if (!n.parentId || !frameById.has(n.parentId)) continue
    childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1)
  }
  const topFrames = [...frameById.values()].filter((f) => !f.parentId || !frameById.has(f.parentId))
  const kinds = new Set<NestingDepthKind>()
  for (const top of topFrames) {
    const hasChild = (childCount.get(top.id) ?? 0) > 0
    if (!hasChild) {
      kinds.add('nest-1')
      continue
    }
    // If any grand-child frame exists under this chapter, treat as 3-level.
    let hasGrand = false
    for (const f of frameById.values()) {
      const p = f.parentId
      if (!p || !frameById.has(p)) continue
      const pp = frameById.get(p)?.parentId
      if (pp === top.id) {
        hasGrand = true
        break
      }
    }
    kinds.add(hasGrand ? 'nest-3' : 'nest-2')
  }
  return {
    kinds,
    count: kinds.size,
    onlyKind: kinds.size === 1 ? [...kinds][0] : null,
  }
}

function analyzeBusinessFrameUniformity(draft: AiDiagramDraft): {
  ok: boolean
  mixedParentFrameIds: string[]
} {
  const nodes = Array.isArray(draft.nodes) ? (draft.nodes as any[]) : []
  const frameById = new Map<string, any>()
  for (const n of nodes) {
    if (n && typeof n === 'object' && n.type === 'group' && n.data?.role === 'frame') frameById.set(n.id, n)
  }

  const frameChildCount = new Map<string, number>()
  for (const f of frameById.values()) {
    if (!f.parentId || !frameById.has(f.parentId)) continue
    frameChildCount.set(f.parentId, (frameChildCount.get(f.parentId) ?? 0) + 1)
  }

  // Case 1 relative to a parent means: parent has direct quad nodes and no child frames.
  // We only care if a parent mixes "direct quad" with "child frames", or mixes case-2 vs case-3
  // among its direct child frames.
  const directQuadCountByFrame = new Map<string, number>()
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    if (n.type !== 'quad') continue
    if (!n.parentId) continue
    if (!frameById.has(n.parentId)) continue
    directQuadCountByFrame.set(n.parentId, (directQuadCountByFrame.get(n.parentId) ?? 0) + 1)
  }

  const mixedParentFrameIds: string[] = []

  for (const parent of frameById.values()) {
    const parentId = parent.id
    const directChildFrames = [...frameById.values()].filter((f) => f.parentId === parentId)
    if (directChildFrames.length === 0) continue // Case 1 is fine (only quads inside parent), no further check.

    const hasDirectQuads = (directQuadCountByFrame.get(parentId) ?? 0) > 0
    if (hasDirectQuads) {
      mixedParentFrameIds.push(parentId)
      continue
    }

    let hasCase2Child = false
    let hasCase3Child = false
    for (const childFrame of directChildFrames) {
      const childHasGrandChildFrames = (frameChildCount.get(childFrame.id) ?? 0) > 0
      if (childHasGrandChildFrames) hasCase3Child = true
      else hasCase2Child = true
      if (hasCase2Child && hasCase3Child) {
        mixedParentFrameIds.push(parentId)
        break
      }
    }
  }

  return {
    ok: mixedParentFrameIds.length === 0,
    mixedParentFrameIds,
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
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), args.timeoutMs)
  const mergedSignal = args.signal
    ? (AbortSignal as any).any
      ? (AbortSignal as any).any([args.signal, controller.signal])
      : controller.signal
    : controller.signal

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Flow2Go',
      },
      signal: mergedSignal,
      body: JSON.stringify({
        model: args.model,
        temperature: args.temperature,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
    })

    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter 错误 ${res.status}: ${text}`)
    const payload = JSON.parse(text)
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回内容')
    return content.trim()
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function openRouterSelectUserTemplate(args: OpenRouterChatOptions): Promise<UserTemplateKey> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: TEMPLATE_SELECTOR_SYSTEM_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })

  const normalized = raw.replace(/\s+/g, ' ').trim()
  const candidates = Object.keys(USER_TEMPLATES) as UserTemplateKey[]
  const exact = candidates.find((c) => c === normalized)
  if (exact) return exact
  const fuzzy = candidates.find((c) => normalized.toLowerCase().includes(c.toLowerCase()))
  return fuzzy ?? 'Frontend-Backend Flow Template'
}

function stripCodeFences(s: string): string {
  const t = s.trim()
  // ``` ... ```
  const fence = t.match(/^```(?:mermaid|json)?\s*([\s\S]*?)\s*```$/i)
  if (fence?.[1]) return fence[1].trim()
  return t
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

export function convertMermaidToAiDraft(rawText: string, opts?: { layoutProfile?: string }): AiDiagramDraft {
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
  const snap = materializeGraphBatchPayloadToSnapshot(transpiled.data, { replace: true })
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

type ComplexityMode = 'compact' | 'chapters'

type SceneRoute = {
  templateKey: UserTemplateKey
  sceneKind:
    | 'business-big-map'
    | 'agent-flow'
    | 'approval-flow'
    | 'data-pipeline'
    | 'business-flow'
    | 'hierarchy'
    | 'mind-map'
    | 'other'
  complexityMode: ComplexityMode
}

const SCENE_ROUTER_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Scene Router。',
  '',
  '你的任务是：根据用户原始需求，选择最适合的模板（8 种之一），并判断表达复杂度模式。',
  '',
  '你的输出必须是“纯 JSON”，不能有任何多余文本或代码块。',
  'JSON 格式：',
  '{',
  '  "templateKey": "从以下 8 个字符串中选择",',
  '  "sceneKind": "business-big-map|agent-flow|approval-flow|data-pipeline|business-flow|hierarchy|mind-map|other",',
  '  "complexityMode": "compact|chapters"',
  '}',
  '',
  '可选 templateKey：',
  '- Frontend-Backend Flow Template',
  '- Data Pipeline Flow Template',
  '- Agent Workflow Template',
  '- Approval Workflow Template',
  '- System Architecture Template',
  '- User Journey Template',
  '- Business Big Map Template',
  '- Mind Map Template',
  '',
  '路由规则（综合判断）：',
  '- 强战略/能力/知识结构/系统分层大图/业务总览：Business Big Map Template，complexityMode=chapters',
  '- 思维导图/树状联想/主题分支展开：Mind Map Template，complexityMode=chapters',
  '- 涉及接口调用链、前后端流转：Frontend-Backend Flow Template，complexityMode=compact',
  '- 涉及采集-清洗-加工-仓库-指标-消费：Data Pipeline Flow Template，complexityMode=chapters',
  '- 涉及 Planner/Executor/Agent/RAG/工具：Agent Workflow Template，complexityMode=chapters',
  '- 涉及申请/审核/驳回/通知/归档：Approval Workflow Template，complexityMode=chapters',
  '- 涉及平台分层/服务分层/基础设施/依赖：System Architecture Template，complexityMode=chapters',
  '- 涉及用户阶段/触点/行为：User Journey Template，complexityMode=chapters',
  '',
  '默认复杂度：如果不确定，优先 compact（更克制），除非明显是章节式结构（则用 chapters）。',
].join('\n')

const DIAGRAM_PLANNER_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Diagram Planner / Graph Normalizer（规划器）。',
  '',
  '你的任务：把用户原始高噪声输入，压缩成“模板可承接的结构规划文本”。',
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
  '当 templateKey 为 Business Big Map Template：',
  '- framesOrRoot 对应一级画框(frame)，并且每个 frame 必须给出 nesting case：case1/case2/case3。',
  '- case1：frame 直接承载要点（directPoints），frame 的 children 必须为空数组（不出现任何子画框）。',
  '- case2：frame 下的 children 对应 group（模块），每个 children.points 对应该 group 内的 quad 要点（直接 quad，不创建 subgroup）。',
  '- case3：frame 下的 children 对应 group（模块），每个 children.points 对应 subgroup 标题（每个 subgroup 再承载 1 个 quad，要点 label 使用该标题）。',
  '- case2/case3 时 directPoints 必须为空数组 []（禁止把要点同时放在 frame 与子模块两处）。',
  '- 明确哪些 frame/group 属于主表达区、哪些属于支撑层（写进 mainChain/supportStrategy 字段）；避免写出任何连线/边。',
  '',
  '当 templateKey 为 Mind Map Template：',
  '- framesOrRoot 的第一个元素作为中心主题（root）；其 children 为一级分支；points 为二级/要点节点。',
  '- 必须确保至少 3 层深度：根(Depth0) -> 一级分支(Depth1) -> 二级要点(Depth2)。',
  '- 要求：children 数量建议 3~6；每个一级分支的 points 数量至少 1、最多 4。',
  '- 列间距、线型由系统 mind-map 布局器与模板负责；你只负责结构信息。',
  '- 列间距、线型由系统 mind-map 布局器与模板负责。',
].join('\n')

function detectMindMapIntent(prompt: string): boolean {
  return /(思维导图|脑图|mind\s*map|树状联想|主题分支|知识梳理|层级展开)/i.test(prompt)
}

function parseSceneRouteJson(raw: string): SceneRoute | null {
  try {
    const cleaned = stripCodeFences(raw).trim()
    const obj = JSON.parse(cleaned)
    const templateKey = obj?.templateKey as UserTemplateKey | undefined
    const sceneKind = obj?.sceneKind as SceneRoute['sceneKind'] | undefined
    const complexityMode = obj?.complexityMode as ComplexityMode | undefined

    const candidates = new Set(Object.keys(USER_TEMPLATES) as UserTemplateKey[])
    if (!templateKey || !candidates.has(templateKey)) return null
    if (!sceneKind) return null
    if (complexityMode !== 'compact' && complexityMode !== 'chapters') return null
    return { templateKey, sceneKind, complexityMode }
  } catch {
    return null
  }
}

async function openRouterSceneRoute(args: OpenRouterChatOptions): Promise<SceneRoute> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
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

async function openRouterDiagramPlanner(args: OpenRouterChatOptions & { templateKey: UserTemplateKey; complexityMode: ComplexityMode }): Promise<string> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS, templateKey, complexityMode } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
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
    ].join('\n'),
    signal,
    timeoutMs,
    temperature: 0.2,
  })

  const s = raw.trim()
  if (!s) throw new Error('Diagram Planner 返回空文本')

  // planner 必须是严格 JSON；否则直接回退旧逻辑，避免影响现有 business big map 视觉稳定性。
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
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const originalPrompt = prompt.trim()
  let chosen: UserTemplateKey | null = null
  let plannerText: string | null = null
  let route: SceneRoute | null = null

  // 新链路：Scene Router -> Diagram Planner。失败则回退到旧逻辑，避免引入全局风险。
  // Mind Map：额外做“硬路由”，避免模型把思维导图当流程图（关键）。
  const forceMindMap = detectMindMapIntent(originalPrompt)
  try {
    if (forceMindMap) {
      chosen = 'Mind Map Template'
      route = { templateKey: 'Mind Map Template', sceneKind: 'mind-map', complexityMode: 'chapters' }
      plannerText = await openRouterDiagramPlanner({
        apiKey: key,
        model,
        prompt: originalPrompt,
        signal,
        timeoutMs,
        templateKey: chosen,
        complexityMode: route.complexityMode,
      })
    } else {
      route = await openRouterSceneRoute({ apiKey: key, model, prompt: originalPrompt, signal, timeoutMs })
      chosen = route.templateKey
      plannerText = await openRouterDiagramPlanner({
        apiKey: key,
        model,
        prompt: originalPrompt,
        signal,
        timeoutMs,
        templateKey: chosen,
        complexityMode: route.complexityMode,
      })
    }
  } catch {
    chosen = null
    plannerText = null
    route = null
  }

  // 兼容旧逻辑：如果 router/planner 失败，继续使用旧 template selector
  if (!chosen) {
    chosen = await openRouterSelectUserTemplate({ apiKey: key, model, prompt, signal, timeoutMs })
  }

  const templateText = USER_TEMPLATES[chosen] || ''
  const effectivePrompt = plannerText ?? originalPrompt

  // 为了最大化保留既有业务大图视觉：frameType/businessStyle 的判断尽量基于原始用户意图，
  // 生成阶段才使用 plannerText 做结构压缩与去噪。
  const frameType = chosen === 'Business Big Map Template' ? await openRouterSelectFrameType({ apiKey: key, model, prompt: originalPrompt, signal, timeoutMs }) : null
  const businessStyle =
    chosen === 'Business Big Map Template' ? await openRouterSelectBusinessStyle({ apiKey: key, model, prompt: originalPrompt, signal, timeoutMs }) : null

  const templateSubgraphRules: Record<UserTemplateKey, string> = {
    'Frontend-Backend Flow Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达分层分区；至少 4 个一级 subgraph：',
      '  - Frontend',
      '  - Gateway / BFF / API Layer',
      '  - Backend Services',
      '  - Database / Cache / External',
      '- 若后端服务有多个子域（订单/支付/用户等），允许在 Backend Services 下嵌套 subgraph 分组（V2）。',
    ].join('\n'),
    'Data Pipeline Flow Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达数据管道分区；至少 5 个一级 subgraph：',
      '  - Data Sources',
      '  - Ingestion',
      '  - Processing / Transformation',
      '  - Storage / Warehouse / Feature Store',
      '  - Serving / BI / API / Consumers',
      '- 治理/监控链路可单独做一个 subgraph：Observability / Data Quality（推荐）。',
    ].join('\n'),
    'Agent Workflow Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达模块边界，至少包含：',
      '  - User / Trigger',
      '  - Planner / Orchestrator',
      '  - Specialist Agents（可嵌套多个子 subgraph）',
      '  - Tools / Knowledge / Memory',
      '  - Reviewer / Verifier',
      '  - Output',
    ].join('\n'),
    'Approval Workflow Template': [
      '【模板落地要求（强制）】',
      '- 必须按角色或阶段用 subgraph 分组（至少 4 个）：',
      '  - Applicant',
      '  - Approvers（至少两级，可嵌套 subgraph）',
      '  - System / Notification',
      '  - Archive / Record',
    ].join('\n'),
    'System Architecture Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达系统分层（至少 6 个）：',
      '  - Users / Entry Points',
      '  - Access Layer',
      '  - Core Business Services（允许嵌套多个子 subgraph）',
      '  - Platform Capabilities',
      '  - Data Layer',
      '  - Infrastructure / External',
    ].join('\n'),
    'User Journey Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达“阶段”；至少 4 个一级 subgraph（阶段名可中文/英文混合）：',
      '  - Awareness',
      '  - Onboarding / Consideration',
      '  - Usage / Interaction',
      '  - Retention / Completion',
      '- 每个阶段内部建议用嵌套 subgraph 或节点簇表达：目标/行为/触点/系统响应/痛点/机会点（V2）。',
    ].join('\n'),
    'Business Big Map Template': [
      '【模板落地要求（强制）】',
      '- 必须生成多个一级 subgraph 作为“章节 frame”，从上到下组织（章节之间保持统一节奏）。',
      '- 一级章节数量不得超过 5 个（硬限制）。',
      '- 必须使用嵌套 subgraph 表达层级：章节(frame) → 模块(group) → 子模块(subgroup) → 要点(quad)。',
      '- 至少包含 3 个二级 subgraph（模块级 group），确保可见编组结构。',
      '- 任意父画框下，直接子画框数量不得超过 3（硬限制）。',
      `- 参考样式：${businessStyle ?? '样式4'}（来自用户提供 project.json 的样式1~4，优先按该样式的容器结构组织）。`,
      `- 已选择的主画框类型：${frameType ?? 'Type F'}（仅用于内部排版策略参考，不要写入任何标题或节点文本）。`,
      '- 不要在标题后附加任何类型后缀文本（例如：`｜Type`、`｜T`、`|T`）。',
      '- 业务大图禁止任何连线：不要输出任何 `-->` 或带标签连线。',
      '- 排版要紧凑：同层分组与节点保持统一小间距，优先规则栅格。',
      '- 控制复杂度：一级章节建议 3~5 个；每章二级模块建议 2~3 个；每个模块下要点建议 2 或 4 个（尽量偶数）。',
      '- 同一章节内的二级模块尽量保持“要点数量一致”（例如都 2 个或都 4 个），避免参差。',
      '- 画框横向平铺；节点必须使用竖向倒N（先上下，再换列），节点列数最多 2 列。',
      '- 结构多样化（硬约束）：整张业务大图必须同时出现三类章节结构：',
      '  - 章节A（Case 1）：1层嵌套（章节画框直接包含节点，不允许任何子 subgraph）',
      '  - 章节B（Case 2）：2层嵌套（章节 -> 二级画框 -> 节点；禁止出现子画框）',
      '  - 章节C（Case 3）：3层嵌套（章节 -> 二级画框 -> 子画框 -> 节点）',
      '- 每一个章节画框必须只属于上述三类之一：禁止同一章节内混用不同层数。',
      '- 严格依据 Diagram Planner 输出的 nesting case（frame.case / case1|case2|case3）生成章节嵌套层级：不得在生成阶段自行推断某个章节内部的子画框层级（尤其禁止 Case2/Case3 混搭）。',
      '- 额外嵌套一致性约束（新增，强制）：任意父画框（包含嵌套的二级/三级画框），其“直接子画框”必须保持相同的相对嵌套层级：',
      '  - 要么该父画框下所有直接子画框都不再包含子画框（全员 Case 2 相对父级），',
      '  - 要么该父画框下所有直接子画框都必须包含子画框（全员 Case 3 相对父级），',
      '  - 禁止同一父画框下同时出现“直接子画框中既有继续嵌套（Case3 相对父级）又有不继续嵌套（Case2 相对父级）”的混搭。',
      '  - 若父画框存在任何直接子画框，则禁止父画框同时直接包含 quad（禁止 Case 1 形态与 Case 2/3 形态混用）。',
      '- 1层嵌套章节：直接放 4~6 个 quad 节点即可（最简）。',
      '- 2层嵌套章节：2~3 个二级画框，每个二级画框 2~4 个节点（最简）。',
      '- 3层嵌套章节：2~3 个二级画框，每个二级画框 2~3 个子画框，每个子画框 2~4 个节点（最简）。',
      '- 嵌套样式从外向内决定：最内层（直接承载节点）统一为“主题色 6% 底 + 主题色不透明描边”的样式，不要出现截断式标题。',
      '- 所有画框标题必须自然、完整、可读，不要截断，不要附加类型尾缀。',
      '- 文案尽量不超过 5 个字；超过 5 个字必须拆成主副标题（V2）。',
    ].join('\n'),
    'Mind Map Template': [
      '【模板落地要求（强制）】',
      '- Mermaid 输出中禁止出现任何 subgraph / end：思维导图只能包含普通节点与父->子边。',
      '- 图中不得出现任何画框/子图层级（不允许创建 frame）。',
      '- Mermaid 第一行必须严格为：flowchart LR。',
      '- 禁止回边/环：请让边从左（上层/根）指向右（更深层），形成树状层级。',
      '- 节点 id 必须唯一且为小写英文字母/数字/下划线；节点 label 必须为中文且尽量短。',
      '- 布局与样式由系统 mind-map 布局器负责：',
      '  - 列式排版：根在最左列，深度越深越往右；同列纵向对齐。',
      '  - 列间距目标至少 8 个 grid units。',
      '  - 以“深度层级”为主题色顺序，节点描边粗细 strokeWidth=2。',
      '  - 边使用贝塞尔曲线效果。',
      '- 结构压缩：至少 3 层深度（根->子->孙），并确保至少存在一条“子节点->孙节点”的分支；同层节点建议 1~5 个，避免过密。',
    ].join('\n'),
  }

  const baseMermaidSystem =
    chosen === 'Business Big Map Template'
      ? DEFAULT_MERMAID_SYSTEM_PROMPT.replace('第一行必须严格为：flowchart LR', '第一行必须严格为：flowchart TB').replace(
          '  - flowchart LR',
          '  - flowchart TB',
        )
      : DEFAULT_MERMAID_SYSTEM_PROMPT

  const system = [
    baseMermaidSystem,
    '',
    '【模板强约束】',
    `模板名称：${chosen}`,
    templateText.trim(),
    '',
    templateSubgraphRules[chosen],
    '',
    '【边数量控制（强制）】',
    ...(chosen === 'Business Big Map Template'
      ? ['- 业务大图必须为 0 条边（edges = 0）']
      : [
          '- 如果关系很多：优先用“汇总节点/分组”替代全连接，避免每对节点都连边',
          '- 一般情况下，边数量尽量控制在：edges <= nodes + 3',
          '- 避免同一对节点重复多条边；避免交叉边过多',
        ]),
  ].join('\n')

  const user = DEFAULT_MERMAID_USER_TEMPLATE.replaceAll('{{prompt}}', effectivePrompt)

  const mindMapJsonMermaidHint = [
    '【必须依据 Planner JSON 生成思维导图 Mermaid】',
    '你在 user 里收到的是严格 JSON（来自 Diagram Planner）。请按以下映射生成：',
    '1) 根节点：从 structure.framesOrRoot[0].title 生成一个节点 rootId[rootTitle]',
    '2) 一级分支：对 structure.framesOrRoot[0].children 每个元素生成一个节点 childId[childTitle]',
    '3) 二级要点：对每个 children[i].points 生成节点 pointId[pointTitle]',
    '4) 连线关系（只表示归属，不要动作）：',
    '   - rootId --> childId',
    '   - childId --> pointId',
    '5) 禁止：任何 subgraph / end / frame / 画框 / 编组。',
    '6) 禁止：生成步骤式“流程图语序/章节链条”；只能做树状发散（root 并列一级分支）。',
    '7) Mermaid 第一行必须是 flowchart LR。',
  ].join('\n')

  const businessJsonMermaidHint = [
    '【必须依据 Planner JSON 生成业务大图 Mermaid】',
    '你在 user 里收到的是严格 JSON（来自 Diagram Planner）。请严格按 JSON 字段生成，不要根据语义自行推断嵌套层级。',
    '结构映射：',
    '1) chapters：structure.framesOrRoot 中每个 frame 对应一个“章节 frame”subgraph。',
    '2) frame.case 决定该章节内部的“嵌套层级类型”（且仅此一个类型）：',
    '   - case1：只在章节 frame 内生成 quad 节点（每个 directPoints 生成一个 quad）。禁止生成任何二级/三级 subgraph。',
    '   - case2：章节 frame 内为每个 children[i] 生成 group 子 subgraph；在每个 group 内只生成 quad（children[i].points）。禁止生成任何 subgroup。',
    '   - case3：章节 frame 内为每个 children[i] 生成 group 子 subgraph；在每个 group 内为 children[i].points 的每个字符串生成 subgroup 子 subgraph；每个 subgroup 里只生成 1 个 quad（quad 标题使用该字符串）。',
    '3) 强制一致性：',
    '   - 同一个章节 frame 内不得混合 case2/case3，也不得混合 quad 与 subgroup 的生成方式。',
    '   - 若 JSON 某字段为空数组，则忽略对应生成。',
    '4) 禁止：业务大图不要输出任何连线（不允许 -->）。',
  ].join('\n')

  const generateOnce = async (extraUserHint?: string) => {
    const content = await openRouterChatComplete({
      apiKey: key,
      model,
      system,
      user: extraUserHint ? `${user}\n\n${extraUserHint}` : user,
      signal,
      timeoutMs,
      temperature: 0.2,
    })

    // Mind Map：强制禁止 subgraph，避免模型“顺便画框/编组”导致不是纯节点思维导图。
    if (chosen === 'Mind Map Template' && /\bsubgraph\b/i.test(content)) {
      throw new Error('Mind Map Template forbidden subgraph')
    }

    return convertMermaidToAiDraft(content, {
      layoutProfile:
        chosen === 'Business Big Map Template'
          ? 'business-big-map'
          : chosen === 'Mind Map Template'
            ? 'mind-map'
            : undefined,
    })
  }

  if (chosen !== 'Business Big Map Template') {
    if (chosen === 'Mind Map Template') {
      // Mind Map：最多重试一次，专门修复“画框/编组/不按 JSON 映射”问题。
      try {
        return await generateOnce(mindMapJsonMermaidHint)
      } catch {
        return await generateOnce(`${mindMapJsonMermaidHint}\n\n【额外强制】必须只输出节点和父子连线，禁止任何 subgraph/end。`)
      }
    }
    const d1 = await generateOnce()

    // 轻量压缩重试（非 business big map）：避免碎节点/碎连线退化过重。
    // 只做一次重试，避免过度消耗。
    if ((route?.sceneKind ?? '') !== 'business-big-map') {
      const nodesCount = Array.isArray(d1.nodes) ? d1.nodes.length : 0
      const edgesCount = Array.isArray(d1.edges) ? d1.edges.length : 0
      const tooComplex = nodesCount > 45 || edgesCount > 60
      if (tooComplex) {
        return generateOnce('【压缩重试】节点/连线过多：必须更章节化、更合并同类、更弱化支撑关系，最多输出 3~5 个章节与少量关键要点。禁止碎节点与全连接。')
      }
    }
    return d1
  }

  // 结构配额器：
  // - 连续两次都只产出同一嵌套深度 -> 自动重试一次
  // - 目标是最小覆盖 3 种样式（3层/2层/1层）
  const attempts: AiDiagramDraft[] = []
  const analyses: ReturnType<typeof analyzeBusinessNestingCoverage>[] = []
  const uniformities: ReturnType<typeof analyzeBusinessFrameUniformity>[] = []
  const hints = [
    '',
    '【结构配额器重试】请强制混合 3 种嵌套样式并显式覆盖：3层嵌套、2层嵌套、1层嵌套；不要只输出单一深度。',
    '【结构配额器最终重试】前两次仍不达标。请优先保证 3 种嵌套样式最小覆盖，再优化美观与密度。',
  ]
  for (let i = 0; i < 2; i += 1) {
    const extra = hints[i] ? `${businessJsonMermaidHint}\n\n${hints[i]}` : businessJsonMermaidHint
    const d = await generateOnce(extra)
    attempts.push(d)
    analyses.push(analyzeBusinessNestingCoverage(d))
    uniformities.push(analyzeBusinessFrameUniformity(d))
    if (analyses[i].count >= 3 && uniformities[i].ok) return normalizeBusinessBigMapDraft(d)
  }
  const sameSingleDepthTwice = analyses[0].count === 1 && analyses[1].count === 1 && analyses[0].onlyKind === analyses[1].onlyKind
  if (sameSingleDepthTwice || analyses[1].count < 3) {
    const d3 = await generateOnce(`${businessJsonMermaidHint}\n\n${hints[2]}`)
    attempts.push(d3)
    analyses.push(analyzeBusinessNestingCoverage(d3))
    uniformities.push(analyzeBusinessFrameUniformity(d3))
    if (analyses[2].count >= 3 && uniformities[2].ok) return normalizeBusinessBigMapDraft(d3)
  }
  // 兜底：选覆盖度最高的一次结果
  let bestIndex = 0
  for (let i = 1; i < analyses.length; i += 1) {
    const scoreI = analyses[i].count + (uniformities[i]?.ok ? 0.5 : 0)
    const scoreBest = analyses[bestIndex].count + (uniformities[bestIndex]?.ok ? 0.5 : 0)
    if (scoreI > scoreBest) bestIndex = i
  }
  return normalizeBusinessBigMapDraft(attempts[bestIndex])
}

