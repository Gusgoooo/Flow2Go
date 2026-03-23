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
  | 'business-big-map'
  /** 实验：同 Planner/提示生成业务大图 Mermaid，物化时用 business-big-map-elk，仅走内置 ELK autoLayout，不做旧版 BBM 归一化 */
  | 'business-big-map-elk'
  | 'mind-map'
  | 'flowchart'

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

import BUSINESS_BIG_MAP_TMPL from '../../usertemplate/07_business_big_map_template.md?raw'
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

/** 兼容旧代码：原 8 个「模板」名称（含业务大图 / 思维导图管道标识） */
export type UserTemplateKey =
  | LayoutProfileKey
  | 'Business Big Map Template'
  | 'Mind Map Template'

/**
 * 业务大图专属系统约束（原 07_business_big_map_template.md，不再作为通用 usertemplate 内容喂给其它场景）
 */
export const BUSINESS_BIG_MAP_SYSTEM_PROMPT = BUSINESS_BIG_MAP_TMPL.trimEnd()

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
  '- pipeline：只能是 flowchart（本选择器不负责 business-big-map / mind-map，二者由 Scene Router 决定）',
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

/** 各 layout profile 的 subgraph 习惯（非全文 usertemplate，仅分组约束） */
const LAYOUT_PROFILE_SUBGRAPH_RULES: Record<LayoutProfileKey, string> = {
  'Frontend-Backend Flow Template': [
    '【布局 profile 落地要求（强制）】',
    '- 必须用 subgraph 表达分层分区；至少 4 个一级 subgraph：',
    '  - Frontend',
    '  - Gateway / BFF / API Layer',
    '  - Backend Services',
    '  - Database / Cache / External',
    '- 若后端服务有多个子域（订单/支付/用户等），允许在 Backend Services 下嵌套 subgraph 分组（V2）。',
  ].join('\n'),
  'Data Pipeline Flow Template': [
    '【布局 profile 落地要求（强制）】',
    '- 必须用 subgraph 表达数据管道分区；至少 5 个一级 subgraph：',
    '  - Data Sources',
    '  - Ingestion',
    '  - Processing / Transformation',
    '  - Storage / Warehouse / Feature Store',
    '  - Serving / BI / API / Consumers',
    '- 治理/监控链路可单独做一个 subgraph：Observability / Data Quality（推荐）。',
  ].join('\n'),
  'Agent Workflow Template': [
    '【布局 profile 落地要求（强制）】',
    '- 必须用 subgraph 表达模块边界，至少包含：',
    '  - User / Trigger',
    '  - Planner / Orchestrator',
    '  - Specialist Agents（可嵌套多个子 subgraph）',
    '  - Tools / Knowledge / Memory',
    '  - Reviewer / Verifier',
    '  - Output',
  ].join('\n'),
  'Approval Workflow Template': [
    '【布局 profile 落地要求（强制）】',
    '- 必须按角色或阶段用 subgraph 分组（至少 4 个）：',
    '  - Applicant',
    '  - Approvers（至少两级，可嵌套 subgraph）',
    '  - System / Notification',
    '  - Archive / Record',
  ].join('\n'),
  'System Architecture Template': [
    '【布局 profile 落地要求（强制）】',
    '- 必须用 subgraph 表达系统分层（至少 6 个）：',
    '  - Users / Entry Points',
    '  - Access Layer',
    '  - Core Business Services（允许嵌套多个子 subgraph）',
    '  - Platform Capabilities',
    '  - Data Layer',
    '  - Infrastructure / External',
  ].join('\n'),
  'User Journey Template': [
    '【布局 profile 落地要求（强制）】',
    '- 必须用 subgraph 表达“阶段”；至少 4 个一级 subgraph（阶段名可中文/英文混合）：',
    '  - Awareness',
    '  - Onboarding / Consideration',
    '  - Usage / Interaction',
    '  - Retention / Completion',
    '- 每个阶段内部建议用嵌套 subgraph 或节点簇表达：目标/行为/触点/系统响应/痛点/机会点（V2）。',
  ].join('\n'),
}

const MIND_MAP_MERMAID_SUBGRAPH_RULES = [
  '【思维导图 Mermaid 约束（强制）】',
  '- Mermaid 输出中禁止出现任何 subgraph / end：思维导图只能包含普通节点与父->子边。',
  '- 图中不得出现任何画框/子图层级（不允许创建 frame）。',
  '- Mermaid 第一行必须严格为：flowchart LR。',
  '- 禁止回边/环：请让边从左（上层/根）指向右（更深层），形成树状层级。',
  '- 节点 id 必须唯一且为小写英文字母/数字/下划线；节点 label 必须为中文且尽量短。',
  '- 父子关系默认用无标签连线：`父id --> 子id`。不要写 `-->|...|` 边标签，除非用户原文明确要求在某条父子边上展示语义（此时才用 `a -->|短文案| b`）。',
  '- 布局与样式由系统 mind-map 布局器负责：',
  '  - 列式排版：根在最左列，深度越深越往右；同列纵向对齐。',
  '  - 列间距目标至少 8 个 grid units。',
  '  - 以“深度层级”为主题色顺序，节点描边粗细 strokeWidth=2。',
  '  - 边使用贝塞尔曲线效果；无标签边在画布上不显示箭头，有标签边才显示箭头。',
  '- 结构压缩：至少 3 层深度（根->子->孙），并确保至少存在一条“子节点->孙节点”的分支；同层节点建议 1~5 个，避免过密。',
].join('\n')

function businessBigMapDynamicRenderRules(frameType: FrameTypeKey | null, businessStyle: BusinessStyleKey | null): string {
  return [
    '【业务大图渲染强约束（动态，与 frame/style 选择器对齐）】',
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
  ].join('\n')
}

function layoutDecisionSystemSnippet(ld: LayoutDecision): string {
  return [
    '【布局决策（轻量，仅版式/引擎偏好；具体节点与章节由 Planner JSON 与用户输入决定）】',
    `- diagramType: ${ld.diagramType}`,
    `- layoutEngine: ${ld.layoutEngine}`,
    `- layoutMode: ${ld.layoutMode}`,
    `- complexityMode: ${ld.complexityMode}`,
    `- profileId: ${ld.profileId}`,
    `- preserveBusinessBigMap: ${ld.preserveBusinessBigMap}`,
  ].join('\n')
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

function validateBusinessPlannerJson(obj: any): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const frames = obj?.structure?.framesOrRoot

  if (!Array.isArray(frames)) {
    errors.push('structure.framesOrRoot 必须是数组')
    return { ok: false, errors }
  }

  const hasCase = new Set<string>()

  const isString = (v: any): v is string => typeof v === 'string' && v.trim().length > 0
  const isStringArray = (v: any): v is string[] => Array.isArray(v) && v.every((x) => isString(x))

  const frameCaseAllowed = new Set(['case1', 'case2', 'case3'])

  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i]
    if (!f || typeof f !== 'object') {
      errors.push(`framesOrRoot[${i}] 必须是对象`)
      continue
    }

    if (!isString(f.title)) errors.push(`framesOrRoot[${i}].title 必须是非空字符串`)

    if (!frameCaseAllowed.has(f.case)) errors.push(`framesOrRoot[${i}].case 必须是 case1|case2|case3`)
    if (frameCaseAllowed.has(f.case)) hasCase.add(f.case)

    if (!isStringArray(f.directPoints)) errors.push(`framesOrRoot[${i}].directPoints 必须是 string[]`)
    if (!Array.isArray(f.children)) errors.push(`framesOrRoot[${i}].children 必须是数组`)

    if (f.case === 'case1') {
      if (Array.isArray(f.children) && f.children.length > 0) errors.push(`framesOrRoot[${i}] case1 时 children 必须为空数组`)
      if (Array.isArray(f.directPoints) && f.directPoints.length === 0) errors.push(`framesOrRoot[${i}] case1 时 directPoints 至少 1 个`)
    }

    if (f.case === 'case2') {
      if (Array.isArray(f.directPoints) && f.directPoints.length > 0) errors.push(`framesOrRoot[${i}] case2 时 directPoints 必须为空数组 []`)
      if (Array.isArray(f.children) && f.children.length === 0) errors.push(`framesOrRoot[${i}] case2 时 children 至少 1 个 group`)
    }

    if (f.case === 'case3') {
      if (Array.isArray(f.directPoints) && f.directPoints.length > 0) errors.push(`framesOrRoot[${i}] case3 时 directPoints 必须为空数组 []`)
      if (Array.isArray(f.children) && f.children.length === 0) errors.push(`framesOrRoot[${i}] case3 时 children 至少 1 个 group`)
    }

    // children 的基本结构校验（case1 不要求 children 为空以外的 children 字段）
    if (Array.isArray(f.children)) {
      f.children.forEach((c: any, j: number) => {
        if (!c || typeof c !== 'object') {
          errors.push(`framesOrRoot[${i}].children[${j}] 必须是对象`)
          return
        }
        if (!isString(c.title)) errors.push(`framesOrRoot[${i}].children[${j}].title 必须是非空字符串`)
        if (!isStringArray(c.points)) errors.push(`framesOrRoot[${i}].children[${j}].points 必须是 string[]`)
      })
    }
  }

  if (!hasCase.has('case1')) errors.push('必须至少包含 1 个 case1 的章节 frame')
  if (!hasCase.has('case2')) errors.push('必须至少包含 1 个 case2 的章节 frame')
  if (!hasCase.has('case3')) errors.push('必须至少包含 1 个 case3 的章节 frame')

  return { ok: errors.length === 0, errors }
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
 * Layout Selector：返回轻量 profile（不含 business_big_map / mind-map，二者由 Scene Router 分流）
 */
export async function openRouterSelectLayoutProfile(args: OpenRouterChatOptions): Promise<LayoutProfileSelectResult> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
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
  'business-big-map',
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
  '  "pipeline": "business-big-map" | "mind-map" | "flowchart",',
  '  "sceneKind": "business-big-map|agent-flow|approval-flow|data-pipeline|business-flow|hierarchy|mind-map|other",',
  '  "complexityMode": "compact" | "normal" | "chapters",',
  '  "layoutProfileKey": "<仅当 pipeline=flowchart 时必填，6 个布局 profile 名称之一>" | null',
  '}',
  '',
  `当 pipeline=business-big-map：layoutProfileKey 必须为 null；sceneKind 建议 business-big-map；complexityMode 建议 normal 或 chapters。`,
  `当 pipeline=mind-map：layoutProfileKey 必须为 null；sceneKind 建议 mind-map。`,
  `当 pipeline=flowchart：layoutProfileKey 必须从下列 6 个名称中精确选一个：`,
  ...LAYOUT_PROFILE_KEYS.map((k) => `  - ${k}`),
  '',
  '路由规则：',
  '- 战略全景/能力地图/业务总览大图 → pipeline=business-big-map',
  '- 思维导图/脑图/树状发散 → pipeline=mind-map',
  '- 其它流程/架构/旅程等 → pipeline=flowchart，并选对 layoutProfileKey',
  '',
  '兼容说明：若你更熟悉旧格式，也可输出 {"templateKey":"...","sceneKind":"...","complexityMode":"compact|chapters"}（8 个旧模板名之一），系统会自动转换。',
  '',
  '默认：不确定时用 flowchart + Frontend-Backend Flow Template + compact。',
].join('\n')

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
  '（templateKey：Business Big Map Template | Mind Map Template | 或 6 个 flowchart layoutProfile 名称之一）',
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

function parseSceneRouteJson(raw: string): SceneRouteV2 | null {
  try {
    const cleaned = stripCodeFences(raw).trim()
    const obj = JSON.parse(cleaned)

    const pipelineRaw = obj?.pipeline as string | undefined
    if (pipelineRaw === 'business-big-map' || pipelineRaw === 'mind-map' || pipelineRaw === 'flowchart') {
      const sceneKind = obj?.sceneKind as SceneRouteV2['sceneKind'] | undefined
      if (!sceneKind || !SCENE_ROUTER_SCENE_KINDS.includes(sceneKind)) return null
      const cm = obj?.complexityMode as string | undefined
      if (cm !== 'compact' && cm !== 'normal' && cm !== 'chapters') return null

      if (pipelineRaw === 'business-big-map') {
        return { sceneKind: 'business-big-map', complexityMode: cm, layoutProfileKey: null, pipeline: 'business-big-map' }
      }
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
        'Business Big Map Template',
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

async function openRouterDiagramPlanner(
  args: OpenRouterChatOptions & { templateKey: UserTemplateKey; complexityMode: ComplexityMode; extraUserHint?: string },
): Promise<string> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS, templateKey, complexityMode, extraUserHint } = args
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
      ...(extraUserHint ? ['', '【Planner 失败原因/额外强制】', extraUserHint] : []),
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
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS, diagramScene: sceneHint, onProgress } = opts
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
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
  const isElkBusinessMapTest = sceneHint === 'business-big-map-elk'
  report('已开始', sceneHint ? `场景胶囊: ${sceneHint}` : '自动路由')
  let chosen: UserTemplateKey = 'Frontend-Backend Flow Template'
  let plannerText: string | null = null
  let route: SceneRouteV2 | null = null
  let layoutDecision: LayoutDecision | null = null

  const mindMapFromHint = sceneHint === 'mind-map'
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
      prompt: originalPrompt,
      signal,
      timeoutMs,
      templateKey: chosen,
      complexityMode: toPlannerComplexity(route.complexityMode),
    })
  }

  const runBusinessBigMapPlanner = async () => {
    route = {
      sceneKind: 'business-big-map',
      complexityMode: 'normal',
      layoutProfileKey: null,
      pipeline: 'business-big-map',
    }
    chosen = 'Business Big Map Template'
    layoutDecision = resolveLayoutDecision(route)
    plannerText = await openRouterDiagramPlanner({
      apiKey: key,
      model,
      prompt: originalPrompt,
      signal,
      timeoutMs,
      templateKey: chosen,
      complexityMode: toPlannerComplexity(route.complexityMode),
    })
  }

  const runFlowchartByLayoutSelector = async () => {
    const sel = await openRouterSelectLayoutProfile({ apiKey: key, model, prompt: originalPrompt, signal, timeoutMs })
    route = layoutProfileResultToFallbackRoute(sel)
    layoutDecision = resolveLayoutDecision(route)
    chosen = sel.layoutProfileKey
    plannerText = await openRouterDiagramPlanner({
      apiKey: key,
      model,
      prompt: originalPrompt,
      signal,
      timeoutMs,
      templateKey: chosen,
      complexityMode: toPlannerComplexity(route.complexityMode),
    })
  }

  // Scene Router → LayoutDecision；Diagram Planner；失败则 Layout Selector + 可选 Planner 回退
  try {
    if (forceMindMap) {
      report('Diagram Planner（思维导图）', '请求中…')
      await runMindMapPlanner()
    } else if (sceneHint === 'business-big-map' || sceneHint === 'business-big-map-elk') {
      report('Diagram Planner（业务大图）', '请求中…')
      await runBusinessBigMapPlanner()
    } else if (sceneHint === 'flowchart') {
      report('布局选择器', '请求中…')
      await runFlowchartByLayoutSelector()
    } else {
      report('场景路由（Scene Router）', '请求中…')
      route = await openRouterSceneRoute({ apiKey: key, model, prompt: originalPrompt, signal, timeoutMs })
      report('场景路由完成', `pipeline=${route.pipeline}`)
      layoutDecision = resolveLayoutDecision(route)
      chosen =
        route.pipeline === 'business-big-map'
          ? 'Business Big Map Template'
          : route.pipeline === 'mind-map'
            ? 'Mind Map Template'
            : (route.layoutProfileKey as LayoutProfileKey)
      report('Diagram Planner', `${chosen}`)
      plannerText = await openRouterDiagramPlanner({
        apiKey: key,
        model,
        prompt: originalPrompt,
        signal,
        timeoutMs,
        templateKey: chosen,
        complexityMode: toPlannerComplexity(route.complexityMode),
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
    } else if (sceneHint === 'business-big-map' || sceneHint === 'business-big-map-elk') {
      try {
        await runBusinessBigMapPlanner()
      } catch {
        plannerText = null
      }
    } else if (sceneHint === 'flowchart') {
      try {
        await runFlowchartByLayoutSelector()
      } catch {
        plannerText = null
      }
    } else if (detectMindMapIntent(originalPrompt)) {
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

  // Business Big Map：对 Planner JSON 做强校验，不合格则重生成（失败才回退到原始 prompt）。
  if (chosen === 'Business Big Map Template' && plannerText) {
    const plannerComplexityForBbm = toPlannerComplexity(route?.complexityMode ?? 'chapters')
    let ok = false
    let lastErrors: string[] = []

    report('业务大图 Planner 校验', '检查 JSON 结构…')
    for (let i = 0; i < 2; i += 1) {
      try {
        const parsed = JSON.parse(plannerText)
        const v = validateBusinessPlannerJson(parsed)
        if (v.ok) {
          ok = true
          break
        }
        lastErrors = v.errors
      } catch (e: any) {
        lastErrors = [`Planner JSON parse 失败：${String(e?.message ?? e)}`]
      }

      report('Diagram Planner（业务大图修正）', `第 ${i + 1} 次重试…`)
      plannerText = await openRouterDiagramPlanner({
        apiKey: key,
        model,
        prompt: originalPrompt,
        signal,
        timeoutMs,
        templateKey: chosen,
        complexityMode: plannerComplexityForBbm,
        extraUserHint: [
          '你输出的 Planner JSON 不符合 Business Big Map 的 case/directPoints/children 约束。',
          '请严格按约束重生成：',
          ...lastErrors.map((x) => `- ${x}`),
          '',
          '再次提醒：必须是严格 JSON，不允许多余文本。',
        ].join('\n'),
      })
    }

    if (!ok) {
      report('业务大图 Planner 仍不合格', '将回退为用户原文参与生成')
      plannerText = null
    } else {
      report('业务大图 Planner 校验', '通过')
    }
  }

  const effectivePrompt = plannerText ?? originalPrompt

  // 为了最大化保留既有业务大图视觉：frameType/businessStyle 的判断尽量基于原始用户意图，
  // 生成阶段才使用 plannerText 做结构压缩与去噪。
  const frameType =
    chosen === 'Business Big Map Template' && !isElkBusinessMapTest
      ? (report('画框类型选择器', '请求中…'),
        await openRouterSelectFrameType({ apiKey: key, model, prompt: originalPrompt, signal, timeoutMs }))
      : null
  if (frameType) report('画框类型', String(frameType))

  const businessStyle =
    chosen === 'Business Big Map Template' && !isElkBusinessMapTest
      ? (report('业务样式选择器', '请求中…'),
        await openRouterSelectBusinessStyle({ apiKey: key, model, prompt: originalPrompt, signal, timeoutMs }))
      : null
  if (businessStyle) report('业务样式', String(businessStyle))

  if (!route || !layoutDecision) {
    throw new Error('内部错误：Scene route 或布局决策缺失')
  }

  const baseMermaidSystem =
    chosen === 'Business Big Map Template'
      ? DEFAULT_MERMAID_SYSTEM_PROMPT.replace('第一行必须严格为：flowchart LR', '第一行必须严格为：flowchart TB').replace(
          '  - flowchart LR',
          '  - flowchart TB',
        )
      : DEFAULT_MERMAID_SYSTEM_PROMPT

  let system: string
  if (chosen === 'Business Big Map Template' && isElkBusinessMapTest) {
    system = [
      baseMermaidSystem,
      '',
      BUSINESS_BIG_MAP_SYSTEM_PROMPT,
      '',
      '【实验：ELK 物化】生成结果将使用 meta.layoutProfile=business-big-map-elk：关闭旧版「业务大图画布归一化 / 章节专色强制」等后处理，子图与顶层位置主要由 Mermaid 物化链路里的 ELK layered（autoLayout）计算。仍须严格遵守 Planner JSON 映射与上文业务大图结构约束（含 0 边）。',
      '',
      '【边数量控制（强制）】',
      '- 业务大图必须为 0 条边（edges = 0）',
    ].join('\n')
  } else if (chosen === 'Business Big Map Template') {
    system = [
      baseMermaidSystem,
      '',
      BUSINESS_BIG_MAP_SYSTEM_PROMPT,
      '',
      businessBigMapDynamicRenderRules(frameType, businessStyle),
      '',
      '【边数量控制（强制）】',
      '- 业务大图必须为 0 条边（edges = 0）',
    ].join('\n')
  } else if (chosen === 'Mind Map Template') {
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
      '',
      '【边数量控制（强制）】',
      '- 如果关系很多：优先用“汇总节点/分组”替代全连接，避免每对节点都连边',
      '- 一般情况下，边数量尽量控制在：edges <= nodes + 3',
      '- 避免同一对节点重复多条边；避免交叉边过多',
    ].join('\n')
  }

  const user = DEFAULT_MERMAID_USER_TEMPLATE.replaceAll('{{prompt}}', effectivePrompt)

  const mindMapJsonMermaidHint = [
    '【必须依据 Planner JSON 生成思维导图 Mermaid】',
    '你在 user 里收到的是严格 JSON（来自 Diagram Planner）。请按以下映射生成：',
    '1) 根节点：从 structure.framesOrRoot[0].title 生成一个节点 rootId[rootTitle]',
    '2) 一级分支：对 structure.framesOrRoot[0].children 每个元素生成一个节点 childId[childTitle]',
    '3) 二级要点：对每个 children[i].points 生成节点 pointId[pointTitle]',
    '4) 连线关系（只表示归属；默认不要边标签、不要流程动作文案）：',
    '   - rootId --> childId',
    '   - childId --> pointId',
    '   - 仅当用户原文明确要求某条边要显示语义时，才对该边使用 rootId -->|短文案| childId（否则一律无 |...|）。',
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

  const generateOnce = async (extraUserHint?: string, mermaidStepLabel?: string) => {
    report('大模型生成 Mermaid', mermaidStepLabel ?? '等待模型返回…')
    const content = await openRouterChatComplete({
      apiKey: key,
      model,
      system,
      user: extraUserHint ? `${user}\n\n${extraUserHint}` : user,
      signal,
      timeoutMs,
      temperature: 0.2,
    })
    report('Mermaid 文本已返回', `约 ${content.length} 字，解析与物化中…`)

    // Mind Map：强制禁止 subgraph，避免模型“顺便画框/编组”导致不是纯节点思维导图。
    if (chosen === 'Mind Map Template' && /\bsubgraph\b/i.test(content)) {
      throw new Error('Mind Map Template forbidden subgraph')
    }

    const mermaidLayoutProfile: string | undefined =
      chosen === 'Business Big Map Template'
        ? isElkBusinessMapTest
          ? 'business-big-map-elk'
          : 'business-big-map'
        : chosen === 'Mind Map Template'
          ? 'mind-map'
          : undefined

    const draft = await convertMermaidToAiDraft(content, {
      layoutProfile: mermaidLayoutProfile,
    })
    const nodeN = Array.isArray(draft.nodes) ? draft.nodes.length : 0
    report('解析与物化完成', `约 ${nodeN} 个节点`)
    return draft
  }

  if (chosen !== 'Business Big Map Template') {
    if (chosen === 'Mind Map Template') {
      // Mind Map：最多重试一次，专门修复“画框/编组/不按 JSON 映射”问题。
      try {
        const dm = await generateOnce(mindMapJsonMermaidHint, '思维导图')
        report('生成完成', '思维导图')
        return dm
      } catch {
        const dm = await generateOnce(
          `${mindMapJsonMermaidHint}\n\n【额外强制】必须只输出节点和父子连线，禁止任何 subgraph/end。`,
          '思维导图（重试）',
        )
        report('生成完成', '思维导图（重试）')
        return dm
      }
    }
    const d1 = await generateOnce(undefined, '主生成')

    // 轻量压缩重试（非 business big map）：避免碎节点/碎连线退化过重。
    // 只做一次重试，避免过度消耗。
    if ((route?.sceneKind ?? '') !== 'business-big-map') {
      const nodesCount = Array.isArray(d1.nodes) ? d1.nodes.length : 0
      const edgesCount = Array.isArray(d1.edges) ? d1.edges.length : 0
      const tooComplex = nodesCount > 45 || edgesCount > 60
      if (tooComplex) {
        return generateOnce(
          '【压缩重试】节点/连线过多：必须更章节化、更合并同类、更弱化支撑关系，最多输出 3~5 个章节与少量关键要点。禁止碎节点与全连接。',
          '压缩重试',
        )
      }
    }
    report('生成完成', '流程图/通用')
    return d1
  }

  // 实验：ELK 业务大图 — 单次生成 + 不做 normalizeBusinessBigMapDraft / 结构配额器
  if (isElkBusinessMapTest) {
    try {
      const out = await generateOnce(businessJsonMermaidHint, 'ELK 业务大图')
      report('生成完成', 'ELK 业务大图')
      return out
    } catch {
      const out = await generateOnce(
        `${businessJsonMermaidHint}\n\n【补充】请保证 flowchart TB，subgraph 嵌套与 Planner JSON 一致；不要输出任何 --> 连线。`,
        'ELK 业务大图（重试）',
      )
      report('生成完成', 'ELK 业务大图（重试）')
      return out
    }
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
    const d = await generateOnce(extra, `业务大图 第 ${i + 1}/2 轮`)
    attempts.push(d)
    analyses.push(analyzeBusinessNestingCoverage(d))
    uniformities.push(analyzeBusinessFrameUniformity(d))
    if (analyses[i].count >= 3 && uniformities[i].ok) {
      report('生成完成', '业务大图（结构配额达标）')
      return normalizeBusinessBigMapDraft(d)
    }
  }
  const sameSingleDepthTwice = analyses[0].count === 1 && analyses[1].count === 1 && analyses[0].onlyKind === analyses[1].onlyKind
  if (sameSingleDepthTwice || analyses[1].count < 3) {
    const d3 = await generateOnce(`${businessJsonMermaidHint}\n\n${hints[2]}`, '业务大图 第 3 轮')
    attempts.push(d3)
    analyses.push(analyzeBusinessNestingCoverage(d3))
    uniformities.push(analyzeBusinessFrameUniformity(d3))
    if (analyses[2].count >= 3 && uniformities[2].ok) {
      report('生成完成', '业务大图（第 3 轮达标）')
      return normalizeBusinessBigMapDraft(d3)
    }
  }
  // 兜底：选覆盖度最高的一次结果
  let bestIndex = 0
  for (let i = 1; i < analyses.length; i += 1) {
    const scoreI = analyses[i].count + (uniformities[i]?.ok ? 0.5 : 0)
    const scoreBest = analyses[bestIndex].count + (uniformities[bestIndex]?.ok ? 0.5 : 0)
    if (scoreI > scoreBest) bestIndex = i
  }
  report('生成完成', '业务大图（兜底选用最高分草稿）')
  return normalizeBusinessBigMapDraft(attempts[bestIndex])
}

